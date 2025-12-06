"""Data classes for logging and managing web crawling activities."""

from dataclasses import dataclass
from datetime import datetime


@dataclass
class HostnameConfig:
    """Configuration for a specific hostname, determining crawlability."""

    hostname: str
    allowed: bool
    quality: str


@dataclass
class RequestLog:
    """Logs the details of a single HTTP request made by the crawler."""

    id: str
    website_id: str
    domain: str
    url: str
    time: datetime
    response_code: int
    payload_size_bytes: int
    duration: str


@dataclass
class WebsiteIndex:
    """Represents a URL discovered by the crawler, to be potentially visited."""

    id: str
    url: str
    interesting: bool | None
