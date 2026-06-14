"""
Generate CSS selectors for article content extraction across all domains.

For each domain:
  1. Pick 3 article URLs from the local tarball mirror
  2. Ask Qwen for a CSS selector for each
  3. Majority-vote the winner
  4. Save to domain_selectors.jsonl (resumable)
"""

import asyncio
import itertools
import json
import re
import tarfile
import textwrap
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import aiohttp
from bs4 import BeautifulSoup, Tag
from tqdm.asyncio import tqdm

# ── config ────────────────────────────────────────────────────────────────────
QWEN_PORTS     = [5004, 5005, 5006, 5007]
MODEL          = "Qwen/Qwen3-14B"
DOWNLOADED_DIR = Path("/home/mp/Projects/koryta/data/scrapers/downloaded")
OUTPUT_FILE    = Path("domain_selectors.jsonl")
CONCURRENCY    = 24   # concurrent Qwen calls (6 per server)
SAMPLES        = 3    # URLs per domain
MAX_INDEX_SCAN = 500  # lines of index.txt to consider per tarball

SKIP_DOMAINS = re.compile(r"\.naszemiasto\.pl$", re.I)

# File extensions that are never article HTML
NON_ARTICLE_EXT = re.compile(
    r"\.(php|jpg|jpeg|png|gif|mp4|avi|mov|pdf|svg|ico|xml|txt|csv|"
    r"doc|docx|xls|xlsx|webm|mp3|ogg|wav|zip|rar)$",
    re.I,
)

# Segment-level blocklist — matched as a prefix (so "katalog" blocks "katalog-firm" too).
# Strip numeric prefixes like "16_" before matching.
_SKIP_SEG_RE = re.compile(
    r"^(tag|tagi|kategori|category|categories|autor|author|strona|page|"
    r"archiv|szukaj|search|reklam|kontakt|o-nas|o-firmie|o-portalu|o-mnie|redakcja|"
    r"polityka|regulamin|newsletter|rejestracja|logowanie|feed|rss|"
    r"firma|firmy|katalog|ogloszeni|galeri|foto|fotorelacj|zdjecia|"
    r"wideo|video|materialy|ofert|klient|account|user|"
    r"dodaj|zaloguj|zapomnialem|login|register|wp-admin|wp-content|wp-includes|"
    r"forum|obszar|wydarzeni|terminarz|konkurs|przetarg|ksiegarnia|"
    r"noclegi|baza|konto|password|restore|reset|kalendarz|day|"
    r"spis|banery|wakacje|wczasy|out|about|sample-page|hello-world|"
    r"index|moje|my|opinie|formularz|contact|privacy|terms|imprint)",
    re.I,
)

# Selectors that are too generic to trust as article containers
_GENERIC_SEL_RE = re.compile(
    r"^(body|html|main|article|section|div|p|span|header|footer|aside|"
    r"div\s*>\s*main|div\s*>\s*article)$"
)

# Selectors that are clearly broken/over-specific and should be dropped
_BAD_SEL_RE = re.compile(
    r"[~+]|"            # CSS sibling combinators — unusual for article containers
    r"\.\w+-\d{4,}|"   # numeric-suffix classes like .post-67055
    r"#\w+-\d{4,}"     # numeric-suffix IDs like #post-67055
)

# Classes stripped from the SKELETON so the LLM doesn't see them.
# Keep this narrow — only strip classes that are NEVER useful as element identifiers.
# Grid/spacing classes are kept so the LLM can understand page structure.
_STRIP_CLS_RE = re.compile(
    r"^("
    r"status-\w+|"                      # WP: status-publish, status-draft
    r"is-layout-\w+|is-style-\w+|"     # WP block editor layout/style
    r"has-[\w-]+-(?:color|font|size)|" # WP block editor color/font/size variants
    r"paywalled?|premium|is-paywall|free"  # paywall state
    r")$",
    re.I,
)

# Strip only truly stateful/non-identifying classes from generated selectors.
# col-*, spacing, type-post etc. are intentionally kept — can be valid identifiers.
_STRIP_SEL_RE = re.compile(
    r"\.(?:"
    r"status-\w+|"                              # WP: status-publish, status-draft, …
    r"is-layout-\w+|is-style-\w+|"             # WP block editor layout / style
    r"has-[\w-]+|"                              # ALL WP has-* state classes
    r"single-format-\w+|"                       # WP post format
    r"type-(?:tdb_templates|attachment)|"       # TagDiv / attachment type only
    r"paywalled|paywall|premium|is-paywall|free"   # paywall state
    r")(?=[.\s#>:\[]|$)",
    re.I,
)


def _clean_selector(sel: str) -> str | None:
    """Strip utility/state classes from a generated selector; return None if result is empty/generic."""
    if not sel:
        return None
    cleaned = _STRIP_SEL_RE.sub("", sel)
    cleaned = re.sub(r"\.{2,}", ".", cleaned)   # collapse double dots
    cleaned = re.sub(r"\.$", "", cleaned)        # trailing dot
    cleaned = cleaned.strip()
    return cleaned if cleaned else None

_port_cycle = itertools.cycle(QWEN_PORTS)


# ── tarball helpers ───────────────────────────────────────────────────────────

def _segment_blocked(seg: str) -> bool:
    bare = re.sub(r"^\d+[_-]", "", seg).rsplit(".", 1)[0]
    return bool(_SKIP_SEG_RE.match(bare))


def _is_article_path(path: str) -> bool:
    """Heuristic: does the path look like an article (not a listing/tag/utility page)?"""
    path = re.sub(r"/date=\d{4}-\d{2}-\d{2}$", "", path)
    path = re.sub(r"^hostname=[^/]+", "", path)
    segments = [s for s in path.split("/") if s]
    if not segments:
        return False
    if NON_ARTICLE_EXT.search(segments[-1]):
        return False
    if any(_segment_blocked(s) for s in segments):
        return False
    if len(segments) == 1:
        # Single-segment path: allow only if the slug looks article-like
        bare = segments[0].rsplit(".", 1)[0]
        has_long_slug  = len(bare) > 15 and bare.count("-") >= 2
        has_article_id = bool(re.search(r"\d{5,}", bare))
        return has_long_slug or has_article_id
    return True


def _article_score(path: str) -> int:
    """Higher = more likely to be an article. Used to prefer best sample URLs."""
    clean = re.sub(r"^hostname=[^/]+", "", path)
    clean = re.sub(r"/date=\d{4}-\d{2}-\d{2}$", "", clean)
    segs  = [s for s in clean.split("/") if s]
    last  = segs[-1] if segs else ""
    score = 0
    # Long hyphenated slug ≈ article headline
    hyphens = last.count("-")
    if len(last) > 25 and hyphens >= 3:
        score += 3
    elif len(last) > 12 and hyphens >= 2:
        score += 2
    # Numeric article ID (5+ digits)
    if re.search(r"\d{5,}", path):
        score += 2
    # Date component in path body (not in the tarball suffix)
    if re.search(r"/20\d{2}/\d{2}/", clean):
        score += 2
    # Deeper paths are more specific
    score += min(len(segs) - 1, 2)
    return score


def get_candidates(tarball_path: Path) -> list[tuple[str, str]]:
    """
    Read index.txt from the tarball and return up to SAMPLES (member_name, url)
    tuples that look like articles, ranked by article-likeness score.
    Reads at most MAX_INDEX_SCAN lines.
    """
    candidates: list[tuple[int, str, str]] = []
    try:
        with tarfile.open(tarball_path, "r:gz") as tf:
            first = next(iter(tf))
            if first.name != "index.txt":
                return []
            raw = tf.extractfile(first).read().decode(errors="replace")
            lines = raw.strip().splitlines()

        for line in lines[:MAX_INDEX_SCAN]:
            line = line.strip()
            if not line:
                continue
            if not _is_article_path(line):
                continue
            member_name = line.removeprefix("hostname=")
            url_path    = re.sub(r"/date=\d{4}-\d{2}-\d{2}$", "", member_name)
            url         = "https://" + url_path
            score       = _article_score(line)
            candidates.append((score, member_name, url))

        # Sort highest-scoring (most article-like) first
        candidates.sort(key=lambda x: -x[0])
    except Exception as e:
        print(f"  [error] get_candidates {tarball_path.name}: {e}")
    return [(m, u) for _, m, u in candidates[: SAMPLES * 3]]


def extract_htmls(tarball_path: Path, member_names: list[str]) -> dict[str, bytes]:
    """Extract multiple members in a single sequential pass, exiting early."""
    targets = set(member_names)
    results: dict[str, bytes] = {}
    try:
        with tarfile.open(tarball_path, "r:gz") as tf:
            for member in tf:
                if member.name in targets:
                    f = tf.extractfile(member)
                    if f:
                        results[member.name] = f.read()
                    targets.discard(member.name)
                    if not targets:
                        break
    except Exception as e:
        print(f"  [error] extract_htmls {tarball_path.name}: {e}")
    return results


# ── skeleton ──────────────────────────────────────────────────────────────────

SKIP_TAGS       = {"script","style","svg","img","link","meta","noscript","iframe",
                   "picture","source","input","button","form"}
SKIP_STRUCTURAL = {"header","nav","footer"}
CONTENT_TAGS    = {"div","section","article","main","aside"}   # annotate word counts
MAX_DEPTH       = 10
SKELETON_LIMIT  = 8000

# Polish + numeric date patterns for listing-detection hint
_DATE_RE = re.compile(
    r"\b\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}\b"           # 12.06.2026 / 12-06-2026
    r"|\b20\d{2}\b"                                        # bare year 202X
    r"|(?:poniedział|wtorek|środa|czwartek|piątek|sobot|niedziel)\w*,?\s+\d{1,2}"  # weekday + day
    r"|(?:styczeń|luty|marzec|kwiecień|maj|czerwiec|lipiec|sierpień"
    r"|wrzesień|październik|listopad|grudzień)\s+20\d{2}",  # month year
    re.I,
)


_NUMERIC_CLASS_RE = re.compile(r"^[\w]+-\d+$")   # post-67055, elementor-134, page-id-456


def _clean_classes(tag: Tag) -> list[str]:
    """Strip numeric-ID and utility/state classes; keep only semantic identifiers."""
    return [c for c in (tag.get("class") or [])
            if not _NUMERIC_CLASS_RE.match(c) and not _STRIP_CLS_RE.match(c)]


def build_skeleton(tag, depth=0) -> str:
    if depth > MAX_DEPTH or not isinstance(tag, Tag):
        return ""
    if tag.name in SKIP_TAGS:
        return ""
    if depth <= 2 and tag.name in SKIP_STRUCTURAL:
        return f"{'  '*depth}<{tag.name}> <!-- skipped -->\n"

    indent = "  " * depth
    cls    = " ".join(_clean_classes(tag)[:3])
    tid    = tag.get("id", "")
    attrs  = (f' class="{cls}"' if cls else "") + (f' id="{tid}"' if tid else "")

    children = [c for c in tag.children if isinstance(c, Tag) and c.name not in SKIP_TAGS]

    if not children:
        text = tag.get_text(" ", strip=True)[:100].replace("\n", " ")
        return f"{indent}<{tag.name}{attrs}>{text}</{tag.name}>\n" if text else ""

    collapsed: list = []
    i = 0
    while i < len(children):
        c   = children[i]
        sig = (c.name, tuple(_clean_classes(c)[:3]))
        j   = i + 1
        while j < len(children) and (children[j].name, tuple(_clean_classes(children[j])[:3])) == sig:
            j += 1
        count = j - i
        collapsed.append(children[i])
        if count > 2:
            collapsed.append(f"<!-- ...{count-1} more <{c.name}> -->")
        elif count == 2:
            collapsed.append(children[i + 1])
        i = j

    inner = "".join(
        (indent + "  " + c + "\n") if isinstance(c, str) else build_skeleton(c, depth + 1)
        for c in collapsed
    )
    if not inner.strip():
        return ""

    # Annotate word count (and listing flag) for any meaningful element
    wc_hint = ""
    if tag.name in CONTENT_TAGS:
        full_text = tag.get_text(" ", strip=True)
        wc = len(full_text.split())
        if wc >= 30:
            date_hits = len(_DATE_RE.findall(full_text))
            listing = " ⚠LISTING" if date_hits >= 4 else ""
            wc_hint = f" <!-- ~{wc}w{listing} -->"

    return f"{indent}<{tag.name}{attrs}>{wc_hint}\n{inner}{indent}</{tag.name}>\n"


def html_to_skeleton(html_bytes: bytes) -> str:
    try:
        soup = BeautifulSoup(html_bytes, "html.parser")
    except Exception as e:
        print(f"  [error] html_to_skeleton: {e}")
        return ""
    body = soup.find("body") or soup
    sk   = build_skeleton(body)
    if len(sk) > SKELETON_LIMIT:
        sk = sk[:SKELETON_LIMIT] + "\n<!-- skeleton truncated -->"
    return sk


# ── LLM ──────────────────────────────────────────────────────────────────────

def strip_thinking(text: str) -> str:
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


PROMPT_TMPL = textwrap.dedent("""\
    You are helping extract article content from a Polish news website.
    URL: {url}

    HTML skeleton (text → snippets, repeated siblings collapsed):
    • <!-- ~Nw -->          element contains ~N words
    • <!-- ~Nw ⚠LISTING --> holds MULTIPLE articles — do NOT select this

    TASK: Return the ONE CSS selector that reliably captures the complete article body \
(headline + lead paragraph + body text) across ALL pages on this site — not just this one.

    STRATEGY — work outside-in:
    1. Find the broadest element that is CLEARLY a single-article container (not a whole-page \
wrapper, not a feed or listing). It must have a distinctive class or id.
    2. If that container holds NOISE (sidebar, related-articles with dates, comments), \
narrow to its largest single-article child.
    3. Stop there. Do NOT drill deeper just to exclude the headline or byline — those belong.

    HARD RULES — every rule applies:
    1. Return ONLY JSON: {{"selector": "...", "reasoning": "one sentence"}}
    2. Selector must work with soup.select_one().
    3. Use MINIMUM classes. `div.article-body` is right; `div.article-body.dark.premium` \
breaks on articles without those variant classes.
    4. No numeric-suffix classes like `.post-67055` or `.elementor-134` — article-specific, \
fails on other pages. Use only stable, generic class names.
       Also avoid responsive/layout classes (col-md-*, col-lg-*, mt-*, mb-*, px-*, g-*) — \
they change with responsive design. Use the semantic class on the same element instead.
    5. No bare tags without class/id: "body", "main", "article", "section", "div" alone are banned.
    6. No descendant chains with 3+ space-separated parts — they go too deep and miss leads.
    7. NEVER select a ⚠LISTING element.
    8. If not a news article (login, gallery, classifieds, directory, calendar, error page):
       {{"selector": null, "reasoning": "not an article page"}}

    HTML skeleton:
    {skeleton}""")


async def ask_qwen(
    session: aiohttp.ClientSession,
    sem: asyncio.Semaphore,
    skeleton: str,
    url: str,
) -> str | None:
    prompt = PROMPT_TMPL.format(url=url, skeleton=skeleton)
    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
        "max_tokens": 200,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    port = next(_port_cycle)
    async with sem:
        try:
            async with session.post(
                f"http://localhost:{port}/v1/chat/completions",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=90),
            ) as resp:
                resp.raise_for_status()
                data   = await resp.json()
                raw    = strip_thinking(data["choices"][0]["message"]["content"])
                # strip markdown fences if model wraps anyway
                raw    = re.sub(r"^```[a-z]*\n?", "", raw.strip())
                raw    = re.sub(r"\n?```$", "", raw.strip())
                result = json.loads(raw)
                return _clean_selector(result.get("selector"))
        except Exception as e:
            print(f"  [warn] Qwen error for {url}: {e}")
            return None


# ── per-domain pipeline ───────────────────────────────────────────────────────

# Known too-broad containers → better child selector (CMS-specific heuristics)
_CMS_OVERRIDES: dict[str, str] = {
    # Polish regional CMS (rawicz24.pl, ddbelchatow.pl, …)
    # section.article > div.container-custom > div.row > article + aside (sidebar)
    "section.article":    "section.article article",
    "section.article.my-4": "section.article article",
    # ZPR/Eska radio CMS: two nameless sections inside, pick the text-heavy one
    # (can't disambiguate cleanly — leave as-is, handled by not_found filter)
}


def majority_vote(selectors: list[str | None]) -> str | None:
    valid = [s for s in selectors if s]
    if not valid:
        return None
    # Discard clearly broken selectors (sibling combinators, numeric post-IDs, too long)
    valid = [s for s in valid if not _BAD_SEL_RE.search(s) and len(s) <= 120]
    if not valid:
        return None
    counts = Counter(valid)
    # Prefer the most-voted selector that isn't a bare generic tag
    for candidate, _ in counts.most_common():
        if not _GENERIC_SEL_RE.fullmatch(candidate.strip()):
            # Apply CMS-specific override if selector is a known bad pattern
            return _CMS_OVERRIDES.get(candidate, candidate)
    # All candidates are generic — return most common as fallback
    return counts.most_common(1)[0][0]


async def process_domain(
    domain: str,
    tarball_path: Path,
    session: aiohttp.ClientSession,
    sem: asyncio.Semaphore,
    executor: ThreadPoolExecutor,
) -> dict | None:
    loop = asyncio.get_event_loop()

    # 1. get candidate (member_name, url) pairs from index.txt
    candidates = await loop.run_in_executor(executor, get_candidates, tarball_path)
    if not candidates:
        print(f"  [skip] {domain}: no article candidates in index.txt")
        return None

    chosen = candidates[:SAMPLES]
    member_names = [m for m, _ in chosen]
    urls         = [u for _, u in chosen]

    # 2. extract HTMLs from tarball
    html_map = await loop.run_in_executor(executor, extract_htmls, tarball_path, member_names)
    # drop non-HTML files (PDFs, images, etc.)
    html_map = {k: v for k, v in html_map.items() if v and v.lstrip()[:1] in (b'<', b'\xef')}
    if not html_map:
        print(f"  [skip] {domain}: could not extract any HTML from tarball")
        return None

    # 3. build skeletons + ask Qwen for each
    tasks = []
    used_urls = []
    for member_name, url in zip(member_names, urls):
        html = html_map.get(member_name)
        if not html:
            continue
        skeleton = html_to_skeleton(html)
        tasks.append(ask_qwen(session, sem, skeleton, url))
        used_urls.append(url)

    if not tasks:
        print(f"  [skip] {domain}: no HTML extracted for any candidate URL")
        return None

    selectors = await asyncio.gather(*tasks)

    # 4. majority vote
    winner = majority_vote(list(selectors))
    votes  = Counter(s for s in selectors if s)

    print(f"  {domain}: {dict(votes)} → {winner}")
    return {
        "domain":       domain,
        "selector":     winner,
        "votes":        votes.get(winner, 0),
        "all_votes":    dict(votes),
        "sample_urls":  used_urls,
    }


# ── main ──────────────────────────────────────────────────────────────────────

def load_done(path: Path) -> set[str]:
    if not path.exists():
        return set()
    done = set()
    with path.open() as f:
        for line in f:
            try:
                done.add(json.loads(line)["domain"])
            except Exception as e:
                print(f"  [warn] load_done bad line: {e}")
    return done


def find_tarballs() -> dict[str, Path]:
    """Return {domain: tarball_path} for all non-empty tarballs."""
    result = {}
    pat = re.compile(r"hostname=(.+?)(?:\.from=|\.total\.)")
    for p in DOWNLOADED_DIR.glob("hostname=*.tar.gz"):
        if p.stat().st_size < 1000:
            continue
        m = pat.match(p.name)
        if not m:
            continue
        domain = m.group(1)
        if SKIP_DOMAINS.search(domain):
            continue
        if domain not in result or p.name > result[domain].name:
            result[domain] = p
    return result


async def main() -> None:
    tarballs = find_tarballs()
    done     = load_done(OUTPUT_FILE)
    todo     = {d: p for d, p in tarballs.items() if d not in done}

    print(f"Tarballs: {len(tarballs)}  Done: {len(done)}  Todo: {len(todo)}")

    sem = asyncio.Semaphore(CONCURRENCY)

    with ThreadPoolExecutor(max_workers=8) as executor:
        async with aiohttp.ClientSession() as session:
            with OUTPUT_FILE.open("a") as out:

                async def handle(domain, tarball_path):
                    try:
                        result = await process_domain(domain, tarball_path, session, sem, executor)
                        if result:
                            out.write(json.dumps(result, ensure_ascii=False) + "\n")
                            out.flush()
                    except Exception as e:
                        print(f"  [error] {domain}: {e}")

                await tqdm.gather(
                    *[handle(d, p) for d, p in todo.items()],
                    total=len(todo), desc="domains", unit="domain",
                )

    # summary
    done_now = load_done(OUTPUT_FILE)
    no_selector = 0
    with OUTPUT_FILE.open() as f:
        for line in f:
            r = json.loads(line)
            if not r.get("selector"):
                no_selector += 1
    print(f"\nDone. {len(done_now)} domains saved, {no_selector} without a selector.")


if __name__ == "__main__":
    asyncio.run(main())
