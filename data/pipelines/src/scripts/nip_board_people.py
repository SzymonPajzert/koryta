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

    uv run python src/scripts/nip_board_people.py \\
        --spreadsheet "$HOME/2026.xlsx - 2026.csv" --limit-companies 20 \\
        --out /tmp/board-people.jsonl

    uv run python src/scripts/nip_board_people.py --nip 6791862817 --show

**Nothing here writes a PESEL.** It is decoded in memory and dropped; the
output carries the birth date, the sex and an HMAC fingerprint, which is what
makes the artifact publishable. An unkeyed digest would not: the row also
carries the birth date and sex, which leave 5,000 candidate numbers, and one
was recovered from its sha256 in 10.3 ms.

**The key lives in `~/.config/koryta/pesel-salt`, outside every checkout.** It
used to live in `data/pipelines/.env`, which is per-worktree -- so when the
workspace holding it was deleted, so was the only thing that could reproduce
the fingerprints of 6,188 already-published people. A run refuses to start
without a key rather than minting one, because a silently-new key produces
fingerprints indistinguishable from the old ones that join to nothing;
`--new-salt` is how you ask for one on purpose, and every row carries
`salt_id` so two artifacts can be told apart. `--keep-pesel` writes the
numbers themselves to a separate local file, which `--publish` refuses.

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
import sys
import time
import typing
from dataclasses import asdict, replace
from pathlib import Path

from dotenv import load_dotenv

from conductor import setup_context
from scrapers.krs import (
    nip_lookup,
    nip_sources,
    odpis_pdf,
    odpis_store,
    people_match,
    search,
)
from stores import config
from stores.storage import Client as CloudStorageClient
from util import pesel as pesel_util

#: The artifact name, in the shared cache and under versioned/. Fixed rather
#: than derived from the source, so two runs over different spreadsheets
#: publish successive versions of one dataset instead of a family of
#: near-identical ones.
ARTIFACT = "krs_odpis_people"


def resolutions_from_bucket(
    nips: typing.Sequence[str],
    names: dict[str, str] | None = None,
    cached: dict[str, dict] | None = None,
) -> dict[str, nip_lookup.NipResolution]:
    """The search answers already in the bucket, for this run's NIPs.

    Shaped like the wykaz's output so everything downstream -- company
    selection, the odpis fetch, the match -- runs unchanged.

    The population is an argument rather than a list this module knows about,
    which is what kept the two halves of the chain apart: `krs_nip_resolve
    resolve --cru` can answer all 18,364 KRS-form CRU NIPs through the
    register's own free search, and a fixed list here would read back only the
    ones it knew about, leaving the wykaz -- 3,000 NIPs a day, so 7 calendar
    days -- as the only CRU route.

    Returned in the order the source named them, not the order the bucket
    lists them: `pick_companies` truncates on `--limit-companies`, so a bucket
    ordering would make a capped run cover an arbitrary subset of the source
    rather than its head.
    """
    from scripts.krs_nip_resolve import (  # noqa: PLC0415
        _krs_entries_of,
        cached_answers,
    )

    # `cached` is a listing of ~17,000 blobs, so a caller that needs the names
    # as well passes the one it already has rather than paying for a second.
    if cached is None:
        ctx, _ = setup_context()
        cached = cached_answers(ctx)
    names = names or {}
    resolutions: dict[str, nip_lookup.NipResolution] = {}
    for nip in nips:
        payload = cached.get(nip)
        entries = _krs_entries_of(payload) if payload else ()
        if entries:
            resolutions[nip] = nip_lookup.NipResolution(
                nip=nip,
                krs=entries[0],
                also_krs=entries[1:],
                name=names.get(nip) or None,
                source="search",
            )
    return resolutions


def resolutions_for_krs(
    path: Path, known_nip: typing.Mapping[str, str] | None = None
) -> dict[str, nip_lookup.NipResolution]:
    """Register entries named directly, for the ones no NIP of ours reaches.

    The chain is keyed on NIPs because that is what a spend register gives it.
    Re-keying an artifact it has already published is the case that does not
    fit: `krs_odpis_people` holds 255 entries and only 64 of them can be
    reversed to a NIP through `companies_merged` or the search bucket, so
    without this the other 191 could not be re-fetched at all -- and a run that
    republished the artifact would silently drop 6,281 rows.

    Keyed `krs:<number>` rather than by NIP, because most of these have no NIP
    and one empty-string key would collapse them all into a single entry.
    """
    known_nip = known_nip or {}
    out: dict[str, nip_lookup.NipResolution] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        krs = nip_lookup.newest_first(line.strip())
        if not krs:
            continue
        out.setdefault(
            f"krs:{krs[0]}",
            nip_lookup.NipResolution(
                nip=known_nip.get(krs[0], ""), krs=krs[0], source="krs-list"
            ),
        )
    return out


def known_nip_by_krs(
    known: typing.Mapping[str, str | typing.Sequence[str]],
) -> dict[str, str]:
    """Invert the NIP-to-entries mapping, so a named entry can still carry one."""
    out: dict[str, str] = {}
    for nip, entries in known.items():
        for krs in nip_lookup.newest_first(entries):
            out.setdefault(krs, nip)
    return out


def add_named_entries(
    args,
    resolutions: dict[str, nip_lookup.NipResolution],
    known_nip: typing.Mapping[str, str],
) -> dict[str, nip_lookup.NipResolution]:
    """`--also-krs`, minus whatever the source already reaches.

    Reported rather than added silently: the count that matters is how many of
    the named entries the population did *not* already cover, since that is
    what the run costs on top of what was priced.
    """
    if not getattr(args, "also_krs", None):
        return {}
    already = {krs for r in resolutions.values() for krs in r.krs_entries}
    named = resolutions_for_krs(Path(args.also_krs), known_nip)
    extra = {
        key: resolution
        for key, resolution in named.items()
        if resolution.krs not in already
    }
    print(
        f"  --also-krs                   {len(extra):>8,}  "
        f"({len(named) - len(extra):,} of {len(named):,} already in the population)"
    )
    return extra


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
            path = config.require_artifact("cru_umowy", "CruUmowy", "--cru")
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

    parser.add_argument(
        "--also-krs",
        help=(
            "a file of KRS numbers to fetch as well, one per line. Not a "
            "source: it names register entries directly, for the entries no "
            "NIP in our data reaches"
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
        "--new-salt",
        action="store_true",
        help=(
            "mint a PESEL key when this machine has none. A new key renumbers "
            "every person, so anything published under the old one stops "
            "joining -- find the old key before reaching for this"
        ),
    )
    parser.add_argument(
        "--keep-pesel",
        help=(
            "also write fingerprint->PESEL to this local file, for offline "
            "work. Refused together with --publish"
        ),
    )
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


def merge_resolutions(
    nips: typing.Sequence[str],
    from_bucket: dict[str, nip_lookup.NipResolution],
    known: typing.Mapping[str, str | typing.Sequence[str]],
    names: typing.Mapping[str, str] | None = None,
) -> dict[str, nip_lookup.NipResolution]:
    """The two sources of a KRS number, in the order the population names them.

    **One pass over `nips`, not two dicts merged**, and that is the whole point.
    Filling from the bucket and then appending the `companies_merged` pairs
    leaves a dict ordered [every search hit] ++ [every cached pair], and
    `pick_companies` truncates on `--limit-companies` in exactly that order --
    so a capped run cuts by *where the KRS came from* rather than by value.

    Measured on the CRU population: a NIP falls back to `companies_merged`
    whenever `_krs_of` returns None, which includes every multi-hit search
    answer -- and a group filed in both registers has two hits. POLREGIO, the
    largest counterparty in the register at 1.16 bn PLN, is one of those, so
    the appended form put it at position ~13,800 and a cap of 2,000 dropped it,
    together with 8 more of the top 2,000 and 1.32 bn PLN of their money.

    The bucket wins where both answer: it is the register replying about this
    NIP today, against a pair recorded whenever the company was last crawled.
    """
    names = names or {}
    resolutions: dict[str, nip_lookup.NipResolution] = {}
    for nip in nips:
        if nip in resolutions:
            continue
        if nip in from_bucket:
            resolutions[nip] = from_bucket[nip]
        elif nip in known:
            entries = nip_lookup.newest_first(known[nip])
            if not entries:
                continue
            resolutions[nip] = nip_lookup.NipResolution(
                nip=nip,
                krs=entries[0],
                also_krs=entries[1:],
                name=names.get(nip) or None,
                source="cache",
            )
    return resolutions


def from_search_bucket(args, rows, nips, salt, pesel_sink=None) -> None:
    """Run the odpis half against the answers the register's search left us.

    The wykaz could not see these at all; the register's own search could, and
    its answers are already in the bucket. So the whole NIP-to-KRS stage is
    skipped and its output reconstructed.
    """
    from scripts.krs_nip_resolve import (  # noqa: PLC0415
        _names_of,
        cached_answers,
    )

    names: dict[str, str] = {}
    for row in rows:
        for nip in row.nips:
            if row.party_text:
                names.setdefault(nip, row.party_text)

    ctx, _ = setup_context()
    cached = cached_answers(ctx)
    from_bucket = resolutions_from_bucket(nips, names, cached)

    # The register's own name for each entry, which the stored answers have
    # carried all along. Without it a company is named only if we separately
    # hold it, so on a `--nip-list` source -- which has no party text at all --
    # most rows were published with `company_name: null`.
    search_names: dict[str, str] = {}
    for nip in nips:
        payload = cached.get(nip)
        if payload:
            search_names.update(_names_of(payload))

    # The same pairs `resolve` refuses to spend a request on. Without them this
    # stage would silently drop every company we already hold -- 1,512 of the
    # CRU population, and 29.9% of its money -- because they are exactly the
    # ones the search was never asked about.
    known, known_names = nip_lookup.known_from_companies_merged(
        Path(args.companies_merged)
        if args.companies_merged
        else config.optional_artifact(
            "companies_merged",
            "Companies",
            "the pairs we already hold cannot be reused and the wykaz is asked "
            "about them again",
        )
    )
    resolutions = merge_resolutions(nips, from_bucket, known, names)
    from_known = sum(1 for r in resolutions.values() if r.source == "cache")

    # `companies_merged` wins where both name an entry: it is the name the site
    # already shows, so the artifact and a koryta page agree.
    known_names = {**search_names, **known_names}

    print("\n" + "=" * 72)
    print(
        f"FROM THE SEARCH BUCKET  {len(resolutions):,} of {len(nips):,} NIPs "
        f"have a KRS number ({from_known:,} of them from companies_merged)"
    )
    # After the count, because that count is about NIPs and these are not
    # reached through one -- folded in earlier it read "2,468 of 2,361 NIPs".
    resolutions.update(add_named_entries(args, resolutions, known_nip_by_krs(known)))

    # The wykaz path returns here too. Without it `--resolve-only` -- the one
    # flag whose whole job is "tell me where this stands and fetch nothing" --
    # began an hours-long crawl of a government service, which is the opposite
    # of what it says and the worst direction for the mistake to run.
    if args.resolve_only:
        report_resolution(nips, resolutions)
        return

    people, company_by_krs, results = fetch_and_match(
        args, resolutions, salt, known_names, pesel_sink
    )
    if args.out:
        write_output(args.out, people, company_by_krs, results, salt)
    if args.keep_pesel and pesel_sink:
        write_pesel_table(args.keep_pesel, pesel_sink)
    if args.publish:
        publish(people, company_by_krs, results, salt)
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

    salt = config.pesel_salt(create=args.new_salt)
    if not salt:
        sys.exit(
            f"No PESEL key. It keys the fingerprints, and without it they "
            f"would be reversible by enumeration.\n"
            f"  expected in {config.PESEL_SALT_FILE}, or ${pesel_util.SALT_ENV}\n"
            f"  pass --new-salt to mint one -- but a NEW key renumbers every "
            f"person, so anything already published under the old one stops "
            f"joining. Find the old key first."
        )
    if args.new_salt:
        print(f"minted a new PESEL key in {config.PESEL_SALT_FILE}")
    print(f"PESEL key salt_id {pesel_util.salt_id(salt)}")

    # Filled only when asked for, and never written to the published artifact.
    pesel_sink: dict[str, str] | None = {} if args.keep_pesel else None
    if args.keep_pesel and args.publish:
        sys.exit("--keep-pesel and --publish are mutually exclusive.")

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
        from_search_bucket(args, rows, nips, salt, pesel_sink)
        return

    # ------------------------------------------------------------ NIP -> KRS
    known, known_names = nip_lookup.known_from_companies_merged(
        Path(args.companies_merged)
        if args.companies_merged
        else config.optional_artifact(
            "companies_merged",
            "Companies",
            "the pairs we already hold cannot be reused and the wykaz is asked "
            "about them again",
        )
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

    resolutions.update(add_named_entries(args, resolutions, known_nip_by_krs(known)))

    if args.resolve_only:
        report_odpis_cost(resolutions)
        return

    people, company_by_krs, results = fetch_and_match(
        args, resolutions, salt, known_names, pesel_sink
    )

    if args.out:
        write_output(args.out, people, company_by_krs, results, salt)
    if args.keep_pesel and pesel_sink:
        write_pesel_table(args.keep_pesel, pesel_sink)
    if args.publish:
        publish(people, company_by_krs, results, salt)
    if args.show:
        show(people, results)


def publish(people, company_by_krs, results, salt=None) -> None:
    """Put the artifact where every other checkout can read it.

    The same layout the pipelines use --
    ``versioned/<name>/<name>.jsonl`` locally, and
    ``filename=<name>/user=<u>/datetime=<t>/backup.tar.gz`` in the shared
    bucket -- so seeding it elsewhere is the ordinary gcloud-cp-and-untar
    recipe rather than something special.

    Safe to publish because no PESEL is in it: the number is decoded to a birth
    date and a sex and dropped, and what stands in for it is an HMAC under a
    key that stays on this machine. That is checked here rather than trusted,
    because this is the one step that makes the data leave the machine.
    """
    path = config.artifact_path(ARTIFACT)
    path.parent.mkdir(parents=True, exist_ok=True)
    write_output(path, people, company_by_krs, results, salt)

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


def report_resolution(nips, resolutions: dict[str, nip_lookup.NipResolution]) -> None:
    """What `--resolve-only` is reached for: where this stands, and its price.

    The odpis count is not the company count. A taxpayer with an earlier
    register entry costs one request per entry, so the figure that prices the
    fetch is the number of distinct entries -- and saying "N companies" where
    the run will make N+1,300 requests is how a paced crawl overruns the window
    somebody left for it.
    """
    # Only the resolutions that came from a NIP can answer "how many of the
    # NIPs are still unresolved". `--also-krs` entries are in the same dict and
    # are not NIPs, so counting them here printed a negative: -167 on a run
    # that named 251 entries.
    from_nip = sum(1 for r in resolutions.values() if r.source != "krs-list")
    print(f"  no KRS number yet            {len(nips) - from_nip:>8,}")
    report_odpis_cost(resolutions)


def report_odpis_cost(resolutions: dict[str, nip_lookup.NipResolution]) -> None:
    """What the fetch will cost, on whichever path asked.

    Both paths take `--resolve-only` and only one of them said this, so the
    same flag priced the run or did not depending on where the KRS numbers came
    from -- and the wykaz path is the one whose own report is about NIPs alone,
    so it was the one missing it.
    """
    entries = {krs for r in resolutions.values() for krs in r.krs_entries}
    superseded = len(entries) - len(resolutions)
    print(f"  odpisy to fetch              {len(entries):>8,}", end="")
    if superseded:
        print(f"  ({superseded:,} superseded entries)", end="")
    # A floor, not an estimate: `REQUEST_INTERVAL` is the delay *between*
    # requests and the service's own response time is on top of it. Said as
    # "about N hours" it would be read as the budget to leave for the run.
    floor = len(entries) * search.REQUEST_INTERVAL / 3600
    print(f"\n  at {search.REQUEST_INTERVAL}s between requests {floor:>8.1f} h and up")


def pick_companies(
    args, resolutions: dict[str, nip_lookup.NipResolution]
) -> tuple[list[str], dict[str, nip_lookup.NipResolution]]:
    """The distinct KRS numbers to fetch, in the order the source named them.

    A taxpayer's earlier register entries follow its open one, adjacently, so
    `--limit-companies` cuts between companies rather than through one -- half
    a transformed company's board history is a worse answer than none of it,
    because nothing downstream would say which half was missing.
    """
    krs_numbers: list[str] = []
    company_by_krs: dict[str, nip_lookup.NipResolution] = {}
    for resolution in resolutions.values():
        for krs in resolution.krs_entries:
            if krs not in company_by_krs:
                company_by_krs[krs] = resolution
                krs_numbers.append(krs)

    if args.limit_companies:
        skipped = krs_numbers[args.limit_companies :]
        krs_numbers = krs_numbers[: args.limit_companies]
        if skipped:
            # A silent truncation reads as "covered everything". Naming the
            # first few says where the cut actually fell, which a count alone
            # does not -- and the cut is only meaningful if this list is in
            # the order the source meant, so it is worth being able to see it.
            print(f"\n  --limit-companies: {len(skipped):,} companies NOT fetched")
            for krs in skipped[:5]:
                resolution = company_by_krs[krs]
                print(f"      first dropped: {krs}  {(resolution.name or '')[:50]}")
    return krs_numbers, company_by_krs


def fetch_odpisy(
    krs_numbers: list[str],
    company_by_krs: dict[str, nip_lookup.NipResolution],
    salt: str,
    ctx=None,
    reparse_only: bool = False,
    pesel_sink: dict[str, str] | None = None,
) -> tuple[list[odpis_pdf.OdpisPerson], list[str], set[str]]:
    """Read every company's odpis, from the bucket where one is already stored.

    Storing the PDFs is what makes a parser fix a re-parse instead of a
    re-crawl -- see `scrapers.krs.odpis_store`, and the two parser bugs that each
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
        people.extend(
            odpis_pdf.parse_people(text, krs, salt=salt, pesel_sink=pesel_sink)
        )
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


def fetch_and_match(args, resolutions, salt, known_names=None, pesel_sink=None):
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
        krs_numbers, company_by_krs, salt, ctx=ctx, pesel_sink=pesel_sink,
        reparse_only=getattr(args, 'reparse_only', False),
    )

    if args.current_only:
        people = [person for person in people if person.current]
    report_people(people, failures, unread_rubryki)

    merged_path = (
        Path(args.people_merged)
        if args.people_merged
        else config.artifact_path("people_merged")
    )
    if not merged_path.is_file():
        # Skipping the match is a legitimate way to run -- `--nip <n> --show`
        # on a checkout that has built nothing is how you look at one company.
        # Publishing the result of one is not: every row would carry
        # `match_verdict: null`, which reads in the artifact as "matched
        # against PeopleMerged and found nobody" rather than "never asked",
        # and there is nothing in the file to tell the two apart.
        if args.publish:
            raise SystemExit(
                f"\n{merged_path} is missing, so nobody can be matched, and "
                f"--publish would file {len(people):,} people as unmatched "
                f"rather than as unchecked.\n"
                f"Build it with:  uv run koryta PeopleMerged"
            )
        print(
            f"\n  [WARN] no people_merged at {merged_path}, so all "
            f"{len(people):,} people stay unmatched.\n"
            f"         Build it with:  uv run koryta PeopleMerged"
        )
        return people, company_by_krs, []

    print("\n" + "=" * 72)
    print(f"MATCH against {merged_path.name}")
    index = people_match.load_index(merged_path)
    print(f"  PeopleMerged rows with a birth date {index.size:,}")
    results = people_match.match_all(people, index)
    print(people_match.summarise(results))
    return people, company_by_krs, results


def write_output(path, people, company_by_krs, results, salt=None) -> None:
    """The artifact, one person-seat per line.

    `salt_id` goes on every row rather than into a sidecar, because rows get
    sliced, concatenated and re-uploaded -- and a fingerprint whose key nobody
    can name is a join waiting to pair unrelated people.

    `nip` goes on for the same reason. A company that has been transformed has
    several `krs` values here, and without the taxpayer's own number nothing in
    the artifact says they are one company -- a reader would count EMITEL twice
    and find its pre-2018 board under a KRS that answers to no name it knows.
    `krs_is_open_entry` says which of them is the entry still standing.
    """
    by_person = {id(result.person): result for result in results}
    key = pesel_util.salt_id(salt) if salt else None
    with open(path, "w", encoding="utf-8") as handle:
        for person in people:
            record = asdict(person)
            record["salt_id"] = key
            record["current"] = person.current
            record["full_name"] = person.full_name
            company = company_by_krs.get(person.krs)
            record["company_name"] = company.name if company else None
            # `or None` because `--also-krs` names entries that reach us
            # through no NIP at all, and it sets "" for them. Two spellings of
            # "unknown" in one published column is a trap for whoever filters
            # on it -- an empty string is truthy in some readers and not in
            # SQL's `IS NULL`.
            record["nip"] = (company.nip or None) if company else None
            record["krs_is_open_entry"] = (
                company.krs == person.krs if company else None
            )
            result = by_person.get(id(person))
            matched = result.matched if result else None
            record["match_verdict"] = result.verdict if result else None
            record["koryta_id"] = matched.koryta_id if matched else None
            record["rejestrio_id"] = list(matched.rejestrio_id) if matched else None
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    print(f"\nwrote {len(people):,} people to {path}")


def write_pesel_table(path, sink: dict[str, str]) -> None:
    """The fingerprint-to-PESEL lookup `--keep-pesel` asks for.

    A separate file from the artifact, and deliberately not a column on it:
    `OdpisPerson` has nowhere to put a PESEL, so nothing that walks the people
    can carry one into `publish`. This file stays on this machine.
    """
    with open(path, "w", encoding="utf-8") as handle:
        for digest, pesel in sink.items():
            handle.write(
                json.dumps({"pesel_fingerprint": digest, "pesel": pesel}) + "\n"
            )
    print(f"wrote {len(sink):,} PESELs to {path} -- KEEP THIS LOCAL")


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
