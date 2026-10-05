"""Matching KMGP people to their 2024 PKW candidacies."""

from entities.person import PKW
from scrapers.kmgp.people import PeopleKMGP


def candidacy(teryt: str, year: str = "2024", party: str | None = "KWW Gmina") -> PKW:
    return PKW(
        election_year=year,
        election_type="rada gminy",
        teryt_candidacy=teryt,
        party=party,
        pkw_name="Jan KOWALSKI",
        first_name="Jan",
        last_name="Kowalski",
    )


def kmgp(*records: PKW) -> PeopleKMGP:
    pipeline = PeopleKMGP()
    pipeline.index_pkw(records)
    return pipeline


def test_a_candidacy_in_the_same_gmina_is_found():
    """The index held name-only Persons, so this raised on teryt_candidacy."""
    elections = kmgp(candidacy("1465011")).lookup_election("Jan Kowalski", "1465011")

    assert [
        (e.election_type, e.committee, e.election_year, e.teryt) for e in elections
    ] == [("rada gminy", "KWW Gmina", "2024", "1465011")]


def test_a_namesake_standing_elsewhere_is_not():
    assert kmgp(candidacy("0201011")).lookup_election("Jan Kowalski", "1465011") == []


def test_only_2024_candidacies_are_indexed():
    assert kmgp(candidacy("1465011", year="2018")).pkw_index == {}
