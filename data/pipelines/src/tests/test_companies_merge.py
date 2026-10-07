"""Unit tests for CompaniesKRS.add_company merge logic.

The same KRS can be scraped from both rejestr.io and api-krs.ms.gov.pl. Only the
api-krs parser populates activity/is_public/owners, so merging must keep those
fields regardless of which source is added first.
"""

from analysis.interesting import Companies
from entities.company import Company as KrsCompany
from entities.company import Owner
from scrapers.krs.list import CompaniesKRS


def _rejestrio_company() -> KrsCompany:
    """Mirrors what company_from_rejestrio produces: no activity/is_public."""
    return KrsCompany(
        krs="0000184990",
        name="MAZOWIECKI PORT LOTNICZY WARSZAWA-MODLIN",
        city="nowy dwór mazowiecki",
        teryt_code="1414",
    )


def _api_krs_company() -> KrsCompany:
    """Mirrors what company_from_api_krs produces: activity/is_public/owners."""
    return KrsCompany(
        krs="0000184990",
        name="MAZOWIECKI PORT LOTNICZY WARSZAWA-MODLIN SP. Z O.O.",
        city="nowy dwór mazowiecki",
        teryt_code="1414",
        nip="5311688030",
        regon="017202409",
        activity=["52.23.Z", "52.21.Z"],
        is_public=True,
        parents=[Owner(krs="0000019874", teryt=None)],
    )


def test_merge_backfills_activity_when_rejestrio_added_first():
    pipeline = CompaniesKRS()
    pipeline.add_company(_rejestrio_company())
    pipeline.add_company(_api_krs_company())

    merged = pipeline.companies["0000184990"]
    assert merged.activity == ["52.23.Z", "52.21.Z"]
    assert merged.is_public is True
    assert merged.nip == "5311688030"
    assert merged.regon == "017202409"
    assert Owner(krs="0000019874", teryt=None) in merged.parents


def test_merge_keeps_activity_when_api_krs_added_first():
    pipeline = CompaniesKRS()
    pipeline.add_company(_api_krs_company())
    pipeline.add_company(_rejestrio_company())

    merged = pipeline.companies["0000184990"]
    assert merged.activity == ["52.23.Z", "52.21.Z"]
    assert merged.is_public is True


def test_merge_preserves_relations_added_before_api_krs():
    """Children set via add_relation during the rejestr.io pass survive merging."""
    pipeline = CompaniesKRS()
    pipeline.add_company(_rejestrio_company())
    pipeline.companies["0000184990"].children.append("0000000001")

    pipeline.add_company(_api_krs_company())

    merged = pipeline.companies["0000184990"]
    assert "0000000001" in merged.children
    assert merged.activity == ["52.23.Z", "52.21.Z"]


def test_merge_unions_owners_without_duplicates():
    pipeline = CompaniesKRS()
    pipeline.add_company(_rejestrio_company())
    pipeline.companies["0000184990"].parents.append(Owner(krs="0000019874", teryt=None))

    pipeline.add_company(_api_krs_company())

    merged = pipeline.companies["0000184990"]
    assert merged.parents.count(Owner(krs="0000019874", teryt=None)) == 1


def test_the_merge_output_keeps_the_owners_krs_found():
    """`Companies` used to drop `parents` on the floor.

    `CompaniesKRS` reads dzial 1 and fills `parents` with a company owner by KRS
    and a gmina/powiat/wojewodztwo by the TERYT its name resolved to. The merge
    into `companies_merged` then built a `Company` without passing them - there
    was a `# TODO add owners=[]` where that argument goes - so every consumer
    downstream saw an empty list and had no way to tell that from "this company
    has no registered owner".

    Two of them are load-bearing: `CompaniesPayloads` turns `parents` into the
    ingest's `owners`/`owner_teryts`, and `RegionPayloads` counts the gmina-level
    codes to decide which region nodes the site needs. Both reported zero, and
    reported it without failing, which is how this survived being written.

    Runs the real `process`, because a test that rebuilds the record by hand
    passes whether or not the argument is there.
    """
    krs = _api_krs_company()
    krs.parents = [
        Owner(krs="0000019193", teryt=None),
        Owner(krs=None, teryt="2261011"),
        Owner(krs=None, teryt="22"),
    ]

    class FakeKrs:
        def read_or_process_list(self, ctx):
            return [krs]

    class FakeEmpty:
        def read_or_process_list(self, ctx):
            return []

    class FakeTeryt:
        cities_to_teryt: dict[str, str] = {}

        def read_or_process(self, ctx):
            return None

    pipeline = Companies()
    pipeline.scraped_companies = FakeKrs()  # type: ignore[assignment]
    pipeline.hardcoded_companies = FakeEmpty()  # type: ignore[assignment]
    pipeline.teryt_pipeline = FakeTeryt()  # type: ignore[assignment]
    pipeline.jst = FakeTeryt()  # type: ignore[assignment]
    pipeline.wiki_companies = lambda ctx: []  # type: ignore[method-assign]

    df = pipeline.process(None)  # type: ignore[arg-type]

    assert len(df) == 1
    parents = df.iloc[0]["parents"]
    assert [p["teryt"] for p in parents if p["teryt"]] == ["2261011", "22"]
    assert [p["krs"] for p in parents if p["krs"]] == ["0000019193"]


def test_the_merge_output_keeps_the_legal_form():
    """`form` places the 243 SPZOZ hospitals and comes from the same merge."""
    krs = _api_krs_company()
    krs.form = "SAMODZIELNY PUBLICZNY ZAKLAD OPIEKI ZDROWOTNEJ"

    class FakeKrs:
        def read_or_process_list(self, ctx):
            return [krs]

    class FakeEmpty:
        def read_or_process_list(self, ctx):
            return []

    class FakeTeryt:
        cities_to_teryt: dict[str, str] = {}

        def read_or_process(self, ctx):
            return None

    pipeline = Companies()
    pipeline.scraped_companies = FakeKrs()  # type: ignore[assignment]
    pipeline.hardcoded_companies = FakeEmpty()  # type: ignore[assignment]
    pipeline.teryt_pipeline = FakeTeryt()  # type: ignore[assignment]
    pipeline.jst = FakeTeryt()  # type: ignore[assignment]
    pipeline.wiki_companies = lambda ctx: []  # type: ignore[method-assign]

    df = pipeline.process(None)  # type: ignore[arg-type]

    assert df.iloc[0]["form"] == "SAMODZIELNY PUBLICZNY ZAKLAD OPIEKI ZDROWOTNEJ"
