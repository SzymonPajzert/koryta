"""CLI for the BIP document crawler (Postgres bip_queue, coordinator + fetchers).

Top-level script like `crawl_cli.py`: outside the import-linter layers, so it
wires the concrete Postgres client, robots cache and bundle store.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

from scrapers.bip.bip_queue import BipQueue
from scrapers.bip.coordinator import BipCoordinator, CoordinatorOptions
from scrapers.bip.registry import hosts_from_entries, parse_subjects_xml
from scrapers.bip.store import LocalBundleStore, rewrap_part
from scrapers.common.pg import PostgresClient
from stores.bip_registry import download_subjects_xml
from stores.web import RobotsCache

USER_AGENT = "KorytaBIPCrawler/0.1 (+http://koryta.pl/crawler)"
DEFAULT_OUT = Path("bip_crawl_out")
DEFAULT_XML_CACHE = Path("bip_crawl_out/registry/subjects.xml")

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


def cmd_registry(args: argparse.Namespace) -> int:
    cache: Path = args.xml_cache
    if cache.exists() and not args.refresh:
        xml = cache.read_bytes()
        source = f"cache {cache}"
    else:
        xml = download_subjects_xml()
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(xml)
        source = "gov.pl"
    entries = parse_subjects_xml(xml)
    hosts = hosts_from_entries(entries)
    pg = PostgresClient.from_env()
    try:
        inserted, updated = BipQueue(pg).upsert_hosts(hosts)
        stats = BipQueue(pg).stats()
    finally:
        pg.close()
    print(f"source:        {source}")
    print(f"registry rows: {len(entries)}")
    print(
        f"hosts:         {stats.get('hosts')} "
        f"(inserted {inserted}, updated {updated})"
    )
    return 0


def cmd_crawl(args: argparse.Namespace) -> int:
    root = Path(args.out)
    pg = PostgresClient.from_env(max_size=4)
    bip_queue = BipQueue(pg)
    if not args.no_repair:
        # A SIGKILL/crash leaves .part bundles behind (SIGTERM flushes them).
        # Re-wrap them before crawling so their bytes are kept, not re-fetched.
        counts = repair_parts(
            bip_queue,
            root,
            older_than_minutes=args.repair_older_than,
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
    )
    coordinator = BipCoordinator(
        bip_queue, store, options, robots_allowed=robots.allowed
    )
    try:
        stats = coordinator.run()
    finally:
        pg.close()
    print(json.dumps(stats.as_dict(), indent=2))
    return 0


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
    repaired = empty = failed = 0
    orphaned_shas: list[str] = []
    for index, part in enumerate(parts, 1):
        bundle, members, status = rewrap_part(part, root)
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
        if index % 200 == 0:
            print(f"  {index}/{len(parts)} rewrapped={repaired}", flush=True)
    pruned = bip_queue.delete_docs(orphaned_shas) if orphaned_shas else 0
    return {
        "parts": len(parts),
        "repaired": repaired,
        "empty": empty,
        "failed": failed,
        "pruned": pruned,
    }


def cmd_repair(args: argparse.Namespace) -> int:
    """Recover `.part` bundles left by a killed run, without re-downloading."""
    pg = PostgresClient.from_env()
    try:
        counts = repair_parts(
            BipQueue(pg),
            Path(args.out),
            older_than_minutes=args.older_than_minutes,
            keep_missing=args.keep_missing,
        )
    finally:
        pg.close()
    print(
        f"stale partial bundles: {counts['parts']} "
        f"(older than {args.older_than_minutes} min; live ones are left alone)"
    )
    print(
        f"rewrapped {counts['repaired']}, empty/removed {counts['empty']}, "
        f"failed {counts['failed']}; pruned {counts['pruned']} doc rows "
        f"whose member was truncated"
    )
    return 0


def cmd_stats(args: argparse.Namespace) -> int:
    pg = PostgresClient.from_env()
    try:
        bip_queue = BipQueue(pg)
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

    registry = sub.add_parser("registry", help="ingest the gov.pl BIP registry")
    registry.add_argument("--xml-cache", type=Path, default=DEFAULT_XML_CACHE)
    registry.add_argument("--refresh", action="store_true")
    registry.set_defaults(func=cmd_registry)

    crawl = sub.add_parser("crawl", help="crawl hosts and harvest documents")
    crawl.add_argument("--out", type=Path, default=DEFAULT_OUT)
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
        "--no-repair",
        action="store_true",
        help="skip the startup re-wrap of .part bundles left by a killed run",
    )
    crawl.add_argument(
        "--repair-older-than",
        type=int,
        default=10,
        help="only repair .part files older than this many minutes",
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
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
