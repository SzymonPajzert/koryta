from __future__ import annotations

import argparse
import csv
import logging
from argparse import ArgumentParser
from pathlib import Path
from uuid import uuid4

from conductor import _setup_context
from scrapers.article.crawler import (
    CrawlOptions,
    run_crawler,
)
from scrapers.article.postgres_queue import PostgresCrawlQueue


def _build_parser() -> ArgumentParser:
    parser = ArgumentParser(description="Run the article crawler")
    parser.add_argument("--worker-id", default=f"crawler-{uuid4()}")
    parser.add_argument("--storage-type", choices=["gcs", "local"], default="local")
    parser.add_argument("--local-output", type=Path, default=Path("crawler_output"))
    parser.add_argument("--per-url-max-retries", type=int, default=3)
    parser.add_argument("--lock-timeout-seconds", type=int, default=60)
    parser.add_argument("--per-domain-rate-limit-qpm", type=int, default=20)
    parser.add_argument("--url-scoring-function", choices=["default", "kalisz"],
                        default="default")  # TODO hook registered function here
    parser.add_argument("--reset", action="store_true",
                        help="Reset the crawl DB and exit (requires confirmation).")
    parser.add_argument("--seed", type=Path,
                        help='CSV file with one column "Url" to seed the crawl queue.')
    parser.add_argument("--append-blocked", type=Path,
                        help='CSV file with columns "Domena" and "Powód" to append '
                             "blocked domains.")
    return parser


def _build_options(args: argparse.Namespace) -> CrawlOptions:
    return CrawlOptions(
        worker_id=args.worker_id,
        storage_type=args.storage_type,
        local_output=args.local_output if args.storage_type == "local" else None,
        per_url_max_retries=args.per_url_max_retries,
        lock_timeout_seconds=args.lock_timeout_seconds,
        per_domain_rate_limit_seconds=args.per_domain_rate_limit_qpm,
        url_scoring_function=args.url_scoring_function,
    )


def _confirm_reset() -> bool:
    answer = input("Reset crawl DB? Type 'reset' to confirm: ").strip()
    return answer.lower() == "reset"


def _read_csv_rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            raise ValueError(f"{path} is missing a header row")
        fieldnames = [name.strip() for name in reader.fieldnames]
        rows = []
        for row in reader:
            cleaned = {k.strip(): (v.strip() if isinstance(v, str) else v)
                       for k, v in row.items() if k is not None}
            rows.append(cleaned)
        return fieldnames, rows


def _load_seed_urls(path: Path) -> list[str]:
    fieldnames, rows = _read_csv_rows(path)
    if fieldnames != ["Url"]:
        raise ValueError(
            f"{path} must have exactly one column named 'Url'. Got: {fieldnames}"
        )
    urls = [row.get("Url", "").strip() for row in rows if row.get("Url")]
    if not urls:
        raise ValueError(f"{path} has no URLs to seed.")
    return urls


def _load_blocked_domains(path: Path) -> list[tuple[str, str]]:
    fieldnames, rows = _read_csv_rows(path)
    expected = ["Domena", "Powód"]
    if fieldnames != expected:
        raise ValueError(
            f"{path} must have columns {expected}. Got: {fieldnames}"
        )
    blocked = []
    for row in rows:
        domain = row.get("Domena", "").strip()
        reason = row.get("Powód", "").strip()
        if domain:
            blocked.append((domain, reason))
    if not blocked:
        raise ValueError(f"{path} has no blocked domains to append.")
    return blocked


def _build_seed_rows(urls: list[str]) -> list[tuple[str, int]]:
    rows = []
    for url in urls:
        rows.append((url, 0))
    return rows


def _setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.StreamHandler()
        ]
    )


def main() -> None:
    _setup_logging()
    parser = _build_parser()
    args = parser.parse_args()
    options = _build_options(args)
    logging.info("Running crawler with options: %s", options)

    queue = PostgresCrawlQueue.from_env()
    logging.info("Initializing crawling queue")

    if args.reset:
        if not _confirm_reset():
            logging.info("Reset cancelled.")
            return
        queue.reset()
        logging.info("Crawl DB reset complete.")
        return

    if args.append_blocked:
        blocked = _load_blocked_domains(args.append_blocked)
        queue.add_blocked_domains(blocked)
        logging.info("Appended %d blocked domains.", len(blocked))

    if args.seed:
        urls = _load_seed_urls(args.seed)
        rows = _build_seed_rows(urls)
        queue.put(rows)
        logging.info("Seeded %d URLs.", len(rows))

    ctx, _ = _setup_context(False, crawl_queue=queue)
    run_crawler(ctx, options)


if __name__ == "__main__":
    main()
