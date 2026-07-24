"""Data classes for articles and mentions."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, ClassVar

from entities.facts import ArticleFact


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
    extraction_method: str | None = None
    outbound_urls: list[str] | None = None
    error: str | None = None


@dataclass
class KoryciarskiScore:
    """Thin LLM score for parsed article content."""

    __output_path__: ClassVar[Path] = Path(
        "article_koryciarski_scores/article_koryciarski_scores.jsonl.tmp"
    )

    url: str
    article_content_hash: str
    koryciarski_llm_score: int | None
    koryciarski_llm_reason: str
    llm_is_article: bool
    model: str
    prompt_version: int
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    error: str | None = None


@dataclass
class ArticleFacts:
    """Thin LLM-extracted facts grounded in parsed article content."""

    __output_path__: ClassVar[Path] = Path("article_facts/article_facts.jsonl.tmp")

    url: str
    article_content_hash: str
    extracted_facts: list[ArticleFact]
    fact_extraction_status: str
    fact_extraction_error: str | None
    model: str
    prompt_version: int
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    response_think_chars: int = 0
    response_think_blocks: int = 0
    response_think_text: str = ""


@dataclass
class ArticleAnalyzedRecord:
    """Merged article record combining parse, score and extracted facts."""

    __output_path__: ClassVar[Path] = Path(
        "article_analyzed/article_analyzed.jsonl.tmp"
    )

    url: str
    domain: str
    title: str | None
    publication_date: str | None
    article_content: str
    koryciarski_llm_score: int | None
    koryciarski_llm_reason: str
    extracted_facts: list[dict[str, Any]]
    tag: str | None = None
