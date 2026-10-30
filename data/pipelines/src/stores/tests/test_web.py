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


V11 = CurlHttpVersion.V1_1


@pytest.mark.parametrize(
    ("error", "url", "robots_asked"),
    [
        # robots.txt is asked over https first: an empty reply there is final.
        ("(52) Empty reply from server.", "http://bip.x.pl/", [None, None, V11]),
        (
            "(92) HTTP/2 stream 1 was not closed cleanly.",
            "https://bip.x.pl/",
            [None, V11],
        ),
        (
            "(16) nghttp2 shuts down connection: COMPRESSION_ERROR.",
            "https://bip.x.pl/",
            [None, V11],
        ),
    ],
)
def test_a_server_that_only_speaks_http1_is_asked_again(
    monkeypatch: pytest.MonkeyPatch, error: str, url: str, robots_asked: list[object]
) -> None:
    server = _Http2Spoiler(error)
    monkeypatch.setattr(fetch, "_session", lambda impersonate: server)
    result = fetch.http_get(url)
    assert result.ok and server.versions == [None, V11]

    robots = _Http2Spoiler(error)
    monkeypatch.setattr(web.cffi_requests, "get", robots.get)
    cache = RobotsCache("test-agent")
    assert cache.allowed(url) and not cache.unreachable(url)
    assert robots.versions == robots_asked


def test_an_empty_reply_over_https_is_not_asked_again(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Over https a dropped HTTP/2 shows as 16 or 92; 52 there is the server's no.
    server = _Http2Spoiler("(52) Empty reply from server.")
    monkeypatch.setattr(fetch, "_session", lambda impersonate: server)
    assert not fetch.http_get("https://bip.x.pl/").ok
    assert server.versions == [None]


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


def test_directives_run_together_are_split_apart() -> None:
    """bip.malopolska.pl's robots.txt (10-30) held its Disallow lines on the
    User-agent line, which every parser read as one robot's name."""
    glued = (
        "User-agent: *Disallow: /Admin.htmlDisallow: /umwm,a,7,artykul.html"
        "Allow: /umwm,a,8,artykul.html\nDisallow: /e,pobierz,get.html?id=9\n"
    )
    assert web.robots_lines(glued) == [
        "User-agent: *",
        "Disallow: /Admin.html",
        "Disallow: /umwm,a,7,artykul.html",
        "Allow: /umwm,a,8,artykul.html",
        "Disallow: /e,pobierz,get.html?id=9",
    ]
    tidy = "User-agent: *\nDisallow: /private\n\nSitemap: https://x.pl/s.xml"
    assert web.robots_lines(tidy) == tidy.splitlines()


def test_a_glued_robots_txt_applies(monkeypatch: pytest.MonkeyPatch) -> None:
    class Response:
        status_code = 200
        text = "User-agent: *Disallow: /umwm,a,7,artykul.htmlDisallow: /e,pobierz"

    monkeypatch.setattr(web.cffi_requests, "get", lambda url, **_: Response())
    cache = RobotsCache("test-agent")
    assert not cache.allowed("https://bip.m.pl/umwm,a,7,artykul.html")
    assert not cache.allowed("https://bip.m.pl/e,pobierz,get.html?id=1")
    assert cache.allowed("https://bip.m.pl/umwm,a,8,artykul.html")


def test_a_comment_stays_a_comment() -> None:
    """bip.srodaslaska.pl's robots.txt comments both of its lines out."""
    commented = "#User-agent: *\n#Disallow: /\nDisallow: /a # not Disallow: /b"
    assert web.robots_lines(commented) == commented.splitlines()
