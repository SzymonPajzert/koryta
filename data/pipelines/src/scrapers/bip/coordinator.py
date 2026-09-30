"""Coordinator: claims URLs, fetches through workers, owns quotas and writes.

One process owns Postgres, the per-host budgets and the bundles; fetcher
threads only do HTTP and parsing (the article crawler's split). Work is
URL-level: many URLs of the same host can be in flight (throttled by the
shared token bucket), and different hosts interleave naturally.
"""

from __future__ import annotations

import hashlib
import logging
import signal
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor, wait
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable

from scrapers.bip.classify import (
    filename_from_url,
    host_of,
    is_html,
    is_low_value_url,
    looks_like_document,
    normalize_url,
    path_of,
    priority_for,
)
from scrapers.bip.frontier import BipFrontier
from scrapers.bip.models import HostRow, RunStats, UrlRow
from scrapers.bip.store import LocalBundleStore
from scrapers.common.fetch import HttpResult, http_get
from scrapers.common.links import extract_links
from scrapers.common.ratelimit import HostTokenBucket

logger = logging.getLogger(__name__)

PROGRESS_EVERY_S = 30.0
_TERMINAL = ("fetched", "error", "skipped")


@dataclass
class CoordinatorOptions:
    out_dir: str = "bip_crawl_out"
    workers: int = 8
    max_pages: int = 150
    max_docs: int = 500
    max_depth: int = 4
    rate_interval_s: float = 1.0
    freshness_seconds: int | None = None
    run_limit: int | None = None
    host_limit: int = 50_000
    max_active_hosts: int = 50
    claim_batch: int = 64
    lock_seconds: int = 600
    request_timeout_s: float = 15.0
    user_agent: str = "KorytaBIPCrawler/0.1 (+http://koryta.pl/crawler)"
    max_doc_bytes: int = 60_000_000


@dataclass
class _ActiveHost:
    crawl_id: str
    pending: int = 0
    pages: int = 0
    docs: int = 0
    cap_hit: bool = False
    errors: int = 0
    done_pages: int = 0
    scope_hosts: set[str] = field(default_factory=set)
    scope_prefix: str = ""


class BipCoordinator:
    def __init__(
        self,
        frontier: BipFrontier,
        store: LocalBundleStore,
        options: CoordinatorOptions,
        *,
        fetch: Callable[[str, float, str], HttpResult] = http_get,
        robots_allowed: Callable[[str], bool] = lambda url: True,
        limiter: HostTokenBucket | None = None,
    ) -> None:
        self.frontier = frontier
        self.store = store
        self.options = options
        self.fetch = fetch
        self.robots_allowed = robots_allowed
        self.limiter = limiter or HostTokenBucket(options.rate_interval_s)
        self.active: dict[str, _ActiveHost] = {}
        self.host_iter: list[HostRow] = []
        self.run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        self.stats = RunStats()
        self._deferred: list[tuple[float, UrlRow]] = []
        self._stop = threading.Event()

    # -- seeding -------------------------------------------------------------
    def _refill_active(self) -> None:
        while len(self.active) < self.options.max_active_hosts and self.host_iter:
            host = self.host_iter.pop(0)
            crawl_id = f"{self.run_id}-{host.host.replace('.', '_')[:40]}"
            self.frontier.start_host(host.host, crawl_id)
            active = _ActiveHost(crawl_id=crawl_id)
            active.scope_hosts.add(host.host)
            self.active[host.host] = active
            seed = host.source_url or f"https://{host.host}/"
            inserted = self.frontier.queue_url(
                UrlRow(
                    url=normalize_url(seed),
                    host=host.host,
                    kind="page",
                    discovered_from="",
                    depth=0,
                    section="root",
                    priority=priority_for(seed),
                ),
                requeue=True,
            )
            if inserted:
                active.pending += 1
            logger.info("seeded %s", host.host)

    # -- quota gate ----------------------------------------------------------
    def _over_quota(self, row: UrlRow) -> bool:
        active = self.active.get(row.host)
        if active is None:
            return True
        if row.kind == "doc":
            return active.docs >= self.options.max_docs
        return active.pages >= self.options.max_pages

    # -- end of host ---------------------------------------------------------
    def _maybe_finalize(self, host: str) -> None:
        active = self.active.get(host)
        if active is None or active.pending > 0:
            return
        if self.frontier.host_pending(host) > 0:
            return
        status = "ok"
        if active.cap_hit:
            status = "partial"
        elif active.errors:
            status = "partial"
        elif active.done_pages == 0 and active.docs == 0:
            status = "dead"
        self.frontier.finalize_host(host, status)
        del self.active[host]
        self.stats.hosts_finalized += 1
        logger.info("host %s -> %s", host, status)

    # -- fetcher -------------------------------------------------------------
    def _fetch_one(
        self, row: UrlRow
    ) -> tuple[UrlRow, HttpResult | None, list[str], str]:
        if not self.robots_allowed(row.url):
            return (row, None, [], "robots")
        if not self.limiter.acquire(row.host):
            return (row, None, [], "rate_limited")
        result = self.fetch(
            row.url, self.options.request_timeout_s, self.options.user_agent
        )
        links: list[str] = []
        if result.ok and len(result.content) <= self.options.max_doc_bytes:
            if is_html(result.content_type):
                html = result.content.decode("utf-8", "replace")
                links = extract_links(html, result.url, keep_query=True)
        return (row, result, links, "")

    # -- result handling -----------------------------------------------------
    def _in_scope(self, host: str, url: str) -> bool:
        active = self.active.get(host)
        if active is None:
            return False
        url_host = host_of(url)
        if url_host not in active.scope_hosts:
            return False
        if url_host == host or not active.scope_prefix:
            return True
        return path_of(url).startswith(active.scope_prefix)

    def _handle_result(
        self,
        row: UrlRow,
        result: HttpResult | None,
        links: list[str],
        special: str,
    ) -> None:
        active = self.active.get(row.host)
        if active is None:
            return
        if special == "rate_limited":
            self._deferred.append(
                (time.monotonic() + self.limiter.next_available_in(row.host), row)
            )
            return
        if special == "robots":
            self.frontier.mark_url(row.url, state="skipped")
            active.pending -= 1
            self.stats.skipped += 1
            self._maybe_finalize(row.host)
            return
        assert result is not None
        if result.error or result.status >= 400:
            self.frontier.mark_url(
                row.url, state="error", status=result.status
            )
            active.pending -= 1
            active.errors += 1
            self.stats.errors += 1
            self._maybe_finalize(row.host)
            return
        self._register_scope(row.host, result.url)
        if looks_like_document(row.url, result.content_type):
            # The cap is also checked at claim time, but several workers can
            # already have document URLs in flight when the previous result
            # pushes the host over it; enforce it here so the budget is exact.
            if active.docs >= self.options.max_docs:
                active.cap_hit = True
                active.pending -= 1
                self.frontier.mark_url(row.url, state="skipped")
                self.stats.skipped += 1
                self._maybe_finalize(row.host)
                return
            self._store_document(row, result, active)
        else:
            self._handle_page(row, result, links, active)
        self._maybe_finalize(row.host)

    def _register_scope(self, host: str, final_url: str) -> None:
        active = self.active[host]
        effective = host_of(final_url)
        if not effective or effective == host:
            return
        active.scope_hosts.add(effective)
        if active.scope_prefix:
            return
        segments = [s for s in path_of(final_url).split("/") if s]
        if segments and segments[0] == "web" and len(segments) >= 2:
            active.scope_prefix = f"/web/{segments[1]}"
        elif segments:
            active.scope_prefix = f"/{segments[0]}"

    def _store_document(
        self, row: UrlRow, result: HttpResult, active: _ActiveHost
    ) -> None:
        digest = hashlib.sha256(result.content).hexdigest()
        known_bundle = self.frontier.doc_bundle(digest)
        duplicate = known_bundle is not None and self.store.blob_exists(known_bundle)
        if duplicate:
            self.stats.docs_seen += 1
            self.frontier.mark_url(
                row.url,
                state="fetched",
                status=result.status,
                content_type=result.content_type,
                size=len(result.content),
                sha256=digest,
            )
            active.pending -= 1
            return
        doc, is_new = self.store.add(
            host=row.host,
            crawl_id=active.crawl_id,
            url=row.url,
            data=result.content,
            content_type=result.content_type,
            filename=filename_from_url(row.url),
            title="",
            chain=[row.discovered_from, row.url],
        )
        self.frontier.record_docs([doc], active.crawl_id)
        if is_new:
            self.stats.docs_new += 1
            self.stats.bytes_stored += doc.size
            active.docs += 1
            self.frontier.bump_host(row.host, docs=1)
        else:
            self.stats.docs_seen += 1
        if active.docs >= self.options.max_docs:
            active.cap_hit = True
        self.frontier.mark_url(
            row.url,
            state="fetched",
            status=result.status,
            content_type=result.content_type,
            size=len(result.content),
            sha256=digest,
        )
        active.pending -= 1

    def _handle_page(
        self, row: UrlRow, result: HttpResult, links: list[str], active: _ActiveHost
    ) -> None:
        active.pages += 1
        active.done_pages += 1
        self.stats.pages_fetched += 1
        self.frontier.bump_host(row.host, pages=1)
        if active.pages >= self.options.max_pages:
            active.cap_hit = True
        added = 0
        if row.depth < self.options.max_depth:
            for raw in links:
                url = normalize_url(raw)
                if is_low_value_url(url) or not self._in_scope(row.host, url):
                    continue
                candidate = UrlRow(
                    url=url,
                    host=row.host,
                    kind="doc" if looks_like_document(url, "") else "page",
                    discovered_from=row.url,
                    depth=row.depth + 1,
                    section=url.split("/")[3] if url.count("/") > 2 else "",
                    priority=priority_for(url),
                )
                if self.frontier.queue_url(candidate):
                    active.pending += 1
                    added += 1
        self.frontier.mark_url(
            row.url,
            state="fetched",
            status=result.status,
            content_type=result.content_type,
            size=len(result.content),
        )
        active.pending -= 1
        logger.debug("page %s (+%d links)", row.url, added)

    # -- main loop -----------------------------------------------------------
    def _install_signal_handlers(self) -> None:
        def handler(signum: int, _frame: object) -> None:
            logger.warning(
                "signal %s: finishing in-flight fetches, then stopping", signum
            )
            self.stop()

        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, handler)

    def run(self) -> RunStats:
        self._install_signal_handlers()
        self.frontier.start_run(self.run_id)
        self.host_iter = self.frontier.select_hosts(
            freshness_seconds=self.options.freshness_seconds,
            limit=self.options.host_limit,
        )
        if self.options.run_limit:
            self.host_iter = self.host_iter[: self.options.run_limit]
        logger.info("hosts selected: %d", len(self.host_iter))
        print(f"hosts selected: {len(self.host_iter)}", flush=True)
        self._refill_active()

        with ThreadPoolExecutor(max_workers=self.options.workers) as pool:
            pending: dict[Future, UrlRow] = {}
            last_progress = time.monotonic()
            while not self._stop.is_set():
                self._refill_active()
                self._dispatch_deferred(pool, pending)
                self._top_up(pool, pending)
                if pending:
                    self._collect(pending)
                if time.monotonic() - last_progress >= PROGRESS_EVERY_S:
                    self._print_progress()
                    last_progress = time.monotonic()
                if self._is_finished(pending):
                    break
        self.store.flush()
        self.frontier.finish_run(self.run_id, self.stats)
        return self.stats

    def _dispatch_deferred(
        self, pool: ThreadPoolExecutor, pending: dict[Future, UrlRow]
    ) -> None:
        now = time.monotonic()
        ready = [item for item in self._deferred if item[0] <= now]
        if not ready:
            return
        self._deferred = [i for i in self._deferred if i[0] > now]
        for _, row in ready:
            pending[pool.submit(self._fetch_one, row)] = row

    def _top_up(
        self, pool: ThreadPoolExecutor, pending: dict[Future, UrlRow]
    ) -> None:
        free = self.options.workers - len(pending)
        if free <= 0:
            return
        claimed = self.frontier.claim_urls(
            "coordinator",
            hosts=list(self.active),
            limit=min(free, self.options.claim_batch),
            lock_seconds=self.options.lock_seconds,
        )
        for row in claimed:
            if row.host not in self.active:
                self.frontier.mark_url(row.url, state="skipped")
                self.stats.skipped += 1
                continue
            if self._over_quota(row):
                active = self.active[row.host]
                active.cap_hit = True
                active.pending -= 1
                self.frontier.mark_url(row.url, state="skipped")
                self.stats.skipped += 1
                self._maybe_finalize(row.host)
                continue
            pending[pool.submit(self._fetch_one, row)] = row

    def _collect(self, pending: dict[Future, UrlRow]) -> None:
        done, _ = wait(list(pending), timeout=5.0, return_when="FIRST_COMPLETED")
        for future in done:
            row = pending.pop(future)
            try:
                self._handle_result(*future.result())
            except Exception as exc:  # keep the crawl alive
                logger.exception("result handling failed: %s", exc)
                self.frontier.mark_url(row.url, state="error")
                self.stats.errors += 1

    def _is_finished(self, pending: dict[Future, UrlRow]) -> bool:
        if pending or self._deferred:
            return False
        if self.active:
            return False
        if not self.host_iter:
            return True
        self._refill_active()
        return not self.active

    def _print_progress(self) -> None:
        stats = self.frontier.stats()
        rates = self.frontier.recent_rates()
        print(
            "hosts ok={ok} partial={partial} dead={dead} active={active} | "
            "urls queued={queued} claimed={claimed} | docs={docs} | "
            "this run: pages={pages} docs+={new} dup={seen} errors={errors}".format(
                ok=stats.get("hosts_ok"),
                partial=stats.get("hosts_partial"),
                dead=stats.get("hosts_dead"),
                active=stats.get("hosts_active"),
                queued=stats.get("urls_queued"),
                claimed=stats.get("urls_claimed"),
                docs=stats.get("docs"),
                pages=self.stats.pages_fetched,
                new=self.stats.docs_new,
                seen=self.stats.docs_seen,
                errors=self.stats.errors,
            )
            + " | last {m}m: pages={p} docs={d} hosts={h} "
            "({ppm}/min pages, {dpm}/min docs)".format(
                m=rates["window_minutes"],
                p=rates["pages"],
                d=rates["docs"],
                h=rates["hosts"],
                ppm=rates["pages_per_min"],
                dpm=rates["docs_per_min"],
            ),
            flush=True,
        )

    def stop(self) -> None:
        self._stop.set()
