from __future__ import annotations

from concurrent.futures import Future
from dataclasses import replace
from pathlib import Path
from typing import cast

from bip_cli import repair_parts
from scrapers.bip.classify import (
    host_of,
    is_document_url,
    is_low_value_url,
    normalize_url,
    path_of,
)
from scrapers.bip.coordinator import BipCoordinator, CoordinatorOptions, _ActiveHost
from scrapers.bip.registry import hosts_from_entries, parse_subjects_xml
from scrapers.bip.store import LocalBundleStore, rewrap_part
from scrapers.common.fetch import HttpResult
from scrapers.common.links import extract_link_pairs, extract_links
from scrapers.common.ratelimit import HostTokenBucket
from scrapers.stores import BipQueue, DocRow, HostRow, UrlRow

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


def test_shared_portal_prefers_root_entry_as_representative() -> None:
    deep_first = b"""<resultset>
      <row><id>1</id><name>Przedszkole Nr 96</name>
        <url>https://bip.city.pl/bip/przedszkole,1442/</url></row>
      <row><id>2</id><name>Urzad Miasta</name><url>https://bip.city.pl/</url></row>
      <row><id>3</id><name>Zly adres</name><url>http://szkola@bip.city.pl</url></row>
    </resultset>"""
    hosts = hosts_from_entries(parse_subjects_xml(deep_first))
    assert len(hosts) == 1
    assert hosts[0].name == "Urzad Miasta"
    assert hosts[0].source_url == "https://bip.city.pl/"
    assert hosts[0].entry_count == 3

    root_first = b"""<resultset>
      <row><id>1</id><name>Urzad Miasta</name><url>https://bip.city.pl/</url></row>
      <row><id>2</id><name>Przedszkole Nr 96</name>
        <url>https://bip.city.pl/bip/przedszkole,1442/</url></row>
    </resultset>"""
    hosts = hosts_from_entries(parse_subjects_xml(root_first))
    assert hosts[0].name == "Urzad Miasta"
    assert hosts[0].source_url == "https://bip.city.pl/"


# -- classification ----------------------------------------------------------
def test_document_url_patterns() -> None:
    assert is_document_url("https://bip.x.pl/attachments/download/97417")
    assert is_document_url("https://bip.x.pl/plik.php?zid=121727")
    assert is_document_url("https://bip.x.pl/resource/12497/Postanowienie+134.pdf")
    assert not is_document_url("https://bip.x.pl/oswiadczenie-majatkowe/1/kowalski")


def test_url_helpers() -> None:
    assert normalize_url("https://bip.x.pl/a/#frag") == "https://bip.x.pl/a"
    assert host_of("https://www.bip.x.pl/a") == "bip.x.pl"
    assert path_of("https://bip.x.pl/a/b?q=1") == "/a/b?q=1"
    assert is_low_value_url("https://bip.x.pl/banners/1/redirect")


def test_normalize_url_collapses_echoed_query_junk() -> None:
    base = "http://www.bip.mops.radom.pl/rejestr-zmian.html"
    expected = f"{base}?acc_cr=1&acc_pa=1&page=6"
    assert (
        normalize_url(f"{base}?amp%3Bamp%3Bacc_pa=1&amp;amp%3Bacc_cr=1&page=6&acc_pa=1")
        == expected
    )
    assert (
        normalize_url(f"{base}?amp%3Bamp%3Bamp%3Bacc_pa=1&amp%3Bacc_cr=1&amp;page=6")
        == expected
    )


def test_normalize_url_drops_image_map_coordinates() -> None:
    assert normalize_url(
        "https://www.bip.tczow.akcessnet.net/index.php"
        "?job=wiad&idg=4&id=377&x=123&y=101&n_id=449"
    ) == (
        "https://www.bip.tczow.akcessnet.net/index.php"
        "?id=377&idg=4&job=wiad&n_id=449"
    )


def test_normalize_url_drops_presentation_toggles() -> None:
    base = "https://bip.chelmza.pl/10262,sprawozdania"
    assert normalize_url(f"{base}?fontsize=big") == base
    assert normalize_url(f"{base}?FontSize=bigger") == base
    assert normalize_url(f"{base}?switch_extend_word_spacing=on") == base
    assert normalize_url(f"{base}?print=1&pokaz_rejestr_zmian=1") == base
    assert (
        normalize_url(f"{base}?switch_off_darkmode=1&tresc=5") == f"{base}?tresc=5"
    )


# -- shared utils ------------------------------------------------------------
def test_shared_link_extraction_keeps_query_when_asked() -> None:
    html = '<a href="/plik.php?zid=1">d</a><a href="mailto:x@y">m</a>'
    assert extract_links(html, "https://bip.x.pl/", keep_query=True) == [
        "https://bip.x.pl/plik.php?zid=1"
    ]
    assert extract_links(html, "https://bip.x.pl/", keep_query=False) == [
        "https://bip.x.pl/plik.php"
    ]


def test_shared_link_extraction_captures_anchor_text() -> None:
    html = '<a href="/plik.php?zid=1">Umowa nr 5</a><a href="/x">Drugi</a>'
    assert extract_link_pairs(html, "https://bip.x.pl/", keep_query=True) == [
        ("https://bip.x.pl/plik.php?zid=1", "Umowa nr 5"),
        ("https://bip.x.pl/x", "Drugi"),
    ]
    assert extract_links(html, "https://bip.x.pl/", keep_query=True) == [
        "https://bip.x.pl/plik.php?zid=1",
        "https://bip.x.pl/x",
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


def test_repair_parts_rewraps_stale_bundles(tmp_path: Path) -> None:
    out = tmp_path / "out"
    store = LocalBundleStore(out)
    bundles = []
    for i in range(2):
        row, _ = store.add(
            host=f"h{i}.pl",
            crawl_id="c1",
            url=f"https://h{i}.pl/{i}",
            data=f"data{i}".encode(),
            content_type="application/pdf",
            filename=f"{i}.pdf",
            chain=[],
        )
        bundles.append(row.bundle)
    store.flush()
    for rel in bundles:
        bundle = out / rel
        killed = bundle.read_bytes()
        bundle.unlink()
        Path(f"{bundle}.part").write_bytes(killed[:-16])

    frontier = FakeFrontier(
        [HostRow(host="h0.pl", name="x", source_url="", teryt="", entry_count=1)]
    )
    counts = repair_parts(
        cast("BipQueue", frontier), out, older_than_minutes=0, keep_missing=True
    )

    assert counts == {"parts": 2, "repaired": 2, "empty": 0, "failed": 0, "pruned": 0}
    assert list(out.rglob("*.part")) == []


# -- coordinator -------------------------------------------------------------
class FakeFrontier:
    """In-memory stand-in for BipQueue, same methods the coordinator uses."""

    def __init__(self, hosts: list[HostRow]) -> None:
        self.hosts = {h.host: h for h in hosts}
        self.urls: dict[str, UrlRow] = {}
        self.states: dict[str, str] = {}
        self.skip_reasons: dict[str, str] = {}
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
            state = self.states.get(row.url)
            if state == "skipped" and self.skip_reasons.get(row.url) == "robots":
                return False
            if requeue or state == "skipped":
                self.states[row.url] = "queued"
            return False
        self.urls[row.url] = row
        self.states[row.url] = "queued"
        return True

    def queue_urls(self, rows: list[UrlRow], *, requeue: bool = False) -> int:
        unique: dict[str, UrlRow] = {}
        for row in rows:
            unique.setdefault(row.url, row)
        return sum(1 for row in unique.values() if self.queue_url(row, requeue=requeue))

    def claim_urls(
        self, worker_id: str, *, hosts: list[str], limit: int, lock_seconds: int
    ) -> list[UrlRow]:
        queues: dict[str, list[str]] = {}
        for url, state in self.states.items():
            row = self.urls[url]
            if state == "queued" and row.host in hosts:
                queues.setdefault(row.host, []).append(url)
        for urls in queues.values():
            urls.sort(key=lambda u: (self.urls[u].depth, u))
        claimed: list[UrlRow] = []
        while len(claimed) < limit:
            progressed = False
            for urls in queues.values():
                if not urls:
                    continue
                progressed = True
                url = urls.pop(0)
                self.states[url] = "claimed"
                claimed.append(self.urls[url])
                if len(claimed) >= limit:
                    break
            if not progressed:
                break
        return claimed

    def mark_url(self, url, *, state, skip_reason="", **kwargs) -> None:  # noqa: ANN001, ANN003
        self.states[url] = state
        if skip_reason:
            self.skip_reasons[url] = skip_reason

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

    def docs_for_bundle(self, bundle: str) -> list[tuple[str, str]]:
        return []

    def delete_docs(self, shas: list[str]) -> int:
        return 0

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


def test_claim_urls_round_robins_across_hosts() -> None:
    hosts = [
        HostRow(host="a.pl", name="A", source_url="", teryt="", entry_count=1),
        HostRow(host="b.pl", name="B", source_url="", teryt="", entry_count=1),
    ]
    bip_queue = FakeFrontier(hosts)
    for i in range(3):
        bip_queue.queue_url(
            UrlRow(url=f"https://a.pl/d{i}.pdf", host="a.pl", kind="doc", depth=i)
        )
        bip_queue.queue_url(
            UrlRow(url=f"https://b.pl/{i}", host="b.pl", kind="page", depth=i)
        )
    claimed = bip_queue.claim_urls(
        "c", hosts=["a.pl", "b.pl"], limit=4, lock_seconds=60
    )
    assert [row.host for row in claimed] == ["a.pl", "b.pl", "a.pl", "b.pl"]


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
    bip_queue = FakeFrontier(
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
        cast("BipQueue", bip_queue),  # test double
        store,
        options,
        fetch=fetch,
        robots_allowed=robots_allowed,
    )
    stats = coordinator.run()
    return bip_queue, store, stats


def test_coordinator_crawls_pages_and_documents(tmp_path: Path) -> None:
    bip_queue, store, stats = _run_coordinator(tmp_path, _site_pages())
    assert stats.pages_fetched == 2
    assert stats.docs_new == 2
    assert "https://bip.test/banners/1" not in bip_queue.urls
    assert bip_queue.hosts["bip.test"].status == "ok"
    assert len(bip_queue.docs) == 2
    assert stats.errors == 0


def test_coordinator_marks_partial_when_capped(tmp_path: Path) -> None:
    bip_queue, _store, stats = _run_coordinator(
        tmp_path, _site_pages(), max_docs=1
    )
    assert bip_queue.hosts["bip.test"].status == "partial"
    assert stats.docs_new == 1


class RecordingStore(LocalBundleStore):
    flushed = False

    def flush(self):  # noqa: ANN201
        self.flushed = True
        return super().flush()


def test_stopped_run_flushes_bundles(tmp_path: Path) -> None:
    """Ctrl-C/SIGTERM must close open bundles, not leave .part files behind."""
    bip_queue = FakeFrontier(
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
        cast("BipQueue", bip_queue),  # test double
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
    bip_queue, _store, stats = _run_coordinator(
        tmp_path, _site_pages(), robots_allowed=lambda url: False
    )
    assert stats.skipped >= 1
    assert stats.docs_new == 0
    assert bip_queue.hosts["bip.test"].status == "dead"


def test_coordinator_robots_skip_is_terminal(tmp_path: Path) -> None:
    bip_queue, _store, _stats = _run_coordinator(
        tmp_path, _site_pages(), robots_allowed=lambda url: False
    )
    denied = [url for url, state in bip_queue.states.items() if state == "skipped"]
    assert denied
    assert all(bip_queue.skip_reasons.get(url) == "robots" for url in denied)
    for url in denied:
        # even an explicit freshness requeue must not revive a robots denial
        assert bip_queue.queue_url(bip_queue.urls[url], requeue=True) is False
        assert bip_queue.states[url] == "skipped"


def test_coordinator_cap_skip_is_requeueable(tmp_path: Path) -> None:
    bip_queue, _store, stats = _run_coordinator(
        tmp_path, _site_pages(), max_pages=1, max_docs=1
    )
    assert stats.skipped >= 1
    capped = [url for url, state in bip_queue.states.items() if state == "skipped"]
    assert capped
    assert all(bip_queue.skip_reasons.get(url) == "cap" for url in capped)
    assert bip_queue.queue_url(bip_queue.urls[capped[0]], requeue=True) is False
    assert bip_queue.states[capped[0]] == "queued"


def test_bundle_is_closed_when_a_host_finishes(tmp_path: Path) -> None:
    """A host's bundle is finalized at host end, not only at run end."""

    class ClosingStore(LocalBundleStore):
        closed: list[str] = []

        def close_host(self, host: str) -> None:
            self.closed.append(host)
            super().close_host(host)

    bip_queue = FakeFrontier(
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
    store = ClosingStore(tmp_path / "out")
    coordinator = BipCoordinator(
        cast("BipQueue", bip_queue),  # test double
        store,
        CoordinatorOptions(workers=1, rate_interval_s=0.0),
        fetch=lambda url, timeout, ua: HttpResult(
            url=url,
            status=200,
            content_type="application/pdf",
            content=b"%PDF-1.4 one",
        ),
        robots_allowed=lambda url: True,
    )
    coordinator.run()
    assert "bip.test" in store.closed
    assert list((tmp_path / "out").rglob("*.part")) == []


def test_result_exception_releases_the_host(tmp_path: Path) -> None:
    """A raise while handling a result must still finalize the host (no hang)."""
    bip_queue = FakeFrontier(
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
    coordinator = BipCoordinator(
        cast("BipQueue", bip_queue),  # test double
        store,
        CoordinatorOptions(workers=1, rate_interval_s=0.0),
    )
    coordinator.active["bip.test"] = _ActiveHost(crawl_id="run-bip_test", pending=1)

    failing: Future = Future()
    failing.set_exception(RuntimeError("boom"))
    row = UrlRow(url="https://bip.test/x", host="bip.test", kind="page")
    bip_queue.urls[row.url] = row
    bip_queue.states[row.url] = "claimed"
    coordinator._collect({failing: row})  # noqa: SLF001 - exercising the handler

    assert coordinator.stats.errors == 1
    assert "bip.test" not in coordinator.active
    assert bip_queue.hosts["bip.test"].status == "partial"


def test_cross_host_is_a_seed_only_move(tmp_path: Path) -> None:
    """The seed may land on another host; a deeper redirect may not be adopted."""
    bip_queue = FakeFrontier(
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
    pages = {
        "https://bip.test/": ("text/html", b'<a href="/b">b</a>'),
        "https://moved.test/b": ("text/html", b'<a href="/c">c</a>'),
    }
    finals = {
        "https://bip.test/": "https://moved.test/",  # seed: adopted
        "https://moved.test/b": "https://third.test/b",  # depth 1: dropped
    }

    def fetch(url: str, timeout: float, user_agent: str) -> HttpResult:
        content_type, content = pages[url]
        return HttpResult(
            url=finals.get(url, url),
            status=200,
            content_type=content_type,
            content=content,
        )

    coordinator = BipCoordinator(
        cast("BipQueue", bip_queue),  # test double
        store,
        CoordinatorOptions(workers=1, rate_interval_s=0.0),
        fetch=fetch,
        robots_allowed=lambda url: True,
    )
    coordinator.run()

    # the seed's link resolved onto the host it redirected to, and was followed
    assert "https://moved.test/b" in bip_queue.urls
    # the depth-1 redirect to third.test was not adopted, so its links are gone
    assert not any("third.test" in url for url in bip_queue.urls)
