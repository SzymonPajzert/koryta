from __future__ import annotations

import argparse
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

    ctx, _ = _setup_context(False, crawl_queue=queue)
    run_crawler(ctx, options)


if __name__ == "__main__":
    main()
