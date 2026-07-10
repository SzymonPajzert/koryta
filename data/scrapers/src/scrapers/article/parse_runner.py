"""Batch HTML parser: reads done crawl URLs, prints stats, writes JSONL."""

from __future__ import annotations

import csv
import logging
import mimetypes
import multiprocessing
import queue as _queue
from collections import Counter
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from tqdm import tqdm

from conductor import Conductor, make_reader_conductor  # type: ignore[attr-defined]
from entities.article import ParsedArticle
from entities.util import NormalizedParse
from scrapers.article.parse import extract_article_content
from scrapers.stores import Context, CrawlQueue, DoneUrl
from scrapers.stores.file import NotInMirrorError

_URL_PARSING_CSV = Path(__file__).parent / "test_data" / "url_parsing.csv"

# Per-process globals, set once in _init_worker.
_process_conductor: Conductor | None = None
_result_queue: multiprocessing.Queue | None = None


def _init_worker(out_q: multiprocessing.Queue) -> None:
    global _process_conductor, _result_queue
    _process_conductor = make_reader_conductor()
    _result_queue = out_q


def _parse_domain_worker(host: str, batch: list[DoneUrl]) -> None:
    """Extract a domain's tar, parse every URL in batch, delete extraction.

    Puts exactly len(batch) items into out_q: a ParsedArticle on success,
    None on any per-URL failure. Domain-level failures also put len(batch)
    Nones so the main process always receives the expected count.
    """
    assert _process_conductor is not None
    assert _result_queue is not None
    mirror = _process_conductor.mirror
    out_q = _result_queue

    try:
        mirror.ensure_extracted(host)
    except NotInMirrorError as exc:
        logging.warning("Domain %s not in mirror: %s", host, exc)
        for _ in batch:
            out_q.put(None)
        return

    for done in batch:
        try:
            html_bytes = mirror.get(done.url)
            result = extract_article_content(html_bytes)
            pub_date = result.get("publication_date")
            out_q.put(
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
            out_q.put(None)

    mirror.delete_extracted(host)


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


def _is_html(media_type: str | None) -> bool:
    if not media_type:
        return False
    base_type = media_type.split(";")[0].strip()
    return mimetypes.guess_extension(base_type) in {".html", ".htm"}


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

    to_parse = [d for d in all_done if _is_html(d.media_type)][:parse_limit]
    print(
        f"\nParsing {len(to_parse)} URLs "
        f"(limit={parse_limit}, workers={worker_processes})..."
    )

    by_domain: dict[str, list[DoneUrl]] = {}
    for done in to_parse:
        try:
            host = NormalizedParse.parse(done.url).hostname_normalized
        except Exception:
            host = "(unparseable)"
        by_domain.setdefault(host, []).append(done)

    # LPT: largest domains first so workers stay busy and no big domain
    # becomes a long-tail bottleneck.
    domains_sorted = sorted(by_domain.items(), key=lambda x: -len(x[1]))

    errors = 0
    not_in_mirror = 0

    result_queue: multiprocessing.Queue = multiprocessing.Queue()

    with ProcessPoolExecutor(
        max_workers=worker_processes,
        initializer=_init_worker,
        initargs=(result_queue,),
    ) as executor:
        futures = [
            executor.submit(_parse_domain_worker, host, batch)
            for host, batch in domains_sorted
        ]

        with tqdm(total=len(to_parse), desc="Parsing HTML", unit="page") as bar:
            received = 0
            while received < len(to_parse):
                try:
                    item = result_queue.get(timeout=30)
                except _queue.Empty:
                    if all(f.done() for f in futures):
                        break  # all workers finished; a crash dropped some items
                    continue
                received += 1
                bar.update(1)
                if item is not None:
                    ctx.io.output_entity(item)

        for future in as_completed(futures):
            try:
                future.result()
            except Exception as exc:
                logging.error("Domain worker crashed: %s", exc)

    logging.info(
        "Parsed %d pages (%d errors, %d not in mirror).",
        len(to_parse) - errors - not_in_mirror,
        errors,
        not_in_mirror,
    )
