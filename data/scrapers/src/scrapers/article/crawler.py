from __future__ import annotations

import hashlib
import logging
import mimetypes
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Literal, cast
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup, Tag
from uuid_extensions import uuid7str  # type: ignore

from entities.util import NormalizedParse
from scrapers.article.scoring import get_scoring_function
from scrapers.stores import CloudStorage, Context, CrawlQueue, DataRef, LocalFile

warsaw_tz = ZoneInfo("Europe/Warsaw")
HEADERS = {"User-Agent": "KorytaCrawler/0.1 (+http://koryta.pl/crawler)"}


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
    request_timeout_seconds: float = 10
    worker_threads: int = 1


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
    yield stats
    stats.duration = time.perf_counter() - start

# Per each hostname we do on-worker rate limitng.
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

def _compress_long_segments(path: str, max_segment_length: int) -> str:
    path_segments = [s for s in path.split("/") if s]

    safe_segments = []
    for segment in path_segments:
        if len(segment.encode('utf-8')) > max_segment_length:
            hash_suffix = hashlib.md5(segment.encode()).hexdigest()[:10]
            truncated = segment[:max_segment_length - 12]
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
    base = f"hostname={parsed.hostname}/{path}/date={date}"
    if suffix:
        base = f"{base}/{suffix}"
    storage_path = base.replace("//", "/").rstrip("/")
    # We compress the segments because otherwise we can
    # get "OSError: [Errno 36] File name too long"
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
    return extension in {'.html', '.htm'}


def _upload_response(
    ctx: Context,
    parsed: NormalizedParse,
    response: requests.Response,
    options: CrawlOptions,
) -> str:
    binary_payload = response.content
    path = _storage_path(parsed)
    ref: DataRef
    if options.storage_type == "gcs":
        ref = CloudStorage(prefix=path)
    elif options.storage_type == "local":
        if options.local_output is None:
            raise ValueError("local_output is required for local storage")
        folder = cast(
            Literal["downloaded", "tests", "versioned", "crawler_output"],
            str(options.local_output),
        )
        ref = LocalFile(filename=path, folder=folder)
    else:
        raise ValueError("Unknown storage type")

    def _write_payload(stream: Any):
        stream.write(binary_payload)

    ctx.io.write_file(ref, _write_payload)
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
        HEADERS["User-Agent"],
    ):
        return CrawlResult(error="disallowed by robots")

    if not _can_crawl(parsed_url, options.per_domain_wait_between_requests_s):
        return CrawlResult(hit_rate_limit=True)

    with stopwatch() as t_request:
        try:
            response = requests.get(
                parsed_url.full_url,
                headers=HEADERS,
                timeout=options.request_timeout_seconds,
            )
        except requests.RequestException as exc:
            return CrawlResult(
                error=str(exc),
                request_duration_s=t_request.duration
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
            logging.info(f"Not parsing the file, because it's not HTML "
                         f"{parsed_url.full_url}")

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

        if not link or link.startswith(("#", "mailto:", "tel:",
                                        "javascript:", "data:")):
            continue

        absolute_link = ctx.utils.join_url(base_url, link)
        clean_link = absolute_link.split("#")[0].rstrip("/")

        if clean_link.startswith(("http://", "https://")):
            discovered.add(clean_link)

    return discovered


def _priority_for_url(options: CrawlOptions, url: str) -> int:
    scorer = get_scoring_function(options.url_scoring_function)
    score = scorer(url)
    return max(0, min(100, 100 - score))

def _normalize_blocked(blocked: set[str]) -> set[str]:
    return {NormalizedParse.parse(url).hostname_normalized for url in blocked}

def _filter_blocked(result: CrawlResult, blocked: set[str]):
    result.discovered_urls = [
        url for url in result.discovered_urls
        if NormalizedParse.parse(url).hostname_normalized not in blocked
    ]

def _worker_thread(thread_index: int, options: CrawlOptions,
                   queue: CrawlQueue, ctx: Context, blocked_normalized: set[str]):
    worker_name = f"{options.worker_id}_{thread_index}"
    logging.info(f"Starting to crawl in worker {worker_name}")

    while True:
        entry = queue.get(
            worker_name,
            max_retries=options.per_url_max_retries,
            timeout_seconds=options.lock_timeout_seconds,
        )
        if entry is None:
            logging.info(f"Waiting for entries in db in worker {worker_name}")
            time.sleep(1)
            continue

        uid, url = entry
        parsed_url = NormalizedParse.parse(url)

        result = crawl_url(ctx, parsed_url, options)

        if result.hit_rate_limit:
            logging.info(f"Skipping because of hit rate limit: {parsed_url.full_url}")
            # NOTE: We do not release the lock here, because we rely on lock timeout
            # mechanism to make it available again. This way it won't be queried over
            # and over again if it has a high priority
        elif result.error:
            logging.error(
                f"[{result.request_duration_s:.2f}s] "
                f"Crawl failed ({result.error}): {parsed_url.full_url}"
            )
            queue.mark_error(uid, result.error)
        else:
            _filter_blocked(result, blocked_normalized)
            logging.info(
                f"[{result.request_duration_s:.2f}s] "
                f"Crawl succeeded: {parsed_url.full_url}"
            )
            queue.mark_done(uid, result.storage_path, {
                "request_duration_s": result.request_duration_s,
                "parse_duration_s": result.parse_duration_s,
                "upload_duration_s": result.upload_duration_s,
                "total_duration_s": result.total_duration_s,
                "worker_id": worker_name,
                "media_type": result.media_type,
            })
            queue.put(
                [
                    (url, _priority_for_url(options, url))
                    for url in result.discovered_urls
                ]
            )


def run_crawler(ctx: Context, options: CrawlOptions):
    queue = ctx.crawl_queue
    if queue is None:
        raise ValueError("Context has no crawl_queue set")

    blocked = queue.get_blocked_domains()
    blocked_normalized = _normalize_blocked(blocked)

    if options.worker_threads <= 1:
        _worker_thread(0, options, queue, ctx, blocked_normalized)
        return

    with ThreadPoolExecutor(max_workers=options.worker_threads) as executor:
        futures = [executor.submit(_worker_thread, idx, options, queue, ctx,
                                   blocked_normalized)
                   for idx in range(options.worker_threads)]
        for future in futures:
            future.result()

