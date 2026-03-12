import pytest

from conductor import _setup_context
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


def test_0000846159(companies):
    company = companies[companies["krs"] == "0000846159"]
    assert (
        company["name"].iloc[0] == "ZAKŁAD GOSPODARKI KOMUNALNEJ GMINY SŁUPIA KONECKA"
    )


# TODO check field presence, how often it's set
# assert company_row["krs"] == "0000123456"
# assert company_row["name"] == "Test Company Sp. z o.o."
# assert company_row["city"] == "Warszawa"
# assert company_row["teryt"] == "1465011"
# assert "0000654321" in company_row["parents"]
