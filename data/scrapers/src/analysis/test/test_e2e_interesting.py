import pytest
import json
import os
import duckdb
from unittest.mock import MagicMock

from main import create_model
from scrapers.tests.mocks import DictMockIO
from scrapers.stores import Context, LocalFile, IO
from analysis.interesting import CompaniesMerged
from entities.company import InterestingEntity, InterestingReason


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
        "company_wikipedia.jsonl": str(wiki_file),
        "company_krs.jsonl": str(krs_file),
    }

    mock_io = DictMockIO(files)
    return Context(io=mock_io, rejestr_io=None, con=duckdb.connect())


def test_find_interesting_entities_e2e(ctx):
    model = CompaniesMerged()
    pipeline = create_model(model)
    model.hardcoded_companies = MagicMock()
    model.hardcoded_companies.output.return_value = []
    pipeline.process(ctx)

    results = ctx.io.output

    # Verify results
    # We expect:
    # 1. Wiki Company A (merged with KRS Company A) -> Interesting (owner Skarb Państwa + content_score > 0)
    # 2. Wiki Company B -> Interesting (political link? "Some Politician" might not be in the list, but let's check logic)
    #    Wait, "Some Politician" is not in WIKI_POLITICAL_LINKS unless I mock that too.
    #    But "Skarb Państwa" in owner_text should trigger it.

    # Let's check what we got
    interesting_names = {e.name for e in results}
    print(f"Found interesting entities: {interesting_names}")

    # Wiki Company A should be there
    assert "Wiki Company A" in interesting_names or "KRS Company A" in interesting_names

    # Boring Company shouldn't be there (unless hardcoded, but 0000999999 is not hardcoded)
    assert "Boring Company" not in interesting_names

    # Check details for Wiki Company A
    entity_a = next(
        e for e in results if e.name == "Wiki Company A" or e.name == "KRS Company A"
    )
    assert entity_a.krs == "0000123456"
    reasons = [r.reason for r in entity_a.reasons]
    assert "owner_text" in reasons
    assert "wiki_content_score" in reasons
    assert "krs" in entity_a.sources
    assert "wiki" in entity_a.sources
