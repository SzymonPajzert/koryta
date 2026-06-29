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


def _extract_title(metadata: dict[str, Any] | None) -> str | None:
    if not metadata:
        return None
    for key in ("headline", "name", "title"):
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            return re.sub(r"\s{2,}", " ", value).strip()
    return None


def _extract_publication_date(metadata: dict[str, Any] | None) -> date | None:
    if not metadata:
        return None
    for key in ("datePublished", "dateCreated", "dateModified"):
        raw = metadata.get(key)
        if isinstance(raw, str):
            raw = raw.strip()
            if not raw or len(raw) > 128:
                continue
            parsed = parse_polish_date(raw)
            if parsed:
                return parsed
    return None


def extract_article_content(html_bytes: bytes, selector: str) -> dict[str, Any]:
    selector = selector.strip()
    if not selector:
        raise ValueError("selector is required")

    soup = BeautifulSoup(html_bytes, "html.parser")
    metadata = _pick_ld_json_metadata(soup)
    element = soup.select_one(selector)

    if not element:
        result = dict(_EMPTY_RESULT)
        result["ld_json"] = metadata
        return result

    article_content = element.get_text(separator=" ", strip=True)
    article_content = article_content.replace("\xa0", " ")
    article_content = re.sub(r"\s+", " ", article_content).strip()

    return {
        "selector_matched": True,
        "title": _extract_title(metadata),
        "publication_date": _extract_publication_date(metadata),
        "ld_json": metadata,
        "article_content": article_content,
    }
