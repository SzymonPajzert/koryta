from scrapers.krs.data import CompaniesHardcoded
from scrapers.stores import Pipeline, ProcessPolicy
from scrapers.tests.mocks import get_test_context, setup_test_context

KRS_STARTERS_ALL = "krs_starters.csv"
COMMON_ROW = 7


def test_public_companies_list():
    ctx = setup_test_context(
        get_test_context(),
        {
            "dane-o-podmiotach-swiadczacych-usugi-publiczne.csv": ";".join(
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
                    "Miejscowość poczty\nTest",
                    "0000000893",
                    "MAZOWIECKIE",
                    "Warszawa",
                    "M.st. Warszawa",
                    "Warszawa",
                    "ul. Wiejska",
                    "4/6/8",
                    "",
                    "00-902",
                    "Warszawa",
                ]
            ),
            "teryt_codes.zip": {
                "TERC_Urzedowy_2025-11-15.csv": """WOJ;POW;GMI;RODZ;NAZWA;NAZWA_DOD
02;;;;DOLNOŚLĄSKIE;województwo
14;;;;MAZOWIECKIE;województwo
"""
            },
        },
    )
    data: CompaniesHardcoded = Pipeline.create(CompaniesHardcoded)
    data.preprocess_sources(ctx, ProcessPolicy({"all"}))
    data.process(ctx)

    PUBLIC_COMPANIES_KRS = data.from_source("PUBLIC_COMPANIES_KRS")

    assert len(PUBLIC_COMPANIES_KRS) > 0
    assert "0000000893" in PUBLIC_COMPANIES_KRS

    # TODO divide the missing by source
    # so we can tell what kind of data we don't currently have
