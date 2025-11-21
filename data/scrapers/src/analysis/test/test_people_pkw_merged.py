import pytest

from main import setup_context

ctx, _ = setup_context(False)

from analysis.people_pkw_merged import people_pkw_merged


@pytest.fixture(scope="module")
def pkw():
    return people_pkw_merged.process(ctx)


@pytest.mark.parametrize(
    "first_name,last_name", [("donald", "tusk"), ("achilles", "baron")]
)
def test_unique(pkw, first_name, last_name):
    first = pkw["first_name"] == first_name
    last = pkw["last_name"] == last_name
    m = pkw[first & last]
    assert len(m) == 1, m


@pytest.mark.parametrize("first_name,last_name,year", [("donald", "tusk", "2001")])
def test_election_exists(pkw, first_name, last_name, year):
    first = pkw["first_name"] == first_name
    last = pkw["last_name"] == last_name
    elections = pkw[first & last]["elections"]
    election_years = set()
    print(elections)
    for es in elections:
        for e in es:
            election_years.add(e["election_year"])
    assert year in election_years
