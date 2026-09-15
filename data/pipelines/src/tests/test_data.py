import pytest

from conductor import setup_context
from scrapers.krs.data import CompaniesHardcoded, Pipeline

KRS_STARTERS_ALL = "krs_starters.csv"
COMMON_ROW = 7


@pytest.fixture
def ctx():
    return setup_context()[0]


def test_public_companies_list(ctx):
    data: CompaniesHardcoded = Pipeline.create(CompaniesHardcoded)
    data.read_or_process(ctx)

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

    # TODO divide missing by source, to see what kind of data we don't currently have


@pytest.mark.parametrize(
    "krs, who",
    [
        ("0000271591", "ENERGA SA"),
        ("0000031521", "POLREGIO, the predecessor entry"),
        ("0000929422", "POLREGIO SA"),
    ],
)
def test_the_state_groups_the_spreadsheets_missed(ctx, krs, who):
    """These three cannot be derived, so losing them is silent and expensive.

    `is_public` is read off the odpis *aktualny*. ENERGA's subsidiaries name
    ENERGA SA as their shareholder, so they only become public once the group
    has a seed. POLREGIO has none to inherit from either way: the SA's
    shareholders are not in KRS at all, and on its predecessor every state
    holding -- SKARB PAŃSTWA, PKP SA, WOJEWÓDZTWO MAZOWIECKIE, ARP -- is struck
    out, which is what transforming into the SA did to them.

    Without these, POLREGIO reads as a private recipient of 1.16 bn PLN of
    public contracts, which is the largest single counterparty in CRU.
    """
    data: CompaniesHardcoded = Pipeline.create(CompaniesHardcoded)
    data.read_or_process(ctx)
    assert krs in set(data.from_source("SPOLKI_SKARBU_PANSTWA")), who
