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

# Classes of the boxes the Polska Press platform (gloswielkopolski.pl,
# pomorska.pl, *.naszemiasto.pl and the other domains that share its selector
# in verified_selectors.json) puts inside an article or a photo gallery. None
# of their text is the article's own, and a fact quoted from another
# article's headline is filed under this one. The class names are the
# platform's own, so removing them changes nothing on any other site.
_NOT_ARTICLE_CLASS = re.compile(
    r"^(?:"
    # other articles' headlines and leads: "Sprawdź też", "Więcej z Twojej
    # okolicy", "Zobacz również", "Powiązane", "Wybrane dla Ciebie"
    r"components(?:Recommendations|Listing)\w*"
    r"|componentsArticleLongFeed"
    r"|atomsGalleryHybridButtonsNavigation"  # the next gallery's title
    r"|componentsArticleNarrator"  # a live feed of other news
    r"|componentsPromotions(?:Promoted|ArticlePromotedList)"  # sponsored
    r"|atomsCommentsSection"  # readers' comments
    r"|componentsQuizTeaser"
    r"|componentsPollPoll"
    r")$"
)


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
        for box in element.find_all(class_=_NOT_ARTICLE_CLASS):
            box.decompose()
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

    result = dict(_EMPTY_RESULT)
    result["title"] = title
    result["publication_date"] = publication_date
    result["ld_json"] = ld_json
    return result
