import pytest

from analysis.people_pkw_merged import people_pkw_merged

pkw = people_pkw_merged()


@pytest.mark.parametrize(
    "first_name,last_name", [("donald", "tusk"), ("achilles", "baron")]
)
def test_unique(first_name, last_name):
    first = pkw["first_name"] == first_name
    last = pkw["last_name"] == last_name
    m = pkw[first & last]
    assert len(m) == 1, m


@pytest.mark.parametrize("first_name,last_name,year", [("donald", "tusk", "2001")])
def test_election_exists(first_name, last_name, year):
    first = pkw["first_name"] == first_name
    last = pkw["last_name"] == last_name
    elections = pkw[first & last]["elections"]
    election_years = set()
    print(elections)
    for es in elections:
        for e in es:
            election_years.add(e["election_year"])
    assert year in election_years
