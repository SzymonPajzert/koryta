from __future__ import annotations

import hashlib
import logging
import mimetypes
import queue as _queue
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Literal, cast
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup, Tag
from curl_cffi import requests
from uuid_extensions import uuid7str  # type: ignore

from entities.util import NormalizedParse
from scrapers.article.scoring import get_scoring_function
from scrapers.stores import (
    Context,
    CrawlQueue,
    CrawlQueueItem,
    LocalFile,
    NewUrl,
    Priority,
)

warsaw_tz = ZoneInfo("Europe/Warsaw")
KORYTA_UA = "KorytaCrawler/0.1 (+http://koryta.pl/crawler)"


def parse_hostname(url: str) -> str:
    return NormalizedParse.parse(url).hostname_normalized


def uuid7():
    return uuid7str()


@dataclass
class CrawlOptions:
    worker_id: str
    storage_type: str
    local_output: Path | None
    per_url_max_retries: int
    lock_timeout_seconds: int
    per_domain_wait_between_requests_s: float
    url_scoring_function: str
    domains_of_interest: frozenset[str] = field(default_factory=frozenset)
    request_timeout_seconds: float = 10
    worker_threads: int = 1
    batch_size: int = 64


@dataclass
class CrawlResult:
    storage_path: str | None = None
    error: str | None = None
    hit_rate_limit: bool = False
    discovered_urls: list[str] = field(default_factory=list)
    request_duration_s: float | None = None
    parse_duration_s: float | None = None
    upload_duration_s: float | None = None
    total_duration_s: float | None = None
    media_type: str | None = None


@contextmanager
def stopwatch():
    stats = SimpleNamespace(duration=0.0)
    start = time.perf_counter()
    try:
        yield stats
    finally:
        stats.duration = time.perf_counter() - start


# Per each hostname we do on-worker rate limiting.
_next_req_lock = threading.Lock()
_next_request_time: dict[str, float] = {}


def _can_crawl(parsed: NormalizedParse, rate_limit: float) -> bool:
    with _next_req_lock:
        domain = parsed.hostname_normalized
        next_time = _next_request_time.get(domain, 0)
        now = time.time()
        if now < next_time:
            return False
        _next_request_time[domain] = time.time() + rate_limit
        return True


_HASH_SUFFIX_LEN = 10  # chars taken from md5 hexdigest


def _compress_long_segments(path: str, max_segment_length: int) -> str:
    path_segments = [s for s in path.split("/") if s]
    safe_segments = []
    for segment in path_segments:
        if len(segment.encode("utf-8")) > max_segment_length:
            hash_suffix = hashlib.md5(segment.encode()).hexdigest()[:_HASH_SUFFIX_LEN]
            # +2: 1 for '_' separator, 1 safety (check is bytes, truncation is chars)
            truncated = segment[:max_segment_length - _HASH_SUFFIX_LEN - 2]
            segment = f"{truncated}_{hash_suffix}"
        safe_segments.append(segment)
    return "/".join(safe_segments)


def _storage_path(
    parsed: NormalizedParse,
    suffix: str | None = None,
) -> str:
    path = parsed.path or ""
    path = path.strip("/")
    if not path:
        path = "index"
    date = datetime.now(warsaw_tz).strftime("%Y-%m-%d")
    base = f"hostname={parsed.hostname_normalized}/{path}/date={date}"
    if suffix:
        base = f"{base}/{suffix}"
    storage_path = base.replace("//", "/").rstrip("/")
    # Compress long segments to avoid "OSError: [Errno 36] File name too long"
    return _compress_long_segments(storage_path, 200)


def _content_type_from_response(response: requests.Response) -> str:
    raw = response.headers.get("Content-Type", "")
    return raw.strip().lower()


def _is_html_response(response: requests.Response) -> bool:
    content_type = _content_type_from_response(response)
    media_type = content_type.split(";")[0].strip()
    if not media_type:
        return False
    extension = mimetypes.guess_extension(media_type)
    return extension in {".html", ".htm"}


def _upload_response(
    ctx: Context,
    parsed: NormalizedParse,
    response: requests.Response,
    options: CrawlOptions,
) -> str:
    path = _storage_path(parsed)
    if options.storage_type == "gcs":
        content_type = _content_type_from_response(response)
        ctx.io.upload(parsed.full_url, response.content, content_type)
    elif options.storage_type == "local":
        if options.local_output is None:
            raise ValueError("local_output is required for local storage")
        folder = cast(
            Literal["downloaded", "tests", "versioned", "crawler_output"],
            str(options.local_output),
        )
        binary_payload = response.content

        def _write(s) -> None:  # type: ignore[no-untyped-def]
            s.write(binary_payload)

        ctx.io.write_file(LocalFile(filename=path, folder=folder), _write)
    else:
        raise ValueError("Unknown storage type")
    return path


def crawl_url(
    ctx: Context,
    parsed_url: NormalizedParse,
    options: CrawlOptions,
) -> CrawlResult:
    start_time = time.time()
    if not ctx.web.robot_txt_allowed(
        ctx,
        parsed_url.full_url,
        parsed_url,
        KORYTA_UA,
    ):
        return CrawlResult(error="disallowed by robots")

    if not _can_crawl(parsed_url, options.per_domain_wait_between_requests_s):
        return CrawlResult(hit_rate_limit=True)

    with stopwatch() as t_request:
        try:
            response = requests.get(
                parsed_url.full_url,
                impersonate="chrome136",
                headers={"User-Agent": KORYTA_UA},
                timeout=options.request_timeout_seconds,
                allow_redirects=True,
            )
        except requests.RequestsError as exc:
            return CrawlResult(
                error=str(exc),
                request_duration_s=t_request.duration,
            )
        except Exception as exc:
            return CrawlResult(
                error=f"unexpected: {exc}",
                request_duration_s=t_request.duration,
            )

    if response.status_code != 200:
        return CrawlResult(
            error=f"http {response.status_code}",
            request_duration_s=t_request.duration,
        )

    with stopwatch() as t_upload:
        storage_path = _upload_response(ctx, parsed_url, response, options)

    with stopwatch() as t_parsed:
        if _is_html_response(response):
            discovered_urls = _extract_urls(ctx, response)
        else:
            discovered_urls = set()
            logging.info(
                "Not parsing the file, because it's not HTML: %s",
                parsed_url.full_url,
            )

    return CrawlResult(
        storage_path=storage_path,
        discovered_urls=list(discovered_urls),
        request_duration_s=t_request.duration,
        parse_duration_s=t_parsed.duration,
        upload_duration_s=t_upload.duration,
        total_duration_s=time.time() - start_time,
        media_type=_content_type_from_response(response),
    )


def _extract_urls(
    ctx: Context,
    response: requests.Response,
) -> set[str]:
    discovered = set()
    soup = BeautifulSoup(response.text, "lxml")

    base_tag = soup.find("base", href=True)
    base_url = response.url
    if isinstance(base_tag, Tag):
        base_href = base_tag.get("href")
        if isinstance(base_href, str):
            base_url = base_href

    for link_el in soup.find_all("a", href=True):
        if not isinstance(link_el, Tag):
            continue
        href_attr = link_el.get("href")
        if not isinstance(href_attr, str):
            continue
        link = href_attr.strip()
        if not link or link.startswith(
            ("#", "mailto:", "tel:", "javascript:", "data:")
        ):
            continue
        try:
            absolute_link = ctx.utils.join_url(base_url, link)
        except ValueError:
            continue
        clean_link = absolute_link.split("?")[0].split("#")[0].rstrip("/")
        if clean_link.startswith(("http://", "https://")):
            parsed_link = NormalizedParse.parse(clean_link)
            clean_link = (
                f"{parsed_link.scheme}://"
                f"{parsed_link.hostname_normalized}"
                f"{parsed_link.path}"
            )
            discovered.add(clean_link)

    return discovered


_FLUSH_INTERVAL_S = 2.0  # also flush after this many seconds of inactivity
_LOG_INTERVAL_S = 30.0   # how often to log queue stats


def _priority_for_url(options: CrawlOptions, url: str) -> Priority:
    scorer = get_scoring_function(
        options.url_scoring_function, options.domains_of_interest
    )
    score = scorer(url)
    return Priority(max(0, min(100, 100 - score)))


def _normalize_blocked(blocked: set[str]) -> set[str]:
    return {NormalizedParse.parse(url).hostname_normalized for url in blocked}


def _filter_blocked(result: CrawlResult, blocked: set[str]) -> None:
    result.discovered_urls = [
        url
        for url in result.discovered_urls
        if NormalizedParse.parse(url).hostname_normalized not in blocked
    ]


def _http_worker(
    work_q: _queue.Queue,
    done_q: _queue.Queue,
    options: CrawlOptions,
    ctx: Context,
) -> None:
    """Fetch/process URLs only; DB claiming and DB writes stay in the coordinator."""
    while True:
        entry: CrawlQueueItem | None = work_q.get()
        if entry is None:
            work_q.task_done()
            return
        try:
            parsed_url = NormalizedParse.parse(entry.url)
            result = crawl_url(ctx, parsed_url, options)
        except Exception as exc:
            result = CrawlResult(error=f"unexpected: {exc}")
        done_q.put((entry, result))
        work_q.task_done()


def _flush_batch(
    pending: list[tuple[CrawlQueueItem, CrawlResult]],
    queue_store: CrawlQueue,
    options: CrawlOptions,
    blocked_normalized: set[str],
    worker_name: str,
) -> None:
    """Write a batch of crawl results to the DB in as few transactions as possible."""
    done_items: list[tuple[str, str | None, dict]] = []
    error_items: list[tuple[str, str]] = []
    all_discovered: list[NewUrl] = []

    for entry, result in pending:
        priority = entry.priority
        if result.hit_rate_limit:
            # Do not release — rely on lock timeout so it isn't re-queued immediately.
            logging.info("[p=%d] Skipping (rate limited): %s", priority, entry.url)
        elif result.error:
            logging.error(
                "[p=%d][%.2fs] Crawl failed (%s): %s",
                priority, result.request_duration_s or 0, result.error, entry.url,
            )
            error_items.append((entry.uid, result.error))
        else:
            logging.info(
                "[p=%d][%.2fs] Crawl succeeded: %s",
                priority, result.request_duration_s or 0, entry.url,
            )
            _filter_blocked(result, blocked_normalized)
            done_items.append((entry.uid, result.storage_path, {
                "request_duration_s": result.request_duration_s,
                "parse_duration_s": result.parse_duration_s,
                "upload_duration_s": result.upload_duration_s,
                "total_duration_s": result.total_duration_s,
                "worker_id": worker_name,
                "media_type": result.media_type,
            }))
            all_discovered.extend(
                NewUrl(u, _priority_for_url(options, u))
                for u in result.discovered_urls
            )

    if done_items:
        queue_store.mark_done_batch(done_items)
    if error_items:
        queue_store.mark_error_batch(error_items)
    if all_discovered:
        queue_store.put(all_discovered)


def _coordinator(
    thread_index: int,
    options: CrawlOptions,
    queue_store: CrawlQueue,
    ctx: Context,
    blocked_normalized: set[str],
) -> None:
    """Coordinate DB batches and HTTP workers for one crawler process.

    Architecture:
    - coordinator owns queue_store and performs all DB reads/writes;
    - --worker-threads controls how many _http_worker threads fetch pages;
    - --batch-size controls how many URLs are claimed/flushed per DB batch.
    """
    worker_name = f"{options.worker_id}_{thread_index}"
    logging.info(
        "Starting crawler coordinator: %s with %d HTTP workers and DB batch size %d",
        worker_name,
        options.worker_threads,
        options.batch_size,
    )

    flush_size = options.batch_size
    refill_watermark = max(1, options.batch_size // 2)

    # work_q: bounded so the coordinator never over-fetches from DB.
    # Refill when fewer than half a DB batch remains queued, then claim one
    # batch. This keeps HTTP workers busy without letting memory grow unbounded.
    work_q: _queue.Queue[CrawlQueueItem | None] = _queue.Queue(
        maxsize=options.batch_size * 2
    )
    # done_q: bounded to provide backpressure — when the coordinator is busy
    # writing to DB, workers block here instead of accumulating results in memory.
    done_q: _queue.Queue[tuple[CrawlQueueItem, CrawlResult]] = _queue.Queue(
        maxsize=options.worker_threads * 2
    )

    http_threads = [
        threading.Thread(
            target=_http_worker, args=(work_q, done_q, options, ctx), daemon=True
        )
        for _ in range(options.worker_threads)
    ]
    for t in http_threads:
        t.start()

    pending: list[tuple[CrawlQueueItem, CrawlResult]] = []
    last_flush = time.monotonic()
    last_log = time.monotonic()
    db_exhausted = False
    total_sent = 0
    total_received = 0

    while True:
        # Refill work queue when it runs low.
        if not db_exhausted and work_q.qsize() < refill_watermark:
            entries = queue_store.get_batch(
                worker_name,
                batch_size=options.batch_size,
                max_retries=options.per_url_max_retries,
                timeout_seconds=options.lock_timeout_seconds,
            )
            if entries:
                for e in entries:
                    work_q.put(e)
                total_sent += len(entries)
            else:
                db_exhausted = True
                logging.info("[%s] DB queue exhausted.", worker_name)

        # Drain results from HTTP workers
        try:
            while True:
                pending.append(done_q.get_nowait())
                total_received += 1
        except _queue.Empty:
            pass

        # Flush accumulated results to DB
        now = time.monotonic()
        if now - last_log >= _LOG_INTERVAL_S:
            logging.info(
                "[%s] work_q=%d done_q=%d pending=%d sent=%d received=%d",
                worker_name,
                work_q.qsize(), done_q.qsize(), len(pending),
                total_sent, total_received,
            )
            last_log = now
        if len(pending) >= flush_size or (
            pending and now - last_flush >= _FLUSH_INTERVAL_S
        ):
            _flush_batch(pending, queue_store, options, blocked_normalized, worker_name)
            pending.clear()
            last_flush = now

        # Terminate when all dispatched URLs have returned results
        if db_exhausted and total_sent == total_received:
            if pending:
                _flush_batch(
                    pending, queue_store, options, blocked_normalized, worker_name
                )
                pending.clear()
            for _ in http_threads:
                work_q.put(None)
            work_q.join()
            for t in http_threads:
                t.join()
            logging.info("[%s] Pipeline complete.", worker_name)
            return

        time.sleep(0.005)


def run_crawler(ctx: Context, options: CrawlOptions) -> None:
    queue_store = ctx.crawl_queue
    if queue_store is None:
        raise ValueError("Context has no crawl_queue set")

    blocked = queue_store.get_blocked_domains()
    blocked_normalized = _normalize_blocked(blocked)

    _coordinator(0, options, queue_store, ctx, blocked_normalized)
