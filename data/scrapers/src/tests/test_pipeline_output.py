import csv
import json
import os

import pytest

from stores.config import VERSIONED_DIR

COLUMNS_IN_FILE = {
    "person_wikipedia.jsonl": [
        "full_name",
        "birth_year",
        "-krs",
    ],
    "company_wikipedia.jsonl": [
        "name",
        "krs",
        "-full_name",
    ],
    "person_krs.jsonl": [
        "full_name",
        "birth_date",
        "employed_krs",
    ],
    "company_krs.jsonl": [
        "krs",
        "name",
        "city",
    ],
    "person_pkw.jsonl": [
        "election_year",
        "party",
        "pkw_name",
    ],
    "people_merged.jsonl": [
        "overall_score",
        "krs_name",
    ],
    "companies_merged.jsonl": [
        "name",
        "krs",
        "reasons",
    ],
    # TODO support region wildcard
    "people_extracted_10.csv": [
        "name",
        "history",
        "has_wikipedia",
        "birth_date",
        "total_employed_years",  # TODO check the format
        "first_employed",  # TODO check the format
        "last_employed",
    ],
}


@pytest.mark.parametrize(
    "filename, column",
    [
        (filename, column)
        for filename, columns in COLUMNS_IN_FILE.items()
        for column in columns
    ],
)
def test_pipeline_output(filename, column):
    """
    Verifies that {filename}.jsonl contains entities with the expected columns.
    """
    path = os.path.join(VERSIONED_DIR, filename.split(".")[0], filename)
    if not os.path.exists(path):
        pytest.skip(f"File {path} not found")

    should_exist = not column.startswith("-")
    column = column.removeprefix("-")

    with open(path, "r") as f:
        # Check first 10 lines
        iterator = enumerate(f)
        if filename.endswith(".csv"):
             # Reset file pointer for DictReader
             f.seek(0)
             iterator = enumerate(csv.DictReader(f))

        for i, record in iterator:
            if i > 10:
                break
            
            if not filename.endswith(".csv"):
                record = json.loads(record)

            should = "should not" if not should_exist else "should"
            assert (column in record) == should_exist, (
                f"Record {i} {should} have '{column}': {record}"
            )
