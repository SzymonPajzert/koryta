from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Literal, cast
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup, Tag
from uuid_extensions import uuid7str  # type: ignore

from entities.util import NormalizedParse
from scrapers.article.scoring import get_scoring_function
from scrapers.stores import CloudStorage, Context, DataRef, LocalFile

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
    per_domain_rate_limit_seconds: int
    url_scoring_function: str
    request_timeout_seconds: float = 10


@dataclass
class CrawlResult:
    storage_path: str | None = None
    error: str | None = None
    hit_rate_limit: bool = False
    discovered_urls: list[str] = field(default_factory=list)
    response_duration_s: float | None = None


# Per each hostname we do on-worker rate limitng.
next_request_time: dict[str, float] = {}


def _can_crawl(parsed: NormalizedParse, rate_limit: int) -> bool:
    domain = parsed.hostname_normalized
    next_time = next_request_time.get(domain, 0)
    now = time.time()
    if now < next_time:
        return False
    next_request_time[domain] = time.time() + rate_limit
    return True


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
    return base.replace("//", "/").rstrip("/")


def _upload_response(
    ctx: Context,
    parsed: NormalizedParse,
    response: requests.Response,
    options: CrawlOptions,
) -> str:
    file_content = response.text
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

    ctx.io.write_file(ref, file_content)
    return path


def crawl_url(
    ctx: Context,
    parsed_url: NormalizedParse,
    options: CrawlOptions,
) -> CrawlResult:
    if not ctx.web.robot_txt_allowed(
        ctx,
        parsed_url.full_url,
        parsed_url,
        HEADERS["User-Agent"],
    ):
        return CrawlResult(error="disallowed by robots", response_duration_s=0)

    if not _can_crawl(parsed_url, options.per_domain_rate_limit_seconds):
        return CrawlResult(hit_rate_limit=True)

    try:
        response = requests.get(
            parsed_url.full_url,
            headers=HEADERS,
            timeout=options.request_timeout_seconds,
        )
        duration = response.elapsed.total_seconds()
        if response.status_code != 200:
            return CrawlResult(
                error=f"http {response.status_code}",
                response_duration_s=duration,
            )

        storage_path = _upload_response(ctx, parsed_url, response, options)
        discovered_urls = _extract_urls(ctx, parsed_url, response)

        return CrawlResult(
            storage_path=storage_path,
            discovered_urls=list(discovered_urls),
            response_duration_s=duration,
        )
    except requests.RequestException as exc:
        return CrawlResult(error=str(exc), response_duration_s=0)


def _extract_urls(
    ctx: Context,
    parsed: NormalizedParse,
    response: requests.Response,
) -> set[str]:
    discovered = set()
    for parser in ["html.parser", "lxml", "html5lib"]:
        soup = BeautifulSoup(response.text, parser)

        for link_el in soup.find_all("a", href=True):
            if not isinstance(link_el, Tag):
                continue
            link = link_el.get("href")
            if not isinstance(link, str):
                continue
            if link in ("", "#", "/"):
                continue
            if any(
                link.startswith(p)
                for p in ("mailto", "url", "tel", "sms", "ftp", "javascript", "data")
            ):
                continue
            absolute_link = ctx.utils.join_url(parsed.domain, link)
            absolute_link = absolute_link.split("#")[0]
            absolute_link = absolute_link.split("?")[0]
            absolute_link = absolute_link.rstrip("/")
            discovered.add(absolute_link)

    return discovered


def _priority_for_url(options: CrawlOptions, url: str) -> int:
    scorer = get_scoring_function(options.url_scoring_function)
    score = scorer(url)
    return max(0, min(100, 100 - score))


def run_crawler(ctx: Context, options: CrawlOptions) -> None:
    queue = ctx.crawl_queue
    if queue is None:
        raise ValueError("Context has no crawl_queue set")

    logging.info("Starting to crawl in worker: %s", options.worker_id)

    while True:
        entry = queue.get(
            options.worker_id,
            max_retries=options.per_url_max_retries,
            timeout_seconds=options.lock_timeout_seconds,
        )
        if entry is None:
            logging.info("Closing crawl queue. Nothing more to do.")
            return

        uid, url = entry
        parsed_url = NormalizedParse.parse(url)
        result = crawl_url(ctx, parsed_url, options)

        if result.hit_rate_limit:
            logging.info(f"Skipping because of hit rate limit: {parsed_url.full_url})")
        elif result.error:
            logging.error(
                f"[{result.response_duration_s:.2f}s] "
                f"Crawl failed ({result.error}): {parsed_url.full_url}"
            )
            queue.mark_error(uid, result.error)
        else:
            logging.info(
                f"[{result.response_duration_s:.2f}s] "
                f"Crawl succeeded: {parsed_url.full_url}"
            )
            queue.mark_done(uid, result.storage_path)
            queue.put(
                [
                    (url, _priority_for_url(options, url))
                    for url in result.discovered_urls
                ]
            )
