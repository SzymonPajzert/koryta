from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from typing import cast

from scrapers.bip.classify import (
    host_of,
    is_document_url,
    is_low_value_url,
    is_section_url,
    normalize_url,
    path_of,
    priority_for,
)
from scrapers.bip.coordinator import BipCoordinator, CoordinatorOptions
from scrapers.bip.frontier import BipFrontier
from scrapers.bip.models import DocRow, HostRow, UrlRow
from scrapers.bip.registry import hosts_from_entries, parse_subjects_xml
from scrapers.bip.store import LocalBundleStore, rewrap_part
from scrapers.common.fetch import HttpResult
from scrapers.common.links import extract_links
from scrapers.common.ratelimit import HostTokenBucket

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
  <row><id>3</id><name>Bez adresu</name><url></url></row>
</resultset>
"""


# -- registry ----------------------------------------------------------------
def test_parse_subjects_skips_rows_without_url() -> None:
    entries = parse_subjects_xml(REGISTRY_XML)
    assert len(entries) == 2
    assert entries[0].host == "bip.a.pl"
    assert entries[0].teryt == "1416022"


def test_hosts_dedupe_by_host() -> None:
    hosts = hosts_from_entries(parse_subjects_xml(REGISTRY_XML))
    assert len(hosts) == 1
    assert hosts[0].entry_count == 2


# -- classification ----------------------------------------------------------
def test_document_url_patterns() -> None:
    assert is_document_url("https://bip.x.pl/attachments/download/97417")
    assert is_document_url("https://bip.x.pl/plik.php?zid=121727")
    assert is_document_url("https://bip.x.pl/resource/12497/Postanowienie+134.pdf")
    assert not is_document_url("https://bip.x.pl/oswiadczenie-majatkowe/1/kowalski")


def test_priorities_documents_before_sections_before_pages() -> None:
    doc = priority_for("https://bip.x.pl/attachments/download/1")
    section = priority_for("https://bip.x.pl/oswiadczenia-majatkowe")
    page = priority_for("https://bip.x.pl/kontakt")
    assert doc < section < page
    assert is_section_url("https://bip.x.pl/oswiadczenia-majatkowe")
    assert is_low_value_url("https://bip.x.pl/banners/1/redirect")


def test_url_helpers() -> None:
    assert normalize_url("https://bip.x.pl/a/#frag") == "https://bip.x.pl/a"
    assert host_of("https://www.bip.x.pl/a") == "bip.x.pl"
    assert path_of("https://bip.x.pl/a/b?q=1") == "/a/b?q=1"


# -- shared utils ------------------------------------------------------------
def test_shared_link_extraction_keeps_query_when_asked() -> None:
    html = '<a href="/plik.php?zid=1">d</a><a href="mailto:x@y">m</a>'
    assert extract_links(html, "https://bip.x.pl/", keep_query=True) == [
        "https://bip.x.pl/plik.php?zid=1"
    ]
    assert extract_links(html, "https://bip.x.pl/", keep_query=False) == [
        "https://bip.x.pl/plik.php"
    ]


def test_token_bucket_bursts_then_throttles() -> None:
    bucket = HostTokenBucket(interval_s=1.0, burst_window_s=3.0, clock=lambda: 100.0)
    assert [bucket.acquire("h") for _ in range(5)] == [True, True, True, False, False]


# -- bundle store ------------------------------------------------------------
def test_store_dedupes_and_names_by_crawl(tmp_path: Path) -> None:
    store = LocalBundleStore(tmp_path / "out")
    row, is_new = store.add(
        host="bip.a.pl",
        crawl_id="c1",
        url="https://bip.a.pl/attachments/download/1",
        data=b"%PDF-1.4 fake",
        content_type="application/pdf",
        filename="1.pdf",
        title="",
        chain=["https://bip.a.pl/"],
    )
    assert is_new
    assert "crawl=c1" in row.bundle
    _, is_new_again = store.add(
        host="bip.a.pl",
        crawl_id="c1",
        url="https://bip.a.pl/attachments/download/1",
        data=b"%PDF-1.4 fake",
        content_type="application/pdf",
        filename="1.pdf",
        title="",
        chain=[],
    )
    assert not is_new_again
    store.flush()
    assert (tmp_path / "out" / row.bundle).exists()
    assert not list((tmp_path / "out").rglob("*.part"))


def test_rewrap_recovers_a_truncated_bundle(tmp_path: Path) -> None:
    """A killed run's .part must be recoverable without re-downloading."""
    store = LocalBundleStore(tmp_path / "out")
    row, _ = store.add(
        host="bip.a.pl",
        crawl_id="c1",
        url="https://bip.a.pl/1",
        data=b"first",
        content_type="application/pdf",
        filename="one.pdf",
        title="",
        chain=[],
    )
    store.flush()
    bundle = tmp_path / "out" / row.bundle
    killed = bundle.read_bytes()
    bundle.unlink()
    part = Path(f"{bundle}.part")
    part.write_bytes(killed[:-16])  # drop the gzip trailer: what a kill leaves

    rel, members, status = rewrap_part(part, tmp_path / "out")
    assert status == "repaired"
    assert members == ["one.pdf"]
    assert (tmp_path / "out" / rel).exists()
    assert not part.exists()


# -- coordinator -------------------------------------------------------------
class FakeFrontier:
    """In-memory stand-in for BipFrontier, same methods the coordinator uses."""

    def __init__(self, hosts: list[HostRow]) -> None:
        self.hosts = {h.host: h for h in hosts}
        self.urls: dict[str, UrlRow] = {}
        self.states: dict[str, str] = {}
        self.docs: dict[str, DocRow] = {}
        self.counters: dict[str, dict[str, int]] = {}
        self.seeded: list[str] = []

    # hosts
    def select_hosts(self, *, freshness_seconds, limit):  # noqa: ANN001
        return list(self.hosts.values())[:limit]

    def start_host(self, host: str, crawl_id: str) -> None:
        self.counters[host] = {"pages": 0, "docs": 0}
        self.seeded.append(host)

    def bump_host(self, host, *, pages=0, docs=0, cap_hit=False) -> None:  # noqa: ANN001
        self.counters[host]["pages"] += pages
        self.counters[host]["docs"] += docs

    def host_pending(self, host: str) -> int:
        return sum(
            1
            for u, s in self.states.items()
            if self.urls[u].host == host and s in ("queued", "claimed")
        )

    def finalize_host(self, host: str, status: str) -> None:
        self.hosts[host] = replace(self.hosts[host], status=status)

    # urls
    def queue_url(self, row: UrlRow, *, requeue: bool = False) -> bool:
        if row.url in self.urls:
            if requeue or self.states.get(row.url) == "skipped":
                self.states[row.url] = "queued"
            return False
        self.urls[row.url] = row
        self.states[row.url] = "queued"
        return True

    def claim_urls(
        self, worker_id: str, *, hosts: list[str], limit: int, lock_seconds: int
    ) -> list[UrlRow]:
        claimed = []
        for url, state in list(self.states.items()):
            if self.urls[url].host not in hosts:
                continue
            if state == "queued":
                self.states[url] = "claimed"
                claimed.append(self.urls[url])
            if len(claimed) >= limit:
                break
        return claimed

    def mark_url(self, url, *, state, **kwargs) -> None:  # noqa: ANN001, ANN003
        self.states[url] = state

    def record_docs(self, docs: list[DocRow], crawl_id: str) -> int:
        new = 0
        for doc in docs:
            if doc.sha256 not in self.docs:
                new += 1
            self.docs[doc.sha256] = doc
        return new

    def doc_bundle(self, sha256: str) -> str | None:
        doc = self.docs.get(sha256)
        return doc.bundle if doc else None

    def start_run(self, run_id: str) -> None:
        pass

    def finish_run(self, run_id: str, stats) -> None:  # noqa: ANN001
        pass

    def stats(self) -> dict[str, int]:
        return {}

    def recent_rates(self, window_minutes: int = 60) -> dict[str, float]:
        return {
            "window_minutes": window_minutes,
            "pages": 0,
            "docs": 0,
            "hosts": 0,
            "doc_hosts": 0,
            "bytes": 0,
            "pages_per_min": 0.0,
            "docs_per_min": 0.0,
            "hosts_per_min": 0.0,
        }


def _site_pages():
    return {
        "https://bip.test/": (
            "text/html",
            b"<html><a href=/oswiadczenia>sec</a>"
            b"<a href=/attachments/download/1>doc</a>"
            b"<a href=/banners/1>junk</a></html>",
        ),
        "https://bip.test/oswiadczenia": (
            "text/html",
            b"<html><a href=/attachments/download/2>doc2</a></html>",
        ),
        "https://bip.test/attachments/download/1": ("application/pdf", b"%PDF-1.4 one"),
        "https://bip.test/attachments/download/2": ("application/pdf", b"%PDF-1.4 two"),
    }


def _run_coordinator(
    tmp_path: Path,
    pages,
    *,
    robots_allowed=lambda url: True,
    **option_overrides,
):  # noqa: ANN001, ANN003
    frontier = FakeFrontier(
        [
            HostRow(
                host="bip.test",
                name="t",
                source_url="https://bip.test/",
                teryt="",
                entry_count=1,
            )
        ]
    )
    store = LocalBundleStore(tmp_path / "out")

    def fetch(url: str, timeout: float, user_agent: str) -> HttpResult:
        if url in pages:
            content_type, content = pages[url]
            return HttpResult(
                url=url, status=200, content_type=content_type, content=content
            )
        return HttpResult(url=url, status=404, content_type="text/html", content=b"")

    option_values: dict[str, object] = dict(
        workers=2, max_pages=10, max_docs=10, rate_interval_s=0.0
    )
    option_values.update(option_overrides)
    options = CoordinatorOptions(**option_values)  # type: ignore[arg-type]
    coordinator = BipCoordinator(
        cast("BipFrontier", frontier),  # test double
        store,
        options,
        fetch=fetch,
        robots_allowed=robots_allowed,
    )
    stats = coordinator.run()
    return frontier, store, stats


def test_coordinator_crawls_pages_and_documents(tmp_path: Path) -> None:
    frontier, store, stats = _run_coordinator(tmp_path, _site_pages())
    assert stats.pages_fetched == 2
    assert stats.docs_new == 2
    assert "https://bip.test/banners/1" not in frontier.urls
    assert frontier.hosts["bip.test"].status == "ok"
    assert len(frontier.docs) == 2
    assert stats.errors == 0


def test_coordinator_marks_partial_when_capped(tmp_path: Path) -> None:
    frontier, _store, stats = _run_coordinator(
        tmp_path, _site_pages(), max_docs=1
    )
    assert frontier.hosts["bip.test"].status == "partial"
    assert stats.docs_new == 1


class RecordingStore(LocalBundleStore):
    flushed = False

    def flush(self):  # noqa: ANN201
        self.flushed = True
        return super().flush()


def test_stopped_run_flushes_bundles(tmp_path: Path) -> None:
    """Ctrl-C/SIGTERM must close open bundles, not leave .part files behind."""
    frontier = FakeFrontier(
        [
            HostRow(
                host="bip.test",
                name="t",
                source_url="https://bip.test/",
                teryt="",
                entry_count=1,
            )
        ]
    )
    store = RecordingStore(tmp_path / "out")
    coordinator = BipCoordinator(
        cast("BipFrontier", frontier),  # test double
        store,
        CoordinatorOptions(workers=1, rate_interval_s=0.0),
        fetch=lambda url, timeout, ua: HttpResult(
            url=url, status=404, content_type="text/html", content=b""
        ),
        robots_allowed=lambda url: True,
    )
    coordinator.stop()
    coordinator.run()
    assert store.flushed
    assert list((tmp_path / "out").rglob("*.part")) == []


def test_coordinator_skips_robots_denied(tmp_path: Path) -> None:
    frontier, _store, stats = _run_coordinator(
        tmp_path, _site_pages(), robots_allowed=lambda url: False
    )
    assert stats.skipped >= 1
    assert stats.docs_new == 0
    assert frontier.hosts["bip.test"].status == "dead"
