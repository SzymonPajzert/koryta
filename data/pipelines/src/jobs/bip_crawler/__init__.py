"""BIP crawler job: harvest documents from the official gov.pl registry.

Run as `koryta_scrape_bip` (or `python -m jobs.bip_crawler`). On an empty host
table it ingests the registry first, repairs stale `.part` bundles, then drives
the coordinator in `coordinator.py`.
"""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import json
import multiprocessing
import os
import re
import time
from collections.abc import Iterator
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

from tqdm import tqdm

from jobs.bip_crawler import found
from jobs.bip_crawler.coordinator import BipCoordinator, CoordinatorOptions
from jobs.bip_crawler.people import run_people_mode
from scrapers.bip.registry import hosts_from_entries, parse_subjects_xml
from scrapers.common.fetch import use_ca_bundle
from scrapers.common.pg import PostgresClient
from scrapers.stores import BipQueue
from stores.bip_bundles import LocalBundleStore, rewrap_part
from stores.bip_queue import PostgresBipQueue
from stores.bip_registry import download_subjects_xml
from stores.tls import ca_bundle
from stores.web import RobotsCache

USER_AGENT = "KorytaBIPCrawler/0.1 (+http://koryta.pl/crawler)"
EXIT_TRY_LATER = 75
DEFAULT_OUT = Path("bip_crawl_out")
DEFAULT_XML_CACHE = Path("bip_crawl_out/registry/subjects.xml")
DEFAULT_CA_BUNDLE = Path("bip_crawl_out/tls/ca-bundle.pem")

_FRESHNESS_RE = re.compile(r"^\s*(\d+)\s*([dh])\s*$", re.IGNORECASE)


def parse_freshness(value: str | None) -> int | None:
    """'7d' / '12h' / None -> seconds (None means never re-crawl stale hosts)."""
    if not value:
        return None
    match = _FRESHNESS_RE.match(value)
    if match is None:
        raise argparse.ArgumentTypeError("freshness must look like 7d or 12h")
    amount, unit = int(match.group(1)), match.group(2).lower()
    return amount * (86400 if unit == "d" else 3600)


def _utc_time(value: str) -> datetime:
    """'2026-10-30T05:43Z' / '2026-10-30 05:43' (UTC) -> an aware datetime."""
    try:
        when = datetime.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError(
            "a time must look like 2026-10-30T05:43Z"
        ) from None
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)


def registry_xml(xml_cache: Path, *, refresh: bool) -> tuple[bytes, str]:
    """The gov.pl registry's XML (cached unless `refresh`) and where it came from."""
    if xml_cache.exists() and not refresh:
        return xml_cache.read_bytes(), f"cache {xml_cache}"
    xml = download_subjects_xml()
    xml_cache.parent.mkdir(parents=True, exist_ok=True)
    xml_cache.write_bytes(xml)
    return xml, "gov.pl"


def ingest_registry(
    bip_queue: BipQueue, xml_cache: Path, *, refresh: bool
) -> tuple[int, int, int, str]:
    """Load the gov.pl registry into `bip_hosts`.

    Returns (registry rows, hosts inserted, hosts updated, source).
    """
    xml, source = registry_xml(xml_cache, refresh=refresh)
    entries = parse_subjects_xml(xml)
    inserted, updated = bip_queue.upsert_hosts(hosts_from_entries(entries))
    return len(entries), inserted, updated, source


@contextlib.contextmanager
def single_crawler(root: Path) -> Iterator[None]:
    """Hold ``root`` for this run: the startup repair re-wraps every ``.part``
    bundle there, which is only safe when no other crawler writes to it."""
    root.mkdir(parents=True, exist_ok=True)
    with (root / ".crawl.lock").open("w") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit(
                f"another koryta_scrape_bip is using {root}; "
                "give this run its own --out"
            ) from None
        yield


def cmd_crawl(args: argparse.Namespace) -> int:
    with single_crawler(Path(args.out)):
        return _crawl(args)


def _crawl(args: argparse.Namespace) -> int:
    root = Path(args.out)
    # Servers that leave out their intermediate certificate verify against
    # this bundle (stores/tls.py); the checks themselves stay on.
    bundle, how = ca_bundle(Path(args.ca_bundle))
    use_ca_bundle(str(bundle) if bundle else None)
    print(f"certificates: {how}", flush=True)
    pg = PostgresClient.from_env(max_size=4)
    bip_queue = PostgresBipQueue(pg)
    if not args.no_registry and bip_queue.stats().get("hosts", 0) == 0:
        print("bip_hosts is empty; ingesting the gov.pl registry...", flush=True)
        entries, inserted, updated, source = ingest_registry(
            bip_queue, args.xml_cache, refresh=args.refresh_registry
        )
        print(
            f"registry: {entries} rows -> {inserted} hosts inserted, "
            f"{updated} updated ({source})",
            flush=True,
        )
    if not args.no_repair:
        # A SIGKILL/crash leaves .part bundles behind (SIGTERM flushes them).
        # Re-wrap them before crawling so their bytes are kept, not re-fetched.
        # Single-instance assumption: at startup no crawler is writing to this
        # --out, so every .part is stale and can be re-wrapped.
        counts = repair_parts(
            bip_queue,
            root,
            older_than_minutes=0,
            keep_missing=False,
        )
        if counts["repaired"] or counts["empty"] or counts["failed"]:
            print(
                f"startup repair: rewrapped {counts['repaired']}, "
                f"empty/removed {counts['empty']}, failed {counts['failed']}; "
                f"pruned {counts['pruned']} doc rows",
                flush=True,
            )
    store = LocalBundleStore(root)
    robots = RobotsCache(USER_AGENT)
    if args.people_of_interest:
        try:
            return run_people_mode(
                args, pg, bip_queue, store, robots.allowed, robots.unreachable
            )
        finally:
            pg.close()
    options = CoordinatorOptions(
        out_dir=args.out,
        workers=args.workers,
        max_pages=args.max_pages,
        max_docs=args.max_docs,
        max_depth=args.depth,
        rate_interval_s=args.rate,
        freshness_seconds=parse_freshness(args.freshness),
        run_limit=args.hosts,
        max_active_hosts=args.max_active_hosts,
        user_agent=USER_AGENT,
        max_run_seconds=args.max_minutes * 60 if args.max_minutes else None,
    )
    coordinator = BipCoordinator(
        bip_queue, store, options, robots_allowed=robots.allowed
    )
    try:
        stats = coordinator.run()
    finally:
        pg.close()
    print(json.dumps(stats.as_dict(), indent=2))
    return EXIT_TRY_LATER if coordinator.timed_out else 0


def repair_parts(
    bip_queue: BipQueue,
    root: Path,
    *,
    older_than_minutes: int,
    keep_missing: bool,
) -> dict[str, int]:
    """Re-wrap `.part` bundles left by a killed run; return per-outcome counts."""
    cutoff = time.time() - older_than_minutes * 60
    parts = sorted(p for p in root.rglob("*.part") if p.stat().st_mtime <= cutoff)
    counts = {"parts": len(parts), "repaired": 0, "empty": 0, "failed": 0, "pruned": 0}
    if not parts:
        return counts
    total = sum(p.stat().st_size for p in parts)
    workers = min(16, os.cpu_count() or 8)
    print(
        f"re-wrapping {len(parts)} stale .part bundles ({total / 1e9:.1f} GB) "
        f"with {workers} workers...",
        flush=True,
    )
    repaired = empty = failed = 0
    orphaned_shas: list[str] = []
    # spawn, not fork: workers must not inherit the parent's Postgres sockets.
    context = multiprocessing.get_context("spawn")
    with ProcessPoolExecutor(max_workers=workers, mp_context=context) as pool:
        futures = [pool.submit(rewrap_part, part, root) for part in parts]
        for future in tqdm(
            as_completed(futures), total=len(parts), desc="repair", unit="bundle"
        ):
            bundle, members, status = future.result()
            if status == "repaired":
                repaired += 1
                if not keep_missing:
                    known = set(members)
                    orphaned_shas.extend(
                        sha
                        for sha, filename in bip_queue.docs_for_bundle(bundle)
                        if filename not in known
                    )
            elif status == "empty":
                empty += 1
            elif status == "failed":
                failed += 1
    counts.update(
        repaired=repaired,
        empty=empty,
        failed=failed,
        pruned=bip_queue.delete_docs(orphaned_shas) if orphaned_shas else 0,
    )
    return counts


def cmd_repair(args: argparse.Namespace) -> int:
    """Recover `.part` bundles left by a killed run, without re-downloading."""
    pg = PostgresClient.from_env()
    try:
        counts = repair_parts(
            PostgresBipQueue(pg),
            Path(args.out),
            older_than_minutes=args.older_than_minutes,
            keep_missing=args.keep_missing,
        )
    finally:
        pg.close()
    print(
        f"rewrapped {counts['repaired']}, empty/removed {counts['empty']}, "
        f"failed {counts['failed']}; pruned {counts['pruned']} doc rows "
        f"whose member was truncated"
    )
    return 0


def cmd_stats(args: argparse.Namespace) -> int:
    pg = PostgresClient.from_env()
    try:
        bip_queue = PostgresBipQueue(pg)
        stats = bip_queue.stats()
        rates = bip_queue.recent_rates()
    finally:
        pg.close()
    for key, value in stats.items():
        if key == "doc_bytes":
            print(f"{key:16} {float(value) / 1e9:.1f} GB")  # type: ignore[arg-type]
        else:
            print(f"{key:16} {value}")
    print(
        f"\nlast {rates['window_minutes']} min: "
        f"pages={rates['pages']} ({rates['pages_per_min']}/min)  "
        f"new docs={rates['docs']} ({rates['docs_per_min']}/min)  "
        f"hosts done={rates['hosts']}  hosts with docs={rates['doc_hosts']}  "
        f"{rates['bytes'] / 1e9:.2f} GB"
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="koryta_scrape_bip")
    sub = parser.add_subparsers(dest="command", required=True)

    crawl = sub.add_parser("crawl", help="crawl hosts and harvest documents")
    crawl.add_argument("--out", type=Path, default=DEFAULT_OUT)
    crawl.add_argument("--xml-cache", type=Path, default=DEFAULT_XML_CACHE)
    crawl.add_argument(
        "--ca-bundle",
        type=Path,
        default=DEFAULT_CA_BUNDLE,
        help="where to keep curl's roots plus Mozilla's intermediate certificates "
        "(rebuilt weekly)",
    )
    crawl.add_argument(
        "--refresh-registry",
        action="store_true",
        help="re-download the registry when bootstrapping an empty host table",
    )
    crawl.add_argument(
        "--no-registry",
        action="store_true",
        help="do not bootstrap the host table from the registry when it is empty",
    )
    crawl.add_argument("--workers", type=int, default=8)
    crawl.add_argument("--max-active-hosts", type=int, default=50)
    crawl.add_argument("--hosts", type=int, default=None, help="limit hosts this run")
    crawl.add_argument("--freshness", type=str, default=None, help="e.g. 7d, 12h")
    crawl.add_argument("--max-pages", type=int, default=150)
    crawl.add_argument("--max-docs", type=int, default=500)
    crawl.add_argument("--depth", type=int, default=4)
    crawl.add_argument(
        "--rate", type=float, default=1.0, help="seconds between hits on one host"
    )
    crawl.add_argument(
        "--max-minutes",
        type=float,
        default=None,
        help="stop gracefully after this many minutes (exit 75 when work remains)",
    )
    crawl.add_argument(
        "--no-repair",
        action="store_true",
        help="skip the startup re-wrap of .part bundles left by a killed run",
    )
    people = crawl.add_argument_group(
        "people mode",
        "Look up the candidacies of BipPeopleOfInterest unit by unit instead of "
        "the blind crawl; --workers is units at once, --rate and --max-minutes apply.",
    )
    people.add_argument(
        "--people-of-interest", action="store_true", help="run the people mode"
    )
    people.add_argument(
        "--poi-max-priority",
        type=int,
        default=None,
        help="only candidacies up to this priority: 0 a draft page without a birth "
        "date, 1 a draft with one, 2 a person not on the site yet, 3 a published page",
    )
    people.add_argument(
        "--poi-limit", type=int, default=None, help="at most this many candidacies"
    )
    people.add_argument(
        "--poi-refresh",
        action="store_true",
        help="search found and not-found ones again",
    )
    people.add_argument(
        "--poi-retry",
        default="unreachable,error,timeout,no_seed,throttled",
        help="not_found reasons to search again (comma-separated; 'unconfirmed' for "
        "those only unnamed files were found for); default unreachable,error,timeout,"
        "no_seed,throttled",
    )
    people.add_argument(
        "--poi-retry-before",
        type=_utc_time,
        default=None,
        help="with --poi-retry, only the candidacies last searched before this time "
        "(ISO 8601, UTC unless it says): those an older walk settled, e.g. "
        "2026-10-30T05:43Z",
    )
    people.add_argument(
        "--unit-pages",
        type=int,
        default=150,
        help="pages a unit's walk reads at least (default 150)",
    )
    people.add_argument(
        "--pages-per-candidacy",
        type=int,
        default=15,
        help="pages a unit's walk reads for each of its candidacies, between "
        "--unit-pages and --max-unit-pages (default 15)",
    )
    people.add_argument(
        "--max-unit-pages",
        type=int,
        default=1000,
        help="pages a unit's walk reads at most (default 1000)",
    )
    people.add_argument(
        "--max-unit-minutes",
        type=float,
        default=30,
        help="a unit's walk stops after this many minutes, its candidacies left "
        "not_found:budget (default 30; 0 for no limit)",
    )
    people.add_argument(
        "--max-per-host",
        type=int,
        default=1,
        help="units searched at once on one start host (default 1: they share "
        "its rate)",
    )
    people.add_argument(
        "--max-per-server",
        type=int,
        default=2,
        help="units searched at once on one server, the address their start hosts "
        "resolve to (default 2: a hosting platform serves dozens of BIPs)",
    )
    people.add_argument(
        "--known-urls",
        default=None,
        help="newline-delimited JSON of known URLs ({url, category}, e.g. the blind "
        "crawl's BipUrlsClassified): declaration-like ones seed each unit's walk",
    )
    people.add_argument(
        "--no-render",
        action="store_true",
        help="read JavaScript-drawn pages as their HTML instead of rendering them "
        "in headless Chromium (needs the render dependency group)",
    )
    people.add_argument(
        "--render-workers",
        type=int,
        default=2,
        help="headless browsers rendering at once (default 2)",
    )
    people.add_argument(
        "--no-sitemaps",
        action="store_true",
        help="do not read the BIPs' sitemaps for declaration pages before walking",
    )
    people.add_argument(
        "--per-person",
        type=int,
        default=3,
        help="files downloaded per candidacy (default 3)",
    )
    crawl.set_defaults(func=cmd_crawl)

    repair = sub.add_parser(
        "repair", help="recover .part bundles left by an interrupted run"
    )
    repair.add_argument("--out", type=Path, default=DEFAULT_OUT)
    repair.add_argument(
        "--older-than-minutes",
        type=int,
        default=10,
        help="only touch .part files older than this (live bundles stay)",
    )
    repair.add_argument(
        "--keep-missing",
        action="store_true",
        help="do not delete doc rows whose member was truncated",
    )
    repair.set_defaults(func=cmd_repair)

    stats = sub.add_parser("stats", help="print bip_queue statistics")
    stats.set_defaults(func=cmd_stats)

    found.add_parser(sub)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)
