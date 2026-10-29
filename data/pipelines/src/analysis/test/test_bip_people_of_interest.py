import duckdb
import pandas as pd
import pytest

from analysis.bip_people_of_interest import (
    candidacy_key,
    people_of_interest,
    priority,
    unit_level,
)
from entities.bip import BipPersonOfInterest
from scrapers.stores import iterate_pipeline


def election(year, office, powiat, success="TRUE", kind="samorządu"):
    return {
        "election_year": year,
        "election_type": kind,
        "office": office,
        "teryt_candidacy_powiat": powiat,
        "candidacy_success": success,
    }


def merged(koryta_id, rejestrio, first, last, born, birth_date, elections):
    return {
        "koryta_id": koryta_id,
        "rejestrio_id": rejestrio,
        "base_first_name": first,
        "base_last_name": last,
        "pkw_birth_year": born,
        "birth_date": birth_date,
        "elections": elections,
    }


def pkw(first, middle, last, year, teryt, office, born, success="TRUE", age=None):
    return {
        "first_name": first,
        "middle_name": middle,
        "last_name": last,
        "election_year": str(year),
        "election_type": "samorządu",
        "candidacy_success": success,
        "teryt_candidacy": teryt,
        "office": office,
        "birth_year": born,
        "age": str(age if age is not None else year - born),
    }


@pytest.fixture
def frames():
    people = pd.DataFrame(
        [
            # on the site and published; KRS knows the birth date
            merged(
                "k1",
                ["111"],
                "jan",
                "kowalski",
                1960,
                "1960-05-01",
                [
                    election(2024, "Rada gminy", "1201"),
                    election(2018, "Rada gminy", "1201"),
                    election(2014, "Rada gminy", "1201"),  # before `since`
                    election(2024, "Wójt", "1201", success="FALSE"),
                ],
            ),
            # not on the site, no birth date; a powiat seat (Łódź's diacritics folded)
            merged(
                None,
                ["222"],
                "łukasz",
                "żak",
                1975,
                None,
                [
                    election(2024, "Rada powiatu", "1003"),
                ],
            ),
            # the same human under a second register entry: one candidacy, two entries
            merged(
                None,
                ["333"],
                "jan",
                "kowalski",
                1961,
                None,
                [
                    election(2024, "Rada gminy", "1201"),
                ],
            ),
            # a draft page without a birth date whose PKW row is missing: no tuple
            merged(
                "k2",
                ["444"],
                "anna",
                "nowak",
                1970,
                None,
                [
                    election(2024, "Rada miasta", "1261"),
                ],
            ),
        ]
    )
    person_pkw = pd.DataFrame(
        [
            pkw("Jan", "Maria", "Kowalski", 2024, "120105", "Rada gminy", 1960),
            pkw("Jan", "Maria", "Kowalski", 2018, "120105", "Rada gminy", 1960),
            pkw("Jan", "Maria", "Kowalski", 2014, "120105", "Rada gminy", 1960),
            pkw(
                "Jan",
                "Maria",
                "Kowalski",
                2024,
                "120105",
                "Wójt",
                1960,
                success="FALSE",
            ),
            # a namesake on the same council, twenty years younger
            pkw("Jan", None, "Kowalski", 2024, "120105", "Rada gminy", 1980),
            pkw("Łukasz", None, "Żak", 2024, "100300", "Rada powiatu", 1975),
        ]
    )
    koryta = pd.DataFrame(
        [
            {
                "id": "k1",
                "is_public": True,
                "birth_date": None,
                "merged_into": None,
            },  # page shows none
            {"id": "k2", "is_public": False, "birth_date": None, "merged_into": None},
            {"id": "k9", "is_public": True, "birth_date": None, "merged_into": "k1"},
        ]
    )
    return people, person_pkw, koryta


def test_one_row_per_won_candidacy_since(frames):
    out = people_of_interest(duckdb.connect(), *frames, since=2018)
    got = {(r.last_name, r.election_year, r.office, r.teryt) for r in out.itertuples()}
    assert got == {
        ("Kowalski", 2024, "Rada gminy", "120105"),
        ("Kowalski", 2018, "Rada gminy", "120105"),
        ("Żak", 2024, "Rada powiatu", "100300"),
    }


def test_rows_carry_the_unit_people_and_priority(frames):
    out = people_of_interest(duckdb.connect(), *frames, since=2018).set_index(
        ["last_name", "election_year"]
    )
    jan = out.loc[("Kowalski", 2024)]
    assert jan.full_name == "Jan Maria Kowalski"
    assert jan.unit_level == "gmina"
    assert list(jan.koryta_ids) == ["k1"]
    assert list(jan.rejestrio_ids) == ["111", "333"]
    assert list(jan.register_birth_dates) == ["1960-05-01"]
    assert jan.page_birth_date is None
    assert jan.on_site and jan.published
    assert jan.priority == 0  # published, and the page shows no birth date
    assert jan.namesakes == 1  # the younger Jan Kowalski on the same council
    zak = out.loc[("Żak", 2024)]
    assert zak.unit_level == "powiat" and not zak.on_site
    assert zak.priority == 3
    assert zak.pkw_age == 49


def test_younger_namesake_is_not_joined_to_the_older_person(frames):
    people, person_pkw, koryta = frames
    out = people_of_interest(duckdb.connect(), people, person_pkw, koryta, since=2024)
    births = {(r.last_name, r.pkw_birth_year) for r in out.itertuples()}
    assert ("Kowalski", 1980) not in births


def test_key_is_stable_and_names_the_candidacy(frames):
    first = people_of_interest(duckdb.connect(), *frames, since=2018)
    again = people_of_interest(duckdb.connect(), *frames, since=2018)
    assert list(first.key) == list(again.key)
    assert first.key.is_unique
    row = first.iloc[0]
    assert row.key == candidacy_key(
        row.teryt,
        row.office,
        row.election_year,
        row.first_name,
        row.middle_name,
        row.last_name,
        row.pkw_birth_year,
    )


def test_output_reads_back_as_dataclasses(frames):
    out = people_of_interest(duckdb.connect(), *frames, since=2018)
    rows = list(iterate_pipeline(out, BipPersonOfInterest))
    assert all(isinstance(r, BipPersonOfInterest) for r in rows)
    assert {r.teryt for r in rows} == {"120105", "100300"}


def test_refuses_a_pkw_output_without_offices(frames):
    people, person_pkw, koryta = frames
    with pytest.raises(ValueError, match="office"):
        people_of_interest(
            duckdb.connect(), people, person_pkw.drop(columns=["office"]), koryta
        )


def test_priority_puts_undated_published_pages_first():
    assert priority(True, True, False) == 0
    assert priority(False, True, False) == 1
    assert priority(True, True, True) == 2
    assert priority(False, False, False) == 3


def test_page_birth_date_comes_from_the_page(frames):
    people, person_pkw, koryta = frames
    koryta.loc[koryta.id == "k1", "birth_date"] = "1960-05-01T00:00:00"
    out = people_of_interest(duckdb.connect(), people, person_pkw, koryta, since=2024)
    jan = out[out.last_name == "Kowalski"].iloc[0]
    assert jan.page_birth_date == "1960-05-01" and jan.priority == 2


def test_unit_level():
    assert unit_level("120000") == "wojewodztwo"
    assert unit_level("120100") == "powiat"
    assert unit_level("120105") == "gmina"
    assert unit_level("146502") == "gmina"
