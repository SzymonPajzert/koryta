import pandas as pd

from scrapers.krs.data import (
    REGON_PUBLIC_OWNERSHIP,
    WOJEWODZTWA_SPOLKI,
    CompaniesHardcoded,
    nip_digits,
    public_nips,
    public_owner_regons,
    public_regons,
    regon_stem,
)
from scrapers.stores import Pipeline, ProcessPolicy
from scrapers.tests.mocks import get_test_context, setup_test_context

KRS_STARTERS_ALL = "krs_starters.csv"
COMMON_ROW = 7

CATALOGUE_HEADER = ";".join(
    [
        "Nazwa podmiotu",
        "KRS",
        "Województwo siedziby",
        "Powiat siedziby",
        "Gmina siedziby",
        "Miejscowość siedziby",
        "Ulica siedziby",
        "Numer budynku siedziby",
        "Numer lokalu siedziby",
        "Kod pocztowy siedziby",
        "Miejscowość poczty",
        "Forma własności",
    ]
)

SEJM = (
    "Test;0000000893;MAZOWIECKIE;Warszawa;M.st. Warszawa;Warszawa;ul. Wiejska;"
    "4/6/8;;00-902;Warszawa;111 - WŁASNOŚĆ SKARBU PAŃSTWA"
)


def hardcoded(*rows: str, header: str = CATALOGUE_HEADER) -> CompaniesHardcoded:
    """`CompaniesHardcoded` run over a public-entity catalogue of these rows."""
    ctx = setup_test_context(
        get_test_context(),
        {
            "dane-o-podmiotach-swiadczacych-usugi-publiczne.csv": "\n".join(
                [header, *rows]
            ),
            "teryt_codes.zip": {
                "TERC_Urzedowy_2025-11-15.csv": """WOJ;POW;GMI;RODZ;NAZWA;NAZWA_DOD
02;;;;DOLNOŚLĄSKIE;województwo
14;;;;MAZOWIECKIE;województwo
24;;;;ŚLĄSKIE;województwo
"""
            },
        },
    )
    data: CompaniesHardcoded = Pipeline.create(CompaniesHardcoded)
    data.preprocess_sources(ctx, ProcessPolicy({"all"}))
    data.process(ctx)
    return data


def test_public_companies_list():
    data = hardcoded(SEJM)

    PUBLIC_COMPANIES_KRS = data.from_source("PUBLIC_COMPANIES_KRS")

    assert len(PUBLIC_COMPANIES_KRS) > 0
    assert "0000000893" in PUBLIC_COMPANIES_KRS

    # TODO divide the missing by source
    # so we can tell what kind of data we don't currently have


def test_only_a_public_ownership_code_says_the_public_owns_it():
    """The catalogue lists private providers of public services as well.

    A private hospital is in it as surely as a municipal one, so being listed
    says nothing about the owner. REGON's `Forma własności` does, and only a
    code in the 1xx range - the public sector - puts an entry in the source
    that `compute_public_krss` reads.
    """
    data = hardcoded(
        SEJM,
        # Karkonoska Agencja Rozwoju Regionalnego, an SA owned by local government
        "KARR;0000073772;DOLNOŚLĄSKIE;Jelenia Góra;Jelenia Góra;Jelenia Góra;"
        "ul. 1 Maja;27;;58-500;Jelenia Góra;113 - WŁASNOŚĆ JEDNOSTEK SAMORZĄDU "
        "TERYTORIALNEGO LUB SAMORZĄDOWYCH OSÓB PRAWNYCH",
        # Mixed, with a public majority: still the public sector
        "GPW;0000247533;ŚLĄSKIE;Katowice;Katowice;Katowice;ul. Wojewódzka;19;;"
        "40-026;Katowice;133 - WŁASNOŚĆ MIESZANA MIĘDZY SEKTORAMI Z PRZEWAGĄ "
        "WŁASNOŚCI SEKTORA PUBLICZNEGO",
        "Szpital prywatny;0000000894;MAZOWIECKIE;Warszawa;Warszawa;Warszawa;ul. X;"
        "1;;00-001;Warszawa;215 - WŁASNOŚĆ PRYWATNA KRAJOWA POZOSTAŁA",
        "Bez kodu;0000000895;MAZOWIECKIE;Warszawa;Warszawa;Warszawa;ul. X;1;;"
        "00-001;Warszawa;",
    )

    assert data.from_source("PUBLIC_COMPANIES_KRS") == {
        "0000000893",
        "0000073772",
        "0000247533",
        "0000000894",
        "0000000895",
    }
    assert data.from_source(REGON_PUBLIC_OWNERSHIP) == {
        "0000000893",
        "0000073772",
        "0000247533",
    }


def test_a_voivodeship_seeds_the_companies_it_lists_as_its_own():
    """Pomorski Fundusz Pożyczkowy: 90.55% Pomorskie, and in no other seed."""
    data = hardcoded(SEJM)

    assert "0000225512" in data.from_source("WOJEWODZTWO_POMORSKIE")


def test_every_voivodeship_list_holds_krs_numbers_once():
    assert len(WOJEWODZTWA_SPOLKI) == 16
    for wojewodztwo, krss in WOJEWODZTWA_SPOLKI.items():
        assert len(set(krss)) == len(krss), wojewodztwo
        assert all(len(krs) == 10 and krs.isdigit() for krs in krss), wojewodztwo


def test_a_regon_is_read_as_the_entity_it_names():
    # The register's 14 digits, a local unit's last five dropped
    assert regon_stem("47158565900000") == "471585659"
    assert regon_stem("013272636") == "013272636"
    assert regon_stem(" 013272636 ") == "013272636"
    # Not a REGON, or a column pandas made floats of: no guess
    assert regon_stem("13272636.0") is None
    assert regon_stem("7321714646") is None
    assert regon_stem("") is None
    assert regon_stem(None) is None
    assert regon_stem(13272636) is None


def catalogue(*rows: tuple) -> pd.DataFrame:
    columns = ["Nazwa podmiotu", "REGON", "Forma własności", "NIP"]
    return pd.DataFrame(
        [row + (None,) * (len(columns) - len(row)) for row in rows], columns=columns
    )


def test_the_public_regons_are_the_public_sectors_only():
    regons = public_regons(
        catalogue(
            # Mixed, with a public majority: the water association that owns
            # Wodociągi i Kanalizacja-Zgierz
            (
                "ZGIERSKA SPÓŁKA WODNA",
                "471585659",
                "133 - WŁASNOŚĆ MIESZANA MIĘDZY SEKTORAMI Z PRZEWAGĄ WŁASNOŚCI "
                "SEKTORA PUBLICZNEGO",
            ),
            ("POLITECHNIKA ŁÓDZKA", "000001583", "112 - WŁASNOŚĆ PAŃSTWOWYCH"),
            # A school listed as a unit of its gmina: the gmina is public too
            (
                "SZKOŁA PODSTAWOWA",
                "61101550800021",
                "113 - WŁASNOŚĆ JEDNOSTEK SAMORZĄDU TERYTORIALNEGO",
            ),
            ("SZPITAL PRYWATNY", "123456789", "215 - WŁASNOŚĆ PRYWATNA KRAJOWA"),
            ("BEZ REGON", None, "111 - WŁASNOŚĆ SKARBU PAŃSTWA"),
            ("BEZ KODU", "987654321", None),
        )
    )

    assert regons == {"471585659", "000001583", "611015508"}


def test_a_catalogue_without_regons_names_no_public_owner():
    assert public_regons(pd.DataFrame({"Forma własności": ["111"]})) == frozenset()


def test_the_pipeline_keeps_the_public_regons_beside_the_companies():
    data = hardcoded(
        SEJM + ";000000555",
        "ZGIERSKA SPÓŁKA WODNA;;ŁÓDZKIE;zgierski;Zgierz;Zgierz;ul. Andrzeja Struga;"
        "45;;95-100;Zgierz;133 - WŁASNOŚĆ MIESZANA MIĘDZY SEKTORAMI Z PRZEWAGĄ "
        "WŁASNOŚCI SEKTORA PUBLICZNEGO;471585659",
        header=CATALOGUE_HEADER + ";REGON",
    )

    assert data.public_regons == {"000000555", "471585659"}


def test_a_nip_is_read_with_or_without_its_dashes():
    assert nip_digits("525-000-85-19") == "5250008519"
    assert nip_digits("5250008519") == "5250008519"
    assert nip_digits("525000851") is None
    assert nip_digits(None) is None


def test_an_identifier_filed_under_both_sectors_is_left_to_the_register():
    # ZGK Granowo's NIP carries a 113 row and a 214 row
    nips = public_nips(
        catalogue(
            ("ZGK GRANOWO", "000000001", "113 - SAMORZĄD", "7881000001"),
            ("ZGK GRANOWO", "000000002", "214 - PRYWATNA", "788-100-00-01"),
            ("IMBiGS", "000000003", "111 - SKARB PAŃSTWA", "525-000-85-19"),
        )
    )

    assert nips == {"5250008519"}


def test_an_owner_is_read_by_its_code_only_outside_krs():
    """A company in KRS has an odpis that says who owns it."""
    code = "112 - WŁASNOŚĆ PAŃSTWOWYCH OSÓB PRAWNYCH"
    rows = pd.DataFrame(
        [
            ["POLITECHNIKA ŁÓDZKA", "000001583", code, None],
            # Owned by people, by its own odpis, whatever the code says
            ["WYDAWNICTWO RBA POLAND", "361123585", code, "0000549918"],
        ],
        columns=["Nazwa podmiotu", "REGON", "Forma własności", "KRS"],
    )

    assert public_regons(rows) == {"000001583", "361123585"}
    assert public_owner_regons(rows) == {"000001583"}
