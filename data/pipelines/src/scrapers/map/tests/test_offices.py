"""Which region each urząd serves.

The names, seats and numbers are the catalogue's own, copied from the August
2025 file, and the codes are TERC's - so these pin the cases the module
docstring describes against what the sources actually say.
"""

import pandas as pd

from scrapers.map.offices import LocalGovernmentOffices, offices_by_region
from scrapers.stores import Pipeline, ProcessPolicy
from scrapers.tests.mocks import get_test_context, setup_test_context

TERC = [
    # WOJ, POW, GMI, RODZ, NAZWA
    ("22", None, None, None, "POMORSKIE"),
    ("22", "15", None, None, "wejherowski"),
    ("22", "15", "03", "1", "Wejherowo"),
    ("22", "15", "10", "2", "Wejherowo"),
    ("22", "12", None, None, "słupski"),
    ("22", "12", "08", "2", "Redzikowo"),
    ("22", "63", None, None, "Słupsk"),
    ("22", "63", "01", "1", "Słupsk"),
    ("04", None, None, None, "KUJAWSKO-POMORSKIE"),
    ("04", "17", None, None, "wąbrzeski"),
    ("04", "17", "01", "1", "Wąbrzeźno"),
    ("04", "17", "05", "2", "Ryńsk"),
    ("04", "11", None, None, "radziejowski"),
    ("04", "11", "05", "3", "Piotrków Kujawski"),
    ("04", "11", "05", "4", "Piotrków Kujawski"),
    ("04", "11", "05", "5", "Piotrków Kujawski"),
    ("04", "12", None, None, "rypiński"),
    ("04", "12", "01", "1", "Rypin"),
    ("04", "12", "04", "2", "Rypin"),
    ("24", None, None, None, "ŚLĄSKIE"),
    ("24", "17", None, None, "żywiecki"),
    ("24", "17", "10", "2", "Radziechowy-Wieprz"),
    ("16", None, None, None, "OPOLSKIE"),
    ("16", "61", None, None, "Opole"),
    ("16", "61", "01", "1", "Opole"),
    ("14", None, None, None, "MAZOWIECKIE"),
    ("14", "65", None, None, "Warszawa"),
    ("14", "65", "01", "1", "Warszawa"),
    ("14", "65", "05", "8", "Mokotów"),
]

COLUMNS = [
    "Nazwa podmiotu",
    "Status",
    "Typ podmiotu",
    "Podtyp podmiotu",
    "REGON",
    "NIP",
    "Województwo siedziby",
    "Powiat siedziby",
    "Gmina siedziby",
    "Miasto siedziby",
    "Ulica siedziby",
    "Numer budynku siedziby",
]


def office(
    name: str,
    kind: str,
    regon: str | None,
    woj: str,
    powiat: str,
    gmina: str,
    street: str = "ul. Testowa",
    number: str = "1",
    subtype: str | None = "ogólne",
    status: str = "ACTIVE",
    nip: str | None = "1234563218",
) -> list[str | None]:
    return [
        name,
        status,
        kind,
        subtype,
        regon,
        nip,
        woj,
        powiat,
        gmina,
        gmina,
        street,
        number,
    ]


def terc() -> pd.DataFrame:
    return pd.DataFrame(TERC, columns=["WOJ", "POW", "GMI", "RODZ", "NAZWA"])


def resolve(*rows: list[str | None]) -> dict[str, list[str]]:
    """Region code -> the names of the offices listed under it."""
    catalogue = pd.DataFrame(list(rows), columns=COLUMNS)
    found: dict[str, list[str]] = {}
    for row in offices_by_region(catalogue, terc()).itertuples():
        found.setdefault(str(row.teryt), []).append(str(row.name))
    return found


def test_a_town_and_the_villages_around_it_each_get_their_own_urzad():
    # Both stand in Wejherowo, so only what they call themselves tells them
    # apart - and the town's is the one a deputy mayor of Wejherowo works in.
    found = resolve(
        office(
            "Urząd Miejski w Wejherowie",
            "urzędy miast i gmin",
            "000526251",
            "POMORSKIE",
            "wejherowski",
            "Wejherowo",
        ),
        office(
            "Urząd Gminy Wejherowo",
            "urzędy miast i gmin",
            "000545113",
            "POMORSKIE",
            "wejherowski",
            "Wejherowo",
        ),
    )

    assert found == {
        "2215031": ["Urząd Miejski w Wejherowie"],
        "2215102": ["Urząd Gminy Wejherowo"],
    }


def test_a_rural_urzad_standing_in_a_town_of_another_name_is_found_by_its_own():
    found = resolve(
        office(
            "Urząd Gminy Ryńsk",
            "urzędy miast i gmin",
            "005726210",
            "KUJAWSKO-POMORSKIE",
            "wąbrzeski",
            "Wąbrzeźno",
        ),
        # Across a powiat border, in a city that is a powiat of its own.
        office(
            "URZĄD GMINY REDZIKOWO",
            "urzędy miast i gmin",
            "000551378",
            "POMORSKIE",
            "Słupsk",
            "Słupsk",
        ),
    )

    assert found == {
        "0417052": ["Urząd Gminy Ryńsk"],
        "2212082": ["URZĄD GMINY REDZIKOWO"],
    }


def test_an_urzad_that_names_no_place_is_given_its_gminas_name():
    # All the catalogue calls these two, which tells a contributor picking an
    # urząd out of a powiat's list nothing about which gmina it runs.
    found = resolve(
        office(
            "URZĄD GMINY",
            "urzędy miast i gmin",
            "000539727",
            "KUJAWSKO-POMORSKIE",
            "rypiński",
            "Rypin",
        ),
        office(
            "URZĄD MIASTA I GMINY",
            "urzędy miast i gmin",
            "000539710",
            "KUJAWSKO-POMORSKIE",
            "radziejowski",
            "Piotrków Kujawski",
        ),
    )

    assert found == {
        "0411053": ["URZĄD MIASTA I GMINY PIOTRKÓW KUJAWSKI"],
        "0412042": ["URZĄD GMINY RYPIN"],
    }


def test_the_gminas_name_is_added_in_the_names_own_case():
    found = resolve(
        office(
            "Urząd Gminy",
            "urzędy miast i gmin",
            "000539727",
            "KUJAWSKO-POMORSKIE",
            "rypiński",
            "Rypin",
        )
    )

    assert found == {"0412042": ["Urząd Gminy Rypin"]}


def test_a_run_together_name_is_split_before_it_is_read():
    # Run together, "URZĄDGMINY" does not start the way a rural urząd's name
    # does - which is the only thing that tells Wejherowo's two apart.
    found = resolve(
        office(
            "URZĄDGMINY RADZIECHOWY-WIEPRZ",
            "urzędy miast i gmin",
            "000550841",
            "ŚLĄSKIE",
            "żywiecki",
            "Radziechowy-Wieprz",
        ),
        office(
            "URZĄDGMINY WEJHEROWO",
            "urzędy miast i gmin",
            "000545113",
            "POMORSKIE",
            "wejherowski",
            "Wejherowo",
        ),
    )

    assert found == {
        "2215102": ["URZĄD GMINY WEJHEROWO"],
        "2417102": ["URZĄD GMINY RADZIECHOWY-WIEPRZ"],
    }


def test_a_city_that_is_its_own_powiat_is_run_by_its_urzad_at_both_levels():
    found = resolve(
        office(
            "URZĄD MIASTA OPOLA",
            "urzędy miast i gmin",
            "000584805",
            "OPOLSKIE",
            "Opole",
            "Opole",
            subtype="miasta na prawach powiatu",
        )
    )

    assert found == {"1661": ["URZĄD MIASTA OPOLA"], "1661011": ["URZĄD MIASTA OPOLA"]}


def test_a_starostwo_in_the_city_serves_the_powiat_around_it():
    # It stands in Słupsk, which has no starostwo. The catalogue's entry for
    # the powiat, registered at the same address, says which powiat it serves.
    address = {"street": "ul. Szarych Szeregów", "number": "14"}
    found = resolve(
        office(
            "Starostwo Powiatowe w Słupsku",
            "starostwa powiatowe",
            "770980930",
            "POMORSKIE",
            "Słupsk",
            "Słupsk",
            subtype=None,
            **address,
        ),
        office(
            "POWIAT SŁUPSKI",
            "jednostki samorządu terytorialnego",
            "770979411",
            "POMORSKIE",
            "Słupsk",
            "Słupsk",
            subtype="powiaty",
            **address,
        ),
    )

    assert found == {"2212": ["Starostwo Powiatowe w Słupsku"]}


def test_a_wojewodztwo_has_the_marszalek_and_the_wojewoda_but_no_delegatura():
    found = resolve(
        office(
            "Urząd Marszałkowski Województwa Pomorskiego w Gdańsku",
            "urzędy marszałkowskie",
            "191686443",
            "POMORSKIE",
            "Gdańsk",
            "Gdańsk",
            subtype=None,
        ),
        office(
            "POMORSKI URZĄD WOJEWÓDZKI W GDAŃSKU",
            "urzędy wojewódzkie",
            "000514242",
            "POMORSKIE",
            "Gdańsk",
            "Gdańsk",
        ),
        office(
            "POMORSKI URZĄD WOJEWÓDZKI W GDAŃSKU DELEGATURA W SŁUPSKU",
            "urzędy wojewódzkie",
            "00051424200011",
            "POMORSKIE",
            "Słupsk",
            "Słupsk",
            subtype="delegatury",
        ),
    )

    assert found == {
        "22": [
            "POMORSKI URZĄD WOJEWÓDZKI W GDAŃSKU",
            "Urząd Marszałkowski Województwa Pomorskiego w Gdańsku",
        ]
    }


def test_a_warsaw_dzielnica_has_an_urzad_of_its_own():
    found = resolve(
        office(
            "URZĄD DZIELNICY MOKOTÓW MIASTA STOŁECZNEGO WARSZAWY",
            "urzędy dzielnicowe m. st. Warszawy",
            "01525966300050",
            "MAZOWIECKIE",
            "Warszawa",
            "Mokotów",
            subtype=None,
            nip=None,
        )
    )

    assert found == {"1465058": ["URZĄD DZIELNICY MOKOTÓW MIASTA STOŁECZNEGO WARSZAWY"]}


def test_withdrawn_and_unnumbered_entries_are_left_out():
    found = resolve(
        office(
            "Urząd Miejski w Wejherowie",
            "urzędy miast i gmin",
            "000526251",
            "POMORSKIE",
            "wejherowski",
            "Wejherowo",
            status="WITHDRAWN",
        ),
        office(
            "URZĄD M.ST. WARSZAWY - CENTRUM OBSŁUGI PODATNIKA",
            "urzędy dzielnicowe m. st. Warszawy",
            None,
            "MAZOWIECKIE",
            "Warszawa",
            "Mokotów",
            subtype=None,
        ),
    )

    assert found == {}


def test_the_pipeline_reads_both_files_and_keeps_the_leading_zeros():
    catalogue = pd.DataFrame(
        [
            office(
                "Urząd Miejski w Wejherowie",
                "urzędy miast i gmin",
                "000526251",
                "POMORSKIE",
                "wejherowski",
                "Wejherowo",
                nip="5882155172",
            )
        ],
        columns=COLUMNS,
    )
    terc_csv = "WOJ;POW;GMI;RODZ;NAZWA;NAZWA_DOD\n" + "\n".join(
        ";".join(value or "" for value in row) + ";" for row in TERC
    )
    ctx = setup_test_context(
        get_test_context(),
        {
            "dane-o-podmiotach-swiadczacych-usugi-publiczne.csv": catalogue.to_csv(
                sep=";", index=False
            ),
            "teryt_codes.zip": {"TERC_Urzedowy_2025-11-15.csv": terc_csv},
        },
    )
    pipeline: LocalGovernmentOffices = Pipeline.create(LocalGovernmentOffices)
    pipeline.preprocess_sources(ctx, ProcessPolicy({"all"}))

    result = pipeline.process(ctx)

    # TERC's name for the region, which is the only one the site has for a
    # gmina it has no region node for.
    assert result.to_dict("records") == [
        {
            "teryt": "2215031",
            "region": "Wejherowo",
            "name": "Urząd Miejski w Wejherowie",
            "regon": "000526251",
            "nip": "5882155172",
        }
    ]
