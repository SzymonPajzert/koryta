import argparse
import logging
import sys
import time
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup
from uuid_extensions import uuid7str

from entities.crawler import WebsiteIndex
from entities.util import NormalizedParse
from scrapers.stores import Context

logger = logging.getLogger(__name__)

warsaw_tz = ZoneInfo("Europe/Warsaw")

HEADERS = {"User-Agent": "KorytaCrawler/0.1 (+http://koryta.pl/crawler)"}
CRAWL_DELAY_SECONDS = 5  # TODO put this into arparse
MAX_RETRIES = 5  # TODO put this into argparse

def ensure_scheme(url: str) -> str:
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
            INTEGER
        );
        """ # TODO add two columns, date added and date finished. Make sure you set first on adding the link to db and second on crawling it suceessfully
    )

    try:
        with open(initial_urls_file, "r") as f:
            urls_to_insert = []
            for line in f:
                url = ensure_scheme(line.strip())
                if url:
                    urls_to_insert.append((uuid7(), url, 0, False, [], 0))

            if urls_to_insert:
                ctx.con.executemany(
                    "INSERT INTO website_index (id, url, priority, done, errors, num_retries) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(url) DO NOTHING",
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


def set_crawl_delay(parsed: NormalizedParse):
    domain = parsed.hostname_normalized
    next_request_time[domain] = time.time() + CRAWL_DELAY_SECONDS


def process_url(ctx: Context, url: str) -> (set[str], str | None):
    """
    Crawls a single URL.
    Returns a tuple of (set_of_found_links, error_message_or_None).
    """
    try:
        url = ensure_scheme(url)
        if not url:
            return set(), "Empty URL"

        parsed = NormalizedParse.parse(url)

        if not ctx.web.robot_txt_allowed(ctx, url, parsed, HEADERS["User-Agent"]):
            return set(), "Disallowed by robots.txt"

        if not ready_to_crawl(parsed):
            # Not an error, just need to wait. Return no links and a specific message.
            return set(), "RATE_LIMITED"

        set_crawl_delay(parsed)
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


def crawl(ctx: Context):
    """Main crawling loop."""
    while True:
        # Get the next URL to crawl
        row = ctx.con.execute(
            f"""
            SELECT id, url, priority, num_retries
            FROM website_index
            WHERE done = FALSE AND num_retries < {MAX_RETRIES}
            ORDER BY priority ASC, id ASC
            LIMIT 1
            """ # TODO try to shuffle the URLs, curently they are always from the same hostname so we are getting lot's of Rate limits
        ).fetchone()

        if not row:
            logger.info("No more URLs to crawl. Exiting.")
            break

        uid, current_url, current_priority, num_retries = row
        new_links, error = process_url(ctx, current_url)

        if error:
            if error == "RATE_LIMITED":
                logger.warning("Rate limited, will try again later.")
                # We don't update the DB, so it will be picked up again
                time.sleep(CRAWL_DELAY_SECONDS)
                continue

            # Persist error and increment retry count
            ctx.con.execute(
                "UPDATE website_index SET num_retries = num_retries + 1, errors = list_append(errors, ?) WHERE id = ?",
                [error, uid],
            )
        else:
            # Mark as done
            ctx.con.execute("UPDATE website_index SET done = TRUE WHERE id = ?", [uid])

            # Add new links to the database
            if new_links:
                new_priority = current_priority + 1
                urls_to_insert = []
                for link_url in new_links:
                    link_url = ensure_scheme(link_url)
                    urls_to_insert.append((uuid7(), link_url, new_priority, False, [], 0))

                if urls_to_insert:
                    ctx.con.executemany(
                        "INSERT INTO website_index (id, url, priority, done, errors, num_retries) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(url) DO NOTHING",
                        urls_to_insert,
                    )


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
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - [%(name)s] %(message)s',
        stream=sys.stdout,
    )

    from main import _setup_context

    ctx, _ = _setup_context(use_rejestr_io=False, storage_mode=args.storage, db_path=args.db_path)

    if args.initial_urls_file:
        init_db(ctx, args.initial_urls_file)
        sys.exit(0)

    logger.info("Starting crawl...")
    try:
        crawl(ctx)
    except KeyboardInterrupt:
        logger.info("Crawl interrupted by user. Exiting.")

    logger.info("Crawl finished.")
