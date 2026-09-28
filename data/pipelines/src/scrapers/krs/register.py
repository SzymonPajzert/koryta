"""What the register says about every company in the KRS bulletin.

A company reaches `ScrapeRejestrIO` only through a door that already knows its
number: a seed list, somebody's person feed, or an owner already in the crawl.
For a company owned by a gmina, a powiat or a województwo that can be none of
them. Pomorski Fundusz Pożyczkowy (KRS 0000225512) is 90.6% Województwo
Pomorskie, sits in no seed list and is not in the public-service catalogue -
its Kujawsko-Pomorski twin is - nobody on its board ever had their feed bought,
and a województwo has no KRS number for an ownership graph to walk from. So the
crawl never met it, though its register entry says who owns it in plain words.

The register can be asked, and costs nothing. Every entity whose entry changes
is named in the daily bulletin `KRSUpdates` reads: 716,744 distinct KRS numbers
between 2025-06-01 and 2026-09-26, which is the whole living register, since a
company that files its accounts changes. Its OdpisAktualny names the owners -
every wspólnik of a spółka z o.o. with 10% or more, and an S.A.'s shareholder
when there is only one. `KRSRegisterOwners` reads those odpisy, a bounded number
per run, and keeps what each says; `CompaniesPublicByRegister` then decides
which of them the public owns.

It is a ledger, not a crawl. The bucket layout `CompaniesKRS` reads holds one
object per response and every one of them is parsed on every run, which is right
for the ~11k companies the site is about and wrong for 700k it mostly is not.
Only the fields that answer "who owns this" are kept, one row per company, and
a company the public turns out to own goes through the ordinary door from there:
`scrape_krs_free` fetches its odpis into the crawl like any other starter's.

Run it on its own; nothing else asks it to fetch:

    koryta KRSRegisterOwners --refresh KRSRegisterOwners --register-sweep-limit 20000
"""

import argparse
import re
import time
from dataclasses import asdict, dataclass, field
from datetime import date
from functools import cache

import pandas as pd
import requests
from tqdm import tqdm

from scrapers.krs.columns import iso_dates, normalise, padded_krs
from scrapers.krs.updates import KRSUpdates
from scrapers.map.jst import normalise as normalise_name
from scrapers.stores import Context, Pipeline

ODPIS_URL = "https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/{krs}?rejestr={rejestr}&format=json"

#: The two registers, in the order they are asked. A company is in P, and so is
#: most of what the bulletin names; S is associations, foundations and SPZOZ.
REGISTERS = ("P", "S")

#: What asking about a company came to.
STATUS_OK = "ok"
#: The register holds the entry but has no current extract of it - HTTP 204.
#: Every one sampled was a company struck off since the bulletin named it.
STATUS_STRUCK_OFF = "struck_off"
#: Neither register knows the number.
STATUS_NOT_FOUND = "not_found"
#: The request did not come back. Asked again on the next run, first.
STATUS_FAILED = "failed"

#: Consecutive failures after which a run stops rather than recording the rest
#: of its queue as failed. The server is down or refusing, and a row per
#: company saying so is worth nothing.
MAX_CONSECUTIVE_FAILURES = 20


def add_arguments(parser: argparse.ArgumentParser) -> None:
    """Registers the sweep's flags on a parser.

    Called by `koryta.get_args` as well as here, for the reason
    `scrapers.cru.config.add_arguments` gives: an unregistered flag's value
    would be read as a pipeline name.
    """
    parser.add_argument(
        "--register-sweep-limit",
        type=int,
        default=0,
        help="How many register entries KRSRegisterOwners may fetch this run. "
        "0, the default, fetches nothing and carries the ledger forward, so a "
        "refresh reached through a dependency never starts a sweep.",
    )
    parser.add_argument(
        "--register-sweep-interval",
        type=float,
        default=0.25,
        help="Seconds between requests to api-krs. It is a government API "
        "that asks for no key; keep it polite.",
    )


@cache
def args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    add_arguments(parser)
    return parser.parse_known_args()[0]


@dataclass
class RegisterEntry:
    """One company as the register described it on the day it was asked."""

    krs: str
    #: The day the register was asked, which is what a later bulletin entry
    #: is compared against to decide the answer is out of date.
    swept: str
    status: str
    rejestr: str | None = None
    name: str | None = None
    form: str | None = None
    nip: str | None = None
    regon: str | None = None
    #: The seat as the register names it - clean uppercase nominatives, which
    #: is what `JstIndex.wojewodztwo_code` reads.
    wojewodztwo: str | None = None
    powiat: str | None = None
    gmina: str | None = None
    #: Every owner that is not a person: `{"name", "krs", "regon", "shares",
    #: "whole"}`, `krs` None where the register writes 0000000000 or nothing,
    #: which is how it writes a gmina, a województwo or the Treasury. `shares`
    #: is the register's own text; `owner_share` reads a fraction out of it.
    owners: list[dict] = field(default_factory=list)
    #: People are masked in api-krs and say nothing about public ownership, so
    #: they are counted rather than kept.
    person_owners: int = 0
    #: `organPodmiotZalozycielskiMinisterNadzorujacy` - a founding or
    #: supervising body, which is how an SPZOZ, a state enterprise or an
    #: institute says who it belongs to.
    founding_organ: bool = False
    #: `dataOstatniegoWpisu`, as an ISO date.
    last_entry: str | None = None
    #: Share capital in PLN - what an owner's stake is a fraction of.
    capital: float | None = None


def iso_date(value: str | None) -> str | None:
    """The register's "13.08.2026" as "2026-08-13"."""
    if not value:
        return None
    parts = value.split(".")
    if len(parts) != 3:
        return value
    day, month, year = parts
    return f"{year}-{month}-{day}"


def summarise_odpis(krs: str, rejestr: str, data: dict, swept: str) -> RegisterEntry:
    """The ownership-relevant fields of one OdpisAktualny response."""
    odpis = data["odpis"]
    naglowek = odpis.get("naglowekA") or {}
    dzial1 = (odpis.get("dane") or {}).get("dzial1") or {}
    podmiot = dzial1.get("danePodmiotu") or {}
    identyfikatory = podmiot.get("identyfikatory") or {}
    siedziba = (dzial1.get("siedzibaIAdres") or {}).get("siedziba") or {}

    owners: list[dict] = []
    person_owners = 0
    for row in (dzial1.get("wspolnicySpzoo") or []) + (
        dzial1.get("jedynyAkcjonariusz") or []
    ):
        # A person comes masked, as a surname and first names, never a `nazwa`.
        if "nazwisko" in row or "imiona" in row:
            person_owners += 1
            continue
        owner_krs = ((row.get("krs") or {}).get("krs")) or None
        if owner_krs == "0000000000":
            owner_krs = None
        owners.append(
            {
                "name": row.get("nazwa"),
                "krs": owner_krs,
                "regon": ((row.get("identyfikator") or {}).get("regon")) or None,
                "shares": row.get("posiadaneUdzialy"),
                "whole": bool(
                    row.get("czyPosiadaCaloscUdzialow")
                    or row.get("czyPosiadaCaloscAkcji")
                ),
            }
        )

    return RegisterEntry(
        krs=krs,
        swept=swept,
        status=STATUS_OK,
        rejestr=rejestr,
        name=podmiot.get("nazwa"),
        form=podmiot.get("formaPrawna"),
        nip=identyfikatory.get("nip"),
        regon=identyfikatory.get("regon"),
        wojewodztwo=siedziba.get("wojewodztwo"),
        powiat=siedziba.get("powiat"),
        gmina=siedziba.get("gmina"),
        owners=owners,
        person_owners=person_owners,
        founding_organ="organPodmiotZalozycielskiMinisterNadzorujacy" in dzial1,
        last_entry=iso_date(naglowek.get("dataOstatniegoWpisu")),
        capital=amount(
            (
                (dzial1.get("kapital") or {}).get("wysokoscKapitaluZakladowego") or {}
            ).get("wartosc")
        ),
    )


def amount(text: str | None) -> float | None:
    """A register amount - "23.247.602,00" or "25673465,00" - in PLN."""
    if not text:
        return None
    digits = text.replace(" ", "").replace(".", "").replace(",", ".")
    try:
        return float(digits)
    except ValueError:
        return None


#: The value an owner's shares are worth, as the register words it:
#: "23.086 UDZIAŁÓW O ŁĄCZNEJ WARTOŚCI 23.247.602,00 ZŁ." The total comes after
#: "ŁĄCZNEJ WARTOŚCI"; a bare "WARTOŚCI" can be the value of one share, so it
#: is read only when no total is given.
_TOTAL_VALUE = re.compile(r"LACZNEJ WARTOSCI\s*(?:NOMINALNEJ\s*)?(\d[\d .]*(?:,\d+)?)")
_ANY_VALUE = re.compile(r"WARTOSCI\s*(?:NOMINALNEJ\s*)?(\d[\d .]*(?:,\d+)?)")


def owner_share(owner: dict, capital: float | None) -> float | None:
    """The fraction of the company one owner holds, where the register says.

    Pomorski Fundusz Pożyczkowy: 23,247,602 of 25,673,465 PLN, 0.906. A
    minority is worth knowing before a company is called public - Gdańskie
    Przedsiębiorstwo Energetyki Cieplnej is 0.171 Gmina Miasto Gdańsk and
    0.829 Stadtwerke Leipzig.
    """
    if owner.get("whole"):
        return 1.0
    text = normalise_name(owner.get("shares") or "")
    match = _TOTAL_VALUE.search(text) or _ANY_VALUE.search(text)
    value = amount(match.group(1).strip()) if match else None
    if value is None or not capital:
        return None
    share = value / capital
    return round(share, 4) if 0 < share <= 1.0001 else None


def fetch_entry(
    session: requests.Session, krs: str, swept: str, interval: float
) -> RegisterEntry:
    """Ask both registers about one KRS number, P first.

    A 404 moves on to the other register; a 204 is an answer - the entry is
    there and has no current extract - and so is an odpis. Anything else is
    retried a few times and then recorded as a failure, which the next run
    asks again.
    """
    for rejestr in REGISTERS:
        response = None
        for attempt in range(3):
            try:
                response = session.get(
                    ODPIS_URL.format(krs=krs, rejestr=rejestr), timeout=30
                )
            except requests.RequestException:
                response = None
            if response is not None and response.status_code in (200, 204, 404):
                break
            time.sleep(5 * (attempt + 1))
        if response is None or response.status_code not in (200, 204, 404):
            return RegisterEntry(krs=krs, swept=swept, status=STATUS_FAILED)
        if response.status_code == 204:
            return RegisterEntry(
                krs=krs, swept=swept, status=STATUS_STRUCK_OFF, rejestr=rejestr
            )
        if response.status_code == 200:
            try:
                data = response.json()
            except ValueError:
                return RegisterEntry(krs=krs, swept=swept, status=STATUS_FAILED)
            if "odpis" in data:
                return summarise_odpis(krs, rejestr, data, swept)
        # A 404, or a 200 whose body says "Not Found": try the other register.
        time.sleep(interval)
    return RegisterEntry(krs=krs, swept=swept, status=STATUS_NOT_FOUND)


COLUMNS = list(RegisterEntry.__dataclass_fields__)


def due_for_a_read(ledger: pd.DataFrame, updates: pd.DataFrame) -> list[str]:
    """The KRS numbers owed a read, in the order to read them.

    Three kinds, in this order:

    - a read that failed, because it is a known gap and is usually cheap to
      close;
    - an answer the register has moved on from - named in the bulletin after
      the day it was read - since an owner may be what changed;
    - a number never read, **oldest first**. The queue is 700k long and the
      prize is sparse, and the prize is old: 53% of the publicly owned spółki
      in the public-service catalogue have a KRS number under 200,000 and 86%
      under 500,000, against a third of the register. Reading in number order
      gets to most of them in a fraction of the time.
    """
    if updates.empty:
        return []
    changed = normalise(updates, "date").groupby("krs")["date"].max()
    if ledger.empty:
        return sorted(changed.index, key=int)

    swept = pd.Series(iso_dates(ledger["swept"]).values, index=ledger["krs"])
    status = pd.Series(ledger["status"].values, index=ledger["krs"])
    failed = sorted(status[status == STATUS_FAILED].index, key=int)

    known = changed[changed.index.isin(swept.index)]
    moved = known[known > swept.reindex(known.index)]
    moved_ids = sorted(set(moved.index) - set(failed), key=int)

    never = sorted(set(changed.index) - set(swept.index), key=int)
    return failed + moved_ids + never


class KRSRegisterOwners(Pipeline[RegisterEntry]):
    """A ledger of who owns every company the bulletin names. See module doc."""

    filename = "krs_register_owners"
    dtype = {"krs": str, "nip": str, "regon": str}

    updates: KRSUpdates

    @property
    def output_class(self):
        return RegisterEntry

    def ledger(self, ctx: Context) -> pd.DataFrame:
        """What earlier runs found, or an empty ledger on the first one."""
        try:
            previous = self.read(ctx)
        except Exception as e:  # missing locally and in the shared cache
            print(f"No earlier register ledger ({e}); starting an empty one")
            previous = None
        if previous is None or previous.empty:
            return pd.DataFrame(columns=COLUMNS)
        previous["krs"] = padded_krs(previous["krs"])
        return previous

    def process(self, ctx: Context) -> pd.DataFrame:
        ledger = self.ledger(ctx)
        limit = args().register_sweep_limit
        if limit <= 0:
            print(
                f"Register ledger carried forward: {len(ledger)} entries, "
                "nothing fetched (--register-sweep-limit is 0)"
            )
            return ledger

        queue = due_for_a_read(ledger, self.updates.read_or_process(ctx))
        print(f"Register entries owed a read: {len(queue)}, reading {limit}")
        queue = queue[:limit]

        swept = date.today().isoformat()
        interval = args().register_sweep_interval
        session = requests.Session()
        rows: list[RegisterEntry] = []
        failures = 0
        try:
            for krs in tqdm(queue, desc="Reading the register"):
                entry = fetch_entry(session, krs, swept, interval)
                rows.append(entry)
                failures = failures + 1 if entry.status == STATUS_FAILED else 0
                if failures >= MAX_CONSECUTIVE_FAILURES:
                    print(f"{failures} reads in a row failed; stopping here")
                    break
                time.sleep(interval)
        except KeyboardInterrupt:
            # What was read is kept: the ledger is written on the way out.
            print(f"Interrupted after {len(rows)} reads; keeping them")

        fresh = pd.DataFrame([asdict(row) for row in rows], columns=COLUMNS)
        kept = ledger[~ledger["krs"].isin(fresh["krs"])]
        merged = pd.concat([kept, fresh], ignore_index=True)
        counts = fresh["status"].value_counts().to_dict() if len(fresh) else {}
        print(f"Read {len(fresh)} register entries: {counts}; ledger {len(merged)}")
        return merged
