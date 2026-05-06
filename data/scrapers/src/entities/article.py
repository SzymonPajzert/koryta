"""Data classes for articles and mentions."""

from dataclasses import dataclass


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
