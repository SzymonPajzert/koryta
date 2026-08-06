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
class ArticleFactsVerified:
    """Extracted facts after LLM-as-judge verification.

    Same shape as ArticleFacts, but each fact dict is annotated with the
    verifier's binary decision (``verified``) plus its verdict/reason. Facts are
    kept as dicts here (not ArticleFact) so the annotation fields survive
    serialization without changing the ArticleFact schema.
    """

    __output_path__: ClassVar[Path] = Path(
        "article_facts_verified/article_facts_verified.jsonl.tmp"
    )

    url: str
    article_content_hash: str
    extracted_facts: list[dict[str, Any]]
    fact_extraction_status: str
    verify_status: str
    verify_error: str | None
    verify_model: str
    verify_version: int
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


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


@dataclass
class ArticlePeopleMentioned:
    """A parsed article and the known people mentioned in it.

    One record per article: carries the URL together with the title, date and
    tags recovered from the article's ld+json metadata, and the people matched
    in its text, so a later pass can summarize the articles per person.
    """

    __output_path__: ClassVar[Path] = Path(
        "article_person_mentions/article_person_mentions.jsonl.tmp"
    )

    url: str
    domain: str
    title: str | None
    date: str | None
    tags: list[str]
    people_mentioned: list[str]


@dataclass
class AffairTag:
    """A single affair/event tag with how often a person appeared next to it."""

    tag: str
    count: int
    first_date: str | None = None
    last_date: str | None = None


@dataclass
class PersonAffairTags:
    """Interesting affair/event tags attributed to a single person.

    One record per person: the person's display name together with the
    interesting tags found on the articles mentioning them. A tag counts only
    when it names an affair, scandal, investigative commission or notable
    event - generic category tags (polityka, prokuratura, sport, ...) are
    filtered out, so the list is a summary of the affairs a person shows up in.
    Each tag carries the number of articles that used it and the date range
    they span.
    """

    __output_path__: ClassVar[Path] = Path(
        "people_affair_tags/people_affair_tags.jsonl.tmp"
    )

    person: str
    tags: list[AffairTag]
    total_articles: int
