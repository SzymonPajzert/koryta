import pytest

from entities.company import Company, Source
from main import setup_context
from pipelines import Companies


@pytest.fixture
def ctx():
    return setup_context(False)[0]


@pytest.fixture
def companies_df(ctx):
    stats = Companies()
    return stats.read_or_process(ctx)


@pytest.fixture
def companies_map(ctx):
    stats = Companies()
    return {c.krs: c for c in stats.read_or_process_list(ctx)}


def test_teryt_code_set(companies_df):
    pytest.skip("TODO")
    total = len(companies_df)
    null_teryt_codes = companies_df["teryt_code"].isna().sum()
    assert null_teryt_codes == 0, (
        f"total rows: {total}, null teryt codes: {null_teryt_codes}"
    )


def test_krs_numbers_unique(companies_df):
    assert len(companies_df["krs"].unique()) == len(companies_df)


def test_sources_non_empty(companies_df):
    has_name = companies_df["name"].notna()
    empty_sources = companies_df["sources"].apply(lambda x: len(x)) == 0

    expect_empty = companies_df[empty_sources & has_name]
    print(expect_empty[["krs", "name"]].head(10))
    assert len(expect_empty) == 0


EXPECTED_COMPANIES = {
    "0000846159": Company(
        krs="0000846159",
        name="ZAKŁAD GOSPODARKI KOMUNALNEJ GMINY SŁUPIA KONECKA",
    ),
    "0000156806": Company(
        krs="0000156806",
        name="C.HARTWIG - TARGI",
        city="Siedlce",
        teryt_code="1464",
        sources=[Source("rejestr-io")],
    ),
    "0000459347": Company(
        krs="0000459347",
        name="ODOLANOWSKI ZAKŁAD KOMUNALNY SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
    ),
}


@pytest.mark.parametrize(
    "expected_company",
    EXPECTED_COMPANIES.values(),
    ids=EXPECTED_COMPANIES.keys(),
)
def test_expected_output(companies_map, companies_df, expected_company):
    company = companies_map[expected_company.krs]
    print(companies_df[companies_df["krs"] == expected_company.krs].iloc[0])
    assert company == expected_company, company
