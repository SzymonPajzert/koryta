from scrapers.krs.data import CompaniesHardcoded

KRS_STARTERS_ALL = "krs_starters.csv"
COMMON_ROW = 7


def test_public_companies_list():
    pipeline = run_pipeline(CompaniesHardcoded)[0]
    data: CompaniesHardcoded = pipeline.model

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

    assert len(missing) <= 313, missing

    # TODO divide the missing by source, so we can tell what kind of data we don't currently have
