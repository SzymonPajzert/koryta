import pytest

from stores import web
from stores.web import RobotsCache, _host_of


def test_host_of_tolerates_funny_query_strings() -> None:
    """Regression: query params without '=' used to raise inside NormalizedParse.

    The robots cache only needs the host, so it must not parse the query at
    all -- a bare '?debug' took a whole crawl result down with it.
    """
    assert _host_of("https://bip.x.pl/path?debug") == "bip.x.pl"
    assert _host_of("https://bip.x.pl/path?a=1=2") == "bip.x.pl"
    assert _host_of("https://www.bip.x.pl/?a&b=2") == "www.bip.x.pl"
    assert _host_of("https://BIP.X.PL/Path") == "bip.x.pl"


def test_robots_txt_comes_from_the_urls_own_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """www.opole.pl has no address without its www.: asked at opole.pl, its
    robots.txt never answered, and the whole city read as unreachable."""
    asked: list[str] = []

    class Response:
        status_code = 200
        text = "User-agent: *\nDisallow: /private\n"

    def get(url: str, **_: object) -> Response:
        asked.append(url)
        return Response()

    monkeypatch.setattr(web.cffi_requests, "get", get)
    cache = RobotsCache("test-agent")
    assert cache.allowed("https://www.opole.pl/bip")
    assert not cache.allowed("https://www.opole.pl/private/x")
    assert not cache.unreachable("https://www.opole.pl/bip")
    assert asked == ["https://www.opole.pl/robots.txt"]


def test_robots_denies_urls_without_a_host() -> None:
    """No network call happens for a hostless URL: it is denied outright."""
    cache = RobotsCache("test-agent")
    assert cache.allowed("https:///no-host") is False
