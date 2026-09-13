"""NIPs in, board and supervisory-board members out, matched to PeopleMerged.

The whole chain, in one place:

1. read NIPs from a spend spreadsheet, the CRU artifact, or a plain list;
2. resolve each to a KRS number -- from odpisy already crawled where possible,
   from the Ministry of Finance's wykaz otherwise;
3. fetch each company's *odpis pełny* and read out everyone who has ever sat on
   its board, supervisory board or held its proxy, with the organ, the
   function, and whether they still hold the seat;
4. decode each PESEL to a birth date and sex, replace it with a keyed
   fingerprint, and match the person against `PeopleMerged` on name plus full
   birth date.

    export KORYTA_PESEL_SALT=...
    uv run python src/scripts/nip_board_people.py \\
        --spreadsheet "$HOME/2026.xlsx - 2026.csv" --limit-companies 20 \\
        --out /tmp/board-people.jsonl

    uv run python src/scripts/nip_board_people.py --nip 6791862817 --show

**Nothing here writes a PESEL.** It is decoded in memory and dropped; the
output carries the birth date, the sex and an HMAC fingerprint, which is what
makes the artifact publishable. `util.pesel.fingerprint` refuses to run without
a key rather than falling back to an unkeyed digest, because a digest of an
11-digit number with a known salt is reversible by enumeration.

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
import os
import sys
import time
from dataclasses import asdict, replace
from pathlib import Path

from scrapers.krs import nip_lookup, nip_sources, odpis_pdf, people_match, search
from stores.config import VERSIONED_DIR
from util import pesel as pesel_util

#: `stores.config.VERSIONED_DIR` is a str, so every use here goes through Path.
VERSIONED = Path(VERSIONED_DIR)


def load_known_nip_to_krs(
    path: Path | None,
) -> tuple[dict[str, str], dict[str, str]]:
    """NIP-to-KRS pairs from companies we already hold.

    Free, and it is the first thing to try: every row here is a wykaz request
    not spent. `companies_merged` carries a NIP for about 93% of its
    KRS-bearing rows, which on the CRU population covered 1,678 of 61,453
    counterparties -- small in share, but the largest and most-contracted ones.
    """
    if path is None or not path.is_file():
        return {}, {}
    known: dict[str, str] = {}
    names: dict[str, str] = {}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            nip = nip_lookup.only_digits(row.get("nip"))
            krs = nip_lookup.only_digits(row.get("krs"))
            if len(nip) == 10 and krs:
                padded = krs.rjust(10, "0")
                known.setdefault(nip, padded)
                if row.get("name"):
                    names.setdefault(padded, str(row["name"]))
    return known, names


def gather_rows(args) -> tuple[list[nip_sources.NipRow], list[nip_sources.NipRow]]:
    if args.spreadsheet:
        return nip_sources.from_spreadsheet(Path(args.spreadsheet))
    if args.cru:
        path = Path(args.cru)
        if not path.is_file():
            path = VERSIONED / "cru_umowy" / "cru_umowy.jsonl"
        return nip_sources.from_cru(path, limit=args.cru_limit), []
    if args.nip_list:
        return nip_sources.from_list(Path(args.nip_list)), []
    return [nip_sources.NipRow(nips=[nip_lookup.only_digits(n)]) for n in args.nip], []


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--spreadsheet", help="a published spend list, as CSV")
    source.add_argument("--cru", nargs="?", const="", help="the cru_umowy artifact")
    source.add_argument("--nip-list", help="a file of NIPs, one per line")
    source.add_argument("--nip", nargs="+", default=[], help="NIPs on the command line")

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
    args = parser.parse_args()

    salt = os.environ.get(pesel_util.SALT_ENV)
    if not salt:
        sys.exit(
            f"{pesel_util.SALT_ENV} is not set. It keys the PESEL "
            f"fingerprints; without it they would be reversible. Set it to a "
            f"long random string and keep it stable between runs."
        )

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

    # ------------------------------------------------------------ NIP -> KRS
    known, known_names = load_known_nip_to_krs(
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
        args, resolutions, salt, known_names
    )

    if args.out:
        write_output(args.out, people, company_by_krs, results)
    if args.show:
        show(people, results)


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
    salt: str,
) -> tuple[list[odpis_pdf.OdpisPerson], list[str], set[str]]:
    people: list[odpis_pdf.OdpisPerson] = []
    failures: list[str] = []
    unread_rubryki: set[str] = set()

    for index, krs in enumerate(krs_numbers, 1):
        if index > 1:
            time.sleep(search.REQUEST_INTERVAL)
        try:
            fetched = search.fetch_odpis_pdf_either(krs, full=True)
        except Exception as error:  # noqa: BLE001
            # One unreadable company must not end a crawl of hundreds; the
            # count is reported instead.
            failures.append(f"{krs}: {error}")
            continue
        if fetched is None:
            failures.append(f"{krs}: no odpis in either register")
            continue
        _, content = fetched
        text = odpis_pdf.extract_text(content)
        unread_rubryki |= odpis_pdf.unread_person_rubryki(text)
        people.extend(odpis_pdf.parse_people(text, krs, salt=salt))
        name = (company_by_krs[krs].name or "")[:44]
        print(
            f"  {index}/{len(krs_numbers)} {krs} {name:<44} "
            f"{len(people):>5} people so far",
            end="\r",
            flush=True,
        )
    print(" " * 100, end="\r")
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


def fetch_and_match(args, resolutions, salt, known_names=None):
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
    people, failures, unread_rubryki = fetch_odpisy(
        krs_numbers, company_by_krs, salt
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
