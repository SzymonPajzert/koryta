"""The one place both crawlers issue HTTP requests."""

from __future__ import annotations

import contextlib
import gzip
import re
import threading
import zlib
from dataclasses import dataclass
from typing import Any

from curl_cffi import CurlHttpVersion, CurlOpt, requests

DEFAULT_UA = "KorytaCrawler/0.1 (+http://koryta.pl/crawler)"

#: curl's errors for a server that spoils HTTP/2: 16 framing, 92 a stream it
#: resets. On plain http also 52, an empty reply: the impersonated browser offers
#: to upgrade to HTTP/2 there, and some servers hang up on the offer. Asked again
#: over HTTP/1.1 they answer: 235 of the people mode's unreachable candidacies on
#: 10-29, all of them on http://.
_HTTP2_SPOILED = re.compile(r"curl: \((?:16|92)\)")
_EMPTY_REPLY = re.compile(r"curl: \(52\)")
#: curl's error for a Content-Encoding it cannot decode. bip.tarnobrzeg.pl and
#: four more BIPs of the people mode (115 candidacies on 10-30) send "identity,
#: compress" over a plain page: read with curl's decoding off, it is all there.
_UNKNOWN_ENCODING = re.compile(r"curl: \(61\)")

_sessions = threading.local()
#: The certificates every GET verifies against; None is curl's own roots.
_ca_bundle: str | None = None


def wants_http1(error: object, url: str) -> bool:
    """Whether a failed GET of ``url`` is worth asking again over HTTP/1.1."""
    text = str(error)
    if _HTTP2_SPOILED.search(text):
        return True
    return url.lower().startswith("http://") and bool(_EMPTY_REPLY.search(text))


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
    #: Where a redirect not followed (``http_get(..., follow=False)``) points,
    #: as its Location header says: maybe relative to ``url``.
    location: str = ""

    @property
    def ok(self) -> bool:
        return not self.error and 200 <= self.status < 300


def http_get(
    url: str,
    timeout: float = 15.0,
    user_agent: str = DEFAULT_UA,
    impersonate: str = "chrome136",
    *,
    follow: bool = True,
) -> HttpResult:
    def get(**http1: object) -> requests.Response:
        return _session(impersonate).get(
            url,
            headers={"User-Agent": user_agent},
            timeout=timeout,
            allow_redirects=follow,
            # A str is taken as the CA file (CURLOPT_CAINFO); the stub says bool.
            verify=verify(),  # type: ignore[arg-type]
            **http1,  # type: ignore[arg-type]
        )

    def raw() -> requests.Response:
        # A session of its own: the thread's keeps decoding for every other GET.
        with requests.Session(
            impersonate=impersonate,  # type: ignore[arg-type]
            curl_options={CurlOpt.HTTP_CONTENT_DECODING: 0},
        ) as session:
            return session.get(
                url,
                headers={"User-Agent": user_agent},
                timeout=timeout,
                allow_redirects=follow,
                verify=verify(),  # type: ignore[arg-type]
            )

    decoded = True
    try:
        try:
            response = get()
        except Exception as exc:
            if wants_http1(exc, url):
                response = get(http_version=CurlHttpVersion.V1_1)
            elif _UNKNOWN_ENCODING.search(str(exc)):
                response, decoded = raw(), False
            else:
                raise
    except Exception as exc:
        return HttpResult(
            url=url, status=0, content_type="", content=b"", error=str(exc)[:200]
        )
    content = response.content
    if not decoded and content[:2] == b"\x1f\x8b":
        # Gzip after all, under a name curl did not know.
        with contextlib.suppress(OSError, EOFError, zlib.error):
            content = gzip.decompress(content)
    location = ""
    if not follow and 300 <= response.status_code < 400:
        location = response.headers.get("Location", "")
    return HttpResult(
        url=str(response.url),
        status=response.status_code,
        content_type=response.headers.get("Content-Type", ""),
        content=content,
        location=location,
    )


def http_post_json(
    url: str,
    payload: dict[str, Any],
    timeout: float = 15.0,
    user_agent: str = DEFAULT_UA,
    impersonate: str = "chrome136",
) -> HttpResult:
    """A POST of ``payload`` as JSON, the way an app's own script calls its API
    (FINN e-Urząd's JSON-RPC); a redirect is not followed."""
    try:
        response = _session(impersonate).post(
            url,
            json=payload,
            headers={"User-Agent": user_agent, "X-Requested-With": "XMLHttpRequest"},
            timeout=timeout,
            allow_redirects=False,
            verify=verify(),  # type: ignore[arg-type]
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
