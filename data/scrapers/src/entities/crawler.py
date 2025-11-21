from dataclasses import dataclass

from datetime import datetime


@dataclass
class HostnameConfig:
    hostname: str
    allowed: bool
    quality: str


@dataclass
class RequestLog:
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
    id: str
    url: str
    interesting: bool | None
