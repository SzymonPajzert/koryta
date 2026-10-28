import pandas as pd

from scrapers.krs.data import (
    REGON_PUBLIC_OWNERSHIP,
    WOJEWODZTWA_SPOLKI,
    CompaniesHardcoded,
    nip_digits,
    public_name_key,
    public_nips,
    public_owner_names,
    public_owner_regons,
    public_regons,
    regon_stem,
    treasury_companies,
    treasury_stakes,
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


def test_an_owner_is_named_public_only_whole_and_outside_krs():
    """For an owner the register gives no REGON: UM Poznań, UCTTM's owner."""
    rows = pd.DataFrame(
        [
            [
                "UNIWERSYTET MEDYCZNY IM. KAROLA MARCINKOWSKIEGO W POZNANIU",
                "000288811",
                "112 - WŁASNOŚĆ PAŃSTWOWYCH OSÓB PRAWNYCH",
                None,
            ],
            # A company has an odpis of its own that says who owns it
            [
                "WYDAWNICTWO RBA POLAND",
                "361123585",
                "112 - WŁASNOŚĆ PAŃSTWOWYCH OSÓB PRAWNYCH",
                "0000549918",
            ],
            # A private university, which a word of the name would not tell apart
            [
                "UNIWERSYTET WSB MERITO W TORUNIU",
                "871092619",
                "215 - WŁASNOŚĆ PRYWATNA KRAJOWA POZOSTAŁA",
                None,
            ],
            # One name filed both ways is nobody's to call
            ["GMINNA SPÓŁKA WODNA", "000000001", "113 - SAMORZĄDOWA", None],
            ["GMINNA SPÓŁKA WODNA", "000000002", "214 - PRYWATNA", None],
        ],
        columns=["Nazwa podmiotu", "REGON", "Forma własności", "KRS"],
    )

    names = public_owner_names(rows)

    assert names == {"UNIWERSYTET MEDYCZNY IM. KAROLA MARCINKOWSKIEGO W POZNANIU"}
    assert (
        public_name_key(
            ' "Uniwersytet  Medyczny im. Karola Marcinkowskiego w Poznaniu" '
        )
        in names
    )
    assert public_name_key("UNIWERSYTET MEDYCZNY") not in names


def test_the_treasury_list_is_read_by_nip_with_the_share():
    # As Prokuratoria prints it, header row and all
    wykaz = pd.DataFrame(
        [
            [
                "1",
                "899-232-12-94",
                "AMW INVEST Sp. z o.o.",
                "Wrocław",
                "aktywna",
                "100",
                "Agencja Mienia Wojskowego",
            ],
            [
                "2",
                "586-103-40-90",
                "POLCARGO GROUP Sp. z o.o.",
                "Medyka",
                "aktywna",
                "9.09",
                "Minister Aktywów Państwowych",
            ],
            ["3", "", "BEZ NIP", "Warszawa", "aktywna", "100", "Minister"],
        ],
        columns=[
            "Lp.",
            "NIP",
            "Nazwa Spółki",
            "Siedziba",
            "Status",
            "Udział % Skarbu Państwa w kapitale zakładowym",
            "Organ reprezentujący Skarb Państwa",
        ],
    )

    assert treasury_stakes(wykaz) == {"8992321294": "100", "5861034090": "9.09"}


def wykaz_of(*rows: tuple[str, str]) -> pd.DataFrame:
    """Prokuratoria's list with these (NIP, share) rows."""
    return pd.DataFrame(
        [
            [str(n), nip, f"Spółka {n}", "Poznań", "aktywna", share, "Minister"]
            for n, (nip, share) in enumerate(rows, 1)
        ],
        columns=["Lp.", "NIP", "Nazwa", "Siedziba", "Status", "Udział", "Organ"],
    )


def test_a_nip_the_list_prints_wrong_is_read_as_the_register_s():
    """Found by name on 2026-10-27: the list gives Wielkopolska Gildia
    Rolno-Ogrodnicza 787-000-61-69 and Federal-Mogul BIMET 584-025-35-79, and
    the register 7820006169 and 5841008149."""
    wykaz = wykaz_of(("787-000-61-69", "5.97"), ("584-025-35-79", "5.000039"))

    assert treasury_stakes(wykaz) == {"7820006169": "5.97", "5841008149": "5.000039"}


def test_the_treasury_s_companies_are_every_krs_entry_under_a_listed_nip():
    companies = pd.DataFrame(
        {
            "krs": ["0000104717", "0000054418", "0000040728", "0000000001", "2"],
            "nip": ["782-000-61-69", "5841008149", "5841008149", None, "nie"],
        }
    )
    wykaz = wykaz_of(("787-000-61-69", "5.97"), ("584-025-35-79", "5.000039"))

    # A predecessor struck off under the same NIP too: its people's posts
    # there have ended, and only a post now makes a member.
    assert treasury_companies(companies, treasury_stakes(wykaz)) == {
        "0000104717",
        "0000054418",
        "0000040728",
    }
    assert treasury_companies(pd.DataFrame(), treasury_stakes(wykaz)) == set()
