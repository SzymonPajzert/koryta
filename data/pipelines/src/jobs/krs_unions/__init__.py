"""List every trade union in KRS through the register's own name search.

    koryta_krs_unions --dry-run           # count what each search would return
    koryta_krs_unions                     # search, and write the hits to the log
    koryta_krs_unions --out unions.jsonl  # write them here instead

Nothing else lists unions: they are in register S, which the bulletin names
by number only, and no public list prints their KRS. The search
(`jobs.krs_odpis.search`) is a substring match on the name that returns at
most 1,000 rows a query, so each term is asked per województwo, and a
województwo over the cap per powiat. On 2026-11-20 "ZWIĄZEK ZAWODOWY" alone
was 9,006 entries, and only Mazowieckie (1,133) and Śląskie (1,493) went over.

The register spells a city-powiat both "KATOWICE" and "M. KATOWICE", and a
filter takes only the spelling given, so both are asked. Where the powiats of
a województwo still add up to fewer entries than the województwo holds, the
run says by how many.

The hits go to `scrapers.krs.labour_unions.SEARCH_LOG` as one part per run;
`LabourUnions` reads them all. A run takes about 250 requests, a few minutes.
"""

import argparse
import gzip
import sys
import time
import typing
from collections.abc import Callable, Iterable, Sequence
from datetime import datetime
from functools import partial

import requests
from uuid_extensions import uuid7str  # type: ignore

from conductor import setup_context
from jobs.krs_odpis.search import (
    SEARCH_API_URL,
    _search_body,
    auth_headers,
    parse_search,
)
from scrapers.krs.labour_unions import SEARCH_LOG, UnionHit
from scrapers.map.teryt import read_terc
from stores.storage import Client, warsaw_tz

#: What a query can return at most: `maksymalnaLiczbaWynikow` refuses more.
CAP = 1000
PAGE = 100

#: The name fragments a union's name holds. "NSZZ" catches the Solidarność
#: units that abbreviate "Niezależny Samorządny Związek Zawodowy".
TERMS = ("ZWIĄZEK ZAWODOWY", "ZWIĄZKU ZAWODOWEGO", "ZWIĄZKÓW ZAWODOWYCH", "NSZZ")

WOJEWODZTWA = (
    "DOLNOŚLĄSKIE",
    "KUJAWSKO-POMORSKIE",
    "LUBELSKIE",
    "LUBUSKIE",
    "ŁÓDZKIE",
    "MAŁOPOLSKIE",
    "MAZOWIECKIE",
    "OPOLSKIE",
    "PODKARPACKIE",
    "PODLASKIE",
    "POMORSKIE",
    "ŚLĄSKIE",
    "ŚWIĘTOKRZYSKIE",
    "WARMIŃSKO-MAZURSKIE",
    "WIELKOPOLSKIE",
    "ZACHODNIOPOMORSKIE",
)

#: TERC's two-digit code of each województwo, to find its powiats.
WOJEWODZTWO_CODES = dict(
    zip(
        WOJEWODZTWA,
        (
            "02",
            "04",
            "06",
            "08",
            "10",
            "12",
            "14",
            "16",
            "18",
            "20",
            "22",
            "24",
            "26",
            "28",
            "30",
            "32",
        ),
    )
)


class Where(typing.NamedTuple):
    wojewodztwo: str | None = None
    powiat: str | None = None

    def __str__(self) -> str:
        return "/".join(p for p in (self.wojewodztwo, self.powiat) if p) or "Polska"


#: Asks one page: (term, where, page number) -> (entries in total, hits).
Ask = Callable[[str, Where, int], tuple[int, list]]


def ask_register(
    term: str, where: Where, page: int, interval: float = 0.5
) -> tuple[int, list]:
    body = _search_body(name=term, page_size=PAGE)
    body["rejestr"] = ["S"]
    body["podmiot"]["wojewodztwo"] = where.wojewodztwo
    body["podmiot"]["powiat"] = where.powiat
    body["paginacja"]["maksymalnaLiczbaWynikow"] = CAP
    body["paginacja"]["numerStrony"] = page
    time.sleep(interval)
    response = requests.post(
        f"{SEARCH_API_URL}wyszukiwarka/krs",
        json=body,
        headers=auth_headers(""),
        timeout=60,
    )
    if response.status_code in (400, 404):
        return 0, []
    response.raise_for_status()
    payload = response.json()
    return int(payload.get("liczbaPodmiotow") or 0), parse_search(payload)


def powiat_spellings(name: str) -> list[str]:
    """How the register may write a powiat TERC calls `name`.

    TERC writes a city-powiat capitalised ("Katowice") and a land one in
    lower case ("będziński"); the register writes either as "KATOWICE" or "M.
    KATOWICE", and Warszawa as "M. ST. WARSZAWA" too.
    """
    upper = name.upper()
    if not name[:1].isupper():
        return [upper]
    spellings = [upper, f"M. {upper}"]
    if upper == "WARSZAWA":
        spellings.append("M. ST. WARSZAWA")
    return spellings


def collect(
    term: str,
    where: Where,
    ask: Ask,
    log: Callable[[str], None] = print,
) -> tuple[int, dict[str, typing.Any]]:
    """Every hit of one filter, paging to the cap: (entries in total, hits by KRS)."""
    total, first = ask(term, where, 1)
    hits = {h.krs: h for h in first}
    pages = (min(total, CAP) + PAGE - 1) // PAGE
    for page in range(2, pages + 1):
        _, more = ask(term, where, page)
        hits.update((h.krs, h) for h in more)
    log(f"  {term} {where}: {total} entries, {len(hits)} read")
    return total, hits


def search(
    ask: Ask,
    powiats: Callable[[str], Iterable[str]],
    terms: Sequence[str] = TERMS,
    log: Callable[[str], None] = print,
) -> tuple[dict[str, tuple[typing.Any, str]], list[str]]:
    """Every union the terms find: KRS -> (hit, filter), and what was missed."""
    found: dict[str, tuple[typing.Any, str]] = {}
    shortfalls: list[str] = []

    def keep(hits: dict, where: Where, term: str) -> None:
        for krs, hit in hits.items():
            found.setdefault(krs, (hit, f"{term} {where}"))

    for term in terms:
        total, hits = collect(term, Where(), ask, log)
        keep(hits, Where(), term)
        if total <= CAP:
            continue
        for wojewodztwo in WOJEWODZTWA:
            where = Where(wojewodztwo)
            in_woj, hits = collect(term, where, ask, log)
            keep(hits, where, term)
            if in_woj <= CAP:
                continue
            reached = set(hits)
            for name in powiats(wojewodztwo):
                for spelling in powiat_spellings(name):
                    _, hits = collect(term, Where(wojewodztwo, spelling), ask, log)
                    keep(hits, Where(wojewodztwo, spelling), term)
                    reached |= set(hits)
            if (missed := in_woj - len(reached)) > 0:
                shortfalls.append(
                    f"{term} {wojewodztwo}: {missed} of {in_woj} not reached"
                )
    return found, shortfalls


def terc_powiats() -> Callable[[str], list[str]]:
    """Powiat names by województwo, from TERC, read once."""
    ctx, _ = setup_context()
    terc = read_terc(ctx)
    rows = terc[terc["POW"].notna() & terc["GMI"].isna()]
    by_code: dict[str, list[str]] = {}
    for row in rows.to_dict("records"):
        by_code.setdefault(str(row["WOJ"]).zfill(2), []).append(str(row["NAZWA"]))
    return lambda wojewodztwo: by_code.get(WOJEWODZTWO_CODES[wojewodztwo], [])


def parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="koryta_krs_unions", description=__doc__.split("\n")[0]
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Count the entries of each term; read no pages.",
    )
    parser.add_argument(
        "--out", help="Write the hits to this jsonl file instead of the shared log."
    )
    parser.add_argument(
        "--interval", type=float, default=0.5, help="Seconds between requests."
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    sys.argv = sys.argv[:1]
    ask = partial(ask_register, interval=args.interval)
    if args.dry_run:
        for term in TERMS:
            print(term, ask(term, Where(), 1)[0])
        return 0

    found, shortfalls = search(ask, terc_powiats())
    today = datetime.now(warsaw_tz).date().isoformat()
    lines = "".join(
        UnionHit(
            krs=hit.krs, name=hit.name, city=hit.city, searched=today, query=query
        ).to_line()
        + "\n"
        for hit, query in found.values()
    )
    print(f"{len(found)} unions found")
    for line in shortfalls:
        print(f"  [WARN] {line}")
    if args.out:
        with open(args.out, "w", encoding="utf-8") as out:
            out.write(lines)
        return 0
    assert SEARCH_LOG.bucket is not None
    name = f"{SEARCH_LOG.prefix}date={today}/{uuid7str()}.jsonl.gz"
    url = Client().create_object(
        SEARCH_LOG.bucket,
        name,
        gzip.compress(lines.encode("utf-8"), mtime=0),
        "application/gzip",
    )
    print(f"Written to {url}")
    return 0
