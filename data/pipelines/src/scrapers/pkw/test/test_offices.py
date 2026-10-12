import math

import pandas as pd
import pytest

from scrapers.pkw.elections import ElectionType
from scrapers.pkw.headers import CSV_HEADERS
from scrapers.pkw.offices import local_office
from scrapers.pkw.process import local_offices, process_csv
from scrapers.pkw.sources import CsvExtractor, InputSource
from scrapers.stores.file import DownloadableFile
from stores.file import read_xls
from util.polish import PkwFormat

#: TERC's kind for each six-digit code, as `Teryt.gmina_kinds` holds it.
KINDS = {
    "101601": "1",  # Tomaszów Mazowiecki, a town
    "101602": "2",  # gmina Tomaszów Mazowiecki around it
    "101604": "3",  # Ujazd, miejsko-wiejska
    "146501": "1",  # Warszawa
    "146502": "8",  # Warszawa-Bemowo
}


@pytest.mark.parametrize(
    ("position", "office"),
    [
        # A letter: 2002, 2014 and 2018.
        ("W", "Wójt"),
        ("B", "Burmistrz"),
        ("P", "Prezydent"),
        # A word: 2006 and 2010.
        ("Wójt", "Wójt"),
        ("Burmistrz", "Burmistrz"),
        ("Prezydent", "Prezydent"),
        # The title with the place: 2024.
        ("Wójt Gminy Czarna", "Wójt"),
        ("Burmistrz Miasta i Gminy Sochocin", "Burmistrz"),
        ("Prezydent Miasta Krakowa", "Prezydent"),
        # 2024's sejmik and dzielnica lists, named by `headers.py`.
        ("Rada sejmiku", "Sejmik"),
        ("Rada dzielnicy", "Rada dzielnicy"),
    ],
)
def test_an_office_the_file_names(position, office):
    assert local_office(position, "101601", KINDS) == office


@pytest.mark.parametrize(
    ("teryt", "office"),
    [
        ("100000", "Sejmik"),
        ("101600", "Rada powiatu"),
        ("101601", "Rada miasta"),
        ("101602", "Rada gminy"),
        # „Rada Miejska w Ujeździe”, but the gmina's council, not the town's.
        ("101604", "Rada gminy"),
        ("146501", "Rada miasta"),
        ("146502", "Rada dzielnicy"),
        # 2024's CSVs, read as numbers.
        (101600, "Rada powiatu"),
        (101601.0, "Rada miasta"),
        (20000, "Sejmik"),
    ],
)
def test_a_council_by_the_unit_it_sits_in(teryt, office):
    assert local_office(None, teryt, KINDS) == office


@pytest.mark.parametrize(
    ("position", "teryt"),
    [
        (None, "101699"),  # a gmina TERC does not know
        (None, "1016011"),  # 1994's old codes are seven digits
        (None, None),
        (math.nan, "101601x"),
        ("Kandydat", "101601"),  # a position nothing here recognises
    ],
)
def test_nothing_that_says_is_no_office(position, teryt):
    assert local_office(position, teryt, KINDS) is None


def test_only_a_local_candidacy_has_one():
    rows = pd.DataFrame(
        {
            "election_type": ["samorządu", "sejmu", "samorządu"],
            "position": ["P", None, None],
            "teryt_candidacy": ["101601", "10", "101601"],
        }
    )

    assert local_offices(rows, KINDS) == ["Prezydent", None, "Rada miasta"]
    assert local_offices(rows.iloc[0:0], KINDS) == []


def test_the_2014_mayoral_workbook_says_which_office_and_who_won(tmp_path):
    """1579520736_samo2014_kandydaci_na_WBP.xls, which reached `person_pkw`
    with neither: its office and both rounds' results are under two header
    rows, which `read_xls` joins into names nothing read."""
    path = tmp_path / "wbp2014.xlsx"
    pd.DataFrame(
        [
            ["TERYT", "Urząd", "Imiona", "Nazwisko", "Wiek", "I tura", None]
            + ["II tura", None],
            [None, None, None, None, None, "%\ngłosów", "Mandat"]
            + ["%\ngłosów", "Mandat"],
            # Witko: 35% in the first round, then the run-off.
            ["101601", "P", "Marcin", "Witko", "43", 35.0, None, 53.7, "T"],
            ["101601", "P", "Rafał", "Zagozdon", "48", 41.0, None, 46.3, None],
            ["020101", "B", "Piotr", "Roman", "50", 60.0, "T", None, None],
            ["020101", "B", "Jan", "Nowak", "50", 40.0, None, None, None],
        ]
    ).to_excel(path, header=False, index=False)
    config = InputSource(
        DownloadableFile("https://example.invalid/x.xls", "x.xls"),
        CsvExtractor(),
        2014,
        PkwFormat.UNKNOWN,
        ElectionType.SAMORZADOWE,
    )

    people = list(process_csv(read_xls(str(path), header_rows=2), config, CSV_HEADERS))

    assert [(p.last_name, p.position, p.candidacy_success) for p in people] == [
        ("Witko", "P", "TRUE"),
        ("Zagozdon", "P", "FALSE"),
        ("Roman", "B", "TRUE"),
        ("Nowak", "B", "FALSE"),
    ]
