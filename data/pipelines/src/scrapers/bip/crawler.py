"""The per-host crawl loop: fetch, classify, extract, store.

HTTP and robots are injected (protocols below) so this module stays pure enough
for the import-linter layer rules and for tests without network access.

Ordering matters: documents found on a page are fetched before the rest of the
page queue (a site's declaration pages sit behind a 100-link homepage menu, and
a plain BFS would spend the whole page budget before reaching them), and pages
whose URL looks like a document-bearing section are queued first.
"""

from __future__ import annotations

import hashlib
import logging
import re
from collections import deque
from dataclasses import dataclass
from typing import Protocol

from scrapers.bip.classify import (
    extract_links,
    filename_from_url,
    is_document_content_type,
    is_document_url,
    is_low_value_url,
    is_section_url,
    normalize_url,
)
from scrapers.bip.frontier import Frontier
from scrapers.bip.models import CrawlOptions, HostCrawlStats, HostRow, UrlRow
from scrapers.bip.ratelimit import HostRateLimiter
from scrapers.bip.store import LocalBundleStore

logger = logging.getLogger(__name__)

_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_HTML_CONTENT_TYPES = ("text/html", "application/xhtml+xml")


class FetchFunc(Protocol):
    def __call__(
        self, url: str, timeout: float, user_agent: str
    ) -> "FetchResult": ...


class RobotsFunc(Protocol):
    def __call__(self, url: str) -> bool: ...


@dataclass(frozen=True)
class FetchResult:
    url: str
    status: int
    content_type: str
    content: bytes
    error: str = ""


def page_title(html: str) -> str:
    match = _TITLE_RE.search(html)
    if match is None:
        return ""
    return re.sub(r"\s+", " ", match.group(1)).strip()[:200]


def _is_html(content_type: str) -> bool:
    media_type = content_type.split(";", 1)[0].strip().lower()
    return media_type in _HTML_CONTENT_TYPES


def _section_of(url: str) -> str:
    """A coarse section label used as provenance metadata."""
    path = re.sub(r"^https?://[^/]+", "", url).strip("/")
    if not path:
        return "root"
    return path.split("/")[0][:60]


def _host_of(url: str) -> str:
    match = re.match(r"^https?://([^/]+)", url, re.IGNORECASE)
    if match is None:
        return ""
    return match.group(1).lower().removeprefix("www.").split(":")[0]


def _path_of(url: str) -> str:
    return re.sub(r"^https?://[^/]+", "", url, flags=re.IGNORECASE)


class _HostCrawler:
    """One host's crawl: two queues (documents first) and the state to bound it."""

    def __init__(
        self,
        host: HostRow,
        frontier: Frontier,
        store: LocalBundleStore,
        fetch: FetchFunc,
        robots_allowed: RobotsFunc,
        rate_limiter: HostRateLimiter,
        options: CrawlOptions,
    ) -> None:
        self.host = host
        self.frontier = frontier
        self.store = store
        self.fetch = fetch
        self.robots_allowed = robots_allowed
        self.rate_limiter = rate_limiter
        self.options = options
        self.stats = HostCrawlStats(host=host.host)
        self.page_queue: deque[tuple[str, int, str]] = deque()
        self.doc_queue: deque[tuple[str, int, str]] = deque()
        self.seen: set[str] = set()
        self.urls_to_record: list[UrlRow] = []
        self.pages_fetched = 0
        self.docs_seen = 0
        # Many `*.bip.gov.pl` sites now live under www.gov.pl/web/<slug>; the
        # crawl scope follows the redirect, bounded to that path prefix.
        self.scope_hosts: set[str] = {host.host}
        self.scope_prefix = ""

    # -- queueing ------------------------------------------------------------
    def enqueue(self, raw_url: str, depth: int, discovered_from: str) -> None:
        url = normalize_url(raw_url)
        if url in self.seen or is_low_value_url(url):
            return
        self.seen.add(url)
        target = self.doc_queue if is_document_url(url) else self.page_queue
        if not is_document_url(url) and is_section_url(url):
            target.appendleft((url, depth, discovered_from))
        else:
            target.append((url, depth, discovered_from))

    def _next(self) -> tuple[str, int, str]:
        if self.doc_queue:
            return self.doc_queue.popleft()
        return self.page_queue.popleft()

    # -- visiting ------------------------------------------------------------
    def run(self) -> HostCrawlStats:
        seeds = (
            [self.host.source_url]
            if self.host.source_url
            else [f"https://{self.host.host}/"]
        )
        for seed in seeds:
            if seed:
                self.enqueue(seed, 0, "")
        try:
            while (
                self.page_queue or self.doc_queue
            ) and self.pages_fetched < self.options.max_pages_per_host:
                url, depth, discovered_from = self._next()
                if depth <= self.options.max_depth:
                    self._visit(url, depth, discovered_from)
        except Exception:
            # Leave a trace before re-raising: _finish still has to close the
            # bundle and mark the host, or a crash strands a .part and leaves
            # the host looking untouched.
            self.stats.errors += 1
            raise
        finally:
            self._finish()
        return self.stats

    def _visit(self, url: str, depth: int, discovered_from: str) -> None:
        self.rate_limiter.wait(self.host.host)
        if not self.robots_allowed(url):
            self.stats.robots_denied += 1
            return
        result = self.fetch(
            url, self.options.request_timeout_s, self.options.user_agent
        )
        if result.error or result.status >= 400:
            self._record_error(url, depth, discovered_from, result.status)
            return
        self._register_scope(result.url)
        if self._looks_like_document(url, result.content_type):
            self._handle_document(url, depth, discovered_from, result)
        elif _is_html(result.content_type):
            self._handle_page(url, depth, discovered_from, result)
        else:
            self.stats.pages_skipped += 1

    def _looks_like_document(self, url: str, content_type: str) -> bool:
        return is_document_content_type(content_type) or (
            is_document_url(url) and not _is_html(content_type)
        )

    def _row(
        self,
        url: str,
        depth: int,
        discovered_from: str,
        kind: str,
        *,
        content_type: str = "",
        size: int = 0,
        sha256: str = "",
        title: str = "",
        last_status: int = 0,
        state: str = "new",
    ) -> UrlRow:
        return UrlRow(
            url=url,
            host=self.host.host,
            kind=kind,
            discovered_from=discovered_from,
            depth=depth,
            section=_section_of(url),
            content_type=content_type,
            size=size,
            sha256=sha256,
            title=title,
            last_status=last_status,
            state=state,
        )

    def _record_error(
        self, url: str, depth: int, discovered_from: str, status: int
    ) -> None:
        self.stats.errors += 1
        kind = "doc" if is_document_url(url) else "page"
        self.urls_to_record.append(
            self._row(
                url,
                depth,
                discovered_from,
                kind,
                last_status=status,
                state="error",
            )
        )

    def _handle_document(
        self, url: str, depth: int, discovered_from: str, result: FetchResult
    ) -> None:
        if self.docs_seen >= self.options.max_docs_per_host:
            self.stats.pages_skipped += 1
            return
        self.docs_seen += 1
        digest = hashlib.sha256(result.content).hexdigest()
        known_bundle = self.frontier.doc_bundle(digest)
        duplicate = known_bundle is not None and self.store.blob_exists(known_bundle)
        duplicate = duplicate or self.store.known_digest(digest)
        if duplicate:
            self.stats.docs_duplicate += 1
            self._record_doc_url(
                url, depth, discovered_from, result, digest, state="duplicate"
            )
            return
        row, is_new = self.store.add(
            host=self.host.host,
            url=url,
            data=result.content,
            content_type=result.content_type,
            filename=filename_from_url(url),
            title="",
            chain=[discovered_from, url],
        )
        self.frontier.record_docs([row])
        if is_new:
            self.stats.docs_stored += 1
            self.stats.bytes_stored += row.size
        else:
            self.stats.docs_duplicate += 1
        self._record_doc_url(
            url, depth, discovered_from, result, row.sha256, state="seen"
        )

    def _record_doc_url(
        self,
        url: str,
        depth: int,
        discovered_from: str,
        result: FetchResult,
        sha256: str,
        *,
        state: str,
    ) -> None:
        self.urls_to_record.append(
            self._row(
                url,
                depth,
                discovered_from,
                "doc",
                content_type=result.content_type,
                size=len(result.content),
                sha256=sha256,
                last_status=result.status,
                state=state,
            )
        )

    def _register_scope(self, final_url: str) -> None:
        effective = _host_of(final_url)
        if not effective or effective == self.host.host:
            return
        self.scope_hosts.add(effective)
        if self.scope_prefix:
            return
        segments = [s for s in _path_of(final_url).split("/") if s]
        if segments and segments[0] == "web" and len(segments) >= 2:
            self.scope_prefix = f"/web/{segments[1]}"
        elif segments:
            self.scope_prefix = f"/{segments[0]}"

    def _in_scope(self, url: str) -> bool:
        url_host = _host_of(url)
        if url_host not in self.scope_hosts:
            return False
        if url_host == self.host.host or not self.scope_prefix:
            return True
        return _path_of(url).startswith(self.scope_prefix)

    def _handle_page(
        self, url: str, depth: int, discovered_from: str, result: FetchResult
    ) -> None:
        self.pages_fetched += 1
        self.stats.pages_fetched += 1
        html = result.content.decode("utf-8", errors="replace")
        self.urls_to_record.append(
            self._row(
                url,
                depth,
                discovered_from,
                "page",
                content_type=result.content_type,
                size=len(result.content),
                title=page_title(html),
                last_status=result.status,
                state="seen",
            )
        )
        for link in extract_links(html, result.url):
            if self._in_scope(link.url):
                self.enqueue(link.url, depth + 1, url)

    def _finish(self) -> None:
        self.store.close_host(self.host.host)
        self.frontier.record_urls(self.urls_to_record)
        hit_cap = (
            self.pages_fetched >= self.options.max_pages_per_host
            or self.docs_seen >= self.options.max_docs_per_host
        )
        if self.stats.errors or hit_cap:
            # A truncated host is not a finished one: mark it partial so the
            # deeper pass picks it up again.
            self.stats.status = (
                "partial" if (self.pages_fetched or self.docs_seen) else "dead"
            )
        else:
            self.stats.status = "ok"
        self.frontier.mark_host(self.host.host, self.stats.status, crawled=True)


def crawl_host(
    host: HostRow,
    *,
    frontier: Frontier,
    store: LocalBundleStore,
    fetch: FetchFunc,
    robots_allowed: RobotsFunc,
    rate_limiter: HostRateLimiter,
    options: CrawlOptions,
) -> HostCrawlStats:
    return _HostCrawler(
        host,
        frontier,
        store,
        fetch,
        robots_allowed,
        rate_limiter,
        options,
    ).run()
