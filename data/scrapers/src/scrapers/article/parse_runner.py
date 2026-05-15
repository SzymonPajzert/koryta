"""Batch HTML parser: reads done crawl URLs, prints stats, writes JSONL."""

from __future__ import annotations

import csv
import logging
from collections import Counter
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import TYPE_CHECKING

from tqdm import tqdm

from entities.article import ParsedArticle
from entities.util import NormalizedParse
from scrapers.article.parse import extract_article_content
from scrapers.stores import Context, CrawlQueue

if TYPE_CHECKING:
    pass

_URL_PARSING_CSV = Path(__file__).parent / "test_data" / "url_parsing.csv"

# Per-process GCS client, initialized once per worker process.
_process_gcs_client = None


def _init_worker(storage_type: str) -> None:
    global _process_gcs_client
    if storage_type == "gcs":
        from google.cloud import storage as gcs
        _process_gcs_client = gcs.Client()


def _parse_worker(
    storage_path: str,
    storage_type: str,
    local_output_str: str,
    uid: str,
    url: str,
) -> ParsedArticle:
    global _process_gcs_client
    if storage_type == "gcs":
        from stores.storage import BUCKET  # type: ignore[import]
        blob = _process_gcs_client.bucket(BUCKET).blob(storage_path)
        html_bytes = blob.download_as_bytes()
    else:
        from stores.config import PROJECT_ROOT  # type: ignore[import]
        html_bytes = (Path(PROJECT_ROOT) / local_output_str / storage_path).read_bytes()

    result = extract_article_content(html_bytes)
    pub_date = result.get("publication_date")
    return ParsedArticle(
        uid=uid,
        url=url,
        storage_path=storage_path,
        is_article=result.get("is_article"),
        title=result.get("title"),
        publication_date=pub_date.isoformat() if pub_date else None,
        article_content=result.get("article_content", ""),
    )


def _load_test_domains() -> set[str]:
    with _URL_PARSING_CSV.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        domains: set[str] = set()
        for row in reader:
            raw = (row.get("Domena") or "").strip()
            if raw:
                try:
                    domains.add(NormalizedParse.parse(raw).hostname_normalized)
                except Exception:
                    pass
    return domains


def _print_media_type_stats(counts: Counter) -> None:
    print("\n=== Media type stats ===")
    total = sum(counts.values())
    for media_type, count in counts.most_common():
        label = media_type or "(none)"
        print(f"  {label:<50} {count:>6}  ({100 * count / total:.1f}%)")
    print(f"  {'TOTAL':<50} {total:>6}")


def _print_domain_stats(counts: Counter, test_domains: set[str]) -> None:
    print("\n=== Domain stats ===")
    total = sum(counts.values())
    for domain, count in counts.most_common():
        covered = "*" if domain in test_domains else " "
        print(f"  {covered} {domain:<55} {count:>6}  ({100 * count / total:.1f}%)")
    print("\n  (* = covered by url_parsing.csv)")


def _print_coverage(domain_counts: Counter, test_domains: set[str]) -> None:
    if not domain_counts:
        print("\n=== Test coverage ===\n  No done URLs.")
        return
    all_domains = set(domain_counts.keys())
    covered = all_domains & test_domains
    total_urls = sum(domain_counts.values())
    covered_urls = sum(domain_counts[d] for d in covered)
    print(
        f"\n=== Test coverage ===\n"
        f"  Domains with test data: {len(covered)}/{len(all_domains)}\n"
        f"  URLs from tested domains: {covered_urls}/{total_urls} "
        f"({100 * covered_urls / total_urls:.1f}%)"
    )


def run_parse(
    queue: CrawlQueue,
    ctx: Context,
    parse_limit: int,
    storage_type: str,
    local_output: Path | None = None,
    worker_processes: int = 1,
) -> None:
    """Fetch done URLs, print stats, parse HTML, emit ParsedArticle entities.

    Caller is responsible for calling dumper.dump_pandas() after this returns.
    """
    logging.info("Fetching all done URLs from DB...")
    all_done = queue.get_done_urls()
    logging.info("Fetched %d done URLs.", len(all_done))

    media_type_counts: Counter = Counter(d.media_type for d in all_done)
    domain_counts: Counter = Counter()
    for d in tqdm(all_done, desc="Counting domains", unit="url"):
        try:
            domain_counts[NormalizedParse.parse(d.url).hostname_normalized] += 1
        except Exception:
            domain_counts["(unparseable)"] += 1

    test_domains = _load_test_domains()

    _print_media_type_stats(media_type_counts)
    _print_domain_stats(domain_counts, test_domains)
    _print_coverage(domain_counts, test_domains)

    to_parse = all_done[:parse_limit]
    print(f"\nParsing {len(to_parse)} URLs (limit={parse_limit}, workers={worker_processes})...")

    local_output_str = str(local_output) if local_output else "crawler_output"
    errors = 0

    with ProcessPoolExecutor(
        max_workers=worker_processes,
        initializer=_init_worker,
        initargs=(storage_type,),
    ) as executor:
        futures = {
            executor.submit(_parse_worker, done.storage_path, storage_type, local_output_str, done.uid, done.url): done
            for done in to_parse
        }
        with tqdm(total=len(to_parse), desc="Parsing HTML", unit="page") as bar:
            for future in as_completed(futures):
                done = futures[future]
                try:
                    ctx.io.output_entity(future.result())
                except Exception as exc:
                    logging.warning("Failed to parse %s: %s", done.url, exc)
                    errors += 1
                bar.update(1)

    logging.info("Parsed %d pages (%d errors).", len(to_parse) - errors, errors)
