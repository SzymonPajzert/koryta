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

import functools
import hashlib
import inspect
import json
import multiprocessing
import os
import re
import sys
import typing
from collections.abc import Callable, Iterable, Iterator
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict, dataclass
from functools import partial
from itertools import batched

import pandas as pd
import pypdf

from scrapers.krs import odpis_files, odpis_pdf, organs
from scrapers.stores import (
    DOWNLOADED_DIR,
    PESEL_SALT_FILE,
    Context,
    Pipeline,
    pesel_salt,
)
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


def parse_each(
    docs: Iterable[Document],
    parse: Callable[[Document], Parsed],
    workers: int | None = None,
) -> Iterator[tuple[Document, Parsed]]:
    """Each document with what `parse` gave for it, in order, on a pool when
    there is more than one worker."""
    workers = WORKERS if workers is None else workers
    if workers <= 1:
        for doc in docs:
            yield doc, parse(doc)
        return
    # forkserver, not fork: the parent holds the storage client's threads, and
    # a child forked mid-lock deadlocks. The workers need only the parser.
    context = multiprocessing.get_context("forkserver")
    with ProcessPoolExecutor(max_workers=workers, mp_context=context) as pool:
        for chunk in batched(docs, BATCH):
            yield from zip(chunk, pool.map(parse, chunk))


def gather(parsed: Iterable[Parsed]) -> tuple[list[dict[str, typing.Any]], list[str]]:
    """The rows of every document, and why some gave none.

    A document the parser cannot read is reported and left out, not allowed to
    take the run down: one corrupt PDF in eight thousand is a line in the log.
    """
    rows: list[dict[str, typing.Any]] = []
    failed: list[str] = []
    for found, problem in parsed:
        rows.extend(found)
        if problem:
            failed.append(problem)
    return rows, failed


def parse_all(
    docs: Iterable[Document],
    parse: Callable[[Document], Parsed],
    workers: int | None = None,
) -> tuple[list[dict[str, typing.Any]], list[str]]:
    """Every document through `parse`; see `parse_each` and `gather`."""
    return gather(parsed for _, parsed in parse_each(docs, parse, workers))


#: Where each document's parse is kept. Local, as the PDFs it is read from
#: are: the seats' rows carry names and fingerprints. None is beside the
#: download cache.
PARSED_ROOT: str | None = None


@functools.cache
def parser_version() -> str:
    """A digest of all the code a document's rows come out of.

    Any change to the parser, the organ names it reads, the PESEL code or the
    PDF library - or to this module - re-parses every document.
    """
    digest = hashlib.sha1(pypdf.__version__.encode())
    for module in (odpis_pdf, organs, pesel_util, sys.modules[__name__]):
        digest.update(inspect.getsource(module).encode())
    return digest.hexdigest()[:16]


class ParsedCache:
    """What parsing each stored odpis gave, kept between runs.

    A stored odpis never changes - its name is written once - so what one
    parser makes of it never does either: keyed by the blob, and stamped with
    `parser_version` and the key (`variant`), a parse is reused until either
    changes. The output is still exactly what parsing every document would
    give; only the time differs. A refresh after a crawl of 295 odpisy
    re-parsed all 9,237 on file, 7.7 minutes, on 2026-10-02.
    """

    def __init__(
        self,
        kind: str,
        columns: typing.Sequence[str],
        variant: str = "",
        keeps: Callable[[list[dict[str, typing.Any]]], bool] = lambda rows: True,
    ):
        root = PARSED_ROOT or os.path.join(DOWNLOADED_DIR, ".odpis-parsed")
        self.dir = os.path.join(root, kind)
        self.stamp = f"{parser_version()}:{variant}"
        #: Only what the pipeline outputs is kept, and only rows `keeps` passes.
        self.columns = tuple(columns)
        self.keeps = keeps

    def _path(self, odpis: odpis_files.StoredOdpis) -> str:
        return os.path.join(self.dir, f"{odpis.blob.replace('/', '.')}.json")

    def get(self, odpis: odpis_files.StoredOdpis) -> Parsed | None:
        try:
            with open(self._path(odpis), encoding="utf-8") as f:
                kept = json.load(f)
        except (OSError, ValueError):
            return None
        if not isinstance(kept, dict) or kept.get("stamp") != self.stamp:
            return None
        return kept["rows"], kept["problem"]

    def put(self, odpis: odpis_files.StoredOdpis, parsed: Parsed) -> None:
        path = self._path(odpis)
        part = f"{path}.part"
        rows = [{c: row.get(c) for c in self.columns} for row in parsed[0]]
        problem = parsed[1]
        if not self.keeps(rows):
            return
        try:
            os.makedirs(self.dir, exist_ok=True)
            with open(part, "w", encoding="utf-8") as f:
                json.dump({"stamp": self.stamp, "rows": rows, "problem": problem}, f)
            os.replace(part, path)
        except (OSError, TypeError) as e:
            print(f"Could not keep the parse of {odpis.blob}: {e}")


def parse_stored(
    ctx: Context,
    stored: typing.Mapping[str, odpis_files.StoredOdpis],
    parse: Callable[[Document], Parsed],
    cache: ParsedCache,
) -> tuple[list[dict[str, typing.Any]], list[str]]:
    """Every stored odpis's rows, in KRS order, parsing only what `cache` lacks."""
    results: dict[str, Parsed] = {}
    for krs in sorted(stored):
        if (kept := cache.get(stored[krs])) is not None:
            results[krs] = kept
    todo = {krs: odpis for krs, odpis in stored.items() if krs not in results}
    print(f"  {len(results):,} odpisy parsed before, {len(todo):,} to parse")
    for doc, parsed in parse_each(documents(ctx, todo), parse):
        results[doc.krs] = parsed
        cache.put(todo[doc.krs], parsed)
    return gather(results[krs] for krs in sorted(stored))


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
        cache = ParsedCache("entries", ENTRY_COLUMNS)
        rows, failed = parse_stored(ctx, stored, entries_of, cache)
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


def carry_no_pesel(rows: list[dict[str, typing.Any]]) -> bool:
    """Whether seat rows are safe to keep on disk: `assert_no_pesel`'s test."""
    if not rows:
        return True
    try:
        assert_no_pesel(pd.DataFrame.from_records(rows))
    except AssertionError:
        return False
    return True


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
        # Keyed by the PESEL key too: a fingerprint under another key is
        # another fingerprint.
        cache = ParsedCache(
            "seats", SEAT_COLUMNS, pesel_util.salt_id(salt), keeps=carry_no_pesel
        )
        rows, failed = parse_stored(ctx, stored, partial(seats_of, salt=salt), cache)
        df = pd.DataFrame.from_records(rows, columns=list(SEAT_COLUMNS))
        assert_no_pesel(df)
        report("seats", len(stored), df, failed)
        return df


def report(what: str, stored: int, df: pd.DataFrame, failed: list[str]) -> None:
    print(f"  {stored:,} stored odpisy -> {len(df):,} {what}; {len(failed):,} unread")
    for problem in failed[:20]:
        print(f"    {problem}")
