from __future__ import annotations

import html
import json
import re
from datetime import date
from typing import Any

from bs4 import BeautifulSoup, Tag

from util.polish import parse_polish_date

_EMPTY_RESULT: dict[str, Any] = {
    "selector_matched": False,
    "title": None,
    "publication_date": None,
    "ld_json": None,
    "article_content": "",
    "extraction_method": None,
}

# The TVP regional CMS renders its articles client-side: the served HTML has
# only empty containers, and the text lives in a `window.__newsData = {...}`
# object literal that the browser executes. Every *_tvp.pl regional site
# (bialystok, bydgoszcz, gdansk, gorzow, kielce, lodz, lublin, olsztyn, opole,
# poznan, rzeszow, szczecin, wroclaw - and vod.tvp.pl) does this, so one
# reader covers them all. No headless browser is needed: the payload is in the
# bytes we already store.
_NEWS_DATA_RE = re.compile(r"window\.__newsData\s*=\s*(\{.*?\})\s*;", re.DOTALL)


def _extract_news_data(html_text: str) -> dict[str, Any] | None:
    """The `window.__newsData` object, or None when the page has none.

    The literal is a JS object literal with quoted keys and standard escapes,
    so ``json.loads`` reads it as-is. Returns None on anything unexpected
    rather than raising: the caller falls back to the selector path, and this
    must never turn a parseable page into an error.
    """
    match = _NEWS_DATA_RE.search(html_text)
    if match is None:
        return None
    raw = match.group(1)
    # A single non-greedy match stops at the first `}`; rebalance braces so the
    # whole object is captured even when it contains nested objects/arrays.
    depth = 0
    in_string = False
    escaped = False
    end = 0
    for index, char in enumerate(raw):
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                end = index + 1
                break
    raw = raw[:end] if end else raw
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return None
    return data if isinstance(data, dict) else None


# The body fields, in reading order. TVP splits the article across four
# keys rather than one array: the head/lead are the standfirst, `standard` is
# the body, and `subtitle` is a mid-article heading.
_NEWS_DATA_BODY_KEYS = (
    "text_paragraph_head",
    "text_paragraph_lead",
    "text_paragraph_standard",
    "text_paragraph_subtitle",
)


def _block_html(value: Any) -> str:
    """The HTML of one paragraph block, whatever shape the CMS wrote it in.

    A field is normally a string of HTML fragments, but the body
    (`text_paragraph_standard`) arrives as a list whose items are dicts like
    ``{"supertitle": ..., "text": "<p>...</p>"}``. Unwrapping `text`/`html`
    keys first means both shapes reach BeautifulSoup as markup.
    """
    if isinstance(value, dict):
        for key in ("text", "html", "content"):
            inner = value.get(key)
            if isinstance(inner, str) and inner.strip():
                return inner
        return ""
    if isinstance(value, list):
        return " ".join(_block_html(item) for item in value)
    return value if isinstance(value, str) else ""


def _html_fragments_to_text(value: Any) -> str:
    """One `text_paragraph_*` field as plain text.

    Tags are stripped and whitespace collapsed to match what the selector path
    produces.
    """
    block = _block_html(value)
    if not block.strip():
        return ""
    text = BeautifulSoup(block, "lxml").get_text(separator=" ")
    text = html.unescape(text).replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def _text_from_news_data(data: dict[str, Any]) -> str:
    """The article body from a `__newsData` object, as one plain-text string.

    Prefers the four ``text_paragraph_*`` fields; falls back to ``lead`` so a
    video-only page still yields its summary rather than nothing.
    """
    parts = [
        text
        for text in (
            _html_fragments_to_text(data.get(key))
            for key in _NEWS_DATA_BODY_KEYS
        )
        if text
    ]
    if not parts:
        lead = data.get("lead")
        if isinstance(lead, str) and lead.strip():
            parts.append(re.sub(r"\s+", " ", lead).strip())
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


def _iter_ld_json_documents(soup: BeautifulSoup) -> list[Any]:
    documents: list[Any] = []
    for script in soup.find_all("script", type="application/ld+json"):
        if not isinstance(script, Tag):
            continue
        raw = script.string if isinstance(script.string, str) else script.get_text()
        raw = raw.strip() if isinstance(raw, str) else ""
        if not raw:
            continue
        try:
            documents.append(json.loads(raw))
        except json.JSONDecodeError:
            continue
    return documents


def _iter_ld_json_items(documents: list[Any]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []

    def _add(obj: Any) -> None:
        if isinstance(obj, dict):
            items.append(obj)
            # Many sites wrap the article node in a @graph array (yoast etc.);
            # descend so the NewsArticle/date node is reachable, not just the
            # top-level container that has no @type/date of its own.
            graph = obj.get("@graph")
            if isinstance(graph, list):
                for node in graph:
                    if isinstance(node, dict):
                        items.append(node)
        elif isinstance(obj, list):
            for item in obj:
                _add(item)

    for document in documents:
        _add(document)
    return items


def _is_article_ld_json(item: dict[str, Any]) -> bool:
    type_value = item.get("@type")
    if isinstance(type_value, list):
        return any(
            isinstance(v, str) and v.lower() in {"article", "newsarticle"}
            for v in type_value
        )
    return isinstance(type_value, str) and type_value.lower() in {
        "article",
        "newsarticle",
    }


def _pick_ld_json_metadata(soup: BeautifulSoup) -> dict[str, Any] | None:
    return _pick_ld_json_metadata_from_items(
        _iter_ld_json_items(_iter_ld_json_documents(soup))
    )


def _pick_ld_json_metadata_from_items(
    items: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not items:
        return None

    for item in items:
        if _is_article_ld_json(item):
            return item

    for item in items:
        for key in (
            "headline",
            "name",
            "title",
            "datePublished",
            "dateCreated",
            "dateModified",
        ):
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                return item

    return items[0]


def _parse_date(raw: str) -> date | None:
    raw = raw.strip()
    if not raw or len(raw) > 128:
        return None
    return parse_polish_date(raw)


def _title_from_ld_json(item: dict[str, Any] | None) -> str | None:
    if not isinstance(item, dict):
        return None
    for key in ("headline", "name", "title"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return re.sub(r"\s{2,}", " ", html.unescape(value)).strip()
    return None


def _date_from_ld_json(item: dict[str, Any] | None) -> date | None:
    if not isinstance(item, dict):
        return None
    for key in ("datePublished", "dateCreated", "dateModified"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            parsed = _parse_date(value)
            if parsed is not None:
                return parsed
    return None


def _best_date_from_items(items: list[dict[str, Any]]) -> date | None:
    # The picked metadata item is not always the one carrying the date (e.g. a
    # dateless Speakable stub is listed before the NewsArticle). Search every
    # ld+json item (incl. @graph nodes) and take the first parseable date.
    for item in items:
        parsed = _date_from_ld_json(item)
        if parsed is not None:
            return parsed
    return None


def date_iso_from_ld_json(ld_json: Any) -> str | None:
    """Best-effort ISO date (YYYY-MM-DD) from a stored ld_json blob.

    Handles a single dict (optionally with @graph), or a list of nodes, so it
    can recover a date from already-parsed rows without re-reading HTML.
    """
    if ld_json is None:
        return None
    parsed = _best_date_from_items(_iter_ld_json_items([ld_json]))
    return parsed.isoformat() if parsed is not None else None


def title_from_ld_json(ld_json: Any) -> str | None:
    """Best-effort article title from a stored ld_json blob (incl. @graph).

    Prefer the Article/NewsArticle node's title; otherwise take a `headline`
    from any node. Never fall back to a bare `name` on a non-article node —
    that is usually the site/publisher name (WebSite/Organization), not the
    article title.
    """
    if ld_json is None:
        return None
    items = _iter_ld_json_items([ld_json])
    for item in items:
        if _is_article_ld_json(item):
            title = _title_from_ld_json(item)
            if title:
                return title
    for item in items:
        headline = item.get("headline")
        if isinstance(headline, str) and headline.strip():
            return re.sub(r"\s{2,}", " ", headline).strip()
    return None


def extract_article_content(
    html_bytes: bytes, selector: str, url: str = ""
) -> dict[str, Any]:
    selector = selector.strip()
    if not selector:
        raise ValueError("selector is required")

    soup = BeautifulSoup(html_bytes, "lxml")
    ld_json_items = _iter_ld_json_items(_iter_ld_json_documents(soup))
    ld_json = _pick_ld_json_metadata_from_items(ld_json_items)

    # Readability disabled — title/date come from ld+json metadata instead of the
    # Node.js worker (see git history for the old fallback).
    title = _title_from_ld_json(ld_json)
    # Date is searched across ALL ld+json items (incl. @graph), not just the
    # single picked metadata node, which often lacks the date.
    publication_date = _best_date_from_items(ld_json_items)

    element = soup.select_one(selector)

    if element:
        content = element.get_text(separator=" ", strip=True)
        content = content.replace("\xa0", " ")
        content = re.sub(r"\s+", " ", content).strip()
        return {
            "selector_matched": True,
            "title": title,
            "publication_date": publication_date,
            "ld_json": ld_json,
            "article_content": content,
            "extraction_method": "selector",
        }

    # Client-rendered fallback, tried only when the selector found nothing -
    # the selector stays the primary path, so a site that renders server-side
    # is unaffected. `__newsData` is the TVP regional CMS and carries the body
    # the DOM never gets.
    html_text = html_bytes.decode("utf-8", errors="replace")
    news = _extract_news_data(html_text)
    if news is not None:
        content = _text_from_news_data(news)
        if content:
            return {
                "selector_matched": False,
                "title": title or news.get("title") or None,
                "publication_date": publication_date,
                "ld_json": ld_json,
                "article_content": content,
                "extraction_method": "news_data",
            }

    result = dict(_EMPTY_RESULT)
    result["title"] = title
    result["publication_date"] = publication_date
    result["ld_json"] = ld_json
    return result
