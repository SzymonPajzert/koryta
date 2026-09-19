from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class RegistryEntry:
    """One row of the official gov.pl BIP registry."""

    entry_id: str
    name: str
    url: str
    host: str
    teryt: str
    place: str
    email: str


@dataclass(frozen=True)
class HostRow:
    """One BIP host, deduplicated from the registry rows."""

    host: str
    name: str
    source_url: str
    teryt: str
    entry_count: int
    status: str = "new"
    crawl_id: str = ""


@dataclass(frozen=True)
class UrlRow:
    """A queued or fetched URL and what the crawl learned about it."""

    url: str
    host: str
    kind: str  # page | doc
    discovered_from: str = ""
    depth: int = 0
    section: str = ""
    priority: int = 50
    content_type: str = ""
    size: int = 0
    sha256: str = ""
    title: str = ""
    last_status: int = 0


@dataclass(frozen=True)
class DocRow:
    """A stored document blob and the chain that led to it."""

    sha256: str
    url: str
    host: str
    content_type: str
    size: int
    filename: str
    title: str
    bundle: str
    chain: list[str] = field(default_factory=list)


@dataclass
class RunStats:
    hosts_finalized: int = 0
    pages_fetched: int = 0
    docs_new: int = 0
    docs_seen: int = 0
    errors: int = 0
    skipped: int = 0
    bytes_stored: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "hosts_finalized": self.hosts_finalized,
            "pages_fetched": self.pages_fetched,
            "docs_new": self.docs_new,
            "docs_seen": self.docs_seen,
            "errors": self.errors,
            "skipped": self.skipped,
            "bytes_stored": self.bytes_stored,
        }
