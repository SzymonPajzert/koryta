import pytest

import pandas as pd
from pytest_check.context_manager import check

from util.config import versioned


df = pd.DataFrame.from_records(versioned.read_jsonl("people_pkw.jsonl"))


@pytest.mark.parametrize(
    "column",
    [
        "party",
        "election_year",
        "teryt_candidacy",
        # "teryt_living", I don't think we'll be able to get this info in sejm, senat
        "sex",
        "birth_year",
    ],
)
def test_check_no_nulls(column):
    grouped = df.groupby(["election_year", "election_type"]).apply(
        lambda x: x[column].notnull().all()
    )
    for year, election in grouped[grouped == False].index:
        with check:
            assert False, f"missing data in {column} for {year} {election.rstrip("u")}"


@pytest.mark.parametrize(
    "column",
    ["pkw_name", "first_name", "middle_name", "last_name", "party", "party_member"],
)
def test_check_no_whitespaces(column):
    # TODO check that strings like name and party are stripped
    for row in versioned.read_jsonl("people_pkw.jsonl"):
        if row[column] is None:
            continue
        assert row[column].strip() == row[column], f"whitespaces in {row}"
