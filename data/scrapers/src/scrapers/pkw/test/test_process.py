import pytest

from util.config import versioned


@pytest.mark.parametrize(
    "column",
    [
        "election_year",
        "teryt_candidacy",
        "teryt_living",
        "sex",
        "birth_year",
    ],
)
def test_check_no_nulls(column):
    for row in versioned.read_jsonl("people_pkw.jsonl"):
        assert row[column] is not None, f"{row}"


# TODO check that strings like name and party are stripped
