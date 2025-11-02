from dataclasses import dataclass

import pytest

from analysis.people_pkw_merged import people_pkw_merged

pkw = people_pkw_merged(force=True)


@dataclass
class Person:
    first_name: str
    last_name: str
    second_name: str | None = None
    birth_year: int | None = None


@pytest.mark.parametrize(
    "person", [Person("donald", "tusk"), Person("achilles", "baron")]
)
def test_unique(person):
    first = pkw["first_name"] == person.first_name
    last = pkw["last_name"] == person.last_name
    m = pkw[first & last]
    assert len(m) == 1, m


@pytest.mark.parametrize(
    "person,second_names",
    [(Person("marian", "łuczak", birth_year=1953), ["tadeusz", "jan"])],
)
def test_second_names(person, second_names):
    first = pkw["first_name"] == person.first_name
    last = pkw["last_name"] == person.last_name
    year = pkw["birth_year"] == person.birth_year
    m = pkw[first & last & year]
    assert set(m["second_name"]) == set(second_names)


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
