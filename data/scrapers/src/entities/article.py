"""Data classes for articles and mentions."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, ClassVar


@dataclass
class Article:
    """Represents an article mentioning a person of interest."""

    id: str
    title: str
    url: str
    mentioned_person: str


@dataclass
class Mention:
    """Represents a mention of a keyword in a source."""

    text: str  # text detected
    url: str  # URL of the source


@dataclass
class ParsedArticle:
    """Parsed content extracted from a crawled HTML page."""

    uid: str
    url: str
    storage_path: str
    is_article: bool | None
    title: str | None
    publication_date: str | None  # ISO date string
    article_content: str


@dataclass
class ParsedArticleRecord:
    """Article parse record persisted by the batch parser."""

    __output_path__: ClassVar[Path] = Path("article_parsed/article_parsed.jsonl.tmp")

    uid: str
    url: str
    domain: str
    storage_path: str
    selector: str | None
    parse_status: str
    selector_matched: bool
    title: str | None
    publication_date: str | None
    ld_json: Any
    article_content: str
    article_content_hash: str
    html_sha256: str | None
    parser_version: int
    error: str | None = None
