from unittest.mock import MagicMock

import pandas as pd
import pytest

from analysis.payloads import UploadPayloads
from scrapers.stores import Context, Pipeline, ProcessPolicy


class MockPipeline(Pipeline):
    filename = "mock"

    def __init__(self, data):
        super().__init__()
        self.data = pd.DataFrame(data)

    def should_refresh_with_logic(self, ctx: Context) -> bool:
        return False

    def read_or_process(self, ctx: Context) -> pd.DataFrame:
        self._cached_result = self.data
        return self.data


@pytest.fixture
def mock_ctx():
    ctx = MagicMock(spec=Context)
    ctx.refresh_policy = ProcessPolicy.with_default()
    return ctx


def test_upload_payloads_person_shape(mock_ctx):
    pipeline = Pipeline.create(UploadPayloads)

    # Mock dependencies
    pipeline.people = MockPipeline(
        [
            {
                "full_name": "Jan Kowalski",
                "first_name": "Jan",
                "last_name": "Kowalski",
                "elections": [
                    {
                        "election_type": "sejm",
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

    assert len(result_df) == 3  # 1 person, 1 company, 1 region

    person_row = result_df[result_df["entity_type"] == "person"].iloc[0]
    assert person_row["entity_type"] == "person"
    assert "1465" in person_row["teryt_powiat"]

    payload = person_row["payload"]
    assert payload["name"] == "Jan Kowalski"
    assert payload["wikipedia"] == "https://pl.wikipedia.org/wiki/Jan_Kowalski"
    assert len(payload["companies"]) == 1
    assert payload["companies"][0]["krs"] == "0000123456"
    assert payload["companies"][0]["name"] == "Test Company Sp. z o.o."
    assert payload["companies"][0]["role"] == "Prezes"
    assert len(payload["elections"]) == 1
    assert payload["elections"][0]["party"] == "Test Party"
    assert payload["elections"][0]["teryt"] == "1465"


def test_upload_payloads_company_shape(mock_ctx):
    pipeline = Pipeline.create(UploadPayloads)

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
        [
            {
                "krs": "0000123456",
                "name": "Test Company Sp. z o.o.",
                "city": "Warszawa",
                "children": ["0000654321"],
                "teryt_code": "1465011",
            }
        ]
    )
    pipeline.regions = MockPipeline(
        {"id": [], "name": [], "type": [], "level": [], "parent_id": []}
    )

    result_df = pipeline.process(mock_ctx)

    assert len(result_df) == 1
    company_row = result_df.iloc[0]

    assert company_row["entity_type"] == "company"
    assert company_row["entity_id"] == "0000123456"
    assert company_row["krs"] == "0000123456"

    payload = company_row["payload"]
    assert payload["name"] == "Test Company Sp. z o.o."
    assert payload["krs"] == "0000123456"
    assert payload["city"] == "Warszawa"
    assert "0000654321" in payload["owns"]
    assert payload["teryt"] == "1465011"


def test_upload_payloads_region_shape(mock_ctx):
    pipeline = Pipeline.create(UploadPayloads)

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
    assert woj_row["entity_type"] == "region"
    assert woj_row["payload"]["teryt"] == "14"
    assert woj_row["payload"]["type"] == "region"
    assert woj_row["payload"]["name"] == "Województwo mazowieckie"
    assert "edge" not in woj_row["payload"]

    # Powiat
    powiat_row = result_df[result_df["entity_id"] == "1465"].iloc[0]
    assert powiat_row["entity_type"] == "region"
    assert powiat_row["payload"]["teryt"] == "1465"
    assert powiat_row["payload"]["type"] == "region"
    assert powiat_row["payload"]["name"] == "Powiat m. st. warszawa"

    edge = powiat_row["payload"]["edge"]
    assert edge["source"] == "teryt14"
    assert edge["target"] == "teryt1465"
    assert edge["type"] == "owns"
