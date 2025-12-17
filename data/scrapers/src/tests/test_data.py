import pytest

from main import _setup_context
from scrapers.krs.data import CompaniesHardcoded, Pipeline

KRS_STARTERS_ALL = "krs_starters.csv"
COMMON_ROW = 7


@pytest.fixture
def ctx():
    return _setup_context(False)[0]


def test_public_companies_list(ctx):
    data: CompaniesHardcoded = Pipeline.create(CompaniesHardcoded)
    data.read_or_process(ctx)

    def from_source(source: str):
        return {k for k, krs in data.all_companies_krs.items() if source in krs.sources}

    PUBLIC_COMPANIES_KRS = from_source("PUBLIC_COMPANIES_KRS")

    manual = {
        *from_source("MINISTERSTWO_AKTYWOW_PANSTWOWYCH_KRSs"),
        *from_source("MINISTERSTWO_KULTURY_DZIEDZICTWA_NARODOWEGO"),
        *from_source("MINISTERSTWO_AKTYWOW_PANSTWOWYCH_KRSs"),
        *from_source("MINISTERSTWO_KULTURY_DZIEDZICTWA_NARODOWEGO"),
        *from_source("SPOLKI_SKARBU_PANSTWA"),
        *from_source("AMW"),
        *from_source("UZDROWISKA"),
        *from_source("WARSZAWA"),
        *from_source("MALOPOLSKIE"),
        *from_source("LUBELSKIE"),
        *from_source("LODZKIE"),
        *from_source("WROCLAW"),
        *from_source("KONIN"),
        *from_source("LESZNO"),
    }

    missing = manual - PUBLIC_COMPANIES_KRS

    assert len(PUBLIC_COMPANIES_KRS) > 0
    assert "0000000893" in PUBLIC_COMPANIES_KRS

    assert len(missing) <= 313, missing

    # TODO divide missing by source, to see what kind of data we don't currently have
