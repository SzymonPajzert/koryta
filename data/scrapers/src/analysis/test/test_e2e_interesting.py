import json
from unittest.mock import MagicMock

import duckdb
import pandas as pd
import pytest

from analysis.interesting import CompaniesMerged
from entities.company import InterestingEntity
from scrapers.stores import Context, Pipeline
from scrapers.tests.mocks import DictMockIO


@pytest.fixture
def ctx(tmp_path):
    # Create dummy data files
    wiki_data = [
        {
            "krs": "0000123456",
            "name": "Wiki Company A",
            "content_score": 5,
            "owner_text": "Skarb Państwa",
            "owner_articles": [],
            "city": "Warsaw",
        },
        {
            "krs": None,
            "name": "Wiki Company B",
            "content_score": 0,
            "owner_text": "Private",
            "owner_articles": ["Some Politician"],
            "city": "Krakow",
        },
        {
            "krs": "0000999999",
            "name": "Boring Company",
            "content_score": 0,
            "owner_text": "Private",
            "owner_articles": [],
            "city": "Lodz",
        },
    ]
    krs_data = [
        {
            "krs": "0000123456",
            "name": "KRS Company A",
            "city": "Warsaw",
        },  # Matches Wiki Company A
        {"krs": "0000654321", "name": "KRS Company C", "city": "Gdansk"},  # Only in KRS
        {"krs": "0000999999", "name": "Boring Company", "city": "Lodz"},
    ]

    wiki_file = tmp_path / "company_wikipedia.jsonl"
    with open(wiki_file, "w") as f:
        for item in wiki_data:
            f.write(json.dumps(item) + "\n")

    krs_file = tmp_path / "company_krs.jsonl"
    with open(krs_file, "w") as f:
        for item in krs_data:
            f.write(json.dumps(item) + "\n")

    files = {
        "company_wikipedia/company_wikipedia.jsonl": str(wiki_file),
        "company_krs/company_krs.jsonl": str(krs_file),
    }

    mock_io = DictMockIO(files)

    def get_last_written():
        if mock_io.output:
            # Filter out non-entity outputs (like write_dataframe tuples)
            entities = [i for i in mock_io.output if isinstance(i, InterestingEntity)]
            if entities:
                return "companies_merged", entities
        return None

    mock_io.dumper.get_last_written.side_effect = get_last_written

    return Context(
        io=mock_io,
        rejestr_io=None,
        con=duckdb.connect(),
        utils=MagicMock(),
        web=MagicMock(),
    )


def test_find_interesting_entities_e2e(ctx):
    model = Pipeline.create(CompaniesMerged)
    model.hardcoded_companies = MagicMock()
    model.hardcoded_companies.filename = "hardcoded_companies"
    model.hardcoded_companies.process = MagicMock(
        return_value=pd.DataFrame(columns=["id"])
    )
    model.scraped_companies = MagicMock()
    model.scraped_companies.filename = "company_krs"  # Mock filename for iterate
    model.wiki_pipeline = MagicMock()
    model.process(ctx)

    results = [e for e in ctx.io.output if isinstance(e, InterestingEntity)]

    # Verify results
    # We expect:
    # 1. Wiki Company A (merged with KRS Company A) -> Interesting
    #   because (owner Skarb Państwa + content_score > 0)
    # 2. Wiki Company B -> Interesting
    #   because (political link? "Some Politician")

    interesting_names = {e.name for e in results}
    print(f"Found interesting entities: {interesting_names}")

    assert "Wiki Company A" in interesting_names or "KRS Company A" in interesting_names
    assert "Boring Company" not in interesting_names

    entity_a = next(e for e in results if e.name in {"Wiki Company A", "KRS Company A"})
    assert entity_a.krs == "0000123456"
    reasons = [r.reason for r in entity_a.reasons]
    assert "owner_text" in reasons
    assert "wiki_content_score" in reasons
    assert "krs" in entity_a.sources
    assert "wiki" in entity_a.sources
