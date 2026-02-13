"""Article crawler business logic.

Handles HTTP requests, link extraction, rate limiting, and the main crawl loop.
Database operations are delegated to CrawlerDB; URL scoring to the scoring module.
"""

import logging
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup
from uuid_extensions import uuid7str

from entities.util import NormalizedParse
from scrapers.article.db import CrawlerDB
from scrapers.article.scoring import ScoringFunction, url_score
from scrapers.stores import Context

logger = logging.getLogger(__name__)

warsaw_tz = ZoneInfo("Europe/Warsaw")

HEADERS = {"User-Agent": "KorytaCrawler/0.1 (+http://koryta.pl/crawler)"}

# Per-domain rate limiting (local to this process)
next_request_time: dict[str, float] = {}


def ensure_url_format(url: str) -> str:
    """Adds https:// to a URL if it's missing a scheme."""
    if not url:
        return ""
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        if url.startswith("//"):
            return "https:" + url
        return "https://" + url
    return url


def ready_to_crawl(parsed: NormalizedParse) -> bool:
    domain = parsed.hostname_normalized
    if domain not in next_request_time:
        return True
    return time.time() > next_request_time[domain]


def set_crawl_delay(parsed: NormalizedParse, config: dict):
    domain = parsed.hostname_normalized
    next_request_time[domain] = time.time() + config["crawl_delay_seconds"]


def process_url(ctx: Context, uid: str, url: str, config: dict) -> tuple[set[str], str | None, str | None]:
    """Crawl a single URL.

    Returns (found_links, error_or_None, storage_path_or_None).
    """
    try:
        url = ensure_url_format(url)
        if not url:
            return set(), "Empty URL", None

        parsed = NormalizedParse.parse(url)

        if not ctx.web.robot_txt_allowed(ctx, url, parsed, HEADERS["User-Agent"]):
            return set(), "Disallowed by robots.txt", None

        if not ready_to_crawl(parsed):
            return set(), "RATE_LIMITED", None

        set_crawl_delay(parsed, config)
        logger.info("Crawling: %s", url)
        response = requests.get(url, headers=HEADERS, timeout=10)

        if response.status_code != 200:
            return set(), f"HTTP status code {response.status_code}", None

        pages_to_visit = set()
        storage_path = ctx.io.upload(parsed, response.content, "text/html", file_id=uid)

        soup = BeautifulSoup(response.text, "html.parser")
        for link in soup.find_all("a", href=True):
            href = link.get("href")
            if not href:
                continue
            if any(href.startswith(prefix) for prefix in ["javascript:", "mailto:", "tel:"]):
                continue
            absolute_link = ctx.utils.join_url(url, href).split("#")[0].rstrip("/")
            if absolute_link:
                pages_to_visit.add(absolute_link)

        logger.info("Found %d links on %s", len(pages_to_visit), url)
        return pages_to_visit, None, storage_path

    except requests.RequestException as e:
        logger.error("An error occurred while crawling %s: %s", url, e)
        return set(), str(e), None


def crawl(
    ctx: Context,
    db: CrawlerDB,
    config: dict,
    worker_id: str,
    score_fn: ScoringFunction = url_score,
):
    """Main crawling loop."""
    while True:
        maybe_row = db.get_and_lock_url(worker_id, config["max_retries"])
        if not maybe_row:
            logger.info("No more URLs to crawl. Exiting.")
            break

        uid, current_url, _, _ = maybe_row
        logger.info("Worker %s crawling: %s", worker_id, current_url)
        new_links, error, storage_path = process_url(ctx, uid, current_url, config)

        if error:
            if error == "RATE_LIMITED":
                logger.warning("Rate limited, will try another url")
                db.release_lock(uid)
                time.sleep(1)
                continue

            db.propagate_error(uid, error)
            continue

        db.mark_done(uid, storage_path)
        if new_links:
            now = datetime.now(warsaw_tz)
            rows_to_insert = []
            for link_url in new_links:
                link_url = ensure_url_format(link_url)
                score = score_fn(link_url)
                priority = 100 - score
                rows_to_insert.append(
                    (uuid7str(), link_url, priority, False, [], 0, now, None, current_url)
                )
            db.insert_urls(rows_to_insert)
