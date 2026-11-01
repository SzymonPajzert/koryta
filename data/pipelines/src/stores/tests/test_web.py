import gzip
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

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


def test_a_page_under_an_encoding_curl_does_not_know_is_read_raw() -> None:
    """bip.tarnobrzeg.pl answers "Content-Encoding: identity, compress" over a
    plain page, which curl refuses (61) unless it leaves decoding alone."""
    body = b"<html>" + b"x" * 500 + b"</html>"

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            data = gzip.compress(body) if self.path == "/gz" else body
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Encoding", "identity, compress")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args: object) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        base = f"http://127.0.0.1:{server.server_port}"
        plain = fetch.http_get(base + "/")
        assert plain.ok and plain.content == body
        packed = fetch.http_get(base + "/gz")  # gzip under a name curl did not know
        assert packed.ok and packed.content == body
    finally:
        server.shutdown()


def test_a_post_sends_its_json_as_an_apps_script_would() -> None:
    """FINN e-Urząd's JSON-RPC: a JSON body, the crawler's own User-Agent, and
    a redirect handed back rather than followed; a form for SISCO eDc."""
    seen: list[tuple[str, dict[str, str], bytes]] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            body = self.rfile.read(int(self.headers["Content-Length"]))
            seen.append((self.path, dict(self.headers), body))
            moved = self.path == "/moved"
            self.send_response(303 if moved else 200)
            if moved:
                self.send_header("Location", "/elsewhere")
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"{}")

        def log_message(self, *args: object) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        base = f"http://127.0.0.1:{server.server_port}"
        payload = {"id": 1, "method": "/rpc/x0", "params": ['"OMR"']}
        answer = fetch.http_post(base + "/rpc/x0", payload, user_agent="Koryta")
        assert answer.ok and answer.content == b"{}"
        path, headers, body = seen[0]
        assert path == "/rpc/x0" and json.loads(body) == payload
        assert headers["Content-Type"] == "application/json"
        assert headers["User-Agent"] == "Koryta"
        moved = fetch.http_post(base + "/moved", payload)
        assert moved.status == 303 and len(seen) == 2
        # SISCO eDc's DataTables: the fields as a form, in their order.
        fetch.http_post(base + "/engine", [("draw", "1"), ("options[a][b]", "ś")])
        path, headers, body = seen[2]
        assert body == b"draw=1&options%5Ba%5D%5Bb%5D=%C5%9B"
        assert headers["Content-Type"].startswith("application/x-www-form-urlencoded")
    finally:
        server.shutdown()


UA = "KorytaBIPCrawler/0.1 (+http://koryta.pl/crawler)"


def allowed(robots_txt: str, path: str) -> bool:
    return web.Robots(robots_txt.splitlines(), UA).allowed(f"https://bip.x.pl{path}")


def test_a_wildcard_or_an_end_in_a_rule_applies() -> None:
    # 2ClickPortal's robots.txt (10-31): its accessibility toggles are disallowed.
    two_click = "User-agent: *\nDisallow: /szukaj/\nDisallow: /*wcag=\n"
    assert not allowed(two_click, "/oswiadczenia-2025.html?v=2&wcag=fs")
    assert not allowed(two_click, "/szukaj/x")
    assert allowed(two_click, "/oswiadczenia-2025.html")
    pdfs = "User-agent: *\nDisallow: /*.pdf$\n"
    assert not allowed(pdfs, "/f/a.pdf") and allowed(pdfs, "/f/a.pdf?v=1")


def test_the_longest_rule_decides_and_an_allow_wins_a_tie() -> None:
    assert allowed("User-agent: *\nDisallow: /*\nAllow: /bip/\n", "/bip/a")
    assert not allowed("User-agent: *\nDisallow: /*\nAllow: /bip/\n", "/inne")
    assert allowed("User-agent: *\nDisallow: /a\nAllow: /a\n", "/a")
    assert allowed("User-agent: *\nDisallow: /a\nAllow: /a/b\n", "/a/b")


def test_every_star_group_counts_and_the_crawlers_own_comes_first() -> None:
    # bip.info.pl's file (10-31): search engines may, everybody else may not.
    info = (
        "User-agent: *\nDisallow: /admin/\n\n"
        "User-agent: Googlebot\nDisallow:\nCrawl-delay: 10\n\n"
        "User-agent: *\nDisallow: /\n"
    )
    assert not allowed(info, "/index")
    assert allowed(info + "\nUser-agent: KorytaBIPCrawler\nAllow: /\n", "/index")
    assert allowed(info + "\nUser-agent: korytabipcrawler/0.1\nDisallow:\n", "/index")


def test_a_group_must_name_the_crawler_not_a_word_of_its_user_agent() -> None:
    assert allowed("User-agent: crawler\nDisallow: /\n", "/")
    assert allowed("User-agent: koryta\nDisallow: /\n", "/")
    assert not allowed("User-agent: KorytaBIPCrawler\nDisallow: /\n", "/")


def test_paths_compare_by_their_escapes() -> None:
    assert not allowed("User-agent: *\nDisallow: /%c5%81odz\n", "/Łodz")
    assert not allowed("User-agent: *\nDisallow: /~jan\n", "/%7Ejan")
    assert allowed("User-agent: *\nDisallow: /\n", "/robots.txt")
    assert allowed("User-agent: *\nDisallow:\n", "/x")
    assert allowed("Disallow: /\n", "/x")  # a rule outside any group


def test_a_bom_and_a_space_before_the_first_line_hide_nothing() -> None:
    lines = web.robots_lines("\ufeff User-agent: *\nDisallow: /admin/\n")
    assert not web.Robots(lines, UA).allowed("https://bip.x.pl/admin/x")


def test_a_long_file_of_plain_rules_is_read_by_lookup() -> None:
    # bip.malopolska.pl's file held 22,884 rules on 10-31.
    rules = "".join(f"Disallow: /ugx,a,{n},artykul.html\n" for n in range(20_000))
    more = "Allow: /ugx,a,1,artykul.html?x\nDisallow: /*.zip$\n"
    robots = web.Robots(f"User-agent: *\n{rules}{more}".splitlines(), UA)
    started = time.monotonic()
    for n in range(2_000):
        assert not robots.allowed(f"https://bip.m.pl/ugx,a,{n},artykul.html")
    assert time.monotonic() - started < 2
    assert robots.allowed("https://bip.m.pl/ugx,a,1,artykul.html?x=1")
    assert robots.allowed("https://bip.m.pl/ugx,a,30000,artykul.html")
    assert not robots.allowed("https://bip.m.pl/f.zip")


def test_a_robots_txt_that_says_not_now_is_a_no_for_a_while(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    answers = iter([(429, ""), (200, "User-agent: *\nDisallow: /private\n")])

    def get(url: str, **_: object) -> object:
        status, text = next(answers)

        class Response:
            status_code = status

        Response.text = text  # type: ignore[attr-defined]
        return Response()

    now = [0.0]
    monkeypatch.setattr(web.cffi_requests, "get", get)
    cache = RobotsCache("test-agent", clock=lambda: now[0])
    assert not cache.allowed("https://bip.x.pl/a")
    assert cache.unreachable("https://bip.x.pl/a")
    now[0] = web.ROBOTS_BUSY_S + 1
    assert cache.allowed("https://bip.x.pl/a")
    assert not cache.allowed("https://bip.x.pl/private/x")


def test_an_error_status_denies_whatever_its_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Response:
        status_code = 500
        text = ""

    monkeypatch.setattr(web.cffi_requests, "get", lambda url, **_: Response())
    cache = RobotsCache("test-agent")
    assert not cache.allowed("https://bip.x.pl/a")
    assert cache.unreachable("https://bip.x.pl/a")


def test_a_reply_that_is_no_http_is_asked_again_on_a_fresh_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """ZETO-RZESZÓW: the request after a &printtype=pdf answer, on the
    connection it spoiled, fails with curl (8)."""

    class Spoilt:
        calls = 0

        def get(self, url: str, **kwargs: object) -> object:
            self.calls += 1
            if self.calls == 1:
                raise RuntimeError("Failed to perform, curl: (8) Invalid status line")

            class Response:
                status_code = 200
                content = b"<html></html>"
                headers = {"Content-Type": "text/html"}

            Response.url = url  # type: ignore[attr-defined]
            return Response()

    server = Spoilt()
    fresh: list[str] = []
    monkeypatch.setattr(fetch, "_session", lambda impersonate: server)
    monkeypatch.setattr(fetch, "_fresh_session", fresh.append)
    result = fetch.http_get("https://bip.domaradz.pl/Oswiadczenia_majatkowe")
    assert result.ok and server.calls == 2 and fresh == ["chrome136"]
