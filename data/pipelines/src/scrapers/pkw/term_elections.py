"""The elections PKW holds during a term, between two general ones.

A mayor whose mandate ends early - death, resignation, a recall referendum, a
seat in the Sejm - is replaced in an early election (wybory przedterminowe); a
court that voids an election orders a re-run (wybory ponowne); a new gmina
elects its first mayor. PKW publishes each on wybory.gov.pl, apart from the
general election's files `sources` reads, so none of them reached the site:
Ewa Weber's run for mayor of Zabrze in August 2025, Kraków's in 2026.

Each term has an app on wybory.gov.pl, and the app reads two kinds of file,
both protobuf with no schema published: `data/list.blob`, every election of
the term, and `data/details/{id}.blob`, one election's committees, candidates
and results, both rounds. There is no candidate CSV. The field numbers below
are the ones the app's own JavaScript decodes them by.

Decisions on 2026-11-18: a re-run is a run of its own, beside the general
election's; an election is read once PKW marks its results final, not while
its candidates are only registered. A candidate struck off before the vote
stood in nothing and is left out.

`candidate_rows` gives each candidacy under the column names of the 2024
mayoral file (`kandydaci_wbp_utf8.csv`), so `process_csv` reads them with the
headers it already has, plus the vote's day and year.
"""

import dataclasses
import datetime
import re
import typing
from zoneinfo import ZoneInfo

#: The columns `candidate_rows` fills, the 2024 mayoral file's names first.
COLUMNS: tuple[str, ...] = (
    "Urząd",
    "Nazwisko i imiona",
    "Nazwa komitetu",
    "Wiek",
    "Miejsce zamieszkania",
    "Przynależność do partii",
    "Poparcie",
    "Czy uzyskał mandat",
    "TERYT",
    "Data głosowania",
    "Rok głosowania",
)

#: `poziomDanych` from which an election's results are final (14), and scans
#: of the protocols are out too (15). Below it the vote may be to come.
FINAL = 14

#: The mayoral kinds, by an election's `typ`. 5 and 6 are councils.
MAYORAL = {2: "Burmistrz", 3: "Wójt", 4: "Prezydent"}

#: A candidate's `statusRejestracji` while registered; 4 and 5 are removed.
REGISTERED = 1

_WARSAW = ZoneInfo("Europe/Warsaw")

Fields = dict[int, list[typing.Any]]


def _varint(buf: bytes, at: int) -> tuple[int, int]:
    value = shift = 0
    while True:
        byte = buf[at]
        at += 1
        value |= (byte & 0x7F) << shift
        shift += 7
        if not byte & 0x80:
            return value, at


def fields(buf: bytes) -> Fields:
    """A protobuf message's fields by number, each the list of its values in
    order: an int for a varint, bytes for anything length-delimited.

    Unknown fields are kept, so a field PKW adds costs nothing; the fixed
    32- and 64-bit kinds are read as bytes, though no field read here has one.
    """
    out: Fields = {}
    at = 0
    while at < len(buf):
        key, at = _varint(buf, at)
        number, kind = key >> 3, key & 7
        value: typing.Any
        if kind == 0:
            value, at = _varint(buf, at)
        elif kind == 2:
            size, at = _varint(buf, at)
            value, at = buf[at : at + size], at + size
        elif kind == 5:
            value, at = buf[at : at + 4], at + 4
        elif kind == 1:
            value, at = buf[at : at + 8], at + 8
        else:
            raise ValueError(f"protobuf wire type {kind} at byte {at}")
        out.setdefault(number, []).append(value)
    return out


def _last(message: Fields, number: int) -> typing.Any:
    """A singular field: the last value given, as protobuf reads it."""
    values = message.get(number)
    return values[-1] if values else None


def _sint(message: Fields, number: int) -> int | None:
    """A zigzag-encoded sint32, the type of most of PKW's numbers."""
    raw = _last(message, number)
    return None if raw is None else (raw >> 1) ^ -(raw & 1)


def _int(message: Fields, number: int) -> int | None:
    raw = _last(message, number)
    if raw is None:
        return None
    raw &= (1 << 64) - 1
    return raw - (1 << 64) if raw >= 1 << 63 else raw


def _text(message: Fields, number: int) -> str | None:
    raw = _last(message, number)
    return None if raw is None else bytes(raw).decode("utf-8")


def _message(message: Fields, number: int) -> Fields:
    raw = _last(message, number)
    return {} if raw is None else fields(raw)


def _messages(message: Fields, number: int) -> list[Fields]:
    return [fields(raw) for raw in message.get(number, [])]


@dataclasses.dataclass(frozen=True)
class TermElection:
    """One election of a term, as its list or its details give it."""

    id: int
    #: `typ`: 2 burmistrz, 3 wójt, 4 prezydent; 5 and 6 are councils.
    kind: int | None
    #: `podtyp`: 1 a re-run, 2 an early election, 4 a new gmina's first.
    #: None for a council by-election (wybory uzupełniające).
    subkind: int | None
    #: `poziomDanych`, how far PKW's data has got (`FINAL`).
    level: int
    #: The same of its run-off, 0 while it has none; None where there is no
    #: run-off at all. Niedźwiada's first round of 2026-11-08 was final at 15
    #: with its run-off of 11-22 still to come, and nobody elected.
    runoff_level: int | None
    #: The day of the vote, in Warsaw.
    day: datetime.date | None
    #: The gmina's code, six digits.
    teryt: str | None
    #: What the office is called („Prezydent Miasta Zabrze”).
    office: str | None


def term_election(message: Fields) -> TermElection:
    """An `Uzupelniajace` message, the shape both a list's entries and a
    details file have."""
    voting = _sint(message, 3)
    gmina = _sint(_message(message, 6), 5)
    election_id = _sint(message, 1)
    if election_id is None:
        raise ValueError("an election without an id")
    runoff = _message(message, 24) if 24 in message else None
    return TermElection(
        id=election_id,
        kind=_int(message, 8),
        subkind=_int(message, 9),
        level=_int(message, 5) or 0,
        runoff_level=None if runoff is None else _int(runoff, 5) or 0,
        day=None
        if voting is None
        else datetime.datetime.fromtimestamp(voting, _WARSAW).date(),
        teryt=None if gmina is None else f"{gmina:06d}",
        office=_text(message, 10),
    )


def listed(listing: bytes) -> list[TermElection]:
    """Every election a term's `list.blob` names."""
    return [term_election(entry) for entry in _messages(fields(listing), 1)]


def mayoral_and_final(election: TermElection) -> bool:
    """Whether to read the election: a mayor's, with results PKW calls final,
    its run-off's too where it went to one.

    Decided off the list, before its details file is fetched: the file is
    kept once read, so one read while a run-off is to come would never say
    who won it.
    """
    return (
        election.kind in MAYORAL
        and election.level >= FINAL
        and (election.runoff_level is None or election.runoff_level >= FINAL)
    )


_BACKING = re.compile(r"^\s*(?:popiera\w*|pop\.)\s", re.IGNORECASE)


def statements(text: str | None) -> tuple[str | None, str | None]:
    """A candidate's `przynaleznosc`, which holds the membership statement and
    the backing one on lines of their own, as (membership, backing).

    „Brak” is PKW's way of saying neither.
    """
    membership: list[str] = []
    backing: list[str] = []
    for line in (text or "").splitlines():
        line = line.strip()
        if not line or line.lower() == "brak":
            continue
        (backing if _BACKING.match(line) else membership).append(line)
    return "; ".join(membership) or None, "; ".join(backing) or None


def _winners(message: Fields) -> set[int]:
    """The candidate ids who took the mandate, in the first round or in a
    run-off, which a details file holds as an election of its own."""
    won = {_sint(message, 26), _sint(_message(message, 24), 26)}
    return {each for each in won if each is not None}


def _struck_off(message: Fields) -> set[int]:
    """The candidate ids a protocol marks struck off the ballot.

    A candidate can be struck off with their registration left standing, as
    Jan Hoffman was in Kraków in 2026: no votes, and `czySkreslono` on the
    protocol's line.
    """
    protocol = _message(message, 25)
    return {
        candidate_id
        for line in _messages(protocol, 28)
        if _last(line, 4) and (candidate_id := _sint(line, 8)) is not None
    }


def candidate_rows(details: bytes) -> list[list[str | None]]:
    """One election's candidacies, one row each under `COLUMNS`, None where
    PKW gives nothing.

    Every registered candidate who was on the ballot, whatever their result;
    a candidate struck off stood in nothing.
    """
    message = fields(details)
    election = term_election(message)
    winners = _winners(message)
    struck = _struck_off(message)
    day = election.day.isoformat() if election.day else None
    year = str(election.day.year) if election.day else None
    rows: list[list[str | None]] = []
    for committee in _messages(message, 18):
        name = _text(_message(committee, 1), 3)
        for district in _messages(committee, 7):
            for candidate in _messages(district, 3):
                candidate_id = _int(candidate, 10)
                registration = _int(candidate, 12)
                if (
                    (registration is not None and registration != REGISTERED)
                    or _last(candidate, 7)
                    or candidate_id in struck
                ):
                    continue
                membership, backing = statements(_text(candidate, 8))
                age = _int(candidate, 3)
                rows.append(
                    [
                        election.office,
                        _text(candidate, 2),
                        name,
                        None if age is None else str(age),
                        _text(candidate, 6),
                        membership,
                        backing,
                        "Tak" if candidate_id in winners else "Nie",
                        election.teryt,
                        day,
                        year,
                    ]
                )
    return rows
