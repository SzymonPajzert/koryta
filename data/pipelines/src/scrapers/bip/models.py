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
    platform: str = "unknown"
    status: str = "new"


@dataclass(frozen=True)
class UrlRow:
    """A discovered URL and what the crawl learned about it."""

    url: str
    host: str
    kind: str  # page | listing | feed | doc
    discovered_from: str
    depth: int
    section: str = ""
    content_type: str = ""
    size: int = 0
    sha256: str = ""
    title: str = ""
    last_status: int = 0
    state: str = "new"


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
class CrawlOptions:
    """Bounds that keep one host's crawl finite and polite."""

    max_pages_per_host: int = 200
    max_docs_per_host: int = 500
    max_depth: int = 4
    request_timeout_s: float = 15.0
    per_host_min_interval_s: float = 1.0
    max_page_bytes: int = 5_000_000
    user_agent: str = "KorytaBIPCrawler/0.1 (+http://koryta.pl/crawler)"


@dataclass
class HostCrawlStats:
    host: str
    pages_fetched: int = 0
    pages_skipped: int = 0
    docs_stored: int = 0
    docs_duplicate: int = 0
    bytes_stored: int = 0
    errors: int = 0
    robots_denied: int = 0
    status: str = "ok"

    def as_dict(self) -> dict[str, object]:
        return {
            "host": self.host,
            "pages_fetched": self.pages_fetched,
            "pages_skipped": self.pages_skipped,
            "docs_stored": self.docs_stored,
            "docs_duplicate": self.docs_duplicate,
            "bytes_stored": self.bytes_stored,
            "errors": self.errors,
            "robots_denied": self.robots_denied,
            "status": self.status,
        }
