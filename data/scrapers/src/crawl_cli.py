from __future__ import annotations

import argparse
import csv
import json
import logging
import os
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
    parser.add_argument("--setup-only", action="store_true",
                        help="Only apply seed/blocked/reset actions, then exit.")
    parser.add_argument("--profile", action="store_true",
                        help="Enable cProfile and write stats to --profile-out.")
    parser.add_argument("--profile-out", type=Path,
                        help="Path to write cProfile .pstats output.")
    parser.add_argument("--metrics-out", type=Path,
                        help="Path to write per-worker timing metrics as JSON.")
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

    queue = PostgresCrawlQueue.from_env(
        host=os.getenv("POSTGRESS_HOST", "localhost"),
        database=os.getenv("POSTGRES_DB", "crawler_db"),
        user=os.getenv("POSTGRES_USER", "crawler_user"),
        password=os.getenv("POSTGRESS_PASSWORD", "crawler_password"),
        port=int(os.getenv("POSTGRES_PORT", "5432")),
    )
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

    if args.setup_only:
        logging.info("Setup-only requested, exiting.")
        return

    ctx, _ = _setup_context(False, crawl_queue=queue)
    metrics = None
    if args.profile:
        import cProfile

        profile_path = args.profile_out or Path(f"{options.worker_id}.pstats")
        profiler = cProfile.Profile()
        profiler.enable()
        try:
            metrics = run_crawler(ctx, options)
        finally:
            profiler.disable()
            profiler.dump_stats(str(profile_path))
            logging.info("Wrote profile to %s", profile_path)
    else:
        metrics = run_crawler(ctx, options)

    if args.metrics_out and metrics is not None:
        payload = {
            "worker_id": metrics.worker_id,
            "started_at": metrics.started_at.isoformat(),
            "finished_at": metrics.finished_at.isoformat() if metrics.finished_at else None,
            "total_entries": metrics.total_entries,
            "successes": metrics.successes,
            "failures": metrics.failures,
            "rate_limit_skips": metrics.rate_limit_skips,
            "request_time_s": metrics.request_time_s,
            "parse_time_s": metrics.parse_time_s,
            "upload_time_s": metrics.upload_time_s,
            "total_runtime_s": metrics.total_runtime_s,
        }
        if metrics.total_runtime_s > 0:
            payload["request_time_pct"] = metrics.request_time_s / metrics.total_runtime_s
            payload["parse_time_pct"] = metrics.parse_time_s / metrics.total_runtime_s
            payload["upload_time_pct"] = metrics.upload_time_s / metrics.total_runtime_s
            payload["other_time_s"] = (
                metrics.total_runtime_s
                - metrics.request_time_s
                - metrics.parse_time_s
                - metrics.upload_time_s
            )
            payload["other_time_pct"] = payload["other_time_s"] / metrics.total_runtime_s
        args.metrics_out.parent.mkdir(parents=True, exist_ok=True)
        args.metrics_out.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
        logging.info("Wrote metrics to %s", args.metrics_out)


if __name__ == "__main__":
    main()
