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
        "sex",
        "birth_year",
    ],
)
def test_check_no_nulls(column):
    # Known data gaps that we accept for now.
    known_failures = {
        ("1994", "samorząd", "party"),
        ("2019", "europarlament", "party"),
        ("1993", "senat", "teryt_candidacy"),
        ("1997", "sejm", "teryt_candidacy"),
        ("1997", "senat", "teryt_candidacy"),
        ("2001", "sejm", "teryt_candidacy"),
        ("2001", "senat", "teryt_candidacy"),
        ("2005", "senat", "teryt_candidacy"),
        ("2009", "europarlament", "teryt_candidacy"),
        ("2007", "sejm", "sex"),
        ("2007", "senat", "sex"),
        ("2010", "samorząd", "sex"),
        ("2001", "sejm", "birth_year"),
        ("2001", "senat", "birth_year"),
        ("2004", "europarlament", "birth_year"),
        ("2005", "sejm", "birth_year"),
        ("2005", "senat", "birth_year"),
        ("2007", "sejm", "birth_year"),
        ("2007", "senat", "birth_year"),
        ("2009", "europarlament", "birth_year"),
        ("2011", "sejm", "birth_year"),
        ("2011", "senat", "birth_year"),
        ("2014", "europarlament", "birth_year"),
        ("2015", "sejm", "birth_year"),
        ("2015", "senat", "birth_year"),
        ("2019", "europarlament", "birth_year"),
        ("2019", "sejm", "birth_year"),
        ("2019", "senat", "birth_year"),
        ("2023", "sejm", "birth_year"),
        ("2023", "senat", "birth_year"),
        ("2024", "europarlament", "birth_year"),
    }
    grouped = df.groupby(["election_year", "election_type"]).apply(
        lambda x: x[column].notnull().all()
    )
    for (year, election), passing in grouped.items():
        if passing:
            continue

        if (str(year), election.rstrip("u"), column) in known_failures:
            continue

        with check:
            assert False, f"missing data in {column} for {year} {election.rstrip('u')}"


@pytest.mark.parametrize(
    "column",
    ["pkw_name", "first_name", "middle_name", "last_name", "party", "party_member"],
)
def test_check_no_whitespaces(column):
    for row in people_rows():
        value = row[column]
        if value is None:
            continue
        if not isinstance(value, str):
            value = str(value)
        assert value.strip() == value, f"whitespaces in {row}"
