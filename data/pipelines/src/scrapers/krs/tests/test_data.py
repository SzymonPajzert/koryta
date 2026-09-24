from scrapers.krs.data import REGON_PUBLIC_OWNERSHIP, CompaniesHardcoded
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


def hardcoded(*rows: str) -> CompaniesHardcoded:
    """`CompaniesHardcoded` run over a public-entity catalogue of these rows."""
    ctx = setup_test_context(
        get_test_context(),
        {
            "dane-o-podmiotach-swiadczacych-usugi-publiczne.csv": "\n".join(
                [CATALOGUE_HEADER, *rows]
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
