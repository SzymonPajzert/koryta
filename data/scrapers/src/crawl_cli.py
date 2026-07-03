from __future__ import annotations

import argparse
import cProfile
import csv
import logging
import os
from argparse import ArgumentParser
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from conductor import setup_context
from external.url_store_client import UrlStoreClient
from scrapers.article.crawler import (
    CrawlOptions,
    run_crawler,
)
from scrapers.article.parse_runner import run_parse
from scrapers.article.postgres_queue import PostgresClient, PostgresCrawlQueue
from scrapers.article.scoring import get_scoring_function
from scrapers.article.url_store_queue import UrlStoreQueue
from scrapers.stores import BlockedDomain, CrawlQueue, NewUrl


def _build_parser() -> ArgumentParser:
    parser = ArgumentParser(description="Run the article crawler")
    parser.add_argument("--worker-id", default=f"crawler-{uuid4()}")
    parser.add_argument("--storage-type", choices=["gcs", "local"], default="local")
    parser.add_argument("--local-output", type=Path, default=Path("crawler_output"))
    parser.add_argument("--per-url-max-retries", type=int, default=3)
    parser.add_argument("--lock-timeout-seconds", type=int, default=60)
    parser.add_argument("--per-domain-rate-limit-qpm", type=int, default=20)
    parser.add_argument(
        "--url-scoring-function",
        choices=["default", "kalisz"],
        default="default",
    )  # TODO hook registered function here
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Reset the crawl DB and exit (requires confirmation).",
    )
    parser.add_argument(
        "--seed",
        type=Path,
        help='CSV file with a "Domena" column to seed the crawl queue.',
    )
    parser.add_argument(
        "--append-blocked",
        type=Path,
        help='CSV file with columns "Domena" and "Powód" to append blocked domains.',
    )
    parser.add_argument(
        "--setup-only",
        action="store_true",
        help="Only apply seed/blocked/reset actions, then exit.",
    )
    parser.add_argument(
        "--profile-path",
        type=Path,
        default=None,
        help="Enable cProfile and write them to that path",
    )
    parser.add_argument(
        "--worker-threads",
        type=int,
        default=1,
        help="Number of concurrent threads inside a worker.",
    )
    parser.add_argument(
        "--parse",
        action="store_true",
        help="Parse done URLs from DB: print stats and write article_parsed.jsonl.",
    )
    parser.add_argument(
        "--parse-limit",
        type=int,
        default=1000,
        help="Max number of done URLs to parse (default: 1000).",
    )
    parser.add_argument(
        "--reprioritize",
        action="store_true",
        help=(
            "Rescore all not-done URLs using the configured scoring function,"
            " then exit."
        ),
    )
    parser.add_argument(
        "--bump-small-domains",
        type=int,
        default=None,
        metavar="N",
        help="Set priority=0 for pending URLs on domains with fewer than N done links, "
             "so that done + bumped = N per domain. Then exit.",
    )
    parser.add_argument(
        "--custom-pipeline",
        action="store_true",
        help="Read url from custom pipeline instead of the default one.",
    )
    return parser


def _build_options(args: argparse.Namespace, seed_urls: list[str]) -> CrawlOptions:
    return CrawlOptions(
        worker_id=args.worker_id,
        storage_type=args.storage_type,
        local_output=args.local_output if args.storage_type == "local" else None,
        per_url_max_retries=args.per_url_max_retries,
        lock_timeout_seconds=args.lock_timeout_seconds,
        per_domain_wait_between_requests_s=60 / args.per_domain_rate_limit_qpm,
        url_scoring_function=args.url_scoring_function,
        domains_of_interest=frozenset(seed_urls),
        worker_threads=max(1, args.worker_threads),
    )


def _confirm_reset() -> bool:
    if os.getenv("CRAWL_RESET_CONFIRM") == "1":
        return True
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
            cleaned = {
                k.strip(): (v.strip() if isinstance(v, str) else v)
                for k, v in row.items()
                if k is not None
            }
            rows.append(cleaned)
        return fieldnames, rows


def _load_seed_urls(path: Path) -> list[str]:
    fieldnames, rows = _read_csv_rows(path)
    if "Domena" not in fieldnames:
        raise ValueError(
            f"{path} must have a 'Domena' column. Got: {fieldnames}"
        )
    urls = [row.get("Domena", "").strip() for row in rows if row.get("Domena")]
    if not urls:
        raise ValueError(f"{path} has no URLs to seed.")
    return urls


def _load_blocked_domains(path: Path) -> list[BlockedDomain]:
    fieldnames, rows = _read_csv_rows(path)
    expected = ["Domena", "Powód"]
    if fieldnames != expected:
        raise ValueError(
            f"{path} must have columns {expected}. Got: {fieldnames}"
        )
    blocked: list[BlockedDomain] = []
    for row in rows:
        domain = row.get("Domena", "").strip()
        reason = row.get("Powód", "").strip()
        if domain:
            blocked.append(BlockedDomain(domain, reason))
    if not blocked:
        raise ValueError(f"{path} has no blocked domains to append.")
    return blocked


def _build_seed_rows(urls: list[str]) -> list[NewUrl]:
    return [NewUrl(url, 0) for url in urls]


def _setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[logging.StreamHandler()],
    )


@contextmanager
def profile_scope(enabled: bool, path: Path | None):
    if not enabled:
        yield
        return
    if path is None:
        raise ValueError("profile path is required when profiling is enabled")
    profiler = cProfile.Profile()
    profiler.enable()
    try:
        yield
    finally:
        profiler.disable()
        path.parent.mkdir(parents=True, exist_ok=True)
        profiler.dump_stats(str(path))
        logging.info("Wrote profile to %s", path)


def main() -> None:  # noqa: PLR0915
    _setup_logging()
    parser = _build_parser()
    args, _ = parser.parse_known_args()

    if args.parse:
        parse(args)
        return

    if args.bump_small_domains is not None:
        bump_small_domains(args, parser)
        return

    if args.reprioritize:
        reprioritize(args)
        return

    seed_urls = _load_seed_urls(args.seed) if args.seed else []
    options = _build_options(args, seed_urls)
    logging.info("Running crawler with options: %s", options)

    pg_client = PostgresClient.from_env(max_size=max(args.worker_threads, 1))
    queue: CrawlQueue
    if args.custom_pipeline:
        url_client = UrlStoreClient.from_env()
        queue = UrlStoreQueue(url_client)
    else:
        queue = PostgresCrawlQueue(pg_client)
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

    if seed_urls:
        rows = _build_seed_rows(seed_urls)
        queue.put(rows)
        logging.info("Seeded %d URLs.", len(rows))

    if args.setup_only:
        logging.info("Setup-only requested, exiting.")
        return

    profile_enabled = args.profile_path is not None
    profile_path = (
        args.profile_path / f"worker-{args.worker_id}.pstats"
        if args.profile_path
        else None
    )
    ctx, _ = setup_context(False, crawl_queue=queue)
    try:
        with profile_scope(profile_enabled, profile_path):
            run_crawler(ctx, options)
    finally:
        pg_client.close()


def reprioritize(args):
    seed_urls = _load_seed_urls(args.seed) if args.seed else []
    scorer = get_scoring_function(
        args.url_scoring_function, frozenset(seed_urls)
    )
    priority_fn = lambda url: max(0, min(100, 100 - scorer(url)))  # noqa: E731
    pg_client = PostgresClient.from_env(max_size=1)
    queue = PostgresCrawlQueue(pg_client)
    try:
        queue.reprioritize(priority_fn)
    finally:
        pg_client.close()


def bump_small_domains(args, parser):
    if not args.seed:
        parser.error("--bump-small-domains requires --seed")
    seed_urls = _load_seed_urls(args.seed)
    pg_client = PostgresClient.from_env(max_size=1)
    queue = PostgresCrawlQueue(pg_client)
    try:
        bumped, by_domain = queue.bump_small_domains(
            args.bump_small_domains, seed_urls
        )
        for domain, count in sorted(by_domain.items(), key=lambda x: -x[1]):
            logging.info("  %s: +%d", domain, count)
        logging.info(
            "Bumped %d URLs to priority 0 (target=%d).",
            bumped, args.bump_small_domains,
        )
    finally:
        pg_client.close()


def parse(args):
    worker_processes = max(1, args.worker_threads)
    pg_client = PostgresClient.from_env(max_size=1)
    queue = PostgresCrawlQueue(pg_client)
    ctx, dumper = setup_context(False, crawl_queue=queue)
    try:
        run_parse(
            queue, ctx, args.parse_limit,
            worker_processes=worker_processes,
        )
    finally:
        dumper.dump_pandas()
        pg_client.close()


if __name__ == "__main__":
    main()
