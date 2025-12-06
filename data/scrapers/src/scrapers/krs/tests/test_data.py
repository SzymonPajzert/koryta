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
    data.preprocess_sources(ctx, ProcessPolicy({"all"}, {"all"}))
    data.process(ctx)

    PUBLIC_COMPANIES_KRS = data.from_source("PUBLIC_COMPANIES_KRS")

    manual = {
        *data.from_source("MINISTERSTWO_AKTYWOW_PANSTWOWYCH_KRSs"),
        *data.from_source("MINISTERSTWO_KULTURY_DZIEDZICTWA_NARODOWEGO"),
        *data.from_source("MINISTERSTWO_AKTYWOW_PANSTWOWYCH_KRSs"),
        *data.from_source("MINISTERSTWO_KULTURY_DZIEDZICTWA_NARODOWEGO"),
        *data.from_source("SPOLKI_SKARBU_PANSTWA"),
        *data.from_source("AMW"),
        *data.from_source("UZDROWISKA"),
        *data.from_source("WARSZAWA"),
        *data.from_source("MALOPOLSKIE"),
        *data.from_source("LUBELSKIE"),
        *data.from_source("LODZKIE"),
        *data.from_source("WROCLAW"),
        *data.from_source("KONIN"),
        *data.from_source("LESZNO"),
    }

    missing = manual - PUBLIC_COMPANIES_KRS

    assert len(PUBLIC_COMPANIES_KRS) > 0
    assert "0000000893" in PUBLIC_COMPANIES_KRS

    assert len(missing) == len(manual) - 1, missing

    # TODO divide the missing by source, so we can tell what kind of data we don't currently have
