"""NIPs in, board and supervisory-board members out, matched to PeopleMerged.

The whole chain, in one place:

1. read NIPs from a spend spreadsheet, the CRU artifact, or a plain list;
2. resolve each to a KRS number -- from odpisy already crawled where possible,
   from the Ministry of Finance's wykaz otherwise;
3. fetch each company's *odpis pełny* and read out everyone who has ever sat on
   its board, supervisory board or held its proxy, with the organ, the
   function, and whether they still hold the seat;
4. decode each PESEL to a birth date and sex, replace it with a run-local
   person number, and match the person against `PeopleMerged` on name plus
   full birth date.

    uv run python src/scripts/nip_board_people.py \\
        --spreadsheet "$HOME/2026.xlsx - 2026.csv" --limit-companies 20 \\
        --out /tmp/board-people.jsonl

    uv run python src/scripts/nip_board_people.py --nip 6791862817 --show

**Nothing here writes a PESEL.** It is decoded in memory and dropped; the
output carries the birth date, the sex and a `person_seq` assigned in
first-seen order, which is what makes the artifact publishable. The number is
a counter rather than a digest on purpose: with the birth date and sex in the
same row only 5,000 PESELs are possible, so any published hash of one --
keyed with anything the reader could also have -- is recoverable in about
10 ms. See `util.pesel.PersonIds`, including what a run-local id cannot do.

**Two budgets are spent, and neither is ours.** The wykaz allows 100 requests a
day of 30 NIPs each; `--max-mf-requests` caps what this run will use and the
run stops rather than overrunning, since an overrun locks the IP out until
midnight. The odpis service is one request per company, paced by
`scrapers.krs.search.REQUEST_INTERVAL`. `--limit-companies` is therefore not a
convenience: on a 1,156-NIP source the odpis stage alone is ~20 minutes.
"""

import argparse
import collections
import datetime
import json
import re
import time
import typing
from dataclasses import asdict, replace
from pathlib import Path

from dotenv import load_dotenv

from conductor import setup_context
from scrapers.krs import nip_lookup, nip_sources, odpis_pdf, people_match, search
from scripts import odpis_store
from stores.config import VERSIONED_DIR
from stores.storage import Client as CloudStorageClient
from util import pesel as pesel_util

#: The artifact name, in the shared cache and under versioned/. Fixed rather
#: than derived from the source, so two runs over different spreadsheets
#: publish successive versions of one dataset instead of a family of
#: near-identical ones.
ARTIFACT = "krs_odpis_people"

#: `stores.config.VERSIONED_DIR` is a str, so every use here goes through Path.
VERSIONED = Path(VERSIONED_DIR)


def resolutions_from_bucket(
    nips: typing.Sequence[str], names: dict[str, str] | None = None
) -> dict[str, nip_lookup.NipResolution]:
    """The search answers already in the bucket, for this run's NIPs.

    Shaped like the wykaz's output so everything downstream -- company
    selection, the odpis fetch, the match -- runs unchanged.

    The population is an argument rather than a list this module knows about,
    which is what kept the two halves of the chain apart: `sponsorship_rejestrio
    resolve --cru` can answer all 18,364 KRS-form CRU NIPs through the
    register's own free search, and a fixed list here would read back only the
    ones it knew about, leaving the wykaz -- 3,000 NIPs a day, so 7 calendar
    days -- as the only CRU route.

    Returned in the order the source named them, not the order the bucket
    lists them: `pick_companies` truncates on `--limit-companies`, so a bucket
    ordering would make a capped run cover an arbitrary subset of the source
    rather than its head.
    """
    from scripts.sponsorship_rejestrio import (  # noqa: PLC0415
        _krs_of,
        cached_answers,
    )

    ctx, _ = setup_context()
    cached = cached_answers(ctx)
    names = names or {}
    resolutions: dict[str, nip_lookup.NipResolution] = {}
    for nip in nips:
        payload = cached.get(nip)
        krs = _krs_of(payload) if payload else None
        if krs:
            resolutions[nip] = nip_lookup.NipResolution(
                nip=nip, krs=krs, name=names.get(nip) or None, source="search"
            )
    return resolutions


def has_source(args) -> bool:
    """Whether the run was given a population of its own."""
    return bool(args.spreadsheet or args.nip_list or args.nip) or args.cru is not None


def gather_rows(args) -> tuple[list[nip_sources.NipRow], list[nip_sources.NipRow]]:
    if args.spreadsheet:
        return nip_sources.from_spreadsheet(Path(args.spreadsheet))
    if args.cru is not None:
        # `--cru` takes an optional path, so the bare flag is the empty string
        # -- falsy, which made `if args.cru:` fall through to the `--nip`
        # branch and read nothing at all.
        path = Path(args.cru)
        if not path.is_file():
            path = VERSIONED / "cru_umowy" / "cru_umowy.jsonl"
        # Ordered by attributed contract value, always. The odpis stage is one
        # request per company, so every CRU run is capped in practice -- and a
        # cap on file order covers a slice of the alphabet while a cap on
        # value covers the money. `pick_companies` truncates in this order.
        return (
            nip_sources.from_cru(
                path, limit=args.cru_limit, order_by_value=True
            ),
            [],
        )
    if args.nip_list:
        return nip_sources.from_list(Path(args.nip_list)), []
    return [nip_sources.NipRow(nips=[nip_lookup.only_digits(n)]) for n in args.nip], []


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--spreadsheet", help="a published spend list, as CSV")
    source.add_argument("--cru", nargs="?", const="", help="the cru_umowy artifact")
    source.add_argument("--nip-list", help="a file of NIPs, one per line")
    source.add_argument("--nip", nargs="+", default=[], help="NIPs on the command line")

    # Not a source: it says where the KRS numbers come from, which is a
    # different question from which NIPs to ask about. Combines with any
    # source, so the CRU population reaches the free channel too.
    parser.add_argument(
        "--from-search-bucket",
        action="store_true",
        help=(
            "take the KRS numbers the register's own search already resolved "
            "into the crawl bucket, skipping the wykaz entirely"
        ),
    )

    parser.add_argument("--cru-limit", type=int, help="stop after N CRU party rows")
    parser.add_argument(
        "--limit-companies",
        type=int,
        help="fetch at most N odpisy (one request and ~1s each)",
    )
    parser.add_argument(
        "--max-mf-requests",
        type=int,
        default=nip_lookup.MF_DAILY_REQUESTS,
        help=f"cap wykaz requests (daily limit is {nip_lookup.MF_DAILY_REQUESTS})",
    )
    parser.add_argument("--date", help="wykaz as-of date, default today")
    parser.add_argument("--out", help="write the people here as JSONL")
    parser.add_argument(
        "--people-merged",
        help="path to people_merged.jsonl; default versioned/, skipped if absent",
    )
    parser.add_argument(
        "--companies-merged",
        help="path to companies_merged.jsonl, for the free NIP->KRS pairs",
    )
    parser.add_argument("--show", action="store_true", help="print each person")
    parser.add_argument(
        "--current-only",
        action="store_true",
        help="only people who still hold the seat",
    )
    parser.add_argument(
        "--resolve-only",
        action="store_true",
        help="stop after NIP-to-KRS, fetching no odpisy",
    )
    parser.add_argument(
        "--reparse-only",
        action="store_true",
        help="parse only the odpisy already in the bucket; fetch nothing",
    )
    parser.add_argument(
        "--publish",
        action="store_true",
        help=(
            f"also write versioned/{ARTIFACT}/{ARTIFACT}.jsonl and upload it "
            f"to the shared cache"
        ),
    )
    return parser


def from_search_bucket(args, rows, nips, person_ids) -> None:
    """Run the odpis half against the answers the register's search left us.

    The wykaz could not see these at all; the register's own search could, and
    its answers are already in the bucket. So the whole NIP-to-KRS stage is
    skipped and its output reconstructed.
    """
    names: dict[str, str] = {}
    for row in rows:
        for nip in row.nips:
            if row.party_text:
                names.setdefault(nip, row.party_text)
    resolutions = resolutions_from_bucket(nips, names)

    # The same pairs `resolve` refuses to spend a request on. Without them this
    # stage would silently drop every company we already hold -- 1,512 of the
    # CRU population, and 29.9% of its money -- because they are exactly the
    # ones the search was never asked about.
    known, known_names = nip_lookup.known_from_companies_merged(
        Path(args.companies_merged)
        if args.companies_merged
        else VERSIONED / "companies_merged" / "companies_merged.jsonl"
    )
    from_known = 0
    for nip in nips:
        if nip in resolutions or nip not in known:
            continue
        resolutions[nip] = nip_lookup.NipResolution(
            nip=nip, krs=known[nip], name=names.get(nip) or None, source="cache"
        )
        from_known += 1

    print("\n" + "=" * 72)
    print(
        f"FROM THE SEARCH BUCKET  {len(resolutions):,} of {len(nips):,} NIPs "
        f"have a KRS number ({from_known:,} of them from companies_merged)"
    )
    people, company_by_krs, results = fetch_and_match(
        args, resolutions, person_ids, known_names
    )
    if args.out:
        write_output(args.out, people, company_by_krs, results)
    if args.publish:
        publish(people, company_by_krs, results)
    if args.show:
        show(people, results)


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if not has_source(args):
        parser.error(
            "a source is required: --spreadsheet, --cru, --nip-list or --nip"
        )

    # The salt and USERNAME both live in data/pipelines/.env, which is
    # gitignored; every other entry point here reads it the same way.
    load_dotenv()

    # One registry for the whole run, so a person sitting on two companies'
    # boards carries one number across both documents.
    person_ids = pesel_util.PersonIds()

    date = args.date or datetime.date.today().isoformat()

    # ---------------------------------------------------------------- source
    rows, unreadable = gather_rows(args)
    nips = nip_sources.distinct_nips(rows)
    print("=" * 72)
    print("SOURCE")
    print(nip_sources.summarise(rows, unreadable))
    if unreadable:
        print(f"\n  rows whose NIP could not be read ({len(unreadable)}), first 5:")
        for row in unreadable[:5]:
            print(f"    {row.source_row}: {row.party_text[:90]}")

    if args.from_search_bucket:
        from_search_bucket(args, rows, nips, person_ids)
        return

    # ------------------------------------------------------------ NIP -> KRS
    known, known_names = nip_lookup.known_from_companies_merged(
        Path(args.companies_merged)
        if args.companies_merged
        else VERSIONED / "companies_merged" / "companies_merged.jsonl"
    )
    print("\n" + "=" * 72)
    print("NIP -> KRS")
    print(f"  NIP->KRS pairs already held  {len(known):>8,}")

    resolutions = nip_lookup.resolve(
        nips,
        date=date,
        known=known,
        max_requests=args.max_mf_requests,
        progress=lambda done, total: print(
            f"  wykaz request {done}/{total}", end="\r", flush=True
        ),
    )
    by_source = collections.Counter(r.source for r in resolutions.values())
    in_krs = [r for r in resolutions.values() if r.in_krs]
    unasked = [n for n in nips if n not in resolutions]
    print(f"  resolved                     {len(resolutions):>8,}  {dict(by_source)}")
    print(f"  have a KRS number            {len(in_krs):>8,}")
    print(f"  no KRS (CEIDG, or unlisted)  {len(resolutions) - len(in_krs):>8,}")
    if unasked:
        print(
            f"  NOT ASKED (request cap)      {len(unasked):>8,}  "
            f"-- rerun tomorrow or raise --max-mf-requests"
        )

    if args.resolve_only:
        return

    people, company_by_krs, results = fetch_and_match(
        args, resolutions, person_ids, known_names
    )

    if args.out:
        write_output(args.out, people, company_by_krs, results)
    if args.publish:
        publish(people, company_by_krs, results)
    if args.show:
        show(people, results)


def publish(people, company_by_krs, results) -> None:
    """Put the artifact where every other checkout can read it.

    The same layout the pipelines use --
    ``versioned/<name>/<name>.jsonl`` locally, and
    ``filename=<name>/user=<u>/datetime=<t>/backup.tar.gz`` in the shared
    bucket -- so seeding it elsewhere is the ordinary gcloud-cp-and-untar
    recipe rather than something special.

    Safe to publish because no PESEL is in it: the number is decoded to a birth
    date and a sex and dropped, and what stands in for it is a counter that has
    no preimage. That is checked here rather than trusted, because this is the
    one step that makes the data leave the machine.
    """
    directory = VERSIONED / ARTIFACT
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{ARTIFACT}.jsonl"
    write_output(path, people, company_by_krs, results)

    leaked = 0
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if re.search(r"\b\d{11}\b", line):
                leaked += 1
    if leaked:
        raise AssertionError(
            f"{leaked} rows of {path} hold an 11-digit run. Refusing to "
            f"upload: a PESEL must never leave this machine."
        )
    print(f"checked {path.name}: no 11-digit run in any row")

    CloudStorageClient().upload_backup_from_path(ARTIFACT, str(path))


def pick_companies(
    args, resolutions: dict[str, nip_lookup.NipResolution]
) -> tuple[list[str], dict[str, nip_lookup.NipResolution]]:
    """The distinct KRS numbers to fetch, in the order the source named them."""
    krs_numbers: list[str] = []
    company_by_krs: dict[str, nip_lookup.NipResolution] = {}
    for resolution in resolutions.values():
        if resolution.krs and resolution.krs not in company_by_krs:
            company_by_krs[resolution.krs] = resolution
            krs_numbers.append(resolution.krs)

    if args.limit_companies:
        skipped = max(len(krs_numbers) - args.limit_companies, 0)
        krs_numbers = krs_numbers[: args.limit_companies]
        if skipped:
            # A silent truncation reads as "covered everything".
            print(f"\n  --limit-companies: {skipped:,} companies NOT fetched")
    return krs_numbers, company_by_krs


def fetch_odpisy(
    krs_numbers: list[str],
    company_by_krs: dict[str, nip_lookup.NipResolution],
    person_ids: pesel_util.PersonIds,
    ctx=None,
    reparse_only: bool = False,
) -> tuple[list[odpis_pdf.OdpisPerson], list[str], set[str]]:
    """Read every company's odpis, from the bucket where one is already stored.

    Storing the PDFs is what makes a parser fix a re-parse instead of a
    re-crawl -- see `scripts.odpis_store`, and the two parser bugs that each
    cost a full re-fetch because the documents had been discarded.
    """
    people: list[odpis_pdf.OdpisPerson] = []
    failures: list[str] = []
    unread_rubryki: set[str] = set()

    stored: dict[str, str] = {}
    if ctx is not None:
        stored = odpis_store.stored_odpisy(ctx, full=True)
        print(f"  {len(stored):,} odpisy already in the bucket")
    if reparse_only and not stored:
        print("  [warn] --reparse-only but nothing is stored")

    fetched_count = 0
    read_count = 0
    for index, krs in enumerate(krs_numbers, 1):
        from_bucket = krs in stored
        if not from_bucket and reparse_only:
            continue
        if not from_bucket and fetched_count:
            time.sleep(search.REQUEST_INTERVAL)
        fetched: tuple[str, bytes] | None
        try:
            if from_bucket:
                fetched = ("?", odpis_store.read_stored(ctx, stored[krs]))
            elif ctx is not None:
                fetched = odpis_store.fetch_and_store(ctx, krs, full=True)
                fetched_count += 1
            else:
                fetched = search.fetch_odpis_pdf_either(krs, full=True)
                fetched_count += 1
        except Exception as error:  # noqa: BLE001
            # One unreadable company must not end a crawl of hundreds; the
            # count is reported instead.
            failures.append(f"{krs}: {error}")
            continue
        if fetched is None:
            failures.append(f"{krs}: no odpis in either register")
            continue
        _, content = fetched
        read_count += 1
        text = odpis_pdf.extract_text(content)
        unread_rubryki |= odpis_pdf.unread_person_rubryki(text)
        people.extend(odpis_pdf.parse_people(text, krs, person_ids=person_ids))
        name = (company_by_krs[krs].name or "")[:40]
        print(
            f"  {index}/{len(krs_numbers)} {'cache' if from_bucket else 'fetch'} "
            f"{krs} {name:<40} {len(people):>5} people so far",
            end="\r",
            flush=True,
        )
    print(" " * 110, end="\r")
    skipped = len(krs_numbers) - read_count - len(failures)
    # Counted rather than inferred from the input length: --reparse-only
    # skips whatever is not stored, and reporting those as read would
    # overstate coverage by exactly the companies nobody has fetched yet.
    print(
        f"  read {read_count:,} odpisy ({fetched_count:,} fetched, "
        f"{read_count - fetched_count:,} from the bucket)"
        + (f", {skipped:,} not stored and skipped" if skipped else "")
    )
    return people, failures, unread_rubryki


def report_people(
    people: list[odpis_pdf.OdpisPerson],
    failures: list[str],
    unread_rubryki: set[str],
) -> None:
    current = sum(1 for person in people if person.current)
    with_date = sum(1 for person in people if person.birth_date)
    print(f"  people found                 {len(people):>8,}")
    print(f"    still holding the seat     {current:>8,}")
    print(f"    struck out (former)        {len(people) - current:>8,}")
    print(f"    with a birth date          {with_date:>8,}")
    print(f"  by role: {dict(collections.Counter(p.role for p in people))}")
    if failures:
        print(f"  companies that failed        {len(failures):>8,}")
        for failure in failures[:5]:
            print(f"    {failure}")
    if unread_rubryki:
        # The guard `people_parsing.unread_person_paths` gives the JSON: a
        # section nobody has taught the parser about should be loud, because
        # the alternative is losing everybody in it with no count to notice.
        print("  [WARN] person-bearing rubryki not in ROLE_BY_RUBRYKA:")
        for rubryka in sorted(unread_rubryki):
            print(f"    {rubryka!r}")


def fetch_and_match(args, resolutions, person_ids, known_names=None):
    krs_numbers, company_by_krs = pick_companies(args, resolutions)
    # A resolution that came from the local cache carries no name, so fill it
    # from `companies_merged` -- otherwise the progress line and the output's
    # `company_name` are blank for exactly the companies we know best.
    for krs, name in (known_names or {}).items():
        resolution = company_by_krs.get(krs)
        if resolution is not None and not resolution.name:
            company_by_krs[krs] = replace(resolution, name=name)

    print("\n" + "=" * 72)
    print(f"ODPISY  ({len(krs_numbers):,} companies, ~{len(krs_numbers)}s)")
    ctx, _ = setup_context()
    people, failures, unread_rubryki = fetch_odpisy(
        krs_numbers, company_by_krs, person_ids, ctx=ctx,
        reparse_only=getattr(args, 'reparse_only', False),
    )

    if args.current_only:
        people = [person for person in people if person.current]
    report_people(people, failures, unread_rubryki)

    merged_path = (
        Path(args.people_merged)
        if args.people_merged
        else VERSIONED / "people_merged" / "people_merged.jsonl"
    )
    if not merged_path.is_file():
        print(f"\n  [skip] no people_merged at {merged_path}")
        return people, company_by_krs, []

    print("\n" + "=" * 72)
    print(f"MATCH against {merged_path.name}")
    index = people_match.load_index(merged_path)
    print(f"  PeopleMerged rows with a birth date {index.size:,}")
    results = people_match.match_all(people, index)
    print(people_match.summarise(results))
    return people, company_by_krs, results


def write_output(path, people, company_by_krs, results) -> None:
    by_person = {id(result.person): result for result in results}
    with open(path, "w", encoding="utf-8") as handle:
        for person in people:
            record = asdict(person)
            record["current"] = person.current
            record["full_name"] = person.full_name
            company = company_by_krs.get(person.krs)
            record["company_name"] = company.name if company else None
            result = by_person.get(id(person))
            matched = result.matched if result else None
            record["match_verdict"] = result.verdict if result else None
            record["koryta_id"] = matched.koryta_id if matched else None
            record["rejestrio_id"] = list(matched.rejestrio_id) if matched else None
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    print(f"\nwrote {len(people):,} people to {path}")


def show(people, results) -> None:
    print("\n" + "=" * 72)
    print(
        f"{'':2}{'role':<14}{'organ':<16}{'born':<12}{'sex':<4}"
        f"{'verdict':<12}name / funkcja"
    )
    verdicts = {id(result.person): result.verdict for result in results}
    for person in people:
        flag = "  " if person.current else "x "
        organ = (person.organ or person.organ_name or "")[:15]
        print(
            f"{flag}{person.role:<14}{organ:<16}"
            f"{person.birth_date or '-':<12}{person.sex or '-':<4}"
            f"{verdicts.get(id(person), '-'):<12}"
            f"{person.full_name} | {(person.funkcja or '')[:30]}"
        )


if __name__ == "__main__":
    main()
