"""Where a European Parliament candidacy is filed: its district's seat.

Until 2026-10 none was. The district number was read as nothing, so the 2009,
2014 and 2024 candidacies reached the ingest with no TERYT and were dropped,
and the 2019 list's residence column was read as the place instead.
"""

import types

import pytest

from scrapers.pkw.elections import ElectionType
from scrapers.pkw.headers import CSV_HEADERS, ElectionContext, lookup_teryt
from scrapers.pkw.process import process_csv
from scrapers.pkw.sources import sources

#: What `Teryt.cities_to_teryt` holds for each seat: the city's powiat code.
TERYT = types.SimpleNamespace(
    cities_to_teryt={
        "Gdańsk": "2261",
        "Bydgoszcz": "0461",
        "Olsztyn": "2862",
        "Warszawa": "1465",
        "Łódź": "1061",
        "Poznań": "3064",
        "Lublin": "0663",
        "Rzeszów": "1863",
        "Kraków": "1261",
        "Katowice": "2469",
        "Wrocław": "0264",
        "Gorzów Wielkopolski": "0861",
    }
)

#: The województwo each district is filed under. The four districts of two
#: województwa - 3, 10, 12 and 13 - go under their seat's.
SEAT_WOJEWODZTWO = {
    1: "22",
    2: "04",
    3: "28",
    4: "14",
    5: "14",
    6: "10",
    7: "30",
    8: "06",
    9: "18",
    10: "12",
    11: "24",
    12: "02",
    13: "08",
}


@pytest.mark.parametrize("year", [2004, 2009, 2014, 2019, 2024])
@pytest.mark.parametrize("district", sorted(SEAT_WOJEWODZTWO))
def test_a_district_is_filed_under_its_seats_wojewodztwo(year, district):
    context = ElectionContext(year, ElectionType.EUROPARLAMENT)

    assert lookup_teryt(TERYT, str(district), context) == SEAT_WOJEWODZTWO[district]


def test_the_2004_district_numbered_p_is_left_to_the_seat_column():
    # Joanna Paul's row; "Siedziba OKW" beside it says Poznań.
    context = ElectionContext(2004, ElectionType.EUROPARLAMENT)

    assert lookup_teryt(TERYT, "P", context) == ""


def test_a_sejm_district_that_is_not_a_number_still_fails():
    context = ElectionContext(2007, ElectionType.SEJM)

    with pytest.raises(ValueError):
        lookup_teryt(TERYT, "P", context)


def european_list(year: int):
    (source,) = [
        s
        for s in sources
        if s.year == year and s.election_type == ElectionType.EUROPARLAMENT
    ]
    return source


@pytest.fixture
def headers():
    # What `main` does with the real index before reading any file. The fields
    # are shared by every test, so whatever index they held goes back after.
    fields = [v for v in CSV_HEADERS.values() if v]
    held = [getattr(v, "teryt", None) for v in fields]
    yield {k: v.set_teryt(TERYT) if v else None for k, v in CSV_HEADERS.items()}
    for v, teryt in zip(fields, held):
        v.teryt = teryt


def test_the_2019_list_places_the_district_and_keeps_the_home(headers):
    """Stood in district 1, Gdańsk, and lives in Toruń, a województwo away."""
    rows = [
        [
            "Numer okręgu",
            "Siedziba OKW",
            "Numer listy",
            "Nazwa",
            "Typ",
            "Numer na liście",
            "Nazwisko",
            "Imiona",
            "Płeć",
            "Zawód",
            "Miejscowość zamieszkania",
            "Kod TERYT",
            "Gmina miejsca zamieszkania",
            "Przynależność do partii",
            "Poparcie",
            "Liczba głosów",
            "Procent głosów oddanych na listę",
            "Procent głosów oddanych w okręgu",
            "Czy przyznano mandat",
        ],
        [
            "1",
            "Gdańsk",
            "1",
            "KOMITET WYBORCZY WYBORCÓW KONFEDERACJA KORWIN BRAUN LIROY NARODOWCY",
            "Komitet wyborczy wyborców",
            "1",
            "KOWALSKI",
            "Jan Adam",
            "Mężczyzna",
            "doradca podatkowy",
            "Toruń",
            "046301",
            "m. Toruń",
            "nie należy do partii politycznej",
            "",
            "1000",
            "5,00",
            "0,50",
            "Nie",
        ],
    ]

    (person,) = process_csv(rows, european_list(2019), headers)

    assert person.teryt_candidacy == "22"
    assert person.teryt_living == "046301"
    assert person.party == (
        "KOMITET WYBORCZY WYBORCÓW KONFEDERACJA KORWIN BRAUN LIROY NARODOWCY"
    )


def test_the_2024_list_places_the_district(headers):
    """District 10 is małopolskie and świętokrzyskie; Kielce is in the second,
    and the run is filed under the first, the seat's, with the rest of its
    list."""
    rows = [
        [
            "Nr okręgu",
            "Nr listy",
            "Pozycja na liście",
            "Nazwisko i imiona",
            "Nazwa komitetu",
            "Płeć",
            "Zawód",
            "Miejsce zamieszkania",
            "TERYT m. z.",
            "Gmina m. z.",
            "Przynależność do partii",
            "Poparcie",
            "Liczba głosów",
            "Procent głosów oddanych na listę",
            "Procent głosów oddanych w okręgu",
            "Czy uzyskał mandat",
        ],
        [
            "10",
            "2",
            "1",
            "Anna Maria NOWAK",
            "KOMITET WYBORCZY PRAWO I SPRAWIEDLIWOŚĆ",
            "Kobieta",
            "ekonomistka",
            "Kielce",
            "266101",
            "m. Kielce",
            "członek partii politycznej: Prawo i Sprawiedliwość",
            "",
            "1000",
            "5,00",
            "0,50",
            "Nie",
        ],
    ]

    (person,) = process_csv(rows, european_list(2024), headers)

    assert person.teryt_candidacy == "12"
    assert person.teryt_living == "266101"


def test_the_2014_council_workbook_still_reads_its_committee(headers):
    """Its "Nazwa" is the place; only the 2019 European list reads it as the
    committee."""
    rows = [
        ["TERYT", "Nazwa", "Komitet", "Nazwisko", "Imiona"],
        [
            "020000",
            "dolnośląskie",
            "Komitet Wyborczy Polskie Stronnictwo Ludowe",
            "KOWALSKI",
            "Jan",
        ],
    ]
    (council,) = [
        s
        for s in sources
        if s.year == 2014 and s.source.url.endswith("kandydaci_do_rad_2014xlsx.xlsx")
    ]

    (person,) = process_csv(rows, council, headers)

    assert person.party == "Komitet Wyborczy Polskie Stronnictwo Ludowe"
