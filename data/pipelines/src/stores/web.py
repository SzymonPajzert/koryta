"""robots.txt handling shared by both crawlers.

`RobotsCache` is the single implementation: it tries https then http, treats a
missing/empty robots.txt as allow-all, an unreachable host or a hard error
status (403/5xx) as deny, and caches per host (thread-safe — fetcher threads
share it). 429 is rate limiting, not a robots verdict, so it is not cached as
a deny. `WebImpl` keeps the old Context-facing method delegating here.
"""

import threading
from typing import Any
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

from curl_cffi import requests as cffi_requests

from scrapers.stores import Context, Web


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
        allow_all = False
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
            # 404 (no robots) and 429 (rate limited, not a verdict) allow;
            # 200 parses; anything else is a hard error and denies.
            if response.status_code in (404, 429) or not response.text.strip():
                allow_all = True
                break
            if response.status_code == 200:
                parser = RobotFileParser()
                parser.parse(response.text.splitlines())
                break
        with self._lock:
            # Unreachable, or an error status (403/5xx/429): deny.
            if not reachable or (parser is None and not allow_all):
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
