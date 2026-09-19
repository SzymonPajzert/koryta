"""The one place both crawlers issue HTTP GETs."""

from __future__ import annotations

from dataclasses import dataclass

from curl_cffi import requests

DEFAULT_UA = "KorytaCrawler/0.1 (+http://koryta.pl/crawler)"


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
        response = requests.get(
            url,
            impersonate=impersonate,  # type: ignore[arg-type]
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
