"""Batch HTML parser: reads done crawl URLs, prints stats, writes JSONL."""

from __future__ import annotations

import csv
import logging
from collections import Counter
from pathlib import Path
from typing import Callable

from tqdm import tqdm

from entities.article import ParsedArticle
from entities.util import NormalizedParse
from scrapers.article.parse import extract_article_content
from scrapers.stores import Context, CrawlQueue

_URL_PARSING_CSV = Path(__file__).parent / "test_data" / "url_parsing.csv"


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
    read_html: Callable[[str], bytes],
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
    print(f"\nParsing {len(to_parse)} URLs (limit={parse_limit})...")

    errors = 0
    for done in tqdm(to_parse, desc="Parsing HTML", unit="page"):
        try:
            html_bytes = read_html(done.storage_path)
            result = extract_article_content(html_bytes)
            pub_date = result.get("publication_date")
            ctx.io.output_entity(
                ParsedArticle(
                    uid=done.uid,
                    url=done.url,
                    storage_path=done.storage_path,
                    is_article=result.get("is_article"),
                    title=result.get("title"),
                    publication_date=pub_date.isoformat() if pub_date else None,
                    article_content=result.get("article_content", ""),
                )
            )
        except Exception as exc:
            logging.warning("Failed to parse %s: %s", done.url, exc)
            errors += 1

    logging.info("Parsed %d pages (%d errors).", len(to_parse) - errors, errors)
