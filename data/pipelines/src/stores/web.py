"""robots.txt handling shared by both crawlers.

`RobotsCache` is the single implementation: it tries https then http, treats a
missing/empty robots.txt as allow-all, unreachable as deny, exposes
Crawl-delay, and caches per host (thread-safe — fetcher threads share it).
`WebImpl` keeps the old Context-facing method delegating here.
"""

import threading
from typing import Any
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

from curl_cffi import requests as cffi_requests

from scrapers.stores import Context, Web

_EMPTY = RobotFileParser()  # no rules -> allow everything


def _host_of(url: str) -> str:
    """Hostname for the robots cache.

    Deliberately not NormalizedParse: that one parses the query string and
    raises on params without '=' (e.g. '?debug'), which used to take a whole
    crawl result down. Robots only needs the host.
    """
    try:
        host = (urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


class RobotsCache:
    def __init__(self, user_agent: str) -> None:
        self.user_agent = user_agent
        self._parsers: dict[str, RobotFileParser | None] = {}
        self._unreachable: set[str] = set()
        self._lock = threading.Lock()

    def _parser(self, host: str) -> RobotFileParser | None:
        with self._lock:
            if host in self._parsers:
                return self._parsers[host]
        parser: RobotFileParser | None = None
        reachable = False
        for scheme in ("https", "http"):
            try:
                response = cffi_requests.get(
                    f"{scheme}://{host}/robots.txt",
                    impersonate="chrome136",
                    headers={"User-Agent": self.user_agent},
                    timeout=10,
                )
            except Exception:
                continue
            reachable = True
            if response.status_code == 404 or not response.text.strip():
                parser = None
                break
            if response.status_code == 200:
                parser = RobotFileParser()
                parser.parse(response.text.splitlines())
                break
        with self._lock:
            if not reachable:
                self._unreachable.add(host)
            self._parsers[host] = parser
        return parser

    def allowed(self, url: str) -> bool:
        host = _host_of(url)
        if not host:
            return False
        parser = self._parser(host)
        if parser is None:
            return host not in self._unreachable
        return parser.can_fetch(self.user_agent, url)

    def crawl_delay(self, host: str) -> float | None:
        parser = self._parser(host)
        if parser is None:
            return None
        delay = parser.crawl_delay(self.user_agent)
        return float(delay) if delay is not None else None


_caches: dict[str, RobotsCache] = {}


class WebImpl(Web):
    def robot_txt_allowed(
        self, ctx: Context, url: str, parsed_url: Any, user_agent: str
    ) -> bool:
        """Checks if we are allowed to fetch a URL according to robots.txt."""
        cache = _caches.get(user_agent)
        if cache is None:
            cache = RobotsCache(user_agent)
            _caches[user_agent] = cache
        return cache.allowed(url)
