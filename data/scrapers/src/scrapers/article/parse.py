from __future__ import annotations

import json
import os
import re
import subprocess
from datetime import date
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup, Tag

from util.polish import parse_polish_date

_WORKER_SCRIPT = Path(__file__).parent / "readability_worker.mjs"
# node_modules lives two levels up from src/
_NODE_MODULES = Path(__file__).parents[3] / "node_modules"

_EMPTY_RESULT: dict[str, Any] = {
    "selector_matched": False,
    "title": None,
    "publication_date": None,
    "ld_json": None,
    "article_content": "",
    "extraction_method": None,
}


class _ReadabilityWorker:
    """Per-process singleton that keeps a Node.js readability worker alive."""

    def __init__(self) -> None:
        env = os.environ.copy()
        env["NODE_PATH"] = str(_NODE_MODULES)
        self._proc = subprocess.Popen(
            ["node", str(_WORKER_SCRIPT)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=env,
        )

    def parse(self, html: str, url: str) -> dict[str, Any]:
        assert self._proc.stdin and self._proc.stdout
        payload = json.dumps({"html": html, "url": url}, ensure_ascii=False) + "\n"
        self._proc.stdin.write(payload.encode("utf-8"))
        self._proc.stdin.flush()
        line = self._proc.stdout.readline()
        if not line:
            return {}
        try:
            return json.loads(line)
        except Exception:
            return {}

    def close(self) -> None:
        try:
            if self._proc.stdin:
                self._proc.stdin.close()
            self._proc.wait(timeout=5)
        except Exception:
            self._proc.kill()


_worker: _ReadabilityWorker | None = None


def _get_worker() -> _ReadabilityWorker:
    global _worker
    if _worker is None:
        _worker = _ReadabilityWorker()
    return _worker


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


def extract_article_content(
    html_bytes: bytes, selector: str, url: str = ""
) -> dict[str, Any]:
    selector = selector.strip()
    if not selector:
        raise ValueError("selector is required")

    html_str = html_bytes.decode("utf-8", errors="replace")
    soup = BeautifulSoup(html_bytes, "lxml")
    ld_json = _pick_ld_json_metadata(soup)

    # Always run Readability for title and date
    full_url = url if url.startswith("http") else f"https://{url}"
    readability: dict[str, Any] = {}
    try:
        readability = _get_worker().parse(html_str, full_url)
    except Exception:
        pass

    title: str | None = None
    raw_title = readability.get("title")
    if isinstance(raw_title, str) and raw_title.strip():
        title = re.sub(r"\s{2,}", " ", raw_title).strip()

    publication_date: date | None = None
    raw_date = readability.get("published_time")
    if isinstance(raw_date, str):
        publication_date = _parse_date(raw_date)

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

    # Selector not found — try Readability content as fallback
    read_text = readability.get("text_content")
    if isinstance(read_text, str) and read_text.strip():
        return {
            "selector_matched": False,
            "title": title,
            "publication_date": publication_date,
            "ld_json": ld_json,
            "article_content": read_text.strip(),
            "extraction_method": "readability",
        }

    result = dict(_EMPTY_RESULT)
    result["title"] = title
    result["publication_date"] = publication_date
    result["ld_json"] = ld_json
    return result
