"""What the register says about who owns each company in the KRS bulletin.

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
when there is only one.

Asking is a job, `jobs.krs_register_owners`: it reads the head of
`KRSRegisterQueue` and appends every answer, verbatim, to `RESPONSE_LOG`. This
module is the pipeline half. `KRSRegisterEntries` folds the log into the ledger,
one row per company with the fields that answer "who owns this";
`KRSRegisterQueue` says which numbers are owed a read; and
`CompaniesPublicByRegister` decides which companies the public owns. None of
them keeps anything between runs: delete their output and the next run builds
the same from the log and the bulletin.

The log is not in the crawl bucket. `CompaniesKRS`, `KRSAlreadyScraped` and
`KRSCensoredPeople` read everything under `hostname=api-krs.ms.gov.pl`, which is
right for the ~11k companies the site is about and wrong for 700k it mostly is
not: every odpis there becomes a company. A company the public turns out to own
goes through the ordinary door instead - `scrape_krs_free` fetches its odpis
into the crawl like any other starter's.
"""

import gzip
import json
import re
import typing
from dataclasses import asdict, dataclass, field
from datetime import datetime

import pandas as pd

from scrapers.krs.columns import iso_dates, normalise, padded_krs
from scrapers.krs.updates import KRSUpdates
from scrapers.map.jst import normalise as normalise_name
from scrapers.stores import CloudStorage, Context, Pipeline

#: What asking about a company came to.
STATUS_OK = "ok"
#: The register holds the entry but has no current extract of it - HTTP 204.
#: Every one sampled was a company struck off since the bulletin named it.
STATUS_STRUCK_OFF = "struck_off"
#: Neither register knows the number.
STATUS_NOT_FOUND = "not_found"
#: The request did not come back. Asked again on the next run, first.
STATUS_FAILED = "failed"

#: Where `jobs.krs_register_owners` writes what the register answered, and where
#: `KRSRegisterEntries` reads it back: gzipped jsonl parts, one `RegisterRead`
#: per line, written once and never rewritten, under
#: `date=<Warsaw date>/<run>-<seq>.jsonl.gz`. A part is immutable, which is what
#: lets `downloaded/` - keyed by object name, never revalidated - cache it.
RESPONSE_LOG = CloudStorage(
    prefix="jobs/krs_register_owners/responses/",
    bucket="koryta-pl-sharedcache",
    binary=True,
)


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
#: "ŁĄCZNEJ", and the noun after that varies: of 5,215 owners in odpisy read
#: 2026-09-28, 345 wrote "O ŁĄCZNEJ WYSOKOŚCI" and a few "ŁĄCZNA WYSOKOŚĆ",
#: "NA ŁĄCZNĄ KWOTĘ" or "W ŁĄCZNEJ KWOCIE". A bare "WARTOŚCI" can be the value
#: of one share, so it is read only when no total is given.
_TOTAL_VALUE = re.compile(
    r"LACZN\w*\s*(?:WARTOSC|WYSOKOSC|KWOT|KWOC)\w*\s*(?:NOMINALN\w*\s*)?"
    r"(\d[\d .]*(?:,\d+)?)"
)
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


@dataclass
class RegisterRead:
    """One question put to the register about one KRS number, as it was logged.

    The unit of `RESPONSE_LOG`. The odpis is kept whole rather than summarised,
    so that a new field or a parser fix is a fold of the log and not another
    700k requests.
    """

    krs: str
    #: When the answer came, as an ISO timestamp in Warsaw time - the clock the
    #: crawl bucket's `date=` segments use. Its date is the ledger's `swept`.
    read_at: str
    status: str
    #: The register that answered, P or S; None where neither did.
    rejestr: str | None = None
    #: The OdpisAktualny as api-krs sent it, for `STATUS_OK` only.
    body: dict | None = None
    error: str | None = None
    #: Which run wrote it: a job run id, or the import of an earlier sweep.
    run: str | None = None

    def to_line(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False)

    @staticmethod
    def from_line(line: str) -> "RegisterRead":
        data = json.loads(line)
        return RegisterRead(
            **{k: v for k, v in data.items() if k in RegisterRead.__dataclass_fields__}
        )


COLUMNS = list(RegisterEntry.__dataclass_fields__)


def due_for_a_read(ledger: pd.DataFrame, updates: pd.DataFrame) -> list[str]:
    """The KRS numbers owed a read, in the order to read them.

    Three kinds, in this order:

    - a read that failed, because it is a known gap and is usually cheap to
      close;
    - an answer the register has moved on from - named in the bulletin on or
      after the day it was read, since the bulletin gives only the day and an
      entry made that afternoon is invisible to a read that morning. An owner
      may be what changed. The re-read carries a later date, so it cannot
      loop: the bulletin for a day is only fetched once the day is over;
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
    moved = known[known >= swept.reindex(known.index)]
    moved_ids = sorted(set(moved.index) - set(failed), key=int)

    never = sorted(set(changed.index) - set(swept.index), key=int)
    return failed + moved_ids + never


#: How two answers about the same number compare when they came at the same
#: moment: an odpis over a 204 or a 404, and any answer over a failure.
_TIE_RANK = {STATUS_OK: 0, STATUS_STRUCK_OFF: 1, STATUS_NOT_FOUND: 1, STATUS_FAILED: 2}


def _later(read_at: str, other: str) -> bool:
    return datetime.fromisoformat(read_at) > datetime.fromisoformat(other)


class _Answer(typing.NamedTuple):
    read_at: str
    status: str
    entry: RegisterEntry


def _answer(read: RegisterRead) -> _Answer:
    swept = read.read_at[:10]
    if read.status == STATUS_OK and read.body is not None and read.rejestr:
        entry = summarise_odpis(read.krs, read.rejestr, read.body, swept)
    else:
        entry = RegisterEntry(
            krs=read.krs,
            swept=swept,
            status=STATUS_FAILED if read.status == STATUS_OK else read.status,
            rejestr=read.rejestr,
        )
    return _Answer(read.read_at, entry.status, entry)


def _replaces(new: _Answer, held: _Answer) -> bool:
    """Whether `new` is the better answer about a number than `held`.

    Any answer beats a failure, whenever it came: a read that did not come back
    says nothing about the company, and must not overwrite one that did. Among
    answers, the newest wins - a company struck off after it was read is struck
    off.
    """
    new_failed = new.status == STATUS_FAILED
    held_failed = held.status == STATUS_FAILED
    if new_failed != held_failed:
        return held_failed
    if new.read_at != held.read_at:
        return _later(new.read_at, held.read_at)
    return _TIE_RANK[new.status] < _TIE_RANK[held.status]


def fold(reads: typing.Iterable[RegisterRead]) -> list[RegisterEntry]:
    """The ledger: the best answer about every number the log holds.

    Each read is summarised as it comes, so what is held is one `RegisterEntry`
    per company and not the 700k odpisy behind them.
    """
    best: dict[str, _Answer] = {}
    for read in reads:
        answer = _answer(read)
        held = best.get(read.krs)
        if held is None or _replaces(answer, held):
            best[read.krs] = answer
    return [best[krs].entry for krs in sorted(best)]


def read_log(ctx: Context) -> typing.Iterator[RegisterRead]:
    """Every read in `RESPONSE_LOG`, part by part."""
    for ref in ctx.io.list_files(RESPONSE_LOG):
        raw = ctx.io.read_data(ref).read_bytes()
        # "\n" only: `splitlines` also breaks at U+2028, U+2029 and U+0085,
        # which `to_line` writes raw inside a string, and a part cannot be
        # rewritten once one of them has split a line in two.
        for line in gzip.decompress(raw).decode("utf-8").split("\n"):
            if line.strip():
                yield RegisterRead.from_line(line)


@dataclass
class QueuedRead:
    """A KRS number owed a read, and why - see `queue_for_a_read`."""

    krs: str
    reason: str


REASON_FAILED = "failed"
REASON_MOVED = "moved"
REASON_NEVER = "never"


def queue_for_a_read(ledger: pd.DataFrame, updates: pd.DataFrame) -> list[QueuedRead]:
    """`due_for_a_read`, with the reason each number is in it."""
    due = due_for_a_read(ledger, updates)
    if ledger.empty:
        return [QueuedRead(krs, REASON_NEVER) for krs in due]
    status = dict(zip(ledger["krs"], ledger["status"]))
    return [
        QueuedRead(
            krs,
            REASON_NEVER
            if krs not in status
            else REASON_FAILED
            if status[krs] == STATUS_FAILED
            else REASON_MOVED,
        )
        for krs in due
    ]


class KRSRegisterEntries(Pipeline[RegisterEntry]):
    """The ledger: what the register last said about every number it was asked.

    A fold of `RESPONSE_LOG` and nothing else. Nothing tells this pipeline the
    log has grown, so a run that needs the latest answers - the register job,
    the KRS scrape - names it in its refresh policy.
    """

    filename = "krs_register_entries"
    dtype = {"krs": str, "nip": str, "regon": str}

    @property
    def output_class(self):
        return RegisterEntry

    def process(self, ctx: Context) -> pd.DataFrame:
        reads = 0

        def counted() -> typing.Iterator[RegisterRead]:
            nonlocal reads
            for read in read_log(ctx):
                reads += 1
                yield read

        entries = fold(counted())
        df = pd.DataFrame([asdict(e) for e in entries], columns=COLUMNS)
        counts = df["status"].value_counts().to_dict() if len(df) else {}
        print(f"Register log: {reads} reads, {len(df)} entries {counts}")
        return df


class KRSRegisterQueue(Pipeline[QueuedRead]):
    """The KRS numbers owed a read, in the order to read them.

    What `jobs.krs_register_owners` works through, a bounded number per run, as
    `ScrapeRejestrIO` is what the KRS scrape works through.
    """

    filename = "krs_register_queue"
    dtype = {"krs": str}
    #: Most of the bulletin on a first run, and derived in seconds from its two
    #: sources, so not worth a copy in the shared cache.
    backup_to_shared_cache = False

    entries: KRSRegisterEntries
    updates: KRSUpdates

    @property
    def output_class(self):
        return QueuedRead

    def process(self, ctx: Context) -> pd.DataFrame:
        ledger = self.entries.read_or_process(ctx)
        if ledger is None or ledger.empty:
            ledger = pd.DataFrame(columns=COLUMNS)
        else:
            ledger = ledger.copy()
            ledger["krs"] = padded_krs(ledger["krs"])
        queue = queue_for_a_read(ledger, self.updates.read_or_process(ctx))
        df = pd.DataFrame([asdict(q) for q in queue], columns=["krs", "reason"])
        counts = df["reason"].value_counts().to_dict() if len(df) else {}
        print(f"Register entries owed a read: {len(df)} {counts}")
        return df
