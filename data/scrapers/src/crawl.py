"""CLI entrypoint for the article crawler.

Handles all I/O-heavy work (env vars, CSV parsing, file reading) and dispatches
to CrawlerDB and the crawler module.
"""

import argparse
import csv
import json
import logging
import os
import subprocess
import sys

from tqdm import tqdm

from entities.util import parse_hostname
from main import _setup_context
from scrapers.article.crawler import crawl, ensure_url_format
from scrapers.article.db import CrawlerDB
from scrapers.article.parse import extract_article_content

logger = logging.getLogger(__name__)


def _make_db() -> CrawlerDB:
    return CrawlerDB(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        database=os.getenv("POSTGRES_DB", "crawler_db"),
        user=os.getenv("POSTGRES_USER", "crawler_user"),
        password=os.getenv("POSTGRES_PASSWORD", "crawler_password"),
    )


def _print_stats(stats: dict):
    logger.info("Total URLs: %d", stats["total_urls"])
    logger.info("Finished URLs: %d", stats["finished_urls"])
    logger.info("Pending URLs: %d", stats["pending_urls"])
    logger.info("URLs with errors: %d", stats["urls_with_errors"])
    logger.info("Total error occurrences: %d", stats["total_errors"])

    if stats["top_errors"]:
        logger.info("Most popular errors:")
        for msg, count in stats["top_errors"]:
            logger.info("  - %s: %d times", msg, count)
    else:
        logger.info("No error messages recorded.")

    avg = stats["avg_processing_seconds"]
    if avg is not None:
        logger.info("Average processing time per finished URL: %.2f seconds", avg)

    for label, data in stats["recent"].items():
        logger.info("--- Stats from %s ---", label)
        logger.info("Successes in last %s: %d", label, data["successes"])
        logger.info("Errors in last %s: %d", label, data["errors"])
        logger.info("Error %% in last %s: %.2f%%", label, data["errors"] / (data["successes"] + 1e-9) * 100)


def _run_parse(db: CrawlerDB, limit: int, view: bool):
    pages = db.get_pages_to_parse(limit)
    if not pages:
        logger.info("No pages to parse.")
        return

    if view:
        logger.info("Found %d pages to parse. Opening in Firefox for manual validation.", len(pages))
        try:
            for page_id, url, storage_path in pages:
                if not storage_path or not os.path.exists(storage_path):
                    logger.warning("Storage path not found for URL %s: %s", url, storage_path)
                    continue
                if storage_path.startswith("gs://"):
                    logger.info("Skipping GCS path for now: %s", storage_path)
                    continue
                try:
                    with open(storage_path, "rb") as f:
                        html_bytes = f.read()
                    extracted = extract_article_content(html_bytes)
                    if not extracted["is_article"]:
                        continue
                    subprocess.Popen(
                        ["firefox", f"file://{os.path.abspath(storage_path)}"],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                    print("\n" + "=" * 80)
                    print(f"URL: {url}")
                    print(f"Title: {extracted['title']}")
                    print(f"Is Article: {extracted['is_article']}")
                    print(f"Publication Date: {extracted['publication_date']}")
                    print("-" * 80)
                    print("Content:")
                    print(extracted["article_content"])
                    input("Press Enter to continue, or Ctrl+C to quit...")
                except KeyboardInterrupt:
                    logger.info("Viewer interrupted by user. Exiting.")
                    break
                except Exception as e:
                    logger.error("Failed to parse or view %s from %s: %s", url, storage_path, e)
        except KeyboardInterrupt:
            logger.info("Viewer interrupted by user. Exiting.")
    else:
        output_filename = "parsed_articles.jsonl"
        logger.info("Found %d pages to parse. Output will be saved to %s", len(pages), output_filename)
        with open(output_filename, "w", encoding="utf-8") as f:
            for page_id, url, storage_path in tqdm(pages, desc="Parsing articles"):
                if not storage_path or not os.path.exists(storage_path):
                    logger.warning("Storage path not found for URL %s: %s", url, storage_path)
                    continue
                if storage_path.startswith("gs://"):
                    logger.info("Skipping GCS path for now: %s", storage_path)
                    continue
                try:
                    with open(storage_path, "rb") as html_file:
                        html_bytes = html_file.read()
                    extracted = extract_article_content(html_bytes)
                    record = {
                        "id": page_id,
                        "url": url,
                        "title": extracted["title"],
                        "is_article": extracted["is_article"],
                        "publication_date": str(extracted["publication_date"]) if extracted["publication_date"] else None,
                        "content": extracted["article_content"],
                    }
                    f.write(json.dumps(record) + "\n")
                except Exception as e:
                    logger.error("Failed to parse %s from %s: %s", url, storage_path, e)
        logger.info("Finished parsing. Results saved to %s", output_filename)


def main():
    parser = argparse.ArgumentParser(description="Article crawler CLI.")
    parser.add_argument(
        "--storage", choices=["local", "gcs"], default="local",
        help="Storage backend for crawled files.",
    )
    parser.add_argument(
        "--init-db", type=str, dest="initial_urls_file", metavar="URL_FILE",
        help="Initialize the database with URLs from a file and exit.",
    )
    parser.add_argument(
        "--reset-db", action="store_true",
        help="Reset database before initialization (requires --init-db).",
    )
    parser.add_argument(
        "--load-blocked", type=str, dest="blocked_csv", metavar="CSV_FILE",
        help="Load blocked domains from a CSV file and exit.",
    )
    parser.add_argument(
        "--crawl-delay-seconds", type=int, default=1,
        help="Seconds to wait between requests to the same domain.",
    )
    parser.add_argument(
        "--max-retries", type=int, default=5,
        help="Maximum retries for a failed URL.",
    )
    parser.add_argument(
        "--worker-id", type=str,
        help="Unique identifier for the crawler worker (required for crawling).",
    )
    parser.add_argument(
        "--stats", action="store_true",
        help="Print database statistics and exit.",
    )
    parser.add_argument(
        "--parse", type=int, nargs="?", const=10, dest="parse_limit", metavar="LIMIT",
        help="Parse crawled HTML articles (default limit: 10).",
    )
    parser.add_argument(
        "--view", action="store_true",
        help="Open parsed articles in Firefox (use with --parse).",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(levelname)s - [%(name)s] %(message)s",
        stream=sys.stdout,
    )

    db = _make_db()

    if args.initial_urls_file:
        try:
            with open(args.initial_urls_file, "r") as f:
                urls = [ensure_url_format(line.strip()) for line in f if line.strip()]
        except FileNotFoundError:
            logger.error("Initial URLs file not found: %s", args.initial_urls_file)
            sys.exit(1)
        db.init_tables(urls, reset=args.reset_db)
        sys.exit(0)

    if args.blocked_csv:
        with open(args.blocked_csv, "r") as f:
            reader = csv.DictReader(f)
            rows = []
            for row in reader:
                domain = parse_hostname(row["Domena"].strip())
                reason = row.get("Powód", "").strip()
                rows.append((domain, reason))
        db.load_blocked_domains(rows)
        sys.exit(0)

    if args.stats:
        _print_stats(db.get_stats())
        sys.exit(0)

    if args.parse_limit is not None:
        _run_parse(db, args.parse_limit, args.view)
        sys.exit(0)

    if not args.worker_id:
        parser.error("--worker-id is required for crawling.")

    ctx, _ = _setup_context(use_rejestr_io=False, storage_mode=args.storage)
    config = {
        "crawl_delay_seconds": args.crawl_delay_seconds,
        "max_retries": args.max_retries,
    }

    logger.info("Starting crawl...")
    try:
        crawl(ctx, db, config, args.worker_id)
    except KeyboardInterrupt:
        logger.info("Crawl interrupted by user. Exiting.")

    logger.info("Crawl finished.")


if __name__ == "__main__":
    main()
