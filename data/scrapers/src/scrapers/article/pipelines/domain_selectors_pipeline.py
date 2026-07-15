import asyncio
import json
import re
import textwrap
from collections import Counter
from pathlib import Path
from typing import Any, cast

import pandas as pd
from bs4 import BeautifulSoup, Tag
from tqdm.asyncio import tqdm

from entities.util import NormalizedParse
from scrapers.article.pipelines.common import hash_bytes, is_html
from scrapers.article.pipelines.done_urls_pipeline import ArticleDoneUrls
from scrapers.article.pipelines.pipeline_utils import (
    iter_done_urls,
    llm_model,
    read_html_from_storage,
)
from scrapers.stores import Context, DoneUrl, LLMRequest, Pipeline

SELECTOR_PROMPT_VERSION = 1
SELECTOR_MAX_TOKENS = 200
SELECTOR_TEMPERATURE = 0
SELECTOR_SAMPLES = 5
SELECTOR_DOMAIN_CONCURRENCY = 8

NON_ARTICLE_EXT = re.compile(
    r"\.(php|jpg|jpeg|png|gif|mp4|avi|mov|pdf|svg|ico|xml|txt|csv|"
    r"doc|docx|xls|xlsx|webm|mp3|ogg|wav|zip|rar)$",
    re.I,
)
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
_GENERIC_SEL_RE = re.compile(
    r"^(body|html|main|article|section|div|p|span|header|footer|aside|"
    r"div\s*>\s*main|div\s*>\s*article)$"
)
_BAD_SEL_RE = re.compile(r"[~+]|\.\w+-\d{4,}|#\w+-\d{4,}")
_STRIP_CLS_RE = re.compile(
    r"^("
    r"status-\w+|"
    r"is-layout-\w+|is-style-\w+|"
    r"has-[\w-]+-(?:color|font|size)|"
    r"paywalled?|premium|is-paywall|free"
    r")$",
    re.I,
)
_STRIP_SEL_RE = re.compile(
    r"\.(?:"
    r"status-\w+|"
    r"is-layout-\w+|is-style-\w+|"
    r"has-[\w-]+|"
    r"single-format-\w+|"
    r"type-(?:tdb_templates|attachment)|"
    r"paywalled|paywall|premium|is-paywall|free"
    r")(?=[.\s#>:\[]|$)",
    re.I,
)
_SKIP_TAGS = {
    "script",
    "style",
    "svg",
    "img",
    "link",
    "meta",
    "noscript",
    "iframe",
    "picture",
    "source",
    "input",
    "button",
    "form",
}
_SKIP_STRUCTURAL = {"header", "nav", "footer"}
_CONTENT_TAGS = {"div", "section", "article", "main", "aside"}
_MAX_DEPTH = 10
_SKELETON_LIMIT = 8000
_DATE_RE = re.compile(
    r"\b\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}\b"
    r"|\b20\d{2}\b"
    r"|(?:poniedział|wtorek|środa|czwartek|piątek|sobot|niedziel)\w*,?\s+\d{1,2}"
    r"|(?:styczeń|luty|marzec|kwiecień|maj|czerwiec|lipiec|sierpień"
    r"|wrzesień|październik|listopad|grudzień)\s+20\d{2}",
    re.I,
)
_NUMERIC_CLASS_RE = re.compile(r"^[\w]+-\d+$")
_CMS_OVERRIDES: dict[str, str] = {
    "section.article": "section.article article",
    "section.article.my-4": "section.article article",
}
_PROMPT_TMPL = textwrap.dedent(
    """\
    You are helping extract article content from a Polish news website.
    URL: {url}

    HTML skeleton (text snippets, repeated siblings collapsed):
    - <!-- ~Nw --> element contains roughly N words
    - <!-- ~Nw LISTING --> holds multiple articles; do not select this

    TASK: Return the ONE CSS selector that reliably captures the complete
    article body (headline + lead paragraph + body text) across ALL pages on
    this site, not just this one.

    STRATEGY:
    1. Find the broadest element that is clearly a single-article container.
    2. If that container holds noise, narrow to its largest single-article child.
    3. Stop there. Do not drill deeper just to exclude the headline or byline.

    HARD RULES:
    1. Return ONLY JSON: {{"selector": "...", "reasoning": "one sentence"}}
    2. Selector must work with soup.select_one().
    3. Use minimum classes. Avoid variant, responsive, layout, and numeric classes.
    4. No bare tags without class/id: body, main, article, section, div are banned.
    5. No descendant chains with 3+ space-separated parts.
    6. Never select a LISTING element.
    7. If not a news article, return:
       {{"selector": null, "reasoning": "not an article page"}}

    HTML skeleton:
    {skeleton}"""
)


class ArticleDomainSelectors(Pipeline):
    filename = "article_domain_selectors"

    done_urls: ArticleDoneUrls

    def process(self, ctx: Context):
        if ctx.llm is None:
            raise ValueError("ArticleDomainSelectors requires Context.llm")

        done_df = self.done_urls.read_or_process(ctx)
        candidates = _candidate_done_urls_by_domain(iter_done_urls(done_df))
        existing = _existing_selector_rows(
            self.read(ctx) if self.output_time(ctx) is not None else None
        )
        model = llm_model(ctx)

        rows = asyncio.run(
            _generate_selectors(
                ctx,
                candidates,
                existing,
                model=model,
            )
        )
        return pd.DataFrame.from_records(rows)


def _existing_selector_rows(df: pd.DataFrame | None) -> dict[str, dict[str, Any]]:
    if df is None:
        return {}
    rows: dict[str, dict[str, Any]] = {}
    for row in df.replace({pd.NA: None}).to_dict(orient="records"):
        domain = row.get("domain")
        if isinstance(domain, str) and domain:
            rows[domain] = cast(dict[str, Any], row)
    return rows


def _selector_cache_valid(row: dict[str, Any], model: str) -> bool:
    return (
        row.get("selector_prompt_version") == SELECTOR_PROMPT_VERSION
        and row.get("model") == model
    )


async def _generate_selectors(
    ctx: Context,
    candidates_by_domain: dict[str, list[DoneUrl]],
    existing: dict[str, dict[str, Any]],
    *,
    model: str,
) -> list[dict[str, Any]]:
    assert ctx.llm is not None
    await ctx.llm.check_health()
    rows: list[dict[str, Any]] = []
    domain_concurrency = max(
        1,
        int(
            getattr(ctx, "article_workers", SELECTOR_DOMAIN_CONCURRENCY)
            or SELECTOR_DOMAIN_CONCURRENCY
        ),
    )
    semaphore = asyncio.Semaphore(domain_concurrency)

    tasks = []
    for domain, candidates in sorted(candidates_by_domain.items()):
        cached = existing.get(domain)
        if cached is not None and _selector_cache_valid(cached, model):
            rows.append(cached)
            continue
        tasks.append(
            _build_selector_sample_for_domain_limited(
                semaphore,
                ctx,
                domain,
                candidates,
                model=model,
            )
        )
    if tasks:
        for task in tqdm.as_completed(
            tasks,
            total=len(tasks),
            desc="Building selector samples",
            unit="domain",
            dynamic_ncols=True,
            mininterval=1.0,
            smoothing=0.05,
        ):
            rows.append(await task)

    prompt_rows = [row for row in rows if row.get("status") == "needs_llm"]
    rows = [row for row in rows if row.get("status") != "needs_llm"]
    if prompt_rows:
        rows.extend(await _generate_selector_prompt_rows(ctx, prompt_rows, model=model))

    return sorted(rows, key=lambda row: str(row.get("domain") or ""))


async def _build_selector_sample_for_domain_limited(
    semaphore: asyncio.Semaphore,
    ctx: Context,
    domain: str,
    candidates: list[DoneUrl],
    *,
    model: str,
) -> dict[str, Any]:
    async with semaphore:
        return await _build_selector_sample_for_domain(
            ctx,
            domain,
            candidates,
            model=model,
        )


async def _build_selector_sample_for_domain(
    ctx: Context,
    domain: str,
    candidates: list[DoneUrl],
    *,
    model: str,
) -> dict[str, Any]:
    if not candidates:
        return _selector_status_row(domain, None, "no_candidates", model)

    chosen = candidates[: SELECTOR_SAMPLES * 3]
    sample = await asyncio.to_thread(_build_selector_sample, ctx, chosen)
    urls = sample["candidate_urls"]
    prompts = sample["prompts"]

    if not sample["html_found"]:
        return _selector_status_row(domain, None, "no_html", model, urls)
    if not prompts:
        return _selector_status_row(domain, None, "no_skeletons", model, urls)

    return {
        "domain": domain,
        "status": "needs_llm",
        "prompts": prompts,
        "sample_urls": sample["sample_urls"],
        "sample_html_hashes": sample["sample_html_hashes"],
    }


async def _generate_selector_prompt_rows(
    ctx: Context,
    prompt_rows: list[dict[str, Any]],
    *,
    model: str,
) -> list[dict[str, Any]]:
    assert ctx.llm is not None
    pending: dict[int, str] = {}
    responses_by_domain: dict[str, list[str]] = {
        str(row["domain"]): [] for row in prompt_rows
    }
    rows_by_domain = {str(row["domain"]): row for row in prompt_rows}

    total_prompts = sum(len(row.get("prompts") or []) for row in prompt_rows)
    with tqdm(
        total=total_prompts,
        desc="Generating selector prompts",
        unit="prompt",
        dynamic_ncols=True,
        mininterval=1.0,
        smoothing=0.05,
    ) as bar:
        async with ctx.llm.response_pool() as pool:
            for row in prompt_rows:
                domain = str(row["domain"])
                for prompt in row.get("prompts") or []:
                    while pool.is_full():
                        request_id, response = await pool.get_response()
                        _record_selector_response(
                            responses_by_domain,
                            pending.pop(request_id),
                            response,
                        )
                        bar.update(1)

                    request_id = await pool.put_request(
                        LLMRequest(
                            prompt=str(prompt),
                            max_tokens=SELECTOR_MAX_TOKENS,
                            temperature=SELECTOR_TEMPERATURE,
                            model=model,
                        )
                    )
                    pending[request_id] = domain

            while pending:
                request_id, response = await pool.get_response()
                _record_selector_response(
                    responses_by_domain,
                    pending.pop(request_id),
                    response,
                )
                bar.update(1)

    return [
        _selector_row_from_responses(
            rows_by_domain[domain],
            responses,
            model=model,
        )
        for domain, responses in responses_by_domain.items()
    ]


def _record_selector_response(
    responses_by_domain: dict[str, list[str]],
    domain: str,
    response,
) -> None:
    if isinstance(response, Exception):
        responses_by_domain[domain].append("")
    else:
        responses_by_domain[domain].append(response.content)


def _selector_row_from_responses(
    prompt_row: dict[str, Any],
    response_texts: list[str],
    *,
    model: str,
) -> dict[str, Any]:
    domain = str(prompt_row["domain"])
    selectors = [
        _parse_selector_response(response_text)
        for response_text in response_texts
        if response_text
    ]
    winner = _majority_vote(selectors)
    votes = Counter(selector for selector in selectors if selector)
    return {
        "domain": domain,
        "selector": winner,
        "status": "ok" if winner else "no_selector",
        "votes": votes.get(winner, 0) if winner else 0,
        "all_votes": dict(votes),
        "sample_urls": prompt_row["sample_urls"],
        "sample_html_hashes": prompt_row["sample_html_hashes"],
        "selector_prompt_version": SELECTOR_PROMPT_VERSION,
        "model": model,
    }


def _candidate_done_urls_by_domain(
    done_urls: list[DoneUrl],
) -> dict[str, list[DoneUrl]]:
    scored: dict[str, list[tuple[int, str, DoneUrl]]] = {}
    seen_urls: set[str] = set()
    for done in done_urls:
        if done.url in seen_urls or not is_html(done.media_type):
            continue
        seen_urls.add(done.url)
        try:
            parsed = NormalizedParse.parse(done.url)
        except Exception:
            continue
        scored.setdefault(parsed.hostname_normalized, [])
        if not _is_article_path(parsed.path):
            continue
        score = _article_score(parsed.path)
        scored.setdefault(parsed.hostname_normalized, []).append(
            (-score, done.url, done)
        )

    return {
        domain: [done for _score, _url, done in sorted(items)]
        for domain, items in scored.items()
    }


def _build_selector_sample(ctx: Context, done_urls: list[DoneUrl]) -> dict[str, Any]:
    html_by_url = {
        url: html
        for url, html in read_html_from_storage(ctx, done_urls).items()
        if html.lstrip()[:1] in (b"<", b"\xef")
    }
    sample_urls: list[str] = []
    sample_html_hashes: list[str] = []
    prompts: list[str] = []
    candidates_with_html = [
        done for done in done_urls if done.url in html_by_url
    ][:SELECTOR_SAMPLES]
    for done in candidates_with_html:
        html = html_by_url.get(done.url)
        if not html:
            continue
        skeleton = _html_to_skeleton(html)
        if not skeleton:
            continue
        prompts.append(_PROMPT_TMPL.format(url=done.url, skeleton=skeleton))
        sample_urls.append(done.url)
        sample_html_hashes.append(hash_bytes(html))
    return {
        "candidate_urls": [done.url for done in done_urls],
        "html_found": bool(html_by_url),
        "sample_urls": sample_urls,
        "sample_html_hashes": sample_html_hashes,
        "prompts": prompts,
    }


def _clean_selector(sel: str | None) -> str | None:
    if not sel:
        return None
    cleaned = _STRIP_SEL_RE.sub("", sel)
    cleaned = re.sub(r"\.{2,}", ".", cleaned)
    cleaned = re.sub(r"\.$", "", cleaned)
    cleaned = cleaned.strip()
    return cleaned if cleaned else None


def _segment_blocked(seg: str) -> bool:
    bare = re.sub(r"^\d+[_-]", "", seg).rsplit(".", 1)[0]
    return bool(_SKIP_SEG_RE.match(bare))


def _is_article_path(path: str) -> bool:
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
        bare = segments[0].rsplit(".", 1)[0]
        return (len(bare) > 15 and bare.count("-") >= 2) or bool(
            re.search(r"\d{5,}", bare)
        )
    return True


def _article_score(path: str) -> int:
    clean = re.sub(r"^hostname=[^/]+", "", path)
    clean = re.sub(r"/date=\d{4}-\d{2}-\d{2}$", "", clean)
    segs = [s for s in clean.split("/") if s]
    last = segs[-1] if segs else ""
    score = 0
    hyphens = last.count("-")
    if len(last) > 25 and hyphens >= 3:
        score += 3
    elif len(last) > 12 and hyphens >= 2:
        score += 2
    if re.search(r"\d{5,}", path):
        score += 2
    if re.search(r"/20\d{2}/\d{2}/", clean):
        score += 2
    score += min(len(segs) - 1, 2)
    return score


def _clean_classes(tag: Tag) -> list[str]:
    return [
        c
        for c in (tag.get("class") or [])
        if not _NUMERIC_CLASS_RE.match(c) and not _STRIP_CLS_RE.match(c)
    ]


def _build_skeleton(tag, depth=0) -> str:
    if depth > _MAX_DEPTH or not isinstance(tag, Tag):
        return ""
    if tag.name in _SKIP_TAGS:
        return ""
    if depth <= 2 and tag.name in _SKIP_STRUCTURAL:
        return f"{'  ' * depth}<{tag.name}> <!-- skipped -->\n"

    indent = "  " * depth
    cls = " ".join(_clean_classes(tag)[:3])
    tid = tag.get("id", "")
    attrs = (f' class="{cls}"' if cls else "") + (f' id="{tid}"' if tid else "")
    children = [
        c for c in tag.children if isinstance(c, Tag) and c.name not in _SKIP_TAGS
    ]

    if not children:
        text = tag.get_text(" ", strip=True)[:100].replace("\n", " ")
        return f"{indent}<{tag.name}{attrs}>{text}</{tag.name}>\n" if text else ""

    collapsed: list[Tag | str] = []
    i = 0
    while i < len(children):
        child = children[i]
        sig = (child.name, tuple(_clean_classes(child)[:3]))
        j = i + 1
        while j < len(children) and (
            children[j].name,
            tuple(_clean_classes(children[j])[:3]),
        ) == sig:
            j += 1
        count = j - i
        collapsed.append(children[i])
        if count > 2:
            collapsed.append(f"<!-- ...{count - 1} more <{child.name}> -->")
        elif count == 2:
            collapsed.append(children[i + 1])
        i = j

    inner = "".join(
        (indent + "  " + c + "\n")
        if isinstance(c, str)
        else _build_skeleton(c, depth + 1)
        for c in collapsed
    )
    if not inner.strip():
        return ""

    wc_hint = ""
    if tag.name in _CONTENT_TAGS:
        full_text = tag.get_text(" ", strip=True)
        wc = len(full_text.split())
        if wc >= 30:
            listing = " LISTING" if len(_DATE_RE.findall(full_text)) >= 4 else ""
            wc_hint = f" <!-- ~{wc}w{listing} -->"

    return f"{indent}<{tag.name}{attrs}>{wc_hint}\n{inner}{indent}</{tag.name}>\n"


def _html_to_skeleton(html_bytes: bytes) -> str:
    try:
        soup = BeautifulSoup(html_bytes, "html.parser")
    except Exception:
        return ""
    body = soup.find("body") or soup
    skeleton = _build_skeleton(body)
    if len(skeleton) > _SKELETON_LIMIT:
        skeleton = skeleton[:_SKELETON_LIMIT] + "\n<!-- skeleton truncated -->"
    return skeleton


def _majority_vote(selectors: list[str | None]) -> str | None:
    valid = [s for s in selectors if s]
    if not valid:
        return None
    valid = [s for s in valid if not _BAD_SEL_RE.search(s) and len(s) <= 120]
    if not valid:
        return None
    counts = Counter(valid)
    for candidate, _ in counts.most_common():
        if not _GENERIC_SEL_RE.fullmatch(candidate.strip()):
            return _CMS_OVERRIDES.get(candidate, candidate)
    return counts.most_common(1)[0][0]


def _selector_status_row(
    domain: str,
    selector: str | None,
    status: str,
    model: str,
    sample_urls: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "domain": domain,
        "selector": selector,
        "status": status,
        "votes": 0,
        "all_votes": {},
        "sample_urls": sample_urls or [],
        "sample_html_hashes": [],
        "selector_prompt_version": SELECTOR_PROMPT_VERSION,
        "model": model,
    }


def _parse_selector_response(response: str) -> str | None:
    raw = re.sub(r"^```[a-z]*\n?", "", response.strip())
    raw = re.sub(r"\n?```$", "", raw.strip())
    try:
        parsed = json.loads(raw)
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    selector = parsed.get("selector")
    if not isinstance(selector, str):
        return None
    return _clean_selector(selector)


_VERIFIED_SELECTORS_FILE = Path(__file__).parent / "verified_selectors.json"


def load_verified_selectors() -> dict[str, str]:
    if not _VERIFIED_SELECTORS_FILE.exists():
        return {}
    with _VERIFIED_SELECTORS_FILE.open(encoding="utf-8") as f:
        data = json.load(f)
    return {k: v for k, v in data.items() if isinstance(k, str) and isinstance(v, str)}


def selector_map_from_df(selectors_df: pd.DataFrame) -> dict[str, str]:
    selectors: dict[str, str] = {}
    for row in selectors_df.to_dict(orient="records"):
        domain = row.get("domain")
        selector = row.get("selector")
        if isinstance(domain, str) and isinstance(selector, str) and selector.strip():
            selectors[domain] = selector.strip()
    return {**selectors, **load_verified_selectors()}
