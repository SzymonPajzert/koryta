import argparse
import logging
import sys
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup
from uuid_extensions import uuid7str

from entities.util import NormalizedParse
from scrapers.stores import Context

logger = logging.getLogger(__name__)

warsaw_tz = ZoneInfo("Europe/Warsaw")

HEADERS = {"User-Agent": "KorytaCrawler/0.1 (+http://koryta.pl/crawler)"}


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


def uuid7():
    return uuid7str()


def parse_hostname(url: str) -> str:
    """Extracts the normalized hostname from a URL."""
    return NormalizedParse.parse(url).hostname_normalized


def init_db(ctx: Context, initial_urls_file: str):
    """Initializes the database, creating the website_index table and populating it with initial URLs."""
    logger.info("Initializing database...")
    ctx.con.execute(
        """
        CREATE TABLE IF NOT EXISTS website_index
        (
            id
            VARCHAR
            PRIMARY
            KEY,
            url
            VARCHAR
            UNIQUE,
            priority
            INTEGER,
            done
            BOOLEAN,
            errors
            VARCHAR
        [],
            num_retries
            INTEGER,
            date_added
            TIMESTAMP,
            date_finished
            TIMESTAMP
        );
        """
    )

    try:
        with open(initial_urls_file, "r") as f:
            urls_to_insert = []
            for line in f:
                url = ensure_url_format(line.strip())
                if url:
                    urls_to_insert.append((uuid7(), url, 0, False, [], 0, datetime.now(warsaw_tz), None))

            if urls_to_insert:
                ctx.con.executemany(
                    "INSERT INTO website_index (id, url, priority, done, errors, num_retries, date_added, date_finished) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(url) DO NOTHING",
                    urls_to_insert,
                )
                logger.info("Added or ignored %d URLs.", len(urls_to_insert))

    except FileNotFoundError:
        logger.error("Initial URLs file not found at %s", initial_urls_file)
        sys.exit(1)

    logger.info("Database initialization complete.")


next_request_time: dict[str, float] = {}


def ready_to_crawl(parsed: NormalizedParse) -> bool:
    domain = parsed.hostname_normalized
    if domain not in next_request_time:
        return True
    return time.time() > next_request_time[domain]


def set_crawl_delay(parsed: NormalizedParse, config: dict):
    domain = parsed.hostname_normalized
    next_request_time[domain] = time.time() + config["crawl_delay_seconds"]


def process_url(ctx: Context, url: str, config: dict) -> (set[str], str | None):
    """
    Crawls a single URL.
    Returns a tuple of (set_of_found_links, error_message_or_None).
    """
    try:
        url = ensure_url_format(url)
        if not url:
            return set(), "Empty URL"

        parsed = NormalizedParse.parse(url)

        if not ctx.web.robot_txt_allowed(ctx, url, parsed, HEADERS["User-Agent"]):
            return set(), "Disallowed by robots.txt"

        if not ready_to_crawl(parsed):
            # Not an error, just need to wait. Return no links and a specific message.
            return set(), "RATE_LIMITED"

        set_crawl_delay(parsed, config)
        logger.info("Crawling: %s", url)
        response = requests.get(url, headers=HEADERS, timeout=10)

        if response.status_code != 200:
            return set(), f"HTTP status code {response.status_code}"

        # Success
        pages_to_visit = set()
        ctx.io.upload(parsed, response.text, "text/html")

        soup = BeautifulSoup(response.text, "html.parser")
        for link in soup.find_all("a", href=True):
            href = link.get("href")
            if not href:
                continue

            # Ignore javascript:, mailto:, etc.
            if any(href.startswith(prefix) for prefix in ["javascript:", "mailto:", "tel:"]):
                continue

            absolute_link = ctx.utils.join_url(url, href).split("#")[0].rstrip("/")
            if absolute_link:
                pages_to_visit.add(absolute_link)

        logger.info("Found %d links on %s", len(pages_to_visit), url)
        return pages_to_visit, None

    except requests.RequestException as e:
        logger.error("An error occurred while crawling %s: %s", url, e)
        return set(), str(e)


def next_url(ctx: Context, config: dict) -> tuple | None:
    row = ctx.con.execute(
        f"""
        SELECT id, url, priority, num_retries
        FROM website_index
        WHERE done = FALSE AND num_retries < {config["max_retries"]}
        ORDER BY priority ASC, RANDOM()
        LIMIT 1
        """
    ).fetchone()
    if not row:
        return None

    return row


def propagate_url_error(ctx: Context, uid: str, error: str) -> None:
    ctx.con.execute(
        "UPDATE website_index SET num_retries = num_retries + 1, errors = list_append(errors, ?) WHERE id = ?",
        [error, uid],
    )


def mark_url_done(ctx: Context, uid: str) -> None:
    ctx.con.execute(
        "UPDATE website_index SET done = TRUE, date_finished = ? WHERE id = ?",
        [datetime.now(warsaw_tz), uid],
    )


def insert_url_rows(ctx: Context, rows: list) -> None:
    ctx.con.executemany(
        "INSERT INTO website_index (id, url, priority, done, errors, num_retries, date_added, date_finished) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(url) DO NOTHING",
        rows,
    )
    # TODO check how many new rows were actually added and log it


def crawl(ctx: Context, config: dict):
    """Main crawling loop."""
    while True:
        maybe_row = next_url(ctx, config)
        if not maybe_row:
            logger.info("No more URLs to crawl. Exiting.")
            break

        uid, current_url, current_priority, num_retries = maybe_row
        new_links, error = process_url(ctx, current_url, config)

        if error:
            if error == "RATE_LIMITED":
                logger.warning("Rate limited, will try another url")
                continue

            propagate_url_error(ctx, uid, error)
            continue

        mark_url_done(ctx, uid)
        if new_links:
            new_priority = current_priority + 1  # Descrease priority, we make bfs for now
            rows_to_insert = []
            for link_url in new_links:
                link_url = ensure_url_format(link_url)
                rows_to_insert.append(
                    (uuid7(), link_url, new_priority, False, [], 0, datetime.now(warsaw_tz), None))
            insert_url_rows(ctx, rows_to_insert)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the web crawler.")
    parser.add_argument(
        "--storage", choices=["local", "gcs"], default="local", help="Storage backend for crawled files."
    )
    parser.add_argument(
        "--db-path", type=str, default="my_crawler_db.duckdb", help="Path to the DuckDB database file."
    )
    parser.add_argument(
        "--init-db",
        type=str,
        dest="initial_urls_file",
        metavar="URL_FILE",
        help="Initialize the database with a list of URLs from a file and exit.",
    )
    parser.add_argument(
        "--crawl-delay-seconds",
        type=int,
        default=5,
        help="Number of seconds to wait between requests to the same domain.",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=5,
        help="Maximum number of retries for a failed URL.",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - [%(name)s] %(message)s',
        stream=sys.stdout,
    )

    from main import _setup_context

    ctx, _ = _setup_context(use_rejestr_io=False, storage_mode=args.storage, db_path=args.db_path)

    config = {
        "crawl_delay_seconds": args.crawl_delay_seconds,
        "max_retries": args.max_retries,
    }

    if args.initial_urls_file:
        init_db(ctx, args.initial_urls_file)
        sys.exit(0)

    logger.info("Starting crawl...")
    try:
        crawl(ctx, config)
    except KeyboardInterrupt:
        logger.info("Crawl interrupted by user. Exiting.")

    logger.info("Crawl finished.")
