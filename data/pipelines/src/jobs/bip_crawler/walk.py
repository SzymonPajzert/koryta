"""`koryta_scrape_bip walk` and `plan`: try the people mode on a few units, and
size a chunk, without touching what the crawl keeps.

    koryta_scrape_bip walk 020800                    # every candidacy of the unit
    koryta_scrape_bip walk 020800,021203 --no-render
    koryta_scrape_bip walk 246201 --person bieda --json /tmp/bytom.json
    koryta_scrape_bip walk 021203 --start https://bip.lwowekslaski.pl/
    koryta_scrape_bip plan                           # what the next chunk takes
    koryta_scrape_bip plan --poi-retry robots --poi-units @units.txt

``walk`` searches the units' candidacies on the night's newest list as a chunk
would (`people.people_search`: the starts in unit_starts.csv, robots.txt and
its exceptions, identity, sitemaps, the renderer, a host's rate), with the code
of the checkout it runs from, into memory. The files go to a scratch folder,
deleted at the end, and nothing reaches the crawl's Postgres, its bundles or
the shared cache: it runs beside a chunk, from any workspace (several at once
from one checkout with --list, which reads a saved copy of the list instead of
restoring the newest into the checkout), and shows each
candidacy's outcome and the files that named them before a chunk takes the
unit. --start and --declarations try an address for the one unit walked, as a
row in unit_starts.csv would, before it goes in the file. Known URLs
(--known-urls) are left out unless given: the chunk's file is 0.7 GB.

``plan`` says what ``crawl --people-of-interest`` with the same selection flags
would search, by outcome, priority and unit. It reads the crawl's Postgres and
creates nothing in it.
"""

from __future__ import annotations

import argparse
import faulthandler
import json
import shutil
import sys
import tempfile
import unicodedata
from collections import Counter
from collections.abc import Collection, Iterable
from dataclasses import asdict
from pathlib import Path
from typing import Any

from conductor import setup_context
from jobs.bip_crawler import robots_exceptions
from jobs.bip_crawler.identity import Agents
from jobs.bip_crawler.people import people_search, selected, server_of
from jobs.bip_crawler.people_list import (
    list_policy,
    outcomes,
    read_list,
    read_list_file,
)
from scrapers.common.fetch import use_ca_bundle
from scrapers.common.pg import PostgresClient
from scrapers.stores import DocRow, PersonRow, with_outcomes
from stores.bip_bundles import LocalBundleStore
from stores.bip_people import MemoryBipPeopleStore, read_searched
from stores.tls import ca_bundle
from stores.web import RobotsCache


class MemoryDocIndex:
    """The files a walk downloaded, by content, kept in memory
    (`people.DocIndex`)."""

    def __init__(self) -> None:
        self.bundles: dict[str, str] = {}

    def doc_bundle(self, sha256: str) -> str | None:
        return self.bundles.get(sha256)

    def record_docs(self, docs: list[DocRow], crawl_id: str) -> int:
        """Keep the ones not seen yet, as ``bip_docs`` does; how many."""
        new = 0
        for doc in docs:
            if doc.sha256 not in self.bundles:
                self.bundles[doc.sha256] = doc.bundle
                new += 1
        return new


def folded(text: str) -> str:
    """Lower case, without diacritics: "bieda" finds "BIEDA", "lukasz" "Łukasz"."""
    text = text.lower().replace("ł", "l")
    return "".join(
        c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)
    )


def chosen(
    people: Iterable[PersonRow],
    units: Collection[str],
    keys: Collection[str] | None = None,
    person: str | None = None,
) -> list[PersonRow]:
    """The candidacies of ``units`` on the list; only ``keys``, and only those
    whose name holds ``person``, when given."""
    wanted = folded(person) if person else ""
    return [
        row
        for row in people
        if row.unit in units
        and (keys is None or row.key in keys)
        and wanted in folded(f"{row.first_name} {row.last_name}")
    ]


def report(rows: list[PersonRow], store: MemoryBipPeopleStore) -> dict[str, Any]:
    """Each unit's walk, and each candidacy's outcome with the files tried for
    it, best first."""
    searched = with_outcomes(rows, store.searched())
    return {
        "outcomes": outcomes(searched),
        "units": [asdict(u) for _, u in sorted(store.units.items())],
        "candidacies": [
            {
                "key": row.key,
                "unit": row.unit,
                "name": f"{row.first_name} {row.last_name}",
                "election_year": row.election_year,
                "priority": row.priority,
                "status": row.status,
                "reason": row.reason,
                "docs": [asdict(d) for d in store.person_docs(row.key)],
            }
            for row in sorted(searched, key=lambda r: (r.unit, r.last_name, r.key))
        ],
    }


def print_report(result: dict[str, Any]) -> None:
    for unit in result["units"]:
        roots = ", ".join(unit["roots"]) or "no start"
        print(
            f"unit {unit['unit']}: {unit['status']}, {unit['pages']} pages "
            f"({unit['declaration_pages']} declaration pages) from {roots}"
        )
    for c in result["candidacies"]:
        label = c["status"] + (f":{c['reason']}" if c["reason"] else "")
        print(
            f"  {label:24s} {c['name']} ({c['unit']}, {c['election_year']}, "
            f"priority {c['priority']}): {len(c['docs'])} files"
        )
        for d in c["docs"]:
            named = "named" if d["named"] else "unnamed"
            anchor = " ".join(d["anchor"].split())[:70]
            print(f"      {d['status']:8s} {d['score']:5.2f} {named:7s} {anchor!r}")
            print(f"        {d['url']}")
            if d["page_url"] and d["page_url"] != d["url"]:
                print(f"        on {d['page_url']}")
    counts = ", ".join(f"{k} {v}" for k, v in result["outcomes"].items())
    print(f"{len(result['candidacies'])} candidacies: {counts}")


def tried_starts(
    units: Collection[str], start: str | None, declarations: list[str] | None
) -> list[dict[str, str]]:
    """The unit_starts.csv row --start and --declarations make for the one
    unit walked; none without them."""
    if not start and not declarations:
        return []
    if len(units) != 1:
        raise SystemExit("--start and --declarations take one unit")
    (unit,) = units
    return [
        {
            "unit": unit,
            "bip_url": start or "",
            "declarations_url": " ".join(declarations or []),
        }
    ]


def cmd_walk(args: argparse.Namespace) -> int:
    # The package imports this module, so its name comes in at call time.
    from jobs.bip_crawler import USER_AGENT  # noqa: PLC0415

    starts = tried_starts(args.units, args.start, args.declarations)
    if args.stacks:
        faulthandler.dump_traceback_later(args.stacks, repeat=True, file=sys.stderr)
    bundle, how = ca_bundle(Path(args.ca_bundle))
    use_ca_bundle(str(bundle) if bundle else None)
    print(f"certificates: {how}", flush=True)
    ctx, _ = setup_context(policy=list_policy())
    people = read_list_file(args.list) if args.list else read_list(ctx)
    rows = chosen(people, args.units, args.keys, args.person)
    if not rows:
        print("no candidacies on the list for those units, keys and names")
        return 1
    print(
        f"walking {len(rows)} candidacies in {len({r.unit for r in rows})} units",
        flush=True,
    )
    agents = Agents(USER_AGENT, server_of)
    robots = RobotsCache(USER_AGENT, agent_for=agents)
    store = MemoryBipPeopleStore()
    out = args.out or Path(tempfile.mkdtemp(prefix="bip-walk-"))
    try:
        with people_search(
            args,
            ctx,
            people,
            store,
            MemoryDocIndex(),
            LocalBundleStore(out),
            robots_exceptions.allowed(robots.allowed),
            robots.unreachable,
            agents,
            USER_AGENT,
            starts,
        ) as search:
            search.run(rows)
    finally:
        if args.out is None:
            shutil.rmtree(out, ignore_errors=True)
        if args.stacks:
            faulthandler.cancel_dump_traceback_later()
    result = report(rows, store)
    print_report(result)
    if args.json:
        args.json.write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"report: {args.json}")
    return 0


def plan_lines(rows: list[PersonRow], todo: list[PersonRow], top: int) -> list[str]:
    """What a chunk would take of the list (``rows``, with outcomes): ``todo``
    by outcome, by priority, and its biggest units."""
    pending = sum(r.status == "pending" for r in rows)
    units = Counter(r.unit for r in todo)
    by_outcome = Counter(
        r.status + (f":{r.reason}" if r.status == "not_found" else "") for r in todo
    )
    by_priority = Counter(r.priority for r in todo)
    lines = [
        f"people of interest: {len(rows):,} candidacies ({pending:,} pending); "
        f"{len(todo):,} to search in {len(units):,} units",
        "by outcome: " + ", ".join(f"{k} {v:,}" for k, v in _most(by_outcome)),
        "by priority: "
        + ", ".join(f"{k} {v:,}" for k, v in sorted(by_priority.items())),
    ]
    if units and top > 0:
        lines.append(
            "biggest units: " + ", ".join(f"{u} {n}" for u, n in _most(units)[:top])
        )
    return lines


def _most(counts: Counter[str]) -> list[tuple[str, int]]:
    """Most first, a tie by name: the same lines whatever order the list is in."""
    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))


def cmd_plan(args: argparse.Namespace) -> int:
    ctx, _ = setup_context(policy=list_policy())
    people = read_list_file(args.list) if args.list else read_list(ctx)
    pg = PostgresClient.from_env(max_size=1)
    try:
        searched = read_searched(pg)
    finally:
        pg.close()
    rows, todo = selected(args, people, searched)
    print("\n".join(plan_lines(rows, todo, args.top)))
    return 0
