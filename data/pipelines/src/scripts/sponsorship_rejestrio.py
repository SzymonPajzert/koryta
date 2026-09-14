"""Resolve a list of NIPs to KRS numbers, and queue the companies for rejestr.io.

One command does the whole thing:

    uv run python src/scripts/sponsorship_rejestrio.py resolve --nip-list nips.txt

That searches the register for each NIP the population names and
**stores every answer in the crawled bucket**, keyed by URL and stamped with
the date, exactly as `scraper.py` stores an api-krs odpis. So a second run
costs nothing: the answers are read back out of the bucket and only NIPs nobody
has asked about yet are fetched. There is no intermediate file to keep.

Then, once the KRS numbers are known:

    uv run python src/scripts/sponsorship_rejestrio.py queries   # priced, dry run
    uv run python src/scripts/sponsorship_rejestrio.py fetch     # actually buy them
    uv run python src/scripts/sponsorship_rejestrio.py urls      # just the URLs
    uv run python src/scripts/sponsorship_rejestrio.py worklist  # what is still missing

`fetch` needs `REJESTR_KEY` in `data/pipelines/.env`
(https://rejestr.io/konto/api). It skips any (company, aktualnosc) pair already
in the bucket, so a rerun after an interruption pays only for what is missing --
26,772 of these blobs are already on file from earlier crawls, and re-buying
one is 0.05 PLN for bytes we have.

**Why this search and not the wykaz.** The Ministry of Finance's wykaz holds
only VAT-registered entities, so it cannot see a foundation below the VAT
threshold -- and it answers ``subject: null`` rather than erroring, which makes
the miss look like an answer. `scrapers.krs.search.search_subjects` is the
register's own search, so it sees whatever the register does, across both `P`
and `S`, for free. Fundacja "Bez Granic" (NIP 7743261776) is the worked
example: invisible to the wykaz by NIP *and* by REGON, and KRS 0000907937 here.

A `POST` body is not part of a URL and the crawl store is keyed by URL, so each
search is filed under a synthetic one -- ``…/wyszukiwarka/krs/nip/<nip>`` --
which names what was actually asked. Two calls per company reach rejestr.io,
not three: the `/org/<krs>` record carries no connections and its name, city
and teryt are already in the free api-krs odpis, so it is off unless
`--with-org-record` asks for it.

**The population is an argument.** A plain file of NIPs is the one source here;
it carries no value, so `--limit` cuts the file in the order it was written.
Sources that do know what each body was paid -- the CRU register, a published
spend list -- order richest first, so that a run stopped halfway has covered
the money rather than an arbitrary prefix.
"""

import argparse
import csv
import json
import sys
import time
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from conductor import setup_context
from scrapers.krs import nip_sources, rejestrio, search
from scrapers.krs.nip_lookup import known_from_companies_merged, nip_valid
from scrapers.stores import CloudStorage, Context
from scrapers.stores.file import DownloadableFile
from stores.config import VERSIONED_DIR

#: `stores.config.VERSIONED_DIR` is a str, so every use here goes through Path.
VERSIONED = Path(VERSIONED_DIR)

#: Where a NIP search is filed in the crawl bucket. Not a real route -- the
#: search is a POST and its body is not in the URL -- but it identifies the
#: question, which is what the store needs of a key.
SEARCH_URL = "https://wyszukiwarka-krs-api.ms.gov.pl/api/wyszukiwarka/krs/nip/{nip}"

#: The bucket prefix every one of those lands under.
SEARCH_PREFIX = "hostname=wyszukiwarka-krs-api.ms.gov.pl"

#: The marker inside a stored key that says "this blob is a NIP search".
_NIP_SEGMENT = "/wyszukiwarka/krs/nip/"

#: Where rejestr.io connection lists land. `upload_result` turns the query
#: string into a path segment, so `?aktualnosc=aktualne` is stored as
#: `/aktualnosc_aktualne` -- which is what has to be matched to tell whether a
#: company's connections were already bought.
REJESTRIO_PREFIX = "hostname=rejestr.io"


def nip_list_recipients(path: Path, limit: int | None) -> list[nip_sources.Recipient]:
    """A file of NIPs, one per line, as the population.

    A plain list says nothing about who was paid what, so `name` is empty and
    `paid` is zero. Everything downstream prints those rather than deciding on
    them, so a source that does know fills them in without changing a line here
    -- which is what `cru_recipients` is.
    """
    rows = nip_sources.from_list(path)
    seen: dict[str, None] = {}
    for row in rows:
        for nip in row.nips:
            seen.setdefault(nip, None)
    chosen = [nip_sources.Recipient(nip, "", 0.0, 0) for nip in seen]
    return chosen[:limit] if limit else chosen


def cached_answers(ctx: Context) -> dict[str, dict]:
    """Every NIP search already in the bucket, newest crawl per NIP.

    Read rather than re-fetched so a rerun is free -- the same reason
    `KRSAlreadyScraped` lists the bucket instead of re-asking api-krs. An
    answer of "no such NIP" is stored and honoured too: it is a result, and
    re-asking it every run would be the same mistake as treating the wykaz's
    ``subject: null`` as a gap.
    """
    newest: dict[str, tuple[str, dict]] = {}
    for ref in ctx.io.list_files(CloudStorage(prefix=SEARCH_PREFIX)):
        if not isinstance(ref, DownloadableFile) or _NIP_SEGMENT not in ref.url:
            continue
        tail = ref.url.split(_NIP_SEGMENT, 1)[1]
        nip, _, stamp = tail.partition("/date=")
        nip = "".join(c for c in nip if c.isdigit())
        if len(nip) != 10:
            continue
        if nip in newest and newest[nip][0] >= stamp:
            continue
        try:
            body = ctx.io.read_data(ref).read_string()
            payload = json.loads(body) if body else {}
        except Exception:  # noqa: BLE001 - an unreadable blob is not fatal
            payload = {}
        newest[nip] = (stamp, payload)
    return {nip: payload for nip, (_, payload) in newest.items()}


def _krs_of(payload: dict) -> str | None:
    """The single KRS a stored search found, or None if it is not single.

    `search.parse_search` has already collapsed the two rows a subject in both
    registers produces, so more than one hit here means genuinely more than one
    subject -- and picking the first would choose a company by accident.
    """
    hits = payload.get("hits") or []
    if len(hits) == 1 and hits[0].get("krs"):
        return str(hits[0]["krs"])
    return None


def known_for(args) -> dict[str, str]:
    """NIP-to-KRS pairs we already hold, so the ministry is not asked for them.

    A pair from `companies_merged` is an answer, so every mode reads them --
    otherwise `resolve` would report a company settled and `queries` would omit
    it. It is deliberately *not* written into the bucket: it is not a search
    answer, and filing it as one would tell a later reader the register said
    something it never said.

    `resolve --refresh` drops them by not calling this; `fetch --refresh` is a
    different flag about re-buying connection lists, which is why the decision
    is the caller's rather than a `refresh` test in here.
    """
    known, _ = known_from_companies_merged(
        Path(args.companies_merged)
        if getattr(args, "companies_merged", None)
        else VERSIONED / "companies_merged" / "companies_merged.jsonl"
    )
    return known


def _mapping(
    cached: dict[str, dict], recipients, known: dict[str, str] | None = None
) -> dict[str, str]:
    """Every recipient whose KRS is settled, from the bucket or from what we hold.

    The bucket wins where both answer: it is the register's own reply to this
    NIP, while `companies_merged` is a pair recorded whenever that company was
    last crawled.
    """
    wanted = {r.nip for r in recipients}
    out = {}
    for nip, payload in cached.items():
        if nip in wanted and (krs := _krs_of(payload)):
            out[nip] = krs
    for nip, krs in (known or {}).items():
        if nip in wanted:
            out.setdefault(nip, krs)
    return out


def cru_recipients(limit: int | None) -> list[nip_sources.Recipient]:
    """Every CRU counterparty whose own name states a KRS legal form.

    The whole register is 61,453 distinct NIPs, but two thirds of those are
    sole traders, spolki cywilne and budget units -- none of which are in KRS,
    so asking about them buys nothing. `cru_company_overlap`'s KRS_FORM/CIVIL
    pair is the repo's existing rule for reading the legal form out of a name,
    and it cuts the crawl to 18,364 with 9.57 bn PLN behind them.

    Ordered by the contract value attributed to the party, richest first: a run
    stopped halfway has then covered the money rather than an arbitrary prefix
    of the register.
    """
    from scripts.cru_company_overlap import CIVIL, KRS_FORM  # noqa: PLC0415

    path = VERSIONED / "cru_umowy" / "cru_umowy.jsonl"
    # Buyers included, because `n` counts every contract a NIP appears on --
    # `nip_sources.attributed_value` is what decides which side was paid.
    rows = nip_sources.from_cru(path, suppliers_only=False)
    paid = nip_sources.attributed_value(rows)

    totals: dict[str, dict] = {}
    for row in rows:
        for nip in row.nips:
            if not nip_valid(nip):
                continue
            entry = totals.setdefault(
                nip, {"name": row.party_text, "paid": paid.get(nip, 0.0), "n": 0}
            )
            entry["n"] += 1

    chosen = [
        nip_sources.Recipient(nip, e["name"], e["paid"], e["n"])
        for nip, e in totals.items()
        if KRS_FORM.search(e["name"]) and not CIVIL.search(e["name"])
    ]
    chosen.sort(key=lambda r: (-r.paid, r.nip))
    return chosen[:limit] if limit else chosen


def recipients_for(args) -> Sequence[nip_sources.Recipient]:
    """Whichever population the run named. Exactly one of them is required."""
    if getattr(args, "cru", False):
        return cru_recipients(args.limit)
    if not getattr(args, "nip_list", None):
        raise SystemExit("give a population: --cru or --nip-list")
    return nip_list_recipients(Path(args.nip_list), args.limit)


def resolve(args) -> None:
    ctx, _ = setup_context()
    recipients = recipients_for(args)

    cached = {} if args.refresh else cached_answers(ctx)
    print(f"{len(cached)} NIPs already answered in the bucket", file=sys.stderr)

    known = {} if args.refresh else known_for(args)
    free = [r for r in recipients if r.nip not in cached and r.nip in known]
    if free:
        print(
            f"{len(free)} already resolved by companies_merged, not asked "
            f"({nip_sources.total_paid(free):,.0f} PLN)",
            file=sys.stderr,
        )

    if args.retry_empty:
        # A stored zero-hit answer may be a throttled request rather than a
        # real absence -- the service returns the same thing for both. Dropping
        # them from the cache re-asks exactly those, on the confirming path.
        empty = [nip for nip, payload in cached.items() if not _krs_of(payload)]
        for nip in empty:
            cached.pop(nip)
        print(f"re-asking {len(empty)} zero-hit answers", file=sys.stderr)

    fetched, failed = 0, 0
    for index, recipient in enumerate(recipients, 1):
        if recipient.nip in cached or recipient.nip in known:
            continue
        try:
            hits = search.search_nip_confirmed(recipient.nip)
        except Exception as error:  # noqa: BLE001 - one bad NIP must not end it
            print(f"  {recipient.nip}: {error}", file=sys.stderr)
            failed += 1
            continue
        # Stored as the parsed hits rather than the raw envelope: the envelope
        # holds nothing else, and a reader of the bucket should not have to
        # know that the service's `numer` arrives unpadded.
        payload = {"nip": recipient.nip, "hits": [asdict(h) for h in hits]}
        ctx.io.upload(
            SEARCH_URL.format(nip=recipient.nip),
            json.dumps(payload, ensure_ascii=False),
            "application/json",
            include_query=True,
            verbose=False,
        )
        cached[recipient.nip] = payload
        fetched += 1
        print(
            f"  {index}/{len(recipients)} {recipient.nip} -> "
            f"{hits[0].krs if hits else 'none':<12}{recipient.name[:42]}",
            end="\r",
            flush=True,
        )
        time.sleep(search.REQUEST_INTERVAL)
    print(" " * 100, end="\r")

    mapping = _mapping(cached, recipients, known)
    unresolved = [r for r in recipients if r.nip not in mapping]
    print(
        f"fetched {fetched} searches ({failed} failed), {len(cached)} on file, "
        f"{len(free)} free from companies_merged"
    )
    print(f"resolved to one KRS number: {len(mapping)} of {len(recipients)}")
    print(
        f"still unresolved: {len(unresolved)}, "
        f"{nip_sources.total_paid(unresolved):,.2f} PLN"
    )
    for recipient in unresolved[:10]:
        print(f"    {recipient.nip}  {recipient.paid:>10,.0f}  {recipient.name[:52]}")
    print(
        f"\nrejestr.io for the {len(mapping)} resolved: "
        f"{rejestrio.cost_pln(len(mapping)):,.2f} PLN "
        f"-- see the `queries` mode"
    )


def already_bought(ctx: Context) -> set[tuple[str, str]]:
    """The (KRS, aktualnosc) pairs whose connection list is already in the bucket.

    Checked before spending, because rejestr.io bills per call and the bucket
    already holds 26,772 of these from earlier crawls. Re-buying one is
    0.05 PLN for bytes we have.
    """
    bought: set[tuple[str, str]] = set()
    for ref in ctx.io.list_files(CloudStorage(prefix=REJESTRIO_PREFIX)):
        if not isinstance(ref, DownloadableFile):
            continue
        if "/krs-powiazania/aktualnosc_" not in ref.url:
            continue
        head, _, tail = ref.url.partition("/krs-powiazania/aktualnosc_")
        krs = "".join(c for c in head.rsplit("/", 1)[-1] if c.isdigit())
        which = tail.split("/")[0]
        if krs and which in rejestrio.REJESTRIO_QUERIES:
            bought.add((krs.rjust(10, "0"), which))
    return bought


def fetch(args) -> None:
    """Buy the connection lists, and store them exactly where the crawl does.

    Deliberately the same shape as `scraper.scrape_krs_paid`: the RejestrIO
    client asks before each call unless told to always allow, the total is
    printed and confirmed before anything is spent, and every response goes
    through `upload_result` so it lands under the same key an ordinary crawl
    would have written. Nothing downstream needs to know these came from here.
    """
    from scraper import upload_result  # noqa: PLC0415
    from scrapers.stores import RejestrIO  # noqa: PLC0415

    ctx, _ = setup_context([RejestrIO])
    recipients = recipients_for(args)
    mapping = _mapping(cached_answers(ctx), recipients, known_for(args))
    pairs = [(r, mapping[r.nip]) for r in recipients if r.nip in mapping]

    bought = set() if args.refresh else already_bought(ctx)
    wanted: list[tuple[nip_sources.Recipient, str, str]] = []
    skipped = 0
    for recipient, krs in pairs:
        for which in rejestrio.REJESTRIO_QUERIES:
            if (krs, which) in bought:
                skipped += 1
                continue
            wanted.append((recipient, krs, which))

    print(f"{len(pairs)} companies resolved to a KRS number")
    print(f"{skipped} connection lists already in the bucket, skipping those")
    print(
        f"{len(wanted)} calls to make, "
        f"{len(wanted) * rejestrio.PLN_PER_CALL:,.2f} PLN"
    )
    if not wanted:
        return
    if not args.yes:
        input("Press enter to continue, ctrl-c to stop...")

    client = RejestrIO.from_context(ctx)
    done, failed = 0, 0
    for index, (recipient, krs, which) in enumerate(wanted, 1):
        url = (
            f"https://rejestr.io/api/v2/org/{krs}"
            f"/krs-powiazania?aktualnosc={which}"
        )
        result = client.get_rejestr_io(url)
        if not result:
            print(f"  [skip] {krs} {which} ({recipient.name[:40]})")
            failed += 1
            continue
        upload_result(ctx, url, result, verbose=False)
        done += 1
        print(
            f"  {index}/{len(wanted)} {krs} {which:<12}{recipient.name[:40]}",
            end="\r",
            flush=True,
        )
        time.sleep(args.sleep)
    print(" " * 100, end="\r")
    print(
        f"stored {done} connection lists ({failed} skipped or failed), "
        f"{done * rejestrio.PLN_PER_CALL:,.2f} PLN spent"
    )


def _resolved(args) -> list[tuple[nip_sources.Recipient, str]]:
    ctx, _ = setup_context()
    recipients = recipients_for(args)
    mapping = _mapping(cached_answers(ctx), recipients)
    pairs = [(r, mapping[r.nip]) for r in recipients if r.nip in mapping]
    print(
        f"# {len(pairs)} of {len(recipients)} have a KRS in the bucket; "
        f"run `resolve` for the rest",
        file=sys.stderr,
    )
    return pairs


def worklist(args) -> None:
    ctx, _ = setup_context()
    recipients = recipients_for(args)
    mapping = _mapping(cached_answers(ctx), recipients)
    missing = [r for r in recipients if r.nip not in mapping]

    writer = csv.writer(sys.stdout)
    writer.writerow(["nip", "name", "paid_pln", "contracts"])
    for recipient in missing:
        writer.writerow(
            [
                recipient.nip,
                recipient.name,
                f"{recipient.paid:.2f}",
                recipient.contracts,
            ]
        )
    print(
        f"\n# {len(missing)} of {len(recipients)} still unresolved, "
        f"{nip_sources.total_paid(missing):,.2f} PLN",
        file=sys.stderr,
    )


def urls(args) -> None:
    pairs = _resolved(args)
    for recipient, krs in pairs:
        print(f"# {recipient.nip}  {recipient.paid:>12,.2f} PLN  {recipient.name}")
        for url in rejestrio.rejestrio_urls(
            krs, with_org_record=args.with_org_record
        ):
            print(url)
    per_company = len(rejestrio.REJESTRIO_QUERIES) + (
        1 if args.with_org_record else 0
    )
    print(
        f"\n# {len(pairs)} companies x {per_company} calls = "
        f"{rejestrio.cost_pln(len(pairs), args.with_org_record):,.2f} PLN",
        file=sys.stderr,
    )


def queries(args) -> None:
    """As `RejestrIOQuery` objects, so the paid crawl can run them unchanged.

    Imported here rather than at module scope: `scrapers.krs.scrape` pulls in
    the analysis layer and pandas, which `resolve` has no use for.
    """
    from entities.company import KRS  # noqa: PLC0415
    from scrapers.krs.scrape import (  # noqa: PLC0415
        REASON_HARDCODED,
        QueryType,
        RejestrIOQuery,
    )

    pairs = _resolved(args)
    # The connection pair only. `already_scraped_companies` counts a company as
    # done once it has these, so the org record buys nothing the queue notices.
    wanted = [
        QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE,
        QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_HISTORYCZNE,
    ]
    if args.with_org_record:
        wanted.insert(0, QueryType.REJESTRIO_ORG)
    built = [
        RejestrIOQuery(
            krs=KRS(id=krs), queries=list(wanted), reasons=[REASON_HARDCODED]
        )
        for _, krs in pairs
    ]
    for query, (recipient, krs) in zip(built, pairs):
        print(
            f"{krs}  {query.paid_calls()} calls  {query.cost():.2f} PLN  "
            f"{recipient.name[:56]}"
        )
    print(
        f"\n# {len(built)} queries, {sum(q.paid_calls() for q in built)} paid calls, "
        f"{sum(q.cost() for q in built):,.2f} PLN",
        file=sys.stderr,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)

    node = sub.add_parser(
        "resolve", help="search each NIP and store the answer in the bucket"
    )
    node.add_argument("--nip-list", help="a file of NIPs, one per line")
    node.add_argument("--limit", type=int, help="only the first N")
    node.add_argument(
        "--refresh",
        action="store_true",
        help="re-ask even NIPs already answered in the bucket",
    )
    node.add_argument(
        "--retry-empty",
        action="store_true",
        help="re-ask only the NIPs whose stored answer found nothing",
    )
    node.add_argument(
        "--cru",
        action="store_true",
        help="take NIPs from the CRU register instead of the hardcoded list",
    )
    node.add_argument(
        "--companies-merged",
        help="NIP->KRS pairs we already hold; default versioned/companies_merged",
    )
    node.set_defaults(func=resolve)

    node = sub.add_parser("worklist", help="NIPs still without a KRS, as CSV")
    node.add_argument("--nip-list", help="a file of NIPs, one per line")
    node.add_argument("--cru", action="store_true", help="use the CRU register")
    node.add_argument("--limit", type=int, help="only the richest N")
    node.set_defaults(func=worklist)

    node = sub.add_parser("fetch", help="actually buy the connection lists")
    node.add_argument("--nip-list", help="a file of NIPs, one per line")
    node.add_argument("--limit", type=int, help="only the first N")
    node.add_argument(
        "--refresh",
        action="store_true",
        help="re-buy lists already in the bucket (costs money for nothing)",
    )
    node.add_argument("--cru", action="store_true", help="use the CRU register")
    node.add_argument("--yes", action="store_true", help="skip the confirmation")
    node.add_argument("--sleep", type=float, default=0.2, help="seconds between calls")
    node.set_defaults(func=fetch)

    for name, func, helptext in (
        ("urls", urls, "rejestr.io URLs for the NIPs that resolved"),
        ("queries", queries, "the same as RejestrIOQuery objects, priced"),
    ):
        node = sub.add_parser(name, help=helptext)
        node.add_argument("--nip-list", help="a file of NIPs, one per line")
        node.add_argument("--cru", action="store_true", help="use the CRU register")
        node.add_argument("--limit", type=int, help="only the richest N")
        node.add_argument(
            "--with-org-record",
            action="store_true",
            help="also buy /org/<krs>; it has no connections, so only for teryt",
        )
        node.set_defaults(func=func)

    return parser


def main() -> None:
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
