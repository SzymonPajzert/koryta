"""Reading the elections PKW held during a term off wybory.gov.pl's files.

The files are protobuf. Each test builds one with the field numbers the site's
own JavaScript decodes them by, from the Zabrze 2025 election (id 4083) as
`details/4083.blob` holds it, cut down to what is read.
"""

import datetime

import pytest

from scrapers.pkw import term_elections
from scrapers.pkw.elections import ElectionType
from scrapers.pkw.headers import CSV_HEADERS
from scrapers.pkw.process import process_csv
from scrapers.pkw.sources import InputSource, TermElectionsExtractor
from scrapers.stores.file import DownloadableFile
from util.polish import PkwFormat


def _varint(n: int) -> bytes:
    out = bytearray()
    while True:
        byte, n = n & 0x7F, n >> 7
        out.append(byte | (0x80 if n else 0))
        if not n:
            return bytes(out)


def _int(number: int, value: int) -> bytes:
    return _varint(number << 3) + _varint(value)


def _sint(number: int, value: int) -> bytes:
    return _int(number, value << 1 if value >= 0 else (-value << 1) - 1)


def _bytes(number: int, value: bytes) -> bytes:
    return _varint(number << 3 | 2) + _varint(len(value)) + value


def _text(number: int, value: str) -> bytes:
    return _bytes(number, value.encode("utf-8"))


# 2025-08-10 07:00 in Warsaw, as PKW stamps a vote's start: 05:00 UTC.
VOTE = 1754802000
RUNOFF = 1756011600


def candidate(cid: int, name: str, age: int, said: str, status: int = 1) -> bytes:
    return (
        _int(1, 1)
        + _text(2, name)
        + _int(3, age)
        + _text(6, "Zabrze")
        + _text(8, said)
        + _int(10, cid)
        + _int(12, status)
    )


def committee(name: str, *candidates: bytes) -> bytes:
    district = _sint(1, 1) + b"".join(_bytes(3, each) for each in candidates)
    return _bytes(1, _sint(1, 1) + _text(3, name) + _int(5, 2)) + _bytes(7, district)


def election(
    election_id: int = 4083,
    *,
    kind: int = 4,
    subkind: int | None = 2,
    level: int = 15,
    office: str = "Prezydent Miasta Zabrze",
    committees: tuple[bytes, ...] = (),
    winner: int | None = None,
    runoff: bool = False,
    runoff_winner: int | None = None,
    runoff_level: int | None = 15,
    struck: tuple[int, ...] = (),
) -> bytes:
    gmina = _sint(1, 240000) + _sint(3, 247800) + _sint(5, 247801)
    body = (
        _sint(1, election_id)
        + _sint(3, VOTE)
        + _int(5, level)
        + _bytes(6, gmina)
        + _int(8, kind)
        + (b"" if subkind is None else _int(9, subkind))
        + _text(10, office)
        + b"".join(_bytes(18, each) for each in committees)
    )
    if winner is not None:
        body += _sint(26, winner)
    if runoff or runoff_winner is not None:
        second = _sint(1, 4135) + _sint(3, RUNOFF)
        if runoff_level is not None:
            second += _int(5, runoff_level)
        if runoff_winner is not None:
            second += _sint(26, runoff_winner)
        body += _bytes(24, second)
    if struck:
        lines = b"".join(
            _bytes(28, _sint(1, n) + _int(4, 1) + _sint(8, cid))
            for n, cid in enumerate(struck)
        )
        body += _bytes(25, lines)
    return body


ZABRZE = election(
    committees=(
        committee(
            "KOMITET WYBORCZY WYBORCÓW BORYSA BORÓWKI",
            candidate(
                4991605,
                "BORÓWKA Borys Aleksander",
                52,
                "członek partii politycznej: Prawo i Sprawiedliwość\n"
                "popierany przez partię polityczną: Prawo i Sprawiedliwość",
            ),
        ),
        committee(
            "KOMITET WYBORCZY WYBORCÓW EWA WEBER",
            candidate(4991603, "WEBER Ewa", 54, "nie należy do partii politycznej"),
        ),
        committee(
            "KOMITET WYBORCZY WYBORCÓW LEPSZE ZABRZE KAMILA ŻBIKOWSKIEGO",
            candidate(
                4992812, "ŻBIKOWSKI Kamil Piotr", 38, "nie należy do partii politycznej"
            ),
        ),
    ),
    runoff_winner=4992812,
)


def test_a_details_file_gives_each_candidacy_with_its_result():
    rows = term_elections.candidate_rows(ZABRZE)

    assert [dict(zip(term_elections.COLUMNS, row)) for row in rows] == [
        {
            "Urząd": "Prezydent Miasta Zabrze",
            "Nazwisko i imiona": "BORÓWKA Borys Aleksander",
            "Nazwa komitetu": "KOMITET WYBORCZY WYBORCÓW BORYSA BORÓWKI",
            "Wiek": "52",
            "Miejsce zamieszkania": "Zabrze",
            "Przynależność do partii": (
                "członek partii politycznej: Prawo i Sprawiedliwość"
            ),
            "Poparcie": "popierany przez partię polityczną: Prawo i Sprawiedliwość",
            "Czy uzyskał mandat": "Nie",
            "TERYT": "247801",
            "Data głosowania": "2025-08-10",
            "Rok głosowania": "2025",
        },
        {
            "Urząd": "Prezydent Miasta Zabrze",
            "Nazwisko i imiona": "WEBER Ewa",
            "Nazwa komitetu": "KOMITET WYBORCZY WYBORCÓW EWA WEBER",
            "Wiek": "54",
            "Miejsce zamieszkania": "Zabrze",
            "Przynależność do partii": "nie należy do partii politycznej",
            "Poparcie": None,
            "Czy uzyskał mandat": "Nie",
            "TERYT": "247801",
            "Data głosowania": "2025-08-10",
            "Rok głosowania": "2025",
        },
        {
            "Urząd": "Prezydent Miasta Zabrze",
            "Nazwisko i imiona": "ŻBIKOWSKI Kamil Piotr",
            "Nazwa komitetu": (
                "KOMITET WYBORCZY WYBORCÓW LEPSZE ZABRZE KAMILA ŻBIKOWSKIEGO"
            ),
            "Wiek": "38",
            "Miejsce zamieszkania": "Zabrze",
            "Przynależność do partii": "nie należy do partii politycznej",
            "Poparcie": None,
            # Won the run-off, which the file holds as an election of its own.
            "Czy uzyskał mandat": "Tak",
            "TERYT": "247801",
            "Data głosowania": "2025-08-10",
            "Rok głosowania": "2025",
        },
    ]


def test_a_first_round_win_is_a_win():
    blob = election(
        committees=(committee("KWW A", candidate(1, "NOWAK Jan", 60, "Brak")),),
        winner=1,
    )

    (row,) = term_elections.candidate_rows(blob)
    assert row[term_elections.COLUMNS.index("Czy uzyskał mandat")] == "Tak"


def test_a_candidate_struck_off_stood_in_nothing():
    # Removed from the register (status 4), and struck off the ballot with the
    # registration left standing, as Jan Hoffman was in Kraków in 2026.
    blob = election(
        committees=(
            committee(
                "KWW A",
                candidate(1, "NOWAK Jan", 60, "Brak"),
                candidate(2, "KOWALSKI Adam", 50, "Brak", status=4),
                candidate(3, "HOFFMAN Jan Krzysztof", 45, "Brak"),
            ),
        ),
        struck=(3,),
    )

    names = [row[1] for row in term_elections.candidate_rows(blob)]
    assert names == ["NOWAK Jan"]


@pytest.mark.parametrize(
    ("said", "membership", "backing"),
    [
        (
            "członek partii politycznej: Koalicja Obywatelska",
            "członek partii politycznej: Koalicja Obywatelska",
            None,
        ),
        (
            "nie należy do partii politycznej\n"
            "popierana przez partię polityczną: Koalicja Obywatelska",
            "nie należy do partii politycznej",
            "popierana przez partię polityczną: Koalicja Obywatelska",
        ),
        ("Brak", None, None),
        ("", None, None),
        (None, None, None),
    ],
)
def test_the_statements_come_apart_by_line(said, membership, backing):
    assert term_elections.statements(said) == (membership, backing)


def test_the_list_says_which_elections_are_mayoral_and_final():
    listing = b"".join(
        _bytes(1, each)
        for each in (
            election(4083),
            # Candidates registered, the vote still to come (Sadlinki, 12-06).
            election(4600, level=7, office="Wójt Gminy Sadlinki", kind=3),
            # A council by-election: no `typ`, no `podtyp`.
            election(3825, kind=0, subkind=None, office="Rada Miejska w Jutrosinie"),
            # The first round final, its run-off to come (Niedźwiada, 11-22):
            # nobody is elected yet, and the file is kept once read.
            election(4531, kind=3, runoff=True, runoff_level=None),
        )
    )

    elections = term_elections.listed(listing)

    assert [e.id for e in elections] == [4083, 4600, 3825, 4531]
    assert elections[0].day == datetime.date(2025, 8, 10)
    assert elections[0].teryt == "247801"
    assert [term_elections.mayoral_and_final(e) for e in elections] == [
        True,
        False,
        False,
        False,
    ]


class _Blob:
    def __init__(self, data: bytes):
        self.data = data

    def read_bytes(self) -> bytes:
        return self.data


class _Io:
    """`ctx.io` with the term's files in memory, by URL."""

    def __init__(self, files: dict[str, bytes]):
        self.files = files
        self.read: list[str] = []

    def read_data(self, ref: DownloadableFile) -> _Blob:
        self.read.append(ref.filename)
        return _Blob(self.files[ref.url])


class _Context:
    def __init__(self, io: _Io):
        self.io = io


def test_the_source_reads_its_rows_with_the_years_they_were_held():
    data = "https://wybory.gov.pl/wojtburmistrz_2024_2029/data"
    later = election(4600, level=7, office="Wójt Gminy Sadlinki", kind=3)
    io = _Io(
        {
            f"{data}/list.blob": _bytes(1, ZABRZE) + _bytes(1, later),
            f"{data}/details/4083.blob": ZABRZE,
        }
    )
    source = InputSource(
        DownloadableFile(f"{data}/list.blob", "list.blob"),
        TermElectionsExtractor(data, "wojtburmistrz_2024_2029"),
        2024,
        PkwFormat.LAST_First,
        ElectionType.SAMORZADOWE,
    )

    rows = source.extractor.read(_Context(io), source.source)  # type: ignore[arg-type]
    people = list(process_csv(rows, source, dict(CSV_HEADERS)))

    # Only the final election was fetched, under a name of its app's.
    assert io.read == ["list.blob", "pkw_wojtburmistrz_2024_2029_4083.blob"]
    winner = people[-1]
    assert (winner.first_name, winner.last_name) == ("Kamil", "ŻBIKOWSKI")
    assert winner.election_year == "2025"
    assert winner.election_date == "2025-08-10"
    assert winner.birth_year == 2025 - 38
    assert winner.candidacy_success == "TRUE"
    assert winner.teryt_candidacy == "247801"
    assert winner.position == "Prezydent Miasta Zabrze"
    borowka = people[0]
    assert borowka.party_member == "członek partii politycznej: Prawo i Sprawiedliwość"
    assert borowka.supported_by == (
        "popierany przez partię polityczną: Prawo i Sprawiedliwość"
    )
