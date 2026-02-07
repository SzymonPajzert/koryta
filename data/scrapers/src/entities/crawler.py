"""Data classes for web crawling entities."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional


@dataclass
class WebsiteIndex:
    """Represents a URL discovered by the crawler, to be potentially visited."""

    id: str
    url: str
    priority: int
    done: bool
    num_retries: int
    date_added: datetime
    errors: List[str] = field(default_factory=list)
    date_finished: Optional[datetime] = None
    locked_by_worker_id: Optional[str] = None
    locked_at: Optional[datetime] = None
    storage_path: Optional[str] = None
    mined_from_url: Optional[str] = None


@dataclass
class BlockedDomain:
    """A domain blocked from crawling."""

    domain: str
    reason: str = ""
