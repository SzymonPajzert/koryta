import json
from unittest.mock import MagicMock

import pandas as pd
import pytest

from analysis.payloads import CompaniesPayloads, PeoplePayloads, RegionPayloads
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


@pytest.mark.parametrize(
    ("stored", "expected"),
    [
        ("TRUE", True),
        ("FALSE", False),
        (True, True),
        (False, False),
        (None, None),
        (float("nan"), None),
        ("", None),
        ("Tak", None),
    ],
)
def test_a_candidacy_carries_whether_it_won(stored, expected, mock_ctx):
    """`candidacy_success` reaches the payload, and a loss is not a win.

    Every case here is one the shortcut gets wrong. `parse_yes_no` stores the
    flag as the *string* "TRUE" or "FALSE", so truthiness reads a recorded
    defeat as a victory; a payload read back from jsonl turns a missing value
    into a float NaN, which is truthy as well. Both have to come out as what
    PKW actually said, and "it said nothing" has to stay distinct from "it said
    no" - the register is silent for three quarters of its rows and all of them
    before 2010.
    """
    row = pd.Series(
        {
            "elections": [
                {
                    "election_type": "samorządu",
                    "party": "KW Testowy",
                    "election_year": 2024,
                    "teryt_powiat": ["1465"],
                    "candidacy_success": stored,
                }
            ]
        }
    )

    elections = _extract_elections(row)

    assert len(elections) == 1
    assert elections[0].elected is expected


def test_a_candidacy_nobody_recorded_a_result_for_says_nothing(mock_ctx):
    """A row with no `candidacy_success` key at all is silent, not a loss.

    The column is absent from whole elections rather than blank within them -
    1994, 1998, 2006 and 2014 record no result for anybody - so this is the
    ordinary case, not an edge one.
    """
    row = pd.Series(
        {
            "elections": [
                {
                    "election_type": "samorządu",
                    "party": "KW Testowy",
                    "election_year": 1998,
                    "teryt_powiat": ["1465"],
                }
            ]
        }
    )

    assert _extract_elections(row)[0].elected is None


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


def test_upload_payloads_carry_the_supervisory_body(mock_ctx, monkeypatch):
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


def test_upload_payloads_carry_the_organ_the_register_names(mock_ctx, monkeypatch):
    """The other supervisory field, and the one that is only ever reported.

    `supervisory_body` above is derived from the form and always has an answer.
    This one is transcribed from `dzial2.organNadzoru` by
    `scrapers.krs.organs`, so a company whose odpis was never read carries no
    key at all - and the ingest leaves the stored value alone rather than
    clearing it. `legal_form` travels beside it for the same page.
    """
    pipeline = Pipeline.create(CompaniesPayloads)
    pipeline.companies = MockPipeline(
        [
            {
                "krs": "0000079907",
                "name": "SP ZOZ Szpital Specjalistyczny nr I",
                "city": "Bytom",
                "activity": [],
                "form": "SAMODZIELNY PUBLICZNY ZAKŁAD OPIEKI ZDROWOTNEJ",
                "supervisory_organ": "rada_spoleczna",
                "is_public": True,
            },
            {
                # Never met through an api-krs odpis, so no organ was read.
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

    assert by_krs["0000079907"]["supervisory_organ"] == "rada_spoleczna"
    assert (
        by_krs["0000079907"]["legal_form"]
        == "SAMODZIELNY PUBLICZNY ZAKŁAD OPIEKI ZDROWOTNEJ"
    )
    # No organ read means no key, which is what stops the ingest clearing one
    # an earlier run stored. NaN is how `from_records` fills a column a row
    # never set; `clean_payload` is not what drops it, `submit_payload` is.
    assert pd.isna(by_krs["0000076705"]["supervisory_organ"])
