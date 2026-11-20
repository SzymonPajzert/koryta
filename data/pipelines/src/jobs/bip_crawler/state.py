"""The people mode's state where anyone can read it, and the units it cannot
get into, by why.

    koryta_scrape_bip state               # probe the stuck units, write the state
    koryta_scrape_bip state --no-probe    # write it with the probes on record
    koryta_scrape_bip state --dry-run     # probe and count; write nothing
    koryta_scrape_bip problems            # the stuck units, from the newest state
    koryta_scrape_bip problems --kind no_answer --csv blocked.csv

The crawl's outcomes live in its Postgres on predator. `state` writes them to
the shared cache as a write-once part, ``jobs/bip_crawler/state/date=<UTC
day>/<UTC stamp>.jsonl.gz``: a line a unit (its walk, its candidacies'
outcomes, how its start addresses answered) and a line a candidacy (key,
unit, outcome). No names and no birth dates, as in the found list
(`stores.bip_found`): a candidacy is its key; who it is stays in the night's
list.

A walk that ends unreachable or refused says nothing of why. So `state` first
asks the start addresses of each unit nobody was found in whose walk read next
to nothing, once as the crawler and once as a browser (`probe_start`), keeps
the answers (`stores.bip_unit_probes`) and sorts the unit into a kind
(`kind_of`):

- ``no_answer``: neither agent got an answer from predator (a host or its
  provider keeping the crawler's address out: Szczecin, Sanok, Rymanów on
  11-05);
- ``refused``: both refused, 403 or a server error (Bytom);
- ``app_shell``: the page that answered is drawn by a script and links next to
  nothing (Gdynia);
- ``browser_only``: a browser got in, the crawler did not (a candidate for
  `identity.HOSTS`: a host listed there is asked as a browser by the probe
  too, as the crawl asks it);
- ``robots``: robots.txt keeps the crawler out of every start;
- ``no_address``: no start address at all;
- ``open``: the crawler gets in; its walk's outcome is the story.

`problems` lists the units of the kinds asked (by default the first four)
from the newest part, so whoever takes them on needs no access to predator.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import sys
import typing
from collections import Counter
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from scrapers.bip.classify import host_of
from scrapers.common.fetch import HttpResult
from scrapers.common.links import extract_link_contexts
from scrapers.stores import PersonRow, UnitRow
from stores.bip_unit_probes import StartProbe, UnitProbeStore
from stores.storage import LISTING_FIELDS, SHARED_BUCKET

if typing.TYPE_CHECKING:
    from scrapers.bip.units import UnitSeed
    from stores.storage import Client

STATE_PREFIX = "jobs/bip_crawler/state/"

NO_ANSWER = "no_answer"
REFUSED = "refused"
APP_SHELL = "app_shell"
BROWSER_ONLY = "browser_only"
ROBOTS = "robots"
NO_ADDRESS = "no_address"
OPEN = "open"
#: What `problems` lists unless asked otherwise: a person can get these going
#: (another network, a contact at the office, the address a script reads).
STUCK = (NO_ANSWER, REFUSED, APP_SHELL, BROWSER_ONLY)
KINDS = (*STUCK, ROBOTS, NO_ADDRESS, OPEN)

#: A walk that read this many pages or fewer read next to nothing.
FEW_PAGES = 2
#: Walk outcomes that say the walk did not get in.
LOCKED_OUT = frozenset({"unreachable", "refused", "no_seed", "robots", "throttled"})

Fetch = Callable[[str, float, str], HttpResult]
#: A start whose robots.txt did not answer: nothing more was asked of it.
_SILENT = "no answer: robots.txt"


# -- the probe -----------------------------------------------------------------
def answer(result: HttpResult) -> str:
    """An answer as `StartProbe` keeps it: the status, or why there was none."""
    if result.status:
        return str(result.status)
    return "no answer: " + " ".join((result.error or "nothing").split())[:80]


def answered(said: str) -> bool:
    """Whether an answer let the agent in: a 2xx, or a redirect."""
    return said.isdigit() and 200 <= int(said) < 400


def _shell(result: HttpResult) -> bool:
    if not result.ok or "html" not in (result.content_type or "html").lower():
        return False
    _, links = extract_link_contexts(result.content, result.url, result.content_type)
    # The people mode's own test (`people._app_shell`).
    return len(links) <= 5 and b"<script" in result.content[:200_000].lower()


def probe_start(
    url: str,
    fetch: Fetch,
    crawler: str | Callable[[str], str],
    browser: str,
    allowed: Callable[[str], bool],
    timeout: float = 20.0,
    unreachable: Callable[[str], bool] = lambda url: False,
) -> StartProbe:
    """Ask ``url`` once as the crawler and once as a browser; not at all when
    robots.txt keeps the crawler out, or did not answer (which keeps it out
    too, RFC 9309: the host said nothing, and that is what it says)."""
    if not allowed(url):
        if unreachable(url):
            return StartProbe(url, _SILENT, _SILENT)
        return StartProbe(url, ROBOTS, ROBOTS)
    # As the crawl asks it: by host, a browser for `identity.HOSTS`.
    agent = crawler(host_of(url)) if callable(crawler) else crawler
    own = fetch(url, timeout, agent)
    other = fetch(url, timeout, browser)
    return StartProbe(
        url, answer(own), answer(other), _shell(own) or (not own.ok and _shell(other))
    )


def kind_of(probes: list[StartProbe]) -> str:
    """Why a unit's starts keep the crawler out, from how they answered."""
    if not probes:
        return NO_ADDRESS
    asked = [p for p in probes if p.crawler != ROBOTS]
    if not asked:
        return ROBOTS
    got_in = [p for p in asked if answered(p.crawler) or answered(p.browser)]
    if got_in and all(p.shell for p in got_in):
        return APP_SHELL
    if any(answered(p.crawler) for p in got_in):
        return OPEN
    if got_in:
        return BROWSER_ONLY
    if all(
        p.crawler.startswith("no answer") and p.browser.startswith("no answer")
        for p in asked
    ):
        return NO_ANSWER
    return REFUSED


def starts(seed: UnitSeed | None) -> list[str]:
    """The addresses a unit's walk starts from, as `PeopleSearch._roots` takes
    them: its BIP's, else its website (Gdynia's website answers, its BIP is a
    script's page: the walk never reads the website)."""
    if seed is None:
        return []
    return list(dict.fromkeys(seed.bip_urls[:3] or seed.www_urls[:2]))


def stuck_units(people: Iterable[PersonRow], units: dict[str, UnitRow]) -> list[str]:
    """The units to probe: nobody found there, and a walk that did not get in
    or read next to nothing (or none yet)."""
    found = {p.unit for p in people if p.status == "found"}
    listed = {p.unit for p in people}
    out = []
    for unit in sorted(listed - found):
        walk = units.get(unit)
        if walk is None or walk.status in LOCKED_OUT or walk.pages <= FEW_PAGES:
            out.append(unit)
    return out


def probe_units(
    units: list[str],
    seeds: dict[str, UnitSeed],
    fetch: Fetch,
    crawler: str | Callable[[str], str],
    browser: str,
    allowed: Callable[[str], bool],
    workers: int = 12,
    unreachable: Callable[[str], bool] = lambda url: False,
) -> dict[str, list[StartProbe]]:
    """Each unit's starts, asked as `probe_start` asks."""

    def one(unit: str) -> tuple[str, list[StartProbe]]:
        return unit, [
            probe_start(url, fetch, crawler, browser, allowed, unreachable=unreachable)
            for url in starts(seeds.get(unit))
        ]

    with ThreadPoolExecutor(max(1, workers)) as pool:
        return dict(pool.map(one, units))


# -- the state -----------------------------------------------------------------
def state_lines(
    people: Iterable[PersonRow],
    units: dict[str, UnitRow],
    probes: dict[str, list[StartProbe]],
) -> list[dict[str, object]]:
    """A line a unit on the list, then a line a candidacy; no names."""
    by_unit: dict[str, list[PersonRow]] = {}
    for p in people:
        by_unit.setdefault(p.unit, []).append(p)
    lines: list[dict[str, object]] = []
    for unit, rows in sorted(by_unit.items()):
        walk = units.get(unit)
        person = rows[0].person or {}
        tried = probes.get(unit)
        lines.append(
            {
                "type": "unit",
                "unit": unit,
                "unit_name": person.get("unit_name", ""),
                "unit_level": person.get("unit_level", ""),
                "candidacies": len(rows),
                "found": sum(r.status == "found" for r in rows),
                "outcomes": dict(
                    Counter(
                        f"{r.status}:{r.reason}" if r.reason else r.status for r in rows
                    )
                ),
                "walk": walk.status if walk else "",
                "pages": walk.pages if walk else 0,
                "declaration_pages": walk.declaration_pages if walk else 0,
                "roots": walk.roots if walk else [],
                "kind": kind_of(tried) if tried is not None else "",
                "probes": [
                    {
                        **{k: v for k, v in asdict(p).items() if k != "checked_at"},
                        "checked_at": p.checked_at.isoformat() if p.checked_at else "",
                    }
                    for p in tried or []
                ],
            }
        )
    for rows in by_unit.values():
        for r in rows:
            lines.append(
                {
                    "type": "candidacy",
                    "key": r.key,
                    "unit": r.unit,
                    "election_year": r.election_year,
                    "priority": r.priority,
                    "status": r.status,
                    "reason": r.reason,
                    "docs": r.docs,
                }
            )
    return lines


def part_name(now: datetime) -> str:
    utc = now.astimezone(timezone.utc)
    return f"{STATE_PREFIX}date={utc:%Y-%m-%d}/{utc:%Y-%m-%dT%H%M%S}Z.jsonl.gz"


def state_part(lines: Iterable[dict[str, object]]) -> bytes:
    text = "".join(
        json.dumps(line, sort_keys=True, ensure_ascii=False) + "\n" for line in lines
    )
    return gzip.compress(text.encode("utf-8"), mtime=0)


def write_state(client: Client, lines: list[dict[str, object]], now: datetime) -> str:
    return client.create_object(
        SHARED_BUCKET, part_name(now), state_part(lines), "application/gzip"
    )


def newest_state(client: Client) -> tuple[str, list[dict[str, object]]] | None:
    """The newest part's gs:// path and lines, or None when there is none."""
    bucket = client.storage_client.bucket(SHARED_BUCKET)
    names = [
        blob.name
        for blob in bucket.list_blobs(prefix=STATE_PREFIX, fields=LISTING_FIELDS)
        if blob.name.endswith(".jsonl.gz")
    ]
    if not names:
        return None
    newest = max(names)
    return f"gs://{SHARED_BUCKET}/{newest}", read_part(
        bucket.get_blob(newest).download_as_bytes()
    )


def read_part(part: bytes) -> list[dict[str, object]]:
    return [
        json.loads(line)
        for line in gzip.decompress(part).decode("utf-8").splitlines()
        if line.strip()
    ]


# -- the listing -----------------------------------------------------------------
PROBLEM_FIELDS = (
    "kind",
    "unit",
    "unit_name",
    "unit_level",
    "candidacies",
    "walk",
    "pages",
    "start",
    "crawler",
    "browser",
    "shell",
    "checked_at",
)


def problems(
    lines: Iterable[dict[str, object]], kinds: Iterable[str] = STUCK
) -> list[dict[str, object]]:
    """A row a stuck unit's start, the units of ``kinds`` with nobody found,
    in the order of ``kinds``, the most candidacies first."""
    order = {k: i for i, k in enumerate(kinds)}
    units = [
        u
        for u in lines
        if u.get("type") == "unit" and u.get("kind") in order and not u.get("found")
    ]
    units.sort(key=lambda u: (order[str(u["kind"])], -int(str(u["candidacies"]))))
    rows: list[dict[str, object]] = []
    for u in units:
        tried = typing.cast("list[dict[str, object]]", u.get("probes") or [{}])
        for p in tried:
            rows.append(
                {
                    **{k: u.get(k, "") for k in PROBLEM_FIELDS[:7]},
                    "start": p.get("url", ""),
                    "crawler": p.get("crawler", ""),
                    "browser": p.get("browser", ""),
                    "shell": p.get("shell", ""),
                    "checked_at": p.get("checked_at", ""),
                }
            )
    return rows


def print_problems(rows: list[dict[str, object]]) -> None:
    counts = Counter(str(r["kind"]) for r in rows)
    units: dict[str, set[object]] = {}
    people: Counter[str] = Counter()
    for r in rows:
        if r["unit"] not in units.setdefault(str(r["kind"]), set()):
            people[str(r["kind"])] += int(str(r["candidacies"]))
        units[str(r["kind"])].add(r["unit"])
    for kind in counts:
        print(f"{kind}: {len(units[kind])} units, {people[kind]} candidacies")
    for r in rows:
        print(
            f"  {r['kind']:<12} {r['unit']} {str(r['unit_name'])[:34]:<34} "
            f"{r['candidacies']:>3}  {str(r['start'])[:60]:<60} "
            f"crawler {r['crawler']} | browser {r['browser']}"
            + (" | script page" if r["shell"] else "")
        )


# -- the commands ----------------------------------------------------------------
def add_parser(sub: argparse._SubParsersAction) -> None:
    from jobs.bip_crawler import DEFAULT_CA_BUNDLE, DEFAULT_XML_CACHE  # noqa: PLC0415

    state = sub.add_parser(
        "state",
        help="probe the units the people mode cannot get into and write its "
        "state to the shared cache",
    )
    state.add_argument(
        "--no-probe", action="store_true", help="write the probes on record"
    )
    state.add_argument("--dry-run", action="store_true", help="write nothing")
    state.add_argument("--workers", type=int, default=12)
    state.add_argument("--xml-cache", type=Path, default=DEFAULT_XML_CACHE)
    state.add_argument("--ca-bundle", type=Path, default=DEFAULT_CA_BUNDLE)
    state.set_defaults(func=cmd_state)

    listing = sub.add_parser(
        "problems",
        help="list the units the people mode cannot get into, from the newest "
        "state in the shared cache",
    )
    listing.add_argument(
        "--kind",
        default=",".join(STUCK),
        help=f"kinds to list, comma-separated, of {', '.join(KINDS)} "
        f"(default {','.join(STUCK)})",
    )
    listing.add_argument("--csv", type=Path, help="write the rows here too")
    listing.add_argument(
        "--part", type=Path, help="read this state part instead of the newest"
    )
    listing.set_defaults(func=cmd_problems)


def cmd_state(args: argparse.Namespace) -> int:
    # The package imports this module, so its helpers come in at call time.
    from conductor import setup_context  # noqa: PLC0415
    from jobs.bip_crawler import USER_AGENT, robots_exceptions  # noqa: PLC0415
    from jobs.bip_crawler.identity import BROWSER_AGENT, Agents  # noqa: PLC0415
    from jobs.bip_crawler.people import (  # noqa: PLC0415
        _one_hop,
        load_seeds,
        server_of,
    )
    from jobs.bip_crawler.people_list import candidacies, list_policy  # noqa: PLC0415
    from scrapers.common.fetch import use_ca_bundle  # noqa: PLC0415
    from scrapers.common.pg import PostgresClient  # noqa: PLC0415
    from stores.bip_people import PostgresBipPeopleStore, read_units  # noqa: PLC0415
    from stores.bip_unit_probes import PostgresUnitProbeStore  # noqa: PLC0415
    from stores.storage import Client  # noqa: PLC0415
    from stores.tls import ca_bundle  # noqa: PLC0415
    from stores.web import RobotsCache  # noqa: PLC0415

    pg = PostgresClient.from_env(max_size=2)
    try:
        ctx, _ = setup_context(policy=list_policy())
        people = candidacies(PostgresBipPeopleStore(pg), ctx)
        units = read_units(pg)
        store: UnitProbeStore = PostgresUnitProbeStore(pg)
        fresh: dict[str, list[StartProbe]] = {}
        if not args.no_probe:
            bundle, _ = ca_bundle(Path(args.ca_bundle))
            use_ca_bundle(str(bundle) if bundle else None)
            seeds, _, _ = load_seeds(ctx, args.xml_cache)
            robots = RobotsCache(USER_AGENT, agent_for=Agents(USER_AGENT, server_of))
            todo = stuck_units(people, units)
            print(f"probing the starts of {len(todo)} units", flush=True)
            fresh = probe_units(
                todo,
                seeds,
                _one_hop,
                Agents(USER_AGENT, server_of),
                BROWSER_AGENT,
                robots_exceptions.allowed(robots.allowed),
                args.workers,
                robots.unreachable,
            )
            if not args.dry_run:
                for unit, tried in fresh.items():
                    store.record(unit, tried)
        # A dry run keeps nothing: it shows the probes on record and its own.
        probes = store.probes() | fresh if args.dry_run else store.probes()
        lines = state_lines(people, units, probes)
        kinds = Counter(
            str(x["kind"]) for x in lines if x["type"] == "unit" and x["kind"]
        )
        print(f"units by kind: {dict(kinds.most_common())}")
        if args.dry_run:
            return 0
        print(f"Wrote {write_state(Client(), lines, datetime.now(timezone.utc))}")
    finally:
        pg.close()
    return 0


def cmd_problems(args: argparse.Namespace) -> int:
    if args.part:
        source, lines = str(args.part), read_part(args.part.read_bytes())
    else:
        from stores.storage import Client  # noqa: PLC0415

        newest = newest_state(Client())
        if newest is None:
            print("no state in the shared cache yet: run koryta_scrape_bip state")
            return 1
        source, lines = newest
    kinds = [k.strip() for k in args.kind.split(",") if k.strip()]
    unknown = [k for k in kinds if k not in KINDS]
    if unknown:
        print(f"unknown kinds: {', '.join(unknown)}", file=sys.stderr)
        return 2
    rows = problems(lines, kinds)
    print(f"from {source}")
    print_problems(rows)
    if args.csv:
        with args.csv.open("w", newline="", encoding="utf-8") as out:
            writer = csv.DictWriter(out, fieldnames=PROBLEM_FIELDS)
            writer.writeheader()
            writer.writerows(rows)
        print(f"wrote {len(rows)} rows to {args.csv}")
    return 0
