from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup
from uuid_extensions import uuid7str  # type: ignore

from entities.crawler import RequestLog
from entities.util import NormalizedParse
from scrapers.article.scoring import get_scoring_function
from scrapers.stores import Context, CrawlQueue, LocalFile
from stores.config import PROJECT_ROOT

warsaw_tz = ZoneInfo("Europe/Warsaw")
HEADERS = {"User-Agent": "KorytaCrawler/0.1 (+http://koryta.pl/crawler)"}


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


def _log_request(
        ctx: Context,
        uid: str,
        url: str,
        response_code: int,
        payload_size: int,
        duration: float,
        storage_path: str | None,
):
    parsed = NormalizedParse.parse(url)
    ctx.io.output_entity(
        RequestLog(
            uuid7str(),
            uid,
            parsed.hostname_normalized,
            url,
            datetime.now(warsaw_tz),
            response_code,
            payload_size,
            f"{duration:.2f}s",
            storage_path,
        )
    )


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


def _upload_text(
        ctx: Context,
        parsed: NormalizedParse,
        text: str,
        content_type: str,
        options: CrawlOptions,
        suffix: str | None = None,
) -> str | None:
    target = _storage_path(parsed, suffix=suffix)
    ext = "html" if content_type.startswith("text/html") else "txt"
    if options.storage_type == "local" and options.local_output is not None:
        relative = Path(options.local_output) / f"{target}.{ext}"
        ref = LocalFile(str(relative), "downloaded")
        ctx.io.write_file(ref, text)
        return os.path.join(PROJECT_ROOT, "downloaded", str(relative))
    result = ctx.io.upload(parsed, text, content_type)  # TODO it should use DataRef
    if result is None:
        return None
    if isinstance(result, str):
        return result
    if hasattr(result, "path"):
        return str(result.path)
    return str(result)


def crawl_url(
        ctx: Context,
        uid: str,
        url: str,
        options: CrawlOptions,
) -> CrawlResult:
    started = datetime.now(warsaw_tz)
    parsed = NormalizedParse.parse(url)

    if not ctx.web.robot_txt_allowed(ctx, url, parsed, HEADERS["User-Agent"]):
        return CrawlResult(error="disallowed by robots")

    if not _can_crawl(parsed, options.per_domain_rate_limit_seconds):
        return CrawlResult(hit_rate_limit=True)

    try:
        response = requests.get(url, headers=HEADERS, timeout=options.request_timeout_seconds)
        if response.status_code != 200:
            _log_request(
                ctx,
                uid,
                url,
                response.status_code,
                len(response.content),
                (datetime.now(warsaw_tz) - started).total_seconds(),
                None,
            )
            return CrawlResult(error=f"http {response.status_code}")

        storage_path = _upload_text(ctx, parsed, response.text, "text/html", options)
        discovered_urls = _extract_urls(ctx, parsed, response)
        duration = (datetime.now(warsaw_tz) - started).total_seconds()

        _log_request(
            ctx,
            uid,
            url,
            response.status_code,
            len(response.content),
            duration,
            storage_path,
        )
        return CrawlResult(storage_path=storage_path, discovered_urls=list(discovered_urls))
    except requests.RequestException as exc:
        _log_request(
            ctx,
            uid,
            url,
            0,
            0,
            (datetime.now(warsaw_tz) - started).total_seconds(),
            None,
        )
        return CrawlResult(error=str(exc))


def _extract_urls(ctx: Context, parsed: NormalizedParse, response: requests.Response) -> set[str]:
    discovered = set()
    for parser in ["html.parser", "lxml", "html5lib"]:
        soup = BeautifulSoup(response.text, parser)

        for link in soup.find_all("a", href=True):
            absolute_link = ctx.utils.join_url(parsed.hostname_normalized, link["href"])
            absolute_link = absolute_link.split("#")[0]
            stop = False
            for prefix in ["javascript", "mailto", "tel"]:
                if absolute_link.startswith(prefix):
                    stop = True
            if stop:
                continue
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

    while True:
        entry = queue.get(
            options.worker_id,
            max_retries=options.per_url_max_retries,
            timeout_seconds=options.lock_timeout_seconds,
        )
        if entry is None:
            logging.info("Closing crawl queue")
            return

        uid, url = entry
        result = crawl_url(ctx, uid, url, options)

        if result.hit_rate_limit:
            logging.info("Skipping because of hit rate limit: %s", url)
        if result.error:
            logging.error("Crawl failed: %s", result.error)
            queue.mark_error(uid, result.error)
        else:
            logging.info("Crawl succeeded: %s", result.storage_path)
            queue.mark_done(uid, result.storage_path)
            queue.put([(url, _priority_for_url(options, url)) for url in result.discovered_urls])
