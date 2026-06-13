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

# ── config ────────────────────────────────────────────────────────────────────
QWEN_PORTS     = [5004, 5005, 5006, 5007]
MODEL          = "Qwen/Qwen3-14B"
DOWNLOADED_DIR = Path("/home/mp/Projects/koryta/data/scrapers/downloaded")
OUTPUT_FILE    = Path("domain_selectors.jsonl")
CONCURRENCY    = 24   # concurrent Qwen calls (6 per server)
SAMPLES        = 3    # URLs per domain
MAX_INDEX_SCAN = 200  # lines of index.txt to consider per tarball

SKIP_RE = re.compile(
    r"/(tag|tagi|kategori\w*|category|categories|autor|author|strona|page|"
    r"archiv\w*|szukaj|search|reklam|kontakt|o-nas|redakcja|polityka-prywatnosci|"
    r"regulamin|newsletter|rejestracja|logowanie|feed|rss)/",
    re.I,
)

_port_cycle = itertools.cycle(QWEN_PORTS)


# ── tarball helpers ───────────────────────────────────────────────────────────

def _is_article_path(path: str) -> bool:
    """Heuristic: does the path look like an article (not a listing/tag page)?"""
    # strip hostname= prefix and /date=... suffix
    path = re.sub(r"/date=\d{4}-\d{2}-\d{2}$", "", path)
    path = re.sub(r"^hostname=[^/]+", "", path)
    segments = [s for s in path.split("/") if s]
    if len(segments) < 1:
        return False
    if SKIP_RE.search("/" + "/".join(segments) + "/"):
        return False
    return True


def get_candidates(tarball_path: Path) -> list[tuple[str, str]]:
    """
    Read index.txt from the tarball and return up to SAMPLES (member_name, url)
    tuples that look like articles. Reads at most MAX_INDEX_SCAN lines.
    """
    host = tarball_path.name.split(".from=")[0].replace("hostname=", "")
    candidates = []
    try:
        with tarfile.open(tarball_path, "r:gz") as tf:
            first = next(iter(tf))
            if first.name != "index.txt":
                return []
            raw = tf.extractfile(first).read().decode(errors="replace")
            lines = raw.strip().splitlines()

        import random
        window = lines[:MAX_INDEX_SCAN]
        random.shuffle(window)
        for line in window:
            line = line.strip()
            if not line:
                continue
            member_name = line.removeprefix("hostname=")
            if not _is_article_path(line):
                continue
            # reconstruct a clean URL
            url_path = re.sub(r"/date=\d{4}-\d{2}-\d{2}$", "", member_name)
            url = "https://" + url_path
            candidates.append((member_name, url))
            if len(candidates) >= SAMPLES * 3:   # oversample, extract later
                break
    except Exception as e:
        print(f"  [error] get_candidates {tarball_path.name}: {e}")
    return candidates


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
MAX_DEPTH       = 10
SKELETON_LIMIT  = 6000


def build_skeleton(tag, depth=0) -> str:
    if depth > MAX_DEPTH or not isinstance(tag, Tag):
        return ""
    if tag.name in SKIP_TAGS:
        return ""
    if depth <= 2 and tag.name in SKIP_STRUCTURAL:
        return f"{'  '*depth}<{tag.name}> <!-- skipped -->\n"

    indent = "  " * depth
    cls    = " ".join((tag.get("class") or [])[:3])
    tid    = tag.get("id", "")
    attrs  = (f' class="{cls}"' if cls else "") + (f' id="{tid}"' if tid else "")

    children = [c for c in tag.children if isinstance(c, Tag) and c.name not in SKIP_TAGS]

    if not children:
        text = tag.get_text(" ", strip=True)[:60].replace("\n", " ")
        return f"{indent}<{tag.name}{attrs}>{text}</{tag.name}>\n" if text else ""

    collapsed: list = []
    i = 0
    while i < len(children):
        c   = children[i]
        sig = (c.name, tuple((c.get("class") or [])[:3]))
        j   = i + 1
        while j < len(children) and (children[j].name, tuple((children[j].get("class") or [])[:3])) == sig:
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
    return f"{indent}<{tag.name}{attrs}>\n{inner}{indent}</{tag.name}>\n" if inner.strip() else ""


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

    Below is a structural skeleton of the HTML page (text content replaced with short snippets, repeated elements collapsed).
    Identify the single best CSS selector for the element containing the main article body text.

    Rules:
    - Return ONLY valid JSON, no markdown fences
    - Format: {{"selector": "...", "reasoning": "..."}}
    - Use soup.select_one() compatible syntax
    - Prefer SHORT selectors like "div.article-body", not long ancestor chains
    - Avoid nav, ads, related articles, comments, sidebars

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
                return result.get("selector")
        except Exception as e:
            print(f"  [warn] Qwen error for {url}: {e}")
            return None


# ── per-domain pipeline ───────────────────────────────────────────────────────

def majority_vote(selectors: list[str | None]) -> str | None:
    valid = [s for s in selectors if s]
    if not valid:
        return None
    counts = Counter(valid)
    winner, votes = counts.most_common(1)[0]
    return winner


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

                await asyncio.gather(*[handle(d, p) for d, p in todo.items()])

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
