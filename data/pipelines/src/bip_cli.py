"""CLI for the BIP document crawler (registry ingest, crawl, stats).

Top-level script on purpose: like `crawl_cli.py` and `koryta.py` it is outside
the import-linter layers, so it may use `os`/`sys`/`urllib` and wire the
concrete HTTP, robots and storage implementations around the pure logic in
`scrapers.bip`.
"""

from __future__ import annotations

import argparse
import logging
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib import robotparser

from curl_cffi import requests

from entities.util import NormalizedParse
from scrapers.bip.crawler import FetchResult, crawl_host
from scrapers.bip.frontier import Frontier
from scrapers.bip.models import CrawlOptions, HostCrawlStats
from scrapers.bip.ratelimit import HostRateLimiter
from scrapers.bip.registry import hosts_from_entries, parse_subjects_xml
from scrapers.bip.store import LocalBundleStore, write_run_manifest
from stores.bip_registry import download_subjects_xml

DEFAULT_DB = Path("bip_crawl_out/frontier.db")
DEFAULT_OUT = Path("bip_crawl_out")
DEFAULT_XML_CACHE = Path("bip_crawl_out/registry/subjects.xml")
USER_AGENT = "KorytaBIPCrawler/0.1 (+http://koryta.pl/crawler)"
MAX_DOC_BYTES = 60_000_000


class RobotsCache:
    """robots.txt per host. 404/no rules means allow; unreachable means deny."""

    def __init__(self, user_agent: str) -> None:
        self.user_agent = user_agent
        self._cache: dict[str, robotparser.RobotFileParser | None] = {}
        self._denied_unreachable: set[str] = set()
        self._lock = threading.Lock()

    def allowed(self, url: str) -> bool:
        host = NormalizedParse.parse(url).hostname_normalized
        parser = self._get(host)
        if host in self._denied_unreachable:
            return False
        if parser is None:
            return True
        return parser.can_fetch(self.user_agent, url)

    def _get(self, host: str) -> robotparser.RobotFileParser | None:
        with self._lock:
            if host in self._cache:
                return self._cache[host]
        parser: robotparser.RobotFileParser | None = None
        reachable = False
        for scheme in ("https", "http"):
            try:
                response = requests.get(
                    f"{scheme}://{host}/robots.txt",
                    impersonate="chrome136",
                    headers={"User-Agent": self.user_agent},
                    timeout=10,
                )
            except Exception:
                continue
            reachable = True
            if response.status_code == 404 or not response.text.strip():
                break
            if response.status_code == 200:
                parser = robotparser.RobotFileParser()
                parser.parse(response.text.splitlines())
                break
        with self._lock:
            if not reachable:
                self._denied_unreachable.add(host)
            self._cache[host] = parser
        return parser


def make_fetch(options: CrawlOptions):
    def fetch(url: str, timeout: float, user_agent: str) -> FetchResult:
        try:
            response = requests.get(
                url,
                impersonate="chrome136",
                headers={"User-Agent": user_agent},
                timeout=timeout,
                allow_redirects=True,
            )
        except Exception as exc:
            return FetchResult(
                url=url, status=0, content_type="", content=b"", error=str(exc)[:200]
            )
        content = response.content
        if len(content) > MAX_DOC_BYTES:
            content = content[:MAX_DOC_BYTES]
        return FetchResult(
            url=str(response.url),
            status=response.status_code,
            content_type=response.headers.get("Content-Type", ""),
            content=content,
        )

    return fetch


def cmd_registry(args: argparse.Namespace) -> int:
    cache: Path = args.xml_cache
    xml: bytes
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
    frontier = Frontier(args.db)
    inserted, updated = frontier.upsert_hosts(hosts)
    unique_urls = len({entry.url.rstrip("/") for entry in entries})
    stats = frontier.stats()
    frontier.close()
    print(f"source:        {source}")
    print(f"registry rows: {len(entries)}")
    print(f"unique urls:   {unique_urls}")
    print(f"hosts:         {stats['hosts']} (inserted {inserted}, updated {updated})")
    print(f"spread:        {len(entries) - unique_urls} duplicate urls")
    return 0


def cmd_crawl(args: argparse.Namespace) -> int:
    options = CrawlOptions(
        max_pages_per_host=args.max_pages,
        max_docs_per_host=args.max_docs,
        max_depth=args.depth,
        per_host_min_interval_s=args.rate,
        user_agent=USER_AGENT,
    )
    frontier = Frontier(args.db)
    hosts = frontier.iter_hosts(
        limit=args.limit, offset=args.offset, status=args.status
    )
    if not hosts:
        print("no hosts to crawl")
        return 1
    store = LocalBundleStore(args.out)
    robots = RobotsCache(USER_AGENT)
    limiter = HostRateLimiter(options.per_host_min_interval_s)
    fetch = make_fetch(options)
    results: list[HostCrawlStats] = []

    print(f"crawling {len(hosts)} hosts with {args.workers} workers "
          f"(max {args.max_pages} pages/host, rate {args.rate}/s)")
    logging.basicConfig(level=logging.WARNING)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(
                crawl_host,
                host,
                frontier=frontier,
                store=store,
                fetch=fetch,
                robots_allowed=robots.allowed,
                rate_limiter=limiter,
                options=options,
            ): host
            for host in hosts
        }
        for future in as_completed(futures):
            try:
                results.append(future.result())
            except Exception as exc:  # noqa: BLE001
                host = futures[future]
                print(f"  [error] {host.host}: {exc}")
                results.append(HostCrawlStats(host=host.host, status="failed"))
    store.flush()
    summaries = [r.as_dict() for r in results]
    write_run_manifest(args.out, summaries)
    _print_crawl_summary(results, frontier)
    frontier.close()
    return 0


def _print_crawl_summary(
    results: list[HostCrawlStats], frontier: Frontier
) -> None:
    ok = [r for r in results if r.status == "ok"]
    docs = sum(r.docs_stored for r in results)
    dupes = sum(r.docs_duplicate for r in results)
    pages = sum(r.pages_fetched for r in results)
    errors = sum(r.errors for r in results)
    denied = sum(r.robots_denied for r in results)
    mb = sum(r.bytes_stored for r in results) / 1_000_000
    print("\n=== crawl summary ===")
    print(f"hosts:       {len(results)} ({len(ok)} ok)")
    print(f"pages:       {pages}")
    print(f"docs new:    {docs} ({mb:.1f} MB)")
    print(f"docs dupes:  {dupes}")
    print(f"errors:      {errors}")
    print(f"robots gap:  {denied}")
    stats = frontier.stats()
    print(f"frontier:    {stats['hosts']} hosts, {stats['urls']} urls, "
          f"{stats['docs']} docs")


def cmd_stats(args: argparse.Namespace) -> int:
    frontier = Frontier(args.db)
    stats = frontier.stats()
    print(f"hosts: {stats['hosts']}")
    print(f"urls:  {stats['urls']}")
    print(f"docs:  {stats['docs']} ({stats['doc_bytes'] / 1_000_000:.1f} MB)")
    for row in frontier.conn.execute(
        "SELECT status, COUNT(*) FROM hosts GROUP BY status ORDER BY 2 DESC"
    ):
        print(f"  hosts {row[0]:10} {row[1]}")
    for row in frontier.conn.execute(
        "SELECT host, COUNT(*) c FROM docs GROUP BY host ORDER BY c DESC LIMIT 10"
    ):
        print(f"  docs  {row[0]:45} {row[1]}")
    frontier.close()
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="koryta_scrape_bip")
    sub = parser.add_subparsers(dest="command", required=True)

    registry = sub.add_parser("registry", help="ingest the gov.pl BIP registry")
    registry.add_argument("--db", type=Path, default=DEFAULT_DB)
    registry.add_argument("--xml-cache", type=Path, default=DEFAULT_XML_CACHE)
    registry.add_argument("--refresh", action="store_true")
    registry.set_defaults(func=cmd_registry)

    crawl = sub.add_parser("crawl", help="crawl hosts and harvest documents")
    crawl.add_argument("--db", type=Path, default=DEFAULT_DB)
    crawl.add_argument("--out", type=Path, default=DEFAULT_OUT)
    crawl.add_argument("--limit", type=int, default=100)
    crawl.add_argument("--offset", type=int, default=0)
    crawl.add_argument("--status", type=str, default="new")
    crawl.add_argument("--workers", type=int, default=8)
    crawl.add_argument("--max-pages", type=int, default=200)
    crawl.add_argument("--max-docs", type=int, default=500)
    crawl.add_argument("--depth", type=int, default=4)
    crawl.add_argument("--rate", type=float, default=1.0)
    crawl.set_defaults(func=cmd_crawl)

    stats = sub.add_parser("stats", help="print frontier statistics")
    stats.add_argument("--db", type=Path, default=DEFAULT_DB)
    stats.set_defaults(func=cmd_stats)
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
