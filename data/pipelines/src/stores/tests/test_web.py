import pytest
from curl_cffi import CurlHttpVersion

from scrapers.common import fetch
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


class _Http2Spoiler:
    """A server that answers only HTTP/1.1, and breaks or drops anything else."""

    def __init__(self, error: str) -> None:
        self.error = error
        self.versions: list[object] = []

    def get(self, url: str, **kwargs: object) -> object:
        self.versions.append(kwargs.get("http_version"))
        if kwargs.get("http_version") != CurlHttpVersion.V1_1:
            raise RuntimeError(f"Failed to perform, curl: {self.error}")

        class Response:
            status_code = 200
            text = "User-agent: *\n"
            content = b"<html></html>"
            headers = {"Content-Type": "text/html"}

        Response.url = url  # type: ignore[attr-defined]
        return Response()


@pytest.mark.parametrize(
    "error",
    [
        "(52) Empty reply from server.",
        "(92) HTTP/2 stream 1 was not closed cleanly: PROTOCOL_ERROR (err 1).",
        "(16) nghttp2 shuts down connection with error 9: COMPRESSION_ERROR.",
    ],
)
def test_a_server_that_only_speaks_http1_is_asked_again(
    monkeypatch: pytest.MonkeyPatch, error: str
) -> None:
    server = _Http2Spoiler(error)
    monkeypatch.setattr(fetch, "_session", lambda impersonate: server)
    result = fetch.http_get("https://bip.x.pl/")
    assert result.ok and server.versions == [None, CurlHttpVersion.V1_1]

    robots = _Http2Spoiler(error)
    monkeypatch.setattr(web.cffi_requests, "get", robots.get)
    cache = RobotsCache("test-agent")
    assert cache.allowed("https://bip.x.pl/") and not cache.unreachable(
        "https://bip.x.pl/"
    )
    assert robots.versions == [None, CurlHttpVersion.V1_1]


def test_other_failures_are_not_asked_again(monkeypatch: pytest.MonkeyPatch) -> None:
    server = _Http2Spoiler("(6) Could not resolve host: opole.pl.")
    monkeypatch.setattr(fetch, "_session", lambda impersonate: server)
    result = fetch.http_get("https://opole.pl/")
    assert not result.ok and "(6)" in result.error and server.versions == [None]


def test_gets_verify_against_the_bundle_once_one_is_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[object] = []

    class Server:
        def get(self, url: str, **kwargs: object) -> object:
            seen.append(kwargs.get("verify"))

            class Response:
                status_code = 200
                text = "User-agent: *\n"
                content = b"<html></html>"
                headers = {"Content-Type": "text/html"}

            Response.url = url  # type: ignore[attr-defined]
            return Response()

    server = Server()
    monkeypatch.setattr(fetch, "_session", lambda impersonate: server)
    monkeypatch.setattr(web.cffi_requests, "get", server.get)
    assert fetch.http_get("https://bip.x.pl/").ok
    monkeypatch.setattr(fetch, "_ca_bundle", "/cache/tls/ca-bundle.pem")
    assert fetch.http_get("https://bip.x.pl/").ok
    assert RobotsCache("test-agent").allowed("https://bip.y.pl/")
    assert seen == [True, "/cache/tls/ca-bundle.pem", "/cache/tls/ca-bundle.pem"]
