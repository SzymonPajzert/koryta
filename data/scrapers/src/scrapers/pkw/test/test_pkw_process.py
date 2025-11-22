import pytest

from main import setup_context
from scrapers.stores import LocalFile
import pandas as pd
from pytest_check.context_manager import check

ctx, _ = setup_context(False)


def people_rows():
    yield from ctx.io.read_data(LocalFile("person_pkw.jsonl", "versioned")).read_jsonl()


df = pd.DataFrame(people_rows())


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
    for row in people_rows():
        if row[column] is None:
            continue
        assert row[column].strip() == row[column], f"whitespaces in {row}"
