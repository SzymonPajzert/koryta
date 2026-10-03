"""Who a capped people upload sends first: new hires, published pages, the rest."""

from dataclasses import asdict
from datetime import date

import pandas as pd

from analysis.payloads.priority import (
    NEW_HIRE,
    ON_SITE,
    PUBLISHED,
    newest_public_start,
    prioritised,
)
from analysis.payloads.site import UNRESOLVED_REGION, SiteSnapshot
from entities.composite import Company, Election, Person

TODAY = date(2026, 10, 4)
PUBLIC = "0000000001"
PRIVATE = "0000000002"
OTHER_PUBLIC = "0000000003"


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
# A new hire


def test_a_new_hire_holds_a_current_public_post_begun_recently():
    hire = person(
        "Anna Nowak",
        "https://rejestr.io/osoby/2",
        Company(krs=PUBLIC, start="2026-09-20"),
        Company(krs=PUBLIC, start="2026-09-25", end="2026-10-01"),  # ended
        Company(krs=PRIVATE, start="2026-10-01"),  # not public
        Company(krs=OTHER_PUBLIC, start="2026-01-01"),  # too long ago
    )

    assert newest_public_start(hire, {PUBLIC, OTHER_PUBLIC}, "2026-09-04") == (
        "2026-09-20"
    )
    # Public is whatever the register says it is, nothing in the payload.
    assert newest_public_start(hire, {PRIVATE}, "2026-09-04") == "2026-10-01"
    assert newest_public_start(hire, {"0000000099"}, "2026-09-04") is None


# ---------------------------------------------------------------------------
# The order


def test_new_hires_then_published_then_the_rest_each_newest_first():
    site = snapshot(
        stored_person("pub", "Jan Kowalski", "https://rejestr.io/osoby/1"),
        stored_person("draft-old", "Ewa Lis", "https://rejestr.io/osoby/3"),
        stored_person("draft-new", "Olga Wilk", "https://rejestr.io/osoby/4"),
        stored_person("draft-none", "Piotr Sowa", "https://rejestr.io/osoby/5"),
    )
    older_hire = person(
        "Anna Nowak",
        "https://rejestr.io/osoby/2",
        Company(krs=PUBLIC, start="2026-09-10"),
    )
    newer_hire = person(
        "Beata Kos",
        "https://rejestr.io/osoby/6",
        Company(krs=PUBLIC, start="2026-09-30"),
    )
    published = person(
        "Jan Kowalski",
        "https://rejestr.io/osoby/1",
        Company(krs=PUBLIC, start="2020-01-01"),
    )
    old_change = person(
        "Ewa Lis",
        "https://rejestr.io/osoby/3",
        Company(krs=PRIVATE, start="2019-05-01"),
    )
    new_change = person(
        "Olga Wilk",
        "https://rejestr.io/osoby/4",
        Company(krs=PRIVATE, start="2026-08-01"),
    )
    undated_change = person("Piotr Sowa", "https://rejestr.io/osoby/5", parties=["PSL"])

    picks = prioritised(
        [older_hire, newer_hire],
        [undated_change, old_change, published, new_change],
        site,
        public_krs={PUBLIC},
        published_ids={"pub"},
        today=TODAY,
        recent_days=30,
    )

    assert [(p.person.name, p.tier, p.since) for p in picks] == [
        ("Beata Kos", NEW_HIRE, "2026-09-30"),
        ("Anna Nowak", NEW_HIRE, "2026-09-10"),
        ("Jan Kowalski", PUBLISHED, "2020-01-01"),
        ("Olga Wilk", ON_SITE, "2026-08-01"),
        ("Ewa Lis", ON_SITE, "2019-05-01"),
        ("Piotr Sowa", ON_SITE, None),
    ]


def test_people_without_a_recent_public_post_or_a_change_are_left_out():
    stored = stored_person("p1", "Jan Kowalski", "https://rejestr.io/osoby/1")
    site = snapshot(
        stored,
        {
            "id": "p2",
            "type": "person",
            "name": "Ewa Lis",
            "rejestrIo": "https://rejestr.io/osoby/3",
        },
        edges=(employed("p1", "place-public", "2020-01-01"),),
    )
    old_hire = person(
        "Anna Nowak",
        "https://rejestr.io/osoby/2",
        Company(krs=PUBLIC, start="2025-01-01"),
    )
    unchanged = person(
        "Jan Kowalski",
        "https://rejestr.io/osoby/1",
        Company(krs=PUBLIC, role="Prezes", start="2020-01-01"),
    )
    # A candidacy the site cannot place is reported, not written.
    unplaceable = person(
        "Ewa Lis",
        "https://rejestr.io/osoby/3",
        elections=[
            Election(election_type="Samorząd", election_year="2024", teryt="9999")
        ],
    )
    assert site.changes(asdict(unplaceable)) == [UNRESOLVED_REGION]

    picks = prioritised(
        [old_hire],
        [unchanged, unplaceable],
        site,
        public_krs={PUBLIC},
        published_ids=set(),
        today=TODAY,
        recent_days=30,
    )

    assert picks == []
