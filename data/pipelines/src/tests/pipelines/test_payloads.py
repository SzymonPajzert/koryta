import json
from collections import Counter
from unittest.mock import MagicMock

import pandas as pd
import pytest

from analysis.payloads import (
    CompaniesPayloads,
    PeoplePayloads,
    RegionPayloads,
    SiteCompanyCategories,
)
from analysis.payloads.person import _extract_elections
from scrapers.map.jst import SKARB_PANSTWA
from scrapers.stores import Context, Pipeline, ProcessPolicy


class MockPipeline(Pipeline):
    filename = "mock"

    def __init__(self, data):
        super().__init__()
        self.data = pd.DataFrame(data)

    def should_refresh_with_logic(self, ctx: Context) -> bool:
        return False

    def process(self, ctx: Context) -> pd.DataFrame:
        return self.data

    def read_or_process(self, ctx: Context) -> pd.DataFrame:
        self._cached_result = self.data
        return self.data


@pytest.fixture
def mock_ctx():
    ctx = MagicMock(spec=Context)
    ctx.refresh_policy = ProcessPolicy.with_default()
    ctx.io = MagicMock()
    return ctx


def test_upload_payloads_person_shape(mock_ctx):
    pipeline = Pipeline.create(PeoplePayloads)

    # Mock dependencies
    pipeline.people = MockPipeline(
        [
            {
                "full_name": "Jan Kowalski",
                "krs_name": "Jan Kowalski",
                "pkw_name": "Jan Kowalski",
                "wiki_name": "Jan Kowalski",
                "first_name": "Jan",
                "last_name": "Kowalski",
                "rejestrio_id": ["123"],
                "employment": [],
                "elections": [
                    {
                        "election_type": "sejmu",
                        "party": "Test Party",
                        "election_year": 2023,
                        "teryt_powiat": ["1465"],
                        "teryt_wojewodztwo": ["1400"],
                    }
                ],
                "companies": [
                    {
                        "name": "Test Company Sp. z o.o.",
                        "krs": "0000123456",
                        "role": "Prezes",
                        "start": "2020-01-01",
                    }
                ],
                "articles": [{"url": "http://example.com/article1"}],
                "wikipedia": "https://pl.wikipedia.org/wiki/Jan_Kowalski",
            }
        ]
    )

    pipeline.companies = MockPipeline(
        [
            {
                "krs": "0000123456",
                "name": "Test Company Sp. z o.o.",
                "city": "Warszawa",
                "children": [],
                "teryt_code": "1465011",
            }
        ]
    )

    pipeline.regions = MockPipeline(
        [
            {
                "id": "14",
                "name": "mazowieckie",
                "type": "region",
                "level": "wojewodztwo",
                "parent_id": None,
            }
        ]
    )

    result_df = pipeline.process(mock_ctx)

    assert len(result_df) == 1  # 1 person

    payload = result_df.iloc[0]
    print(f"keys: {payload.keys()}")
    assert payload["name"] == "Jan Kowalski"
    assert payload["wikipedia"] == "https://pl.wikipedia.org/wiki/Jan_Kowalski"
    assert len(payload["companies"]) == 1
    assert payload["companies"][0]["krs"] == "0000123456"
    assert payload["companies"][0]["role"] == "Prezes"
    assert len(payload["elections"]) == 1
    assert payload["elections"][0]["committee"] == "Test Party"
    assert payload["elections"][0]["teryt"] == "1465"


def test_election_without_a_committee_sends_none(mock_ctx):
    """A candidacy the PKW listing records no committee for sends null.

    Not the string "None": the uploader drops null fields, so that would have
    reached the frontend as a committee somebody stood for.
    """
    row = pd.Series(
        {
            "elections": [
                {
                    "election_type": "sejmu",
                    "party": None,
                    "election_year": 2023,
                    "teryt_powiat": ["1465"],
                }
            ]
        }
    )

    elections = _extract_elections(row)

    assert len(elections) == 1
    assert elections[0].committee is None


def test_pre_1999_district_codes_are_not_sent_as_teryt(mock_ctx):
    """A 1994 council candidacy is filed under a voivodeship that no longer is.

    The 1994 and 1998 files predate the 1999 reform, so they carry codes from
    the 49-voivodeship division - '2736', '1911', '47'. None of them is the code
    of a region the site holds, and the ingest used to answer an unresolvable
    one by throwing, which cost the person every candidacy after it in the
    payload. The candidacy itself is kept: it happened, and the ingest has an
    allowlist for exactly these elections.
    """
    row = pd.Series(
        {
            "elections": [
                {
                    "election_type": "samorządu",
                    "party": None,
                    "election_year": 1994,
                    "teryt_powiat": ["2736"],
                },
                {
                    "election_type": "samorządu",
                    "party": None,
                    "election_year": 1994,
                    "teryt_powiat": ["1911"],
                },
                {
                    "election_type": "samorządu",
                    "party": None,
                    "election_year": 1994,
                    "teryt_powiat": ["47"],
                },
            ]
        }
    )
    dropped: Counter[str] = Counter()

    elections = _extract_elections(row, dropped)

    assert [e.teryt for e in elections] == [None, None, None]
    # Counted rather than silently binned - the count is how a modern code that
    # stopped resolving would show up in a run's output.
    assert dropped == Counter({"2736": 1, "1911": 1, "47": 1})


def test_modern_district_codes_are_untouched(mock_ctx):
    row = pd.Series(
        {
            "elections": [
                # A powiat code passes through as it is
                {"election_type": "sejmu", "teryt_powiat": ["1465"]},
                # A voivodeship-wide candidacy is filed WW00; the site's region
                # node for a voivodeship is keyed on the bare two digits
                {"election_type": "sejmu", "teryt_powiat": ["2200"]},
                # Powiat warszawski zachodni has no region node on the site,
                # but 1431 is a real TERYT code - that is a missing region to
                # create, not a code to drop
                {"election_type": "sejmu", "teryt_powiat": ["1431"]},
            ]
        }
    )
    dropped: Counter[str] = Counter()

    elections = _extract_elections(row, dropped)

    assert [e.teryt for e in elections] == ["1465", "22", "1431"]
    assert dropped == Counter()


def test_upload_payloads_region_shape(mock_ctx):
    pipeline = Pipeline.create(RegionPayloads)

    pipeline.people = MockPipeline(
        {
            "full_name": [],
            "elections": [],
            "companies": [],
            "articles": [],
            "wikipedia": [],
        }
    )
    pipeline.companies = MockPipeline(
        {"krs": [], "name": [], "city": [], "children": [], "teryt_code": []}
    )
    pipeline.regions = MockPipeline(
        [
            {
                "id": "14",
                "name": "mazowieckie",
                "type": "region",
                "level": "wojewodztwo",
                "parent_id": None,
            },
            {
                "id": "1465",
                "name": "m. st. warszawa",
                "type": "region",
                "level": "powiat",
                "parent_id": "14",
            },
        ]
    )

    result_df = pipeline.process(mock_ctx)
    assert len(result_df) == 2

    # Wojewodztwo
    woj_row = result_df[result_df["entity_id"] == "14"].iloc[0]
    woj_payload = json.loads(woj_row["payload"])
    assert woj_payload["teryt"] == "14"
    assert woj_payload["type"] == "region"
    assert woj_payload["name"] == "Województwo mazowieckie"
    assert "edge" not in woj_payload

    # Powiat
    powiat_row = result_df[result_df["entity_id"] == "1465"].iloc[0]
    powiat_payload = json.loads(powiat_row["payload"])
    assert powiat_payload["teryt"] == "1465"
    assert powiat_payload["type"] == "region"
    assert powiat_payload["name"] == "Powiat m. st. warszawa"

    edge = powiat_payload["edge"]
    assert edge["source"] == "teryt14"
    assert edge["target"] == "teryt1465"
    assert edge["type"] == "owns"


def test_upload_payloads_company_shape(mock_ctx, monkeypatch):
    """A company payload carries the categories the site stores.

    They used to be derived on the site from the `activity` codes below, which
    is why this asserts on the payload rather than on the mapping: the mapping
    has its own tests in `entities/tests/test_company_categories.py`, and what
    matters here is that the answer actually reaches the ingest endpoint.
    """
    pipeline = Pipeline.create(CompaniesPayloads)
    pipeline.companies = MockPipeline(
        [
            {
                # PKP SKM w Trojmiescie: only a PKD 2025 rail code
                "krs": "0000076705",
                "name": "PKP Szybka Kolej Miejska w Trojmiescie",
                "city": "Gdynia",
                "activity": ["49.12.Z", "49.31.Z", "52.21.B"],
                "is_public": True,
                "teryt_code": "2262",
            },
            {
                # Instytut Badawczy Drog i Mostow: carries 42.12 among ten
                # construction codes, and is not a railway
                "krs": "0000158240",
                "name": "Instytut Badawczy Drog i Mostow",
                "city": "Warszawa",
                "activity": ["72.19.Z", "42.11.Z", "42.12.Z"],
                "is_public": True,
            },
            {
                "krs": "0000999999",
                "name": "Szpital Powiatowy",
                "city": "Wolow",
                "activity": ["86.10.Z"],
                "is_public": True,
            },
        ]
    )
    monkeypatch.setattr(
        "analysis.payloads.company.KorytaCompanies",
        lambda *args, **kwargs: MockPipeline(
            [{"krs": krs} for krs in ("0000076705", "0000158240", "0000999999")]
        ),
    )

    result_df = pipeline.process(mock_ctx)
    by_krs = {row["krs"]: row for row in result_df.to_dict(orient="records")}
    assert set(by_krs) == {"0000076705", "0000158240", "0000999999"}

    assert by_krs["0000076705"]["categories"] == ["koleje"]
    assert by_krs["0000076705"]["teryt_code"] == "2262"
    # The raw codes still travel too - the site stores both
    assert by_krs["0000076705"]["activity"] == ["49.12.Z", "49.31.Z", "52.21.B"]

    assert by_krs["0000158240"]["categories"] == []
    assert by_krs["0000999999"]["categories"] == ["szpitale"]


def test_the_treasury_travels_as_a_flag_not_as_an_owner(mock_ctx, monkeypatch):
    """The Treasury is neither a company nor a territory.

    It has no KRS number - it is not in the register - so it cannot ride in
    `owners`, where the ingest would look it up with `findCompanyByKRS` and 404.
    It is not a territory either, so it must not ride in `owner_teryts`, where a
    lookup would either find nothing or, worse, let it compete with real regions
    for the company's seat. `owner_skarb_panstwa` is what carries it.
    """
    pipeline = Pipeline.create(CompaniesPayloads)
    pipeline.companies = MockPipeline(
        [
            {
                "krs": "0000322757",
                "name": "Polska Grupa Zbrojeniowa",
                "city": "Radom",
                "activity": [],
                "is_public": True,
                "parents": [
                    {"krs": None, "teryt": SKARB_PANSTWA},
                    {"krs": None, "teryt": "1465"},
                    {"krs": "0000019193", "teryt": None},
                ],
            },
            {
                "krs": "0000076705",
                "name": "PKP Szybka Kolej Miejska w Trojmiescie",
                "city": "Gdynia",
                "activity": [],
                "is_public": True,
                "parents": [{"krs": None, "teryt": "2261011"}],
            },
        ]
    )
    monkeypatch.setattr(
        "analysis.payloads.company.KorytaCompanies",
        lambda *args, **kwargs: MockPipeline(
            [{"krs": krs} for krs in ("0000322757", "0000076705")]
        ),
    )

    by_krs = {
        row["krs"]: row for row in pipeline.process(mock_ctx).to_dict(orient="records")
    }

    treasury = by_krs["0000322757"]
    assert treasury["owner_skarb_panstwa"] is True
    # ...and it is in neither of the lists the ingest resolves by lookup.
    assert treasury["owner_teryts"] == ["1465"]
    assert treasury["owners"] == ["0000019193"]

    # A company the Treasury does not own says so, rather than saying nothing.
    assert by_krs["0000076705"]["owner_skarb_panstwa"] is False


def test_upload_payloads_carry_the_supervisory_organ(mock_ctx, monkeypatch):
    """An SPZOZ payload says its supervisory organ is a rada spoleczna.

    The whole reason the field exists is that the site cannot work this out: it
    follows from `formaPrawna`, which never reaches a node. Asserted on the
    payload rather than on `supervisory_body()` - that has its own tests in
    `entities/tests/test_company_bodies.py` - because what matters here is that
    the answer travels.
    """
    pipeline = Pipeline.create(CompaniesPayloads)
    pipeline.companies = MockPipeline(
        [
            {
                # SP ZOZ Szpital Specjalistyczny nr I w Bytomiu: in the
                # associations register, so no PKD code at all.
                "krs": "0000079907",
                "name": "SP ZOZ Szpital Specjalistyczny nr I",
                "city": "Bytom",
                "activity": [],
                "form": "SAMODZIELNY PUBLICZNY ZAKŁAD OPIEKI ZDROWOTNEJ",
                "is_public": True,
            },
            {
                "krs": "0000076705",
                "name": "PKP Szybka Kolej Miejska w Trojmiescie",
                "city": "Gdynia",
                "activity": ["49.12.Z"],
                "form": "SPÓŁKA AKCYJNA",
                "is_public": True,
            },
        ]
    )
    monkeypatch.setattr(
        "analysis.payloads.company.KorytaCompanies",
        lambda *args, **kwargs: MockPipeline(
            [{"krs": krs} for krs in ("0000079907", "0000076705")]
        ),
    )

    by_krs = {
        row["krs"]: row for row in pipeline.process(mock_ctx).to_dict(orient="records")
    }

    assert by_krs["0000079907"]["supervisory_body"] == "rada-spoleczna"
    # ...and the same form is the only thing that can file it under szpitale.
    assert by_krs["0000079907"]["categories"] == ["szpitale"]
    # The empty string, not a missing key: it is what clears a stored value.
    assert by_krs["0000076705"]["supervisory_body"] == ""


def test_site_company_categories_from_the_stored_pkd_codes(mock_ctx, monkeypatch):
    """The catch-up producer works off the export alone.

    `CompaniesPayloads` reads today's register, which means a KRS scrape and a
    wiki rebuild before a one-line change to the mapping can be applied to the
    site. This one reads the codes the site was last ingested with, so the same
    change can be applied the day it lands.
    """
    pipeline = Pipeline.create(SiteCompanyCategories)
    monkeypatch.setattr(
        "analysis.payloads.company.KorytaCompanies",
        lambda *args, **kwargs: MockPipeline(
            [
                {
                    # PKP SKM w Trojmiescie: only a PKD 2025 rail code
                    "id": "place-1",
                    "krs": "0000076705",
                    "activity": ["49.12.Z", "49.31.Z", "52.21.B"],
                },
                {
                    # PKP Energetyka: the register stores no PKD for it at all,
                    # so nothing but the override list can place it. This is the
                    # case a PKD-only producer silently gets wrong, and it is
                    # 1253 of the 4047 place nodes on the site.
                    "id": "place-2",
                    "krs": "0000014327",
                    "activity": [],
                },
                {
                    # Instytut Badawczy Drog i Mostow: carries 42.12 among ten
                    # construction codes, and is on the exclude list
                    "id": "place-3",
                    "krs": "0000158240",
                    "activity": ["72.19.Z", "42.11.Z", "42.12.Z"],
                },
            ]
        ),
    )

    result_df = pipeline.process(mock_ctx)
    records = result_df.to_dict(orient="records")

    # Exactly the two fields `apply-company-categories.ts` reads, and no more:
    # this is not an ingest payload and must not be fed to the uploader.
    assert all(set(record) == {"krs", "categories"} for record in records)

    by_krs = {record["krs"]: record["categories"] for record in records}
    assert by_krs == {
        "0000076705": ["koleje"],
        "0000014327": ["koleje"],
        "0000158240": [],
    }


def test_site_company_categories_read_the_form_off_the_node(mock_ctx, monkeypatch):
    """An SPZOZ is filed by its legal form, and the export remembers it.

    `SZPITALE.forms` places all 243 of them, none of which declares a single PKD
    code - the associations register has no `przedmiotDzialalnosci` at all. The
    node does not store the form, only the supervisory organ the form implies,
    so the catch-up producer reads that back and maps it in. Without it every
    one of those hospitals would come back with no category and the migration
    would strip `szpitale` from each of them.
    """
    pipeline = Pipeline.create(SiteCompanyCategories)
    monkeypatch.setattr(
        "analysis.payloads.company.KorytaCompanies",
        lambda *args, **kwargs: MockPipeline(
            [
                {
                    # An SPZOZ hospital: no PKD, placed by its form alone.
                    "id": "place-1",
                    "krs": "0000079907",
                    "activity": [],
                    "supervisory_body": "rada-spoleczna",
                },
                {
                    # The same shape without the organ - a spolka - stays where
                    # its codes put it, so reading the field cannot widen an
                    # answer for anything but an SPZOZ.
                    "id": "place-2",
                    "krs": "0000076705",
                    "activity": ["49.12.Z"],
                    "supervisory_body": "",
                },
            ]
        ),
    )

    by_krs = {
        record["krs"]: record["categories"]
        for record in pipeline.process(mock_ctx).to_dict(orient="records")
    }
    assert by_krs == {"0000079907": ["szpitale"], "0000076705": ["koleje"]}


def test_site_company_categories_refuses_a_cache_with_no_pkd(mock_ctx, monkeypatch):
    """A `KorytaCompanies` output cached before it read `activity`.

    It reads back with no such column, every company looks like it declares no
    PKD, and the emitted answer would tell the migration to remove `categories`
    from every node the override lists do not name. That is a worse outcome than
    not running at all, so it fails instead.
    """
    pipeline = Pipeline.create(SiteCompanyCategories)
    monkeypatch.setattr(
        "analysis.payloads.company.KorytaCompanies",
        lambda *args, **kwargs: MockPipeline(
            [
                {"id": "place-1", "krs": "0000076705"},
                {"id": "place-2", "krs": "0000158240"},
            ]
        ),
    )

    with pytest.raises(ValueError, match="--refresh KorytaCompanies"):
        pipeline.process(mock_ctx)
