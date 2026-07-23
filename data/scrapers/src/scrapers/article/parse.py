from __future__ import annotations

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
    for document in documents:
        if isinstance(document, dict):
            items.append(document)
        elif isinstance(document, list):
            for item in document:
                if isinstance(item, dict):
                    items.append(item)
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
    items = _iter_ld_json_items(_iter_ld_json_documents(soup))
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
            return re.sub(r"\s{2,}", " ", value).strip()
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


def extract_article_content(
    html_bytes: bytes, selector: str, url: str = ""
) -> dict[str, Any]:
    selector = selector.strip()
    if not selector:
        raise ValueError("selector is required")

    soup = BeautifulSoup(html_bytes, "lxml")
    ld_json = _pick_ld_json_metadata(soup)

    # Readability disabled — title/date come from ld+json metadata instead of the
    # Node.js worker (see git history for the old fallback).
    title = _title_from_ld_json(ld_json)
    publication_date = _date_from_ld_json(ld_json)

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

    result = dict(_EMPTY_RESULT)
    result["title"] = title
    result["publication_date"] = publication_date
    result["ld_json"] = ld_json
    return result
