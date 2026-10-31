"""robots.txt handling shared by both crawlers.

`RobotsCache` is the single implementation: it tries https then http, treats a
missing/empty robots.txt as allow-all, an unreachable host or a hard error
status (403/5xx) as deny, and caches per host (thread-safe — fetcher threads
share it). 429 is rate limiting, not a robots verdict, so it is not cached as
a deny. `Robots` reads the file. `WebImpl` keeps the old Context-facing method
delegating here.
"""

import functools
import re
import threading
import time
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urlsplit

from curl_cffi import CurlHttpVersion
from curl_cffi import requests as cffi_requests

from scrapers.common.fetch import verify, wants_http1
from scrapers.stores import Context, Web

#: A directive run into the text before it, its line break lost. On 10-30
#: bip.malopolska.pl's robots.txt held 18,000 Disallow lines on its User-agent
#: line, which Python's parser and Google's alike read as one robot's name, so
#: none applied; split onto their own lines, they all do.
_GLUED = re.compile(
    r"(?i)(?<=\S)(?<!dis)(?=(?:user-agent|disallow|allow|sitemap|crawl-delay)\s*:)"
)


def robots_lines(text: str) -> list[str]:
    """robots.txt's lines, directives run together split apart. A comment is
    left whole: bip.srodaslaska.pl's "#User-agent: *" / "#Disallow: /" allows
    everything, and split after its "#" it would deny everything."""
    lines: list[str] = []
    for line in text.lstrip("\ufeff").splitlines():
        code, mark, comment = line.partition("#")
        pieces = _GLUED.sub("\n", code).split("\n")
        pieces[-1] += mark + comment
        lines.extend(pieces)
    return lines


_LINE = re.compile(r"(?i)^\s*(user-agent|allow|disallow)\s*:\s*(.*?)\s*$")
_ESCAPE = re.compile(r"%([0-9A-Fa-f]{2})")
#: Characters RFC 3986 leaves alone in a path and query, and "%" itself.
_KEPT = "!#$%&'()*+,/:;=?@[]-._~"


def _octets(path: str) -> str:
    """A path or rule as RFC 9309 compares them: an escaped character that
    needs none ("%7E", "%61") written out, other escapes in upper case, any
    other character outside ASCII percent-encoded as UTF-8."""

    def unescape(match: re.Match[str]) -> str:
        char = chr(int(match.group(1), 16))
        if char.isascii() and (char.isalnum() or char in "-._~"):
            return char
        return "%" + match.group(1).upper()

    return quote(_ESCAPE.sub(unescape, path), safe=_KEPT)


@functools.cache
def _pattern(rule: str) -> re.Pattern[str]:
    """A rule's path as a regex: "*" any run of characters, a final "$" the end."""
    end = rule.endswith("$")
    body = rule[:-1] if end else rule
    return re.compile(
        ".*".join(re.escape(part) for part in body.split("*")) + ("$" if end else "")
    )


@dataclass(frozen=True)
class _Rule:
    allow: bool
    path: str


class Robots:
    """One host's robots.txt as RFC 9309 reads it for one crawler.

    The groups whose user-agent is the crawler's product token (the User-Agent
    up to its "/", in any case) together, else every "*" group together; then
    the longest rule that matches a path decides, an Allow over a Disallow as
    long. Python's own parser read the same file differently from one release
    to another (10-31: bip.info.pl's two "*" groups, a "Disallow: /" in the
    second, denied everything under 3.13.14 and almost nothing under 3.11,
    3.12 and 3.14), took "User-agent: crawler" for this crawler, and knew
    no "*" or "$" in a rule, so 2ClickPortal's "Disallow: /*wcag=" let its
    accessibility toggles through.
    """

    def __init__(self, lines: Iterable[str], user_agent: str) -> None:
        token = user_agent.split("/", 1)[0].strip().lower()
        groups: list[tuple[set[str], list[_Rule]]] = []
        reading_agents = False
        for line in lines:
            match = _LINE.match(line.split("#", 1)[0])
            if not match:
                continue
            key, value = match.group(1).lower(), match.group(2)
            if key == "user-agent":
                if not reading_agents:
                    groups.append((set(), []))
                groups[-1][0].add(value.split("/", 1)[0].strip().lower())
                reading_agents = True
                continue
            reading_agents = False
            if groups and value:
                groups[-1][1].append(_Rule(key == "allow", _octets(value)))
        named = [rules for agents, rules in groups if token in agents]
        if not named:
            named = [rules for agents, rules in groups if "*" in agents]
        # A plain rule is a prefix: looked up by length, the longest first, so
        # bip.malopolska.pl's 22,884 rules cost a lookup each, not a regex.
        self._plain: dict[int, dict[str, bool]] = {}
        self._wild: list[tuple[re.Pattern[str], int, bool]] = []
        for rule in (rule for rules in named for rule in rules):
            if "*" in rule.path or rule.path.endswith("$"):
                self._wild.append((_pattern(rule.path), len(rule.path), rule.allow))
            else:
                same = self._plain.setdefault(len(rule.path), {})
                same[rule.path] = same.get(rule.path, False) or rule.allow
        self._lengths = sorted(self._plain, reverse=True)

    def allowed(self, url: str) -> bool:
        parts = urlsplit(url)
        path = _octets((parts.path or "/") + (f"?{parts.query}" if parts.query else ""))
        if path == "/robots.txt":
            return True
        length, allow = -1, True
        for size in self._lengths:
            verdict = self._plain[size].get(path[:size])
            if verdict is not None:
                length, allow = size, verdict
                break
        for rule, size, verdict in self._wild:
            longer = size > length or (size == length and verdict and not allow)
            if longer and rule.match(path):
                length, allow = size, verdict
        return length < 0 or allow


def _get_robots(url: str, user_agent: str) -> Any:
    """robots.txt as the crawlers' fetch asks for it, again over HTTP/1.1 when
    the server spoils HTTP/2 or says nothing (`wants_http1`)."""
    kwargs: dict[str, Any] = {
        "impersonate": "chrome136",
        "headers": {"User-Agent": user_agent},
        "timeout": 10,
        "verify": verify(),
    }
    try:
        return cffi_requests.get(url, **kwargs)
    except Exception as exc:
        if not wants_http1(exc, url):
            raise
        return cffi_requests.get(url, http_version=CurlHttpVersion.V1_1, **kwargs)


def _host_of(url: str) -> str:
    """Hostname for the robots cache, as written: robots.txt binds the host it
    is served from, and www.opole.pl has no address without its www.

    Deliberately not NormalizedParse: that one parses the query string and
    raises on params without '=' (e.g. '?debug'), which used to take a whole
    crawl result down. Robots only needs the host.
    """
    try:
        return (urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""


#: How long a host whose robots.txt answered 429 is taken to say no.
ROBOTS_BUSY_S = 60.0


class RobotsCache:
    def __init__(self, user_agent: str, clock: Any = time.monotonic) -> None:
        self.user_agent = user_agent
        self._parsers: dict[str, Robots | None] = {}
        self._unreachable: set[str] = set()
        #: Hosts whose robots.txt said "not now" (429), until when.
        self._busy: dict[str, float] = {}
        self._clock = clock
        self._lock = threading.Lock()

    def _parser(self, host: str) -> Robots | None:
        with self._lock:
            if host in self._parsers:
                return self._parsers[host]
            if self._busy.get(host, 0.0) > self._clock():
                return None
        parser: Robots | None = None
        reachable = False
        allow_all = busy = False
        for scheme in ("https", "http"):
            try:
                response = _get_robots(
                    f"{scheme}://{host}/robots.txt", self.user_agent
                )
            except Exception:
                continue
            reachable = True
            # 404 (no robots) and an empty 200 allow, a 200 parses, a 429 says
            # no for now; any other status is a hard error and denies, empty or
            # not (a 500 with no body used to allow all).
            if response.status_code == 404 or (
                response.status_code == 200 and not response.text.strip()
            ):
                allow_all = True
                break
            if response.status_code == 200:
                parser = Robots(robots_lines(response.text), self.user_agent)
                break
            if response.status_code == 429:
                busy = True
                break
        with self._lock:
            if busy:  # asked again once the while is over
                self._busy[host] = self._clock() + ROBOTS_BUSY_S
                return None
            # Unreachable, or an error status (403/5xx): deny.
            if not reachable or (parser is None and not allow_all):
                self._unreachable.add(host)
            self._parsers[host] = parser
        return parser

    def unreachable(self, url: str) -> bool:
        """Whether ``allowed`` said no because the host did not answer for its
        robots.txt (down, timing out, an error status, or 429 for now), not
        because it said no."""
        host = _host_of(url)
        with self._lock:
            busy = self._busy.get(host, 0.0) > self._clock()
            return host in self._unreachable or busy

    def allowed(self, url: str) -> bool:
        host = _host_of(url)
        if not host:
            return False
        parser = self._parser(host)
        if parser is None:
            return not self.unreachable(url)
        return parser.allowed(url)



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
