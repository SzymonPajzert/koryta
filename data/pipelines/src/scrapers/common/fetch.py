"""The one place both crawlers issue HTTP GETs."""

from __future__ import annotations

import threading
from dataclasses import dataclass

from curl_cffi import requests

DEFAULT_UA = "KorytaCrawler/0.1 (+http://koryta.pl/crawler)"

_sessions = threading.local()


def _session(impersonate: str) -> requests.Session:
    """One session per thread: keeps connections (and TLS) alive across GETs."""
    cache = getattr(_sessions, "cache", None)
    if cache is None:
        cache = {}
        _sessions.cache = cache
    session = cache.get(impersonate)
    if session is None:
        session = requests.Session(impersonate=impersonate)  # type: ignore[arg-type]
        cache[impersonate] = session
    return session


@dataclass(frozen=True)
class HttpResult:
    url: str
    status: int
    content_type: str
    content: bytes
    error: str = ""

    @property
    def ok(self) -> bool:
        return not self.error and 200 <= self.status < 300


def http_get(
    url: str,
    timeout: float = 15.0,
    user_agent: str = DEFAULT_UA,
    impersonate: str = "chrome136",
) -> HttpResult:
    try:
        response = _session(impersonate).get(
            url,
            headers={"User-Agent": user_agent},
            timeout=timeout,
            allow_redirects=True,
        )
    except Exception as exc:
        return HttpResult(
            url=url, status=0, content_type="", content=b"", error=str(exc)[:200]
        )
    return HttpResult(
        url=str(response.url),
        status=response.status_code,
        content_type=response.headers.get("Content-Type", ""),
        content=response.content,
    )
