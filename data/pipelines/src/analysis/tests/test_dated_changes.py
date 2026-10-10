"""The day each change a payload would write dates from: `dated_changes`."""

from dataclasses import asdict
from datetime import date

import pandas as pd

from analysis.payloads.site import (
    ENDED_EMPLOYMENT,
    MISSING_COMPANY,
    NEW_CANDIDACY,
    NEW_EMPLOYMENT,
    NEW_PERSON,
    PERSON_FIELDS,
    SiteSnapshot,
    day_of,
)
from entities.composite import Company, Election, Person

PUBLIC = "0000000001"
PRIVATE = "0000000002"


def stored_person(node_id: str, name: str, register: str) -> dict:
    return {"id": node_id, "type": "person", "name": name, "rejestrIo": register}


def snapshot(*people: dict, edges: tuple = ()) -> SiteSnapshot:
    nodes = [
        *people,
        {"id": "place-public", "type": "place", "name": "Gmina", "krsNumber": PUBLIC},
        {"id": "place-private", "type": "place", "name": "Firma", "krsNumber": PRIVATE},
        {"id": "teryt1465", "type": "region", "name": "Warszawa", "teryt": "1465"},
    ]
    return SiteSnapshot(
        pd.DataFrame.from_records(nodes),
        pd.DataFrame.from_records(list(edges)) if edges else pd.DataFrame(),
    )


def person(name: str, register: str, *companies: Company, **extra) -> Person:
    return Person(
        name=name,
        companies=list(companies),
        elections=extra.pop("elections", []),
        sources=[],
        rejestrIo=register,
        **extra,
    )


def employed(person_id: str, place: str, start: str) -> dict:
    return {
        "id": f"edge-{person_id}-{place}-{start}",
        "type": "employed",
        "source": person_id,
        "target": place,
        "name": "Prezes",
        "start_date": start,
    }


# ---------------------------------------------------------------------------
# The date a change dates from


def test_a_new_employment_dates_from_its_start():
    site = snapshot(stored_person("p1", "Jan Kowalski", "https://rejestr.io/osoby/1"))
    payload = asdict(
        person(
            "Jan Kowalski",
            "https://rejestr.io/osoby/1",
            Company(krs=PUBLIC, role="Prezes", start="2026-09-15"),
        )
    )

    assert site.dated_changes(payload) == [(NEW_EMPLOYMENT, "2026-09-15")]
    assert site.changes(payload) == [NEW_EMPLOYMENT]


def test_the_end_of_a_stored_job_dates_from_the_day_it_ended():
    site = snapshot(
        stored_person("p1", "Jan Kowalski", "https://rejestr.io/osoby/1"),
        edges=(employed("p1", "place-public", "2025-02-13"),),
    )
    payload = asdict(
        person(
            "Jan Kowalski",
            "https://rejestr.io/osoby/1",
            Company(krs=PUBLIC, role="Prezes", start="2025-02-13", end="2026-08-25"),
        )
    )

    assert site.dated_changes(payload) == [(ENDED_EMPLOYMENT, "2026-08-25")]


def test_a_company_the_site_lacks_dates_from_the_post_too():
    site = snapshot(stored_person("p1", "Jan Kowalski", "https://rejestr.io/osoby/1"))
    payload = asdict(
        person(
            "Jan Kowalski",
            "https://rejestr.io/osoby/1",
            Company(krs="0000099999", role="Członek", start="2025-03-01"),
        )
    )

    assert site.dated_changes(payload) == [(MISSING_COMPANY, "2025-03-01")]


def test_a_candidacy_dates_from_its_year_and_a_field_from_nothing():
    site = snapshot(stored_person("p1", "Jan Kowalski", "https://rejestr.io/osoby/1"))
    candidacy = Election(election_type="Samorząd", election_year="2024", teryt="1465")
    payload = asdict(
        person(
            "Jan Kowalski",
            "https://rejestr.io/osoby/1",
            elections=[candidacy],
            birthDate="1970-01-01",
        )
    )

    assert site.dated_changes(payload) == [
        (PERSON_FIELDS, None),
        (NEW_CANDIDACY, "2024-01-01"),
    ]


def test_a_person_the_site_lacks_has_no_date():
    site = snapshot()
    payload = asdict(person("Anna Nowak", "https://rejestr.io/osoby/2"))

    assert site.dated_changes(payload) == [(NEW_PERSON, None)]


def test_day_of_reads_every_shape_a_payload_date_arrives_in():
    assert day_of("2026-09-15") == "2026-09-15"
    assert day_of(date(2026, 9, 15)) == "2026-09-15"
    assert day_of(pd.Timestamp("2026-09-15 13:00")) == "2026-09-15"
    assert day_of(None) is None
    assert day_of(float("nan")) is None
    assert day_of(pd.NaT) is None
