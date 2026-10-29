"""The one place both crawlers issue HTTP GETs."""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass

from curl_cffi import CurlHttpVersion, requests

DEFAULT_UA = "KorytaCrawler/0.1 (+http://koryta.pl/crawler)"

#: curl's errors for a server that spoils HTTP/2 (16 framing, 92 a stream it
#: resets) or closes without a word (52). Plenty of BIP servers answer the same
#: request over HTTP/1.1: 235 of the people mode's unreachable candidacies on
#: 10-29.
_HTTP1_ONLY = re.compile(r"curl: \((?:16|52|92)\)")

_sessions = threading.local()
#: The certificates every GET verifies against; None is curl's own roots.
_ca_bundle: str | None = None


def wants_http1(error: object) -> bool:
    """Whether a failed GET is worth asking again over HTTP/1.1."""
    return bool(_HTTP1_ONLY.search(str(error)))


def use_ca_bundle(path: str | None) -> None:
    """Verify every GET from now on against ``path``: `stores.tls.ca_bundle`,
    curl's roots and the intermediates servers leave out."""
    global _ca_bundle
    _ca_bundle = path


def verify() -> str | bool:
    """What a GET passes as ``verify``: the bundle when there is one."""
    return _ca_bundle or True


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
    def get(**http1: object) -> requests.Response:
        return _session(impersonate).get(
            url,
            headers={"User-Agent": user_agent},
            timeout=timeout,
            allow_redirects=True,
            # A str is taken as the CA file (CURLOPT_CAINFO); the stub says bool.
            verify=verify(),  # type: ignore[arg-type]
            **http1,  # type: ignore[arg-type]
        )

    try:
        try:
            response = get()
        except Exception as exc:
            if not wants_http1(exc):
                raise
            response = get(http_version=CurlHttpVersion.V1_1)
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
