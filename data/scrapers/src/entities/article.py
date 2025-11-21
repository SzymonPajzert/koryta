from dataclasses import dataclass


@dataclass
class Article:
    id: str
    title: str
    url: str
    mentioned_person: str


@dataclass
class Mention:
    text: str  # text detected
    url: str  # URL of the source
