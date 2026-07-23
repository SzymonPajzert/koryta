"""Unit tests for CompaniesKRS.add_company merge logic.

The same KRS can be scraped from both rejestr.io and api-krs.ms.gov.pl. Only the
api-krs parser populates activity/is_public/owners, so merging must keep those
fields regardless of which source is added first.
"""

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
