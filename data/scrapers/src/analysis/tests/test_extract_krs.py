import json

import pandas as pd

from analysis.extract import Extract
from scrapers.stores import Pipeline
from scrapers.tests.mocks import get_test_context, setup_test_context


def test_extract_by_krs():
    # 1. Setup Mock Data

    # Company structure:
    # Parent (0000000001)
    #   -> Child1 (0000000002)
    #       -> GrandChild1 (0000000003)
    #   -> Child2 (0000000004)
    # Other (0000000099)

    companies_data = [
        {
            "krs": "0000000001",
            "name": "Parent",
            "children": ["0000000002", "0000000004"],
            "parents": [],
        },
        {
            "krs": "0000000002",
            "name": "Child1",
            "children": ["0000000003"],
            "parents": ["0000000001"],
        },
        {
            "krs": "0000000003",
            "name": "GrandChild1",
            "children": [],
            "parents": ["0000000002"],
        },
        {
            "krs": "0000000004",
            "name": "Child2",
            "children": [],
            "parents": ["0000000001"],
        },
        {"krs": "0000000099", "name": "Other", "children": [], "parents": []},
    ]

    # Times for 2024 and 2025 in ms
    ts_2024 = 1704067200000
    ts_2025 = 1735689600000

    people_data = [
        {
            "krs_name": "Person1",
            "pkw_name": "Person1",
            "history": "h1",
            "wiki_name": None,
            "birth_date": "1980-01-01",
            "employed_total": 1000,
            "first_employed": ts_2024,
            "last_employed": ts_2025,
            "employment": [{"employed_krs": "0000000001"}],
            "elections": [],
            "teryt_wojewodztwo": [],
            "overall_score": 20,
            "unique_chance": 0.0,
            "employed_start": "2020-01-01",
            "employed_end": "2021-01-01",  # Mock extra fields
            "rejestrio_id": "1",
        },
        {
            "krs_name": "Person2",
            "pkw_name": "Person2",
            "history": "h2",
            "wiki_name": None,
            "birth_date": "1980-01-01",
            "employed_total": 1000,
            "first_employed": ts_2024,
            "last_employed": ts_2025,
            "employment": [{"employed_krs": "0000000002"}],
            "elections": [],
            "teryt_wojewodztwo": [],
            "overall_score": 20,
            "unique_chance": 0.0,
            "rejestrio_id": "2",
        },
        {
            "krs_name": "Person3",
            "pkw_name": "Person3",
            "history": "h3",
            "wiki_name": None,
            "birth_date": "1980-01-01",
            "employed_total": 1000,
            "first_employed": ts_2024,
            "last_employed": ts_2025,
            "employment": [{"employed_krs": "0000000003"}],
            "elections": [],
            "teryt_wojewodztwo": [],
            "overall_score": 20,
            "unique_chance": 0.0,
            "rejestrio_id": "3",
        },
        {
            "krs_name": "Person4",
            "pkw_name": "Person4",
            "history": "h4",
            "wiki_name": None,
            "birth_date": "1980-01-01",
            "employed_total": 1000,
            "first_employed": ts_2024,
            "last_employed": ts_2025,
            "employment": [{"employed_krs": "0000000004"}],
            "elections": [],
            "teryt_wojewodztwo": [],
            "overall_score": 20,
            "unique_chance": 0.0,
            "rejestrio_id": "4",
        },
        {
            "krs_name": "Person5",
            "pkw_name": "Person5",
            "history": "h5",
            "wiki_name": None,
            "birth_date": "1980-01-01",
            "employed_total": 1000,
            "first_employed": ts_2024,
            "last_employed": ts_2025,
            "employment": [{"employed_krs": "0000000099"}],
            "elections": [],
            "teryt_wojewodztwo": [],
            "overall_score": 20,
            "unique_chance": 0.0,
            "rejestrio_id": "5",
        },
    ]

    ctx = setup_test_context(
        get_test_context(),
        {
            "people_enriched/people_enriched.jsonl": "\n".join(
                [json.dumps(p) for p in people_data]
            ),
            "company_krs/company_krs.jsonl": "\n".join(
                [json.dumps(c) for c in companies_data]
            ),
        },
    )

    # 2. Initialize Extract pipeline
    extract = Pipeline.create(Extract)

    # Mock dependencies to prevent full pipeline execution
    extract.people = Pipeline.create(type(extract.people))
    extract.people.read_or_process = lambda ctx: pd.DataFrame(people_data)

    extract.companies = Pipeline.create(type(extract.companies))
    # CompaniesKRS returns a DataFrame where each row is a company dict
    # CompaniesKRS returns a DataFrame where each row is a company dict
    extract.companies.read_or_process = lambda ctx: pd.DataFrame(companies_data)

    extract.teryt = Pipeline.create(type(extract.teryt))
    extract.teryt.read_or_process = lambda ctx: None

    extract.hardcoded_people = Pipeline.create(type(extract.hardcoded_people))
    extract.hardcoded_people.read_or_process = lambda ctx: pd.DataFrame({"id": []})

    # 3. Inject args
    class MockArgs:
        krs = "0000000001"
        region = None

    extract.args = MockArgs()

    # 4. Run Process
    result_df = extract.process(ctx)

    # 5. Verify Results
    assert len(result_df) == 4  # P1, P2, P3, P4
    names = result_df["name"].tolist()
    assert "Person1" in names
    assert "Person2" in names
    assert "Person3" in names  # Grandchild
    assert "Person4" in names
    assert "Person5" not in names
