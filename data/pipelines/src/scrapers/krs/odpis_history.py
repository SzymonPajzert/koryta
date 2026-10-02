"""Every stored odpis, parsed: the register's entries, and who sat where, when.

`jobs.krs_odpis` fetches odpisy pełne into the crawl bucket. These two
pipelines read every one on file -- the newest for each company -- and ask
nothing of the service:

- `KrsOdpisEntries`: each company's own list of register entries (number, day,
  what the entry did, case number, court). It names nobody, so it goes to the
  shared cache.
- `KrsOdpisSeats`: everybody the odpis names in an organ, a proxy, the owners'
  list or a liquidation, with the entries that began and ended each seat and
  the days of those entries. Names, birth dates and PESEL fingerprints keyed
  under a key that never leaves the machine holding it: building the seats
  needs that key, so every other machine restores them from the shared cache.

That is the company history rejestr.io sells as its ``historyczne`` feed, read
off the register's own documents.

Nothing tells either pipeline that the bucket has grown, so after a crawl ask
for them by name: ``koryta KrsOdpisSeats --refresh KrsOdpisSeats``. Each lists
the bucket once and reads every document through the local cache, so a warm
rebuild needs no network beyond the listing. Parsing is the cost -- a full
odpis takes ~0.2 s -- so it runs on a process pool; the entries need only the
document's first pages, before Dział 1.
"""

import multiprocessing
import re
import typing
from collections.abc import Callable, Iterable, Iterator
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict, dataclass
from functools import partial
from itertools import batched

import pandas as pd

from scrapers.krs import odpis_files, odpis_pdf
from scrapers.stores import PESEL_SALT_FILE, Context, Pipeline, pesel_salt
from util import pesel as pesel_util

#: Parsing processes. One is left for the reader feeding them.
WORKERS = max(1, min(8, multiprocessing.cpu_count() - 1))

#: Documents read ahead of the pool, so memory stays bounded at any corpus size.
BATCH = 64


@dataclass(frozen=True)
class Document:
    """One stored odpis, as the parsers take it."""

    krs: str
    register: str
    content: bytes


#: What parsing one document gives: its rows, or why there are none.
Parsed = tuple[list[dict[str, typing.Any]], str | None]


def documents(
    ctx: Context, stored: typing.Mapping[str, odpis_files.StoredOdpis]
) -> Iterator[Document]:
    """The stored odpisy in KRS order, each read through the local cache."""
    for krs in sorted(stored):
        odpis = stored[krs]
        assert odpis.ref is not None, "listed odpisy carry their reference"
        content = ctx.io.read_data(odpis.ref).read_bytes()
        yield Document(krs=krs, register=odpis.register, content=content)


def parse_all(
    docs: Iterable[Document],
    parse: Callable[[Document], Parsed],
    workers: int | None = None,
) -> tuple[list[dict[str, typing.Any]], list[str]]:
    """Every document through `parse`, on a pool when there is more than one worker.

    A document the parser cannot read is reported and left out, not allowed to
    take the run down: one corrupt PDF in eight thousand is a line in the log.
    """
    rows: list[dict[str, typing.Any]] = []
    failed: list[str] = []

    def keep(parsed: Parsed) -> None:
        found, problem = parsed
        rows.extend(found)
        if problem:
            failed.append(problem)

    workers = WORKERS if workers is None else workers
    if workers <= 1:
        for doc in docs:
            keep(parse(doc))
        return rows, failed
    # forkserver, not fork: the parent holds the storage client's threads, and
    # a child forked mid-lock deadlocks. The workers need only the parser.
    context = multiprocessing.get_context("forkserver")
    with ProcessPoolExecutor(max_workers=workers, mp_context=context) as pool:
        for chunk in batched(docs, BATCH):
            for parsed in pool.map(parse, chunk):
                keep(parsed)
    return rows, failed


def _failure(doc: Document, problem: Exception) -> str:
    return f"{doc.krs} ({doc.register}): {type(problem).__name__}: {problem}"[:200]


# ---------------------------------------------------------------- the entries
@dataclass
class OdpisEntry:
    krs: str
    register: str
    #: The moment the document speaks for ("Stan na dzień"), ISO day.
    stated_on: str | None
    number: str
    #: The day the court made the entry, ISO. Not called ``date``: pandas reads
    #: a jsonl column of exactly that name back as a datetime, whatever dtype
    #: the pipeline pins.
    entry_date: str
    description: str
    case_number: str | None
    court: str | None


ENTRY_COLUMNS = tuple(OdpisEntry.__dataclass_fields__)


def entries_of(doc: Document) -> Parsed:
    try:
        text = odpis_pdf.extract_head_text(doc.content)
    except Exception as problem:  # noqa: BLE001 - one unreadable PDF is not the run
        return [], _failure(doc, problem)
    stated = odpis_pdf.stated_on(text)
    rows = [
        asdict(
            OdpisEntry(
                krs=doc.krs,
                register=doc.register,
                stated_on=stated,
                number=e.number,
                entry_date=e.date,
                description=e.description,
                case_number=e.case_number,
                court=e.court,
            )
        )
        for e in odpis_pdf.parse_entries(text)
    ]
    return rows, None if rows else f"{doc.krs} ({doc.register}): no entries read"


class KrsOdpisEntries(Pipeline[OdpisEntry]):
    """The register's list of entries, for every company with an odpis on file."""

    filename = "krs_odpis_entries"
    dtype = {c: str for c in ENTRY_COLUMNS}

    @property
    def output_class(self):
        return OdpisEntry

    def process(self, ctx: Context) -> pd.DataFrame:
        stored = odpis_files.stored_odpisy(ctx)
        rows, failed = parse_all(documents(ctx, stored), entries_of)
        df = pd.DataFrame.from_records(rows, columns=list(ENTRY_COLUMNS))
        report("entries", len(stored), df, failed)
        return df


# ------------------------------------------------------------------ the seats
@dataclass
class OdpisSeat:
    krs: str
    register: str
    stated_on: str | None
    dzial: int
    rubryka: str
    role: str
    organ_name: str | None
    organ: str | None
    position: int
    surname: str
    given_names: str
    full_name: str
    funkcja: str | None
    birth_date: str | None
    sex: str | None
    #: HMAC of the PESEL under the machine's key; `salt_id` names the key.
    pesel_fingerprint: str | None
    salt_id: str
    has_pesel: bool
    is_company: bool
    entry_added: str | None
    entry_removed: str | None
    date_added: str | None
    date_removed: str | None
    current: bool


SEAT_COLUMNS = tuple(OdpisSeat.__dataclass_fields__)

#: Read back as text whatever pandas would otherwise guess: a KRS or an entry
#: number is an identifier, and a birth date with no day is still a string.
SEAT_TEXT_COLUMNS = tuple(
    c
    for c in SEAT_COLUMNS
    if c not in {"dzial", "position", "has_pesel", "is_company", "current"}
)

#: A PESEL is 11 digits. Nothing a seat carries may hold a run of them.
ELEVEN_DIGITS = re.compile(r"(?<!\d)\d{11}(?!\d)")

#: The HMAC hex digests, checked for their shape instead of for digit runs: a
#: 32-character hex string holds an 11-digit run by chance often enough that
#: the run test would refuse good rows, while a cell that is exactly a
#: lowercase hex digest of that length cannot be a PESEL.
HEX_COLUMNS = {
    "pesel_fingerprint": pesel_util.FINGERPRINT_LENGTH,
    "salt_id": pesel_util.SALT_ID_LENGTH,
}


class PeselKeyMissing(RuntimeError):
    """No PESEL key on this machine; the seats cannot be fingerprinted."""


def require_salt() -> str:
    """The PESEL key, or an error naming both places it is looked for.

    Never minted here: a new key would renumber every person, and join to
    nothing parsed before.
    """
    salt = pesel_salt()
    if not salt:
        raise PeselKeyMissing(
            "No PESEL key: set KORYTA_PESEL_SALT or put the key in "
            f"{PESEL_SALT_FILE} (0600). The seats are fingerprinted with it, "
            "and a new key would join nothing parsed before."
        )
    return salt


def seats_of(doc: Document, salt: str) -> Parsed:
    try:
        text = odpis_pdf.extract_text(doc.content)
        people = odpis_pdf.parse_people(text, doc.krs, salt=salt)
    except Exception as problem:  # noqa: BLE001 - one unreadable PDF is not the run
        return [], _failure(doc, problem)
    stated = odpis_pdf.stated_on(text)
    key = pesel_util.salt_id(salt)
    rows = []
    for person in people:
        row = asdict(person)
        row.update(
            register=doc.register,
            stated_on=stated,
            full_name=person.full_name,
            salt_id=key,
            current=person.current,
        )
        rows.append(row)
    return rows, None


def assert_no_pesel(df: pd.DataFrame) -> None:
    """Refuse an 11-digit run in any text cell, or a digest column that is no digest."""
    leaked = 0
    for column in df.columns:
        values = df[column]
        if values.dtype == bool or pd.api.types.is_numeric_dtype(values):
            continue
        if column in HEX_COLUMNS:
            shape = re.compile(rf"[0-9a-f]{{{HEX_COLUMNS[column]}}}")
            leaked += int(
                values.map(
                    lambda v: isinstance(v, str) and not shape.fullmatch(v)
                ).sum()
            )
            continue
        leaked += int(
            values.map(
                lambda v: isinstance(v, str) and bool(ELEVEN_DIGITS.search(v))
            ).sum()
        )
    if leaked:
        raise AssertionError(
            f"{leaked} cells hold an 11-digit run; refusing to return them: "
            "a PESEL must never reach an artifact."
        )


class KrsOdpisSeats(Pipeline[OdpisSeat]):
    """Everybody every stored odpis names, with the days each seat began and ended."""

    filename = "krs_odpis_seats"
    dtype = {c: str for c in SEAT_TEXT_COLUMNS}
    # Shared, as outputs are by default: `PeopleKRSCombined` reads the seats,
    # and a machine without the PESEL key can only restore them, never build
    # them. They hold what `person_krs` already shares -- names, birth dates,
    # posts -- plus fingerprints that are HMACs under that key, which stays on
    # the machine that parsed the PDFs.

    @property
    def output_class(self):
        return OdpisSeat

    def process(self, ctx: Context) -> pd.DataFrame:
        salt = require_salt()
        print(f"  PESEL key salt_id {pesel_util.salt_id(salt)}")
        stored = odpis_files.stored_odpisy(ctx)
        rows, failed = parse_all(documents(ctx, stored), partial(seats_of, salt=salt))
        df = pd.DataFrame.from_records(rows, columns=list(SEAT_COLUMNS))
        assert_no_pesel(df)
        report("seats", len(stored), df, failed)
        return df


def report(what: str, stored: int, df: pd.DataFrame, failed: list[str]) -> None:
    print(f"  {stored:,} stored odpisy -> {len(df):,} {what}; {len(failed):,} unread")
    for problem in failed[:20]:
        print(f"    {problem}")
