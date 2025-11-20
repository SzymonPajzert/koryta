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
