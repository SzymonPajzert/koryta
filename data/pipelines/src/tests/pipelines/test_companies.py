import pytest

from entities.company import Company, Source
from koryta import setup_context
from pipelines import Companies

#: Runs a real pipeline through ``read_or_process``, so it needs the
#: ``versioned/`` output of a completed run - which is what ``e2e`` marks.
#: ``person_wikipedia`` is named because it is the one output whose absence
#: reaches ``ProcessWiki``, and rebuilding that resumes a ~2.9 GB Wikipedia
#: dump download and a forty-minute parse from inside what looks like a
#: test run.
pytestmark = [pytest.mark.e2e, pytest.mark.needs_versioned("person_wikipedia")]


@pytest.fixture(scope="module")
def ctx():
    return setup_context()[0]


@pytest.fixture(scope="module")
def companies_df(ctx):
    stats = Companies()
    return stats.read_or_process(ctx)


@pytest.fixture(scope="module")
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
    empty_sources = companies_df["sources"].apply(len) == 0

    expect_empty = companies_df[empty_sources & has_name]
    print(expect_empty[["krs", "name"]].head(10))
    assert len(expect_empty) == 0


EXPECTED_COMPANIES = {
    "0000846159": Company(
        krs="0000846159",
        name="ZAKŁAD GOSPODARKI KOMUNALNEJ GMINY SŁUPIA KONECKA",
        city="Słupia",
        teryt_code="260506",
        nip="6581991448",
        # 14 digits: this REGON identifies a local unit, not the parent entity.
        regon="38630854600000",
        sources=[
            Source(source="api-krs", source_krs="api-krs.ms.gov.pl", reason=None),
            Source(source="hardcoded", source_krs=None, reason="PUBLIC_COMPANIES_KRS"),
            Source(source="rejestr-io", source_krs="rejestr.io", reason=None),
        ],
        activity=[
            "36.00.Z",
            "37.00.Z",
            "42.21.Z",
            "68.32.Z",
            "81.30.Z",
            "81.29.Z",
            "42.11.Z",
            "42.91.Z",
            "42.99.Z",
            "43.2.",
        ],
        children=[],
        parents=[],
        is_public=True,
    ),
    "0000156806": Company(
        krs="0000156806",
        name="C.HARTWIG - TARGI",
        city="Siedlce",
        teryt_code="1464",
        nip="5260251517",
        # Leading zero, and the reason `dtype` pins these as strings.
        regon="010053589",
        sources=[Source("rejestr-io", "rejestr.io")],
        is_public=True,
    ),
    "0000459347": Company(
        krs="0000459347",
        name="ODOLANOWSKI ZAKŁAD KOMUNALNY",
        city="Odolanów",
        teryt_code="3017",
        nip="6222783193",
        regon="302409617",
        activity=[
            "37.00.Z",
            "36.00.Z",
            "33.14.Z",
            "38.11.Z",
            "39.00.Z",
            "41.20.Z",
            "42.21.Z",
            "43.22.Z",
            "43.29.Z",
            "81.30.Z",
        ],
        # The hardcoded PUBLIC_COMPANIES_KRS source below is what sets this.
        is_public=True,
        sources=[
            Source(source="api-krs", source_krs="api-krs.ms.gov.pl", reason=None),
            Source(source="hardcoded", source_krs=None, reason="PUBLIC_COMPANIES_KRS"),
            Source(source="rejestr-io", source_krs="rejestr.io", reason=None),
        ],
    ),
}


@pytest.mark.parametrize(
    "expected_company",
    EXPECTED_COMPANIES.values(),
    ids=EXPECTED_COMPANIES.keys(),
)
def test_expected_output(companies_map, companies_df, expected_company):
    company = companies_map[expected_company.krs]
    company.sources.sort(key=lambda x: x.source)
    print(companies_df[companies_df["krs"] == expected_company.krs].iloc[0])
    print(company)
    print(expected_company)
    assert company == expected_company, company


def test_nip_and_regon_survive_the_merge(companies_df):
    """Without these the output cannot be joined to any register keyed on a
    tax id, which is how public-procurement sources identify a company.

    Only KRS supplies them, and it has a NIP for about 93% of its rows, so the
    bar is "most of them" rather than "all".
    """
    with_krs = companies_df["krs"].notna()
    populated = companies_df.loc[with_krs, "nip"].notna().mean()
    assert populated > 0.8, f"only {populated:.1%} of companies carry a NIP"


def test_identifiers_are_strings_not_floats(companies_df):
    """The failure this guards against is silent and destroys data.

    Read back without an explicit dtype, pandas types these columns as floats:
    a REGON of "010053589" becomes 10053589.0, losing a digit that is part of
    the identifier, and every value picks up a ".0".
    """
    for column in ("nip", "regon"):
        values = companies_df[column].dropna()
        assert values.map(lambda v: isinstance(v, str)).all(), (
            f"{column} is not all strings"
        )
        assert not values.str.endswith(".0").any(), (
            f"{column} contains float-formatted values"
        )

    regons = companies_df["regon"].dropna()
    assert regons.str.startswith("0").any(), (
        "no REGON starts with a zero, which means the leading digit was lost"
    )


EXPECTED_PUBLIC_STATUS = {
    "0000012143": False,
    "0000032034": True,
    "0000033768": True,
    "0000888730": False,
    "0000026425": True,
    "0000144249": False,
}


@pytest.mark.parametrize(
    "krs,expected_is_public",
    EXPECTED_PUBLIC_STATUS.items(),
    ids=EXPECTED_PUBLIC_STATUS.keys(),
)
def test_is_public(companies_map, krs, expected_is_public):
    if krs not in companies_map:
        pytest.skip(
            f"KRS {krs} not found in test data, please ensure data exists for this test"
        )
    assert companies_map[krs].is_public == expected_is_public


# Companies scraped from both rejestr.io and api-krs.ms.gov.pl must keep the
# activity codes that only api-krs provides.
EXPECTED_ACTIVITIES = {
    "0000184990": "52.23.Z",  # Port Lotniczy Warszawa-Modlin
}


@pytest.mark.parametrize(
    "krs,expected_activity",
    EXPECTED_ACTIVITIES.items(),
    ids=EXPECTED_ACTIVITIES.keys(),
)
def test_activity_set_for_merged_company(companies_map, krs, expected_activity):
    if krs not in companies_map:
        pytest.skip(
            f"KRS {krs} not found in test data, please ensure data exists for this test"
        )
    company = companies_map[krs]
    assert company.activity, f"No activity set for {krs} ({company.name})"
    assert expected_activity in company.activity, (
        f"Expected {expected_activity} in {company.activity} for {krs}"
    )
