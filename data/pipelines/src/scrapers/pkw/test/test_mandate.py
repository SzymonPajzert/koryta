import math

import pytest

from scrapers.pkw.elections import ElectionType
from scrapers.pkw.headers import CSV_HEADERS, parse_mandate
from scrapers.pkw.process import process_csv
from scrapers.pkw.sources import CsvExtractor, InputSource
from scrapers.stores.file import DownloadableFile
from util.polish import PkwFormat


@pytest.mark.parametrize("value", ["T", "W", "G", "B", "L", "P", "O", "K", " T "])
def test_every_letter_is_a_seat(value):
    assert parse_mandate(value, None) == "TRUE"


@pytest.mark.parametrize("value", ["N", "", None, float("nan")])
def test_blank_is_a_loss_not_an_unknown(value):
    # The file marks its winners, so an unmarked row lost. Proven against
    # 2018-radni.xlsx, which holds every one of the marked rows and none of
    # the blank ones - see parse_mandate.
    assert parse_mandate(value, None) == "FALSE"


def test_unknown_letter_raises():
    with pytest.raises(ValueError):
        parse_mandate("X", None)


def config(year: int, election_type: ElectionType) -> InputSource:
    return InputSource(
        DownloadableFile("https://example.invalid/x.csv", "x.csv"),
        CsvExtractor(),
        year,
        PkwFormat.UNKNOWN,
        election_type,
    )


def test_mandate_column_reaches_candidacy_success():
    rows = [
        ["Nazwisko", "1. imię", "Mandat"],
        ["KOWALSKI", "Jan", "T"],
        ["NOWAK", "Anna", "B"],
        ["WIŚNIEWSKI", "Piotr", "N"],
        ["DĄBROWSKA", "Ewa", math.nan],
    ]

    people = list(
        process_csv(rows, config(2018, ElectionType.SAMORZADOWE), CSV_HEADERS)
    )

    assert [p.candidacy_success for p in people] == [
        "TRUE",
        "TRUE",
        "FALSE",
        "FALSE",
    ]
