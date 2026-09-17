from __future__ import annotations

import tarfile
import threading
from pathlib import Path

from scrapers.bip.classify import (
    extract_links,
    filename_from_url,
    is_document_content_type,
    is_document_url,
)
from scrapers.bip.crawler import FetchResult, crawl_host
from scrapers.bip.frontier import Frontier
from scrapers.bip.models import CrawlOptions, DocRow, HostRow
from scrapers.bip.ratelimit import HostRateLimiter
from scrapers.bip.registry import hosts_from_entries, parse_subjects_xml
from scrapers.bip.store import LocalBundleStore

REGISTRY_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<resultset>
  <row>
    <id>1</id><name>Urzad Gminy A</name><url>https://bip.a.pl/</url>
    <place>A</place><email>a@a.pl</email>
    <communeTercCode><code>1416022</code></communeTercCode>
  </row>
  <row>
    <id>2</id><name>Szkola w A</name><url>http://bip.a.pl/szkola</url>
    <place>A</place><communeTercCode><code>1416022</code></communeTercCode>
  </row>
  <row>
    <id>3</id><name>Bez adresu</name><url></url>
  </row>
</resultset>
"""


def test_parse_subjects_skips_rows_without_url() -> None:
    entries = parse_subjects_xml(REGISTRY_XML)
    assert len(entries) == 2
    first = entries[0]
    assert first.name == "Urzad Gminy A"
    assert first.host == "bip.a.pl"
    assert first.teryt == "1416022"


def test_hosts_dedupe_by_host() -> None:
    hosts = hosts_from_entries(parse_subjects_xml(REGISTRY_XML))
    assert len(hosts) == 1
    assert hosts[0].host == "bip.a.pl"
    assert hosts[0].entry_count == 2


def test_document_url_patterns() -> None:
    assert is_document_url("https://bip.x.pl/attachments/download/97417")
    assert is_document_url("https://bip.x.pl/plik.php?zid=121727")
    assert is_document_url("https://bip.x.pl/resource/12497/Postanowienie+134.pdf")
    assert is_document_url("https://bip.x.pl/api/files/4207277")
    assert not is_document_url("https://bip.x.pl/oswiadczenie-majatkowe/1/kowalski")


def test_document_content_types() -> None:
    assert is_document_content_type("application/pdf; charset=binary")
    assert is_document_content_type("application/zip")
    assert not is_document_content_type("text/html; charset=utf-8")


def test_filename_from_url() -> None:
    assert (
        filename_from_url("https://bip.x.pl/a/b/om_m_sulgan.pdf") == "om_m_sulgan.pdf"
    )
    assert filename_from_url("https://bip.x.pl/attachments/download/1") == "1"


def test_extract_links_keeps_query_and_skips_non_http() -> None:
    html = """
    <html><body>
      <a href="/plik.php?zid=121727">Umowy</a>
      <a href="attachments/download/9">Zalacznik</a>
      <a href="#top">top</a>
      <a href="mailto:a@b.pl">mail</a>
      <a href="javascript:void(0)">js</a>
      <a href="https://other.example/x">obcy</a>
    </body></html>
    """
    links = extract_links(html, "https://bip.x.pl/index.html")
    urls = {link.url for link in links}
    assert "https://bip.x.pl/plik.php?zid=121727" in urls
    assert "https://bip.x.pl/attachments/download/9" in urls
    assert "https://other.example/x" in urls
    assert len(links) == 3


def test_frontier_upsert_and_doc_dedupe(tmp_path: Path) -> None:
    frontier = Frontier(tmp_path / "frontier.db")
    host = HostRow(
        host="bip.a.pl",
        name="A",
        source_url="https://bip.a.pl/",
        teryt="1",
        entry_count=1,
    )
    inserted, updated = frontier.upsert_hosts([host])
    assert (inserted, updated) == (1, 0)
    inserted, updated = frontier.upsert_hosts([host])
    assert (inserted, updated) == (0, 1)
    assert frontier.stats()["hosts"] == 1

    row = DocRow(
        sha256="deadbeef",
        url="https://bip.a.pl/attachments/download/1",
        host="bip.a.pl",
        content_type="application/pdf",
        size=10,
        filename="1",
        title="t",
        bundle="hostname=bip.a.pl/date=2026-01-01/uid_x.tar.gz",
        chain=["https://bip.a.pl/"],
    )
    assert frontier.record_docs([row]) == 1
    assert frontier.record_docs([row]) == 0
    assert frontier.stats()["docs"] == 1
    frontier.close()


def test_store_bundles_and_dedupes(tmp_path: Path) -> None:
    store = LocalBundleStore(tmp_path / "out")
    row, is_new = store.add(
        host="bip.a.pl",
        url="https://bip.a.pl/attachments/download/1",
        data=b"%PDF-1.4 fake",
        content_type="application/pdf",
        filename="1.pdf",
        title="umowa",
        chain=["https://bip.a.pl/"],
    )
    assert is_new
    assert row.bundle.endswith(".tar.gz")
    _, is_new_again = store.add(
        host="bip.a.pl",
        url="https://bip.a.pl/attachments/download/1",
        data=b"%PDF-1.4 fake",
        content_type="application/pdf",
        filename="1.pdf",
        title="umowa",
        chain=["https://bip.a.pl/"],
    )
    assert not is_new_again
    store.flush()
    bundle = tmp_path / "out" / row.bundle
    assert bundle.exists()


def test_store_is_thread_safe(tmp_path: Path) -> None:
    """Regression: concurrent adds deadlocked the first 100-host run."""
    store = LocalBundleStore(tmp_path / "out", max_bundle_bytes=10_000)

    def worker(index: int) -> None:
        store.add(
            host="bip.a.pl",
            url=f"https://bip.a.pl/{index}",
            data=f"doc-{index}".encode() * 10,
            content_type="application/pdf",
            filename=f"{index}.pdf",
            title="",
            chain=[],
        )

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(24)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    store.flush()

    names: list[str] = []
    for bundle in (tmp_path / "out").rglob("uid_*.tar.gz"):
        with tarfile.open(bundle) as archive:
            names += [
                member.name
                for member in archive.getmembers()
                if member.isfile() and member.name != "index.txt"
            ]
    assert len(names) == 24


def test_missing_bundle_is_restored(tmp_path: Path) -> None:
    """A document whose bundle was lost must be re-stored, not treated as a dup."""
    store = LocalBundleStore(tmp_path / "out")
    frontier = Frontier(tmp_path / "frontier.db")
    row, _ = store.add(
        host="bip.a.pl",
        url="https://bip.a.pl/1",
        data=b"%PDF-1.4 lost",
        content_type="application/pdf",
        filename="1.pdf",
        title="",
        chain=[],
    )
    store.flush()
    frontier.record_docs([row])
    assert frontier.doc_bundle(row.sha256) == row.bundle
    assert store.blob_exists(row.bundle)
    assert not store.blob_exists("hostname=bip.a.pl/date=1970-01-01/uid_none.tar.gz")
    frontier.close()


def test_crawl_follows_cross_host_redirect_with_prefix(tmp_path: Path) -> None:
    """*.bip.gov.pl now serves under www.gov.pl/web/<slug>; scope follows it."""
    frontier = Frontier(tmp_path / "frontier.db")
    store = LocalBundleStore(tmp_path / "out")
    pages = {
        "http://bip.test/": (
            "text/html",
            b"<html><a href='https://portal.test/web/test/oswiadczenia'>s</a></html>",
        ),
        "https://portal.test/web/test/oswiadczenia": (
            "text/html",
            b"<html><a href='https://portal.test/web/test/attachments/download/1'>d</a>"
            b"<a href='https://portal.test/other/x'>out</a></html>",
        ),
        "https://portal.test/web/test/attachments/download/1": (
            "application/pdf",
            b"%PDF-1.4 x",
        ),
    }

    def fetch(url: str, timeout: float, user_agent: str) -> FetchResult:
        if url == "http://bip.test/":
            content_type, content = pages[url]
            return FetchResult(
                url="https://portal.test/web/test",
                status=200,
                content_type=content_type,
                content=content,
            )
        if url in pages:
            content_type, content = pages[url]
            return FetchResult(
                url=url, status=200, content_type=content_type, content=content
            )
        return FetchResult(
            url=url, status=404, content_type="text/html", content=b"", error="404"
        )

    host = HostRow(
        host="bip.test",
        name="t",
        source_url="http://bip.test/",
        teryt="",
        entry_count=1,
    )
    stats = crawl_host(
        host,
        frontier=frontier,
        store=store,
        fetch=fetch,
        robots_allowed=lambda url: True,
        rate_limiter=HostRateLimiter(0.0),
        options=CrawlOptions(max_pages_per_host=10, max_depth=3),
    )
    store.flush()
    assert stats.pages_fetched == 2
    assert stats.docs_stored == 1
    assert frontier.url_count() == 3  # the /other/ link stayed out of scope
    frontier.close()


def test_crawl_host_follows_links_and_stores_docs(tmp_path: Path) -> None:
    frontier = Frontier(tmp_path / "frontier.db")
    store = LocalBundleStore(tmp_path / "out")
    pages = {
        "https://bip.test/": (
            "text/html",
            b"""<html><title>BIP test</title><body>
            <a href="/oswiadczenia">Oswiadczenia</a>
            <a href="/attachments/download/1">Zalacznik 1</a>
            <a href="mailto:x@y.z">mail</a>
            </body></html>""",
        ),
        "https://bip.test/oswiadczenia": (
            "text/html",
            b"<html><title>Oswiadczenia</title>"
            b"<a href=/attachments/download/2>Zalacznik 2</a></html>",
        ),
        "https://bip.test/attachments/download/1": ("application/pdf", b"%PDF-1.4 one"),
        "https://bip.test/attachments/download/2": ("application/pdf", b"%PDF-1.4 two"),
    }

    def fetch(url: str, timeout: float, user_agent: str) -> FetchResult:
        if url in pages:
            content_type, content = pages[url]
            return FetchResult(
                url=url, status=200, content_type=content_type, content=content
            )
        return FetchResult(
            url=url, status=404, content_type="text/html", content=b"", error="http 404"
        )

    host = HostRow(
        host="bip.test",
        name="Test",
        source_url="https://bip.test/",
        teryt="",
        entry_count=1,
    )
    stats = crawl_host(
        host,
        frontier=frontier,
        store=store,
        fetch=fetch,
        robots_allowed=lambda url: True,
        rate_limiter=HostRateLimiter(0.0),
        options=CrawlOptions(max_pages_per_host=10, max_depth=3),
    )
    store.flush()
    assert stats.pages_fetched == 2
    assert stats.docs_stored == 2
    assert stats.errors == 0
    assert frontier.stats()["docs"] == 2
    assert frontier.stats()["urls"] == 4
    frontier.close()
