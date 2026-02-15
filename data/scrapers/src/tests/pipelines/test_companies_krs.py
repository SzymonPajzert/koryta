import pytest

from main import _setup_context
from scrapers.krs.list import CompaniesKRS


@pytest.fixture
def ctx():
    return _setup_context(False)[0]


@pytest.fixture
def companies(ctx):
    stats = CompaniesKRS()
    return stats.read_or_process(ctx)


def test_teryt_code_set(companies):
    total = len(companies)
    null_teryt_codes = companies["teryt_code"].isna().sum()
    assert null_teryt_codes == 0, (
        f"total rows: {total}, null teryt codes: {null_teryt_codes}"
    )
