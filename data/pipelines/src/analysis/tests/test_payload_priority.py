"""Who a capped people upload sends first: new hires, the people bought from
rejestr.io, the pages somebody left a note on, published pages, the rest."""

import sys
from dataclasses import asdict
from datetime import date
from unittest.mock import patch

import pandas as pd

from analysis.payloads.person import PeoplePayloads
from analysis.payloads.priority import (
    BOUGHT,
    NEW_HIRE,
    NOTED,
    NOTED_MISSING,
    ON_SITE,
    PUBLISHED,
    newest_public_start,
    prioritised,
    register_id,
)
from analysis.payloads.site import UNRESOLVED_REGION, SiteSnapshot
from entities.composite import Company, Election, Person
from entities.person import PageNote
from scrapers.koryta.download import KorytaNotes

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
        bought=set(),
        noted={},
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
        bought=set(),
        noted={},
        today=TODAY,
        recent_days=30,
    )

    assert picks == []


# ---------------------------------------------------------------------------
# The people bought from rejestr.io


def test_a_page_bought_for_goes_after_the_new_hires_and_before_the_published():
    site = snapshot(
        stored_person("pub", "Jan Kowalski", "https://rejestr.io/osoby/1"),
        stored_person("pub-bought", "Ewa Lis", "https://rejestr.io/osoby/3"),
        stored_person("draft-bought", "Olga Wilk", "https://rejestr.io/osoby/4"),
        stored_person("draft", "Piotr Sowa", "https://rejestr.io/osoby/5"),
    )
    hire = person(
        "Anna Nowak",
        "https://rejestr.io/osoby/2",
        Company(krs=PUBLIC, start="2026-09-10"),
    )
    published = person(
        "Jan Kowalski",
        "https://rejestr.io/osoby/1",
        Company(krs=PUBLIC, start="2026-09-01"),
    )
    published_bought = person(
        "Ewa Lis",
        "https://rejestr.io/osoby/3",
        Company(krs=PRIVATE, start="2019-05-01"),
    )
    draft_bought = person(
        "Olga Wilk",
        "https://rejestr.io/osoby/4",
        Company(krs=PRIVATE, start="2026-08-01"),
    )
    draft = person(
        "Piotr Sowa",
        "https://rejestr.io/osoby/5",
        Company(krs=PRIVATE, start="2026-09-20"),
    )

    picks = prioritised(
        [hire],
        [draft, published, published_bought, draft_bought],
        site,
        public_krs={PUBLIC},
        published_ids={"pub", "pub-bought"},
        # A new hire bought as well is still a new hire.
        bought={"2", "3", "4"},
        noted={},
        today=TODAY,
        recent_days=30,
    )

    # Published or not, newest news first, and ahead of anything newer in
    # the tiers after.
    assert [(p.person.name, p.tier, p.since) for p in picks] == [
        ("Anna Nowak", NEW_HIRE, "2026-09-10"),
        ("Olga Wilk", BOUGHT, "2026-08-01"),
        ("Ewa Lis", BOUGHT, "2019-05-01"),
        ("Jan Kowalski", PUBLISHED, "2026-09-01"),
        ("Piotr Sowa", ON_SITE, "2026-09-20"),
    ]


def test_somebody_bought_goes_only_onto_a_page_the_payload_would_change():
    site = snapshot(
        stored_person("p1", "Jan Kowalski", "https://rejestr.io/osoby/1"),
        edges=(employed("p1", "place-public", "2020-01-01"),),
    )
    unchanged = person(
        "Jan Kowalski",
        "https://rejestr.io/osoby/1",
        Company(krs=PUBLIC, role="Prezes", start="2020-01-01"),
    )
    # The feeds are bought by name, so one bought for somebody without a page
    # may be a namesake's: nobody but a new hire gets a page.
    namesake = person(
        "Jan Kowalski",
        "https://rejestr.io/osoby/7",
        Company(krs=PRIVATE, start="2026-09-30"),
    )

    picks = prioritised(
        [namesake],
        [unchanged],
        site,
        public_krs={PUBLIC},
        published_ids={"p1"},
        bought={"1", "7"},
        noted={},
        today=TODAY,
        recent_days=30,
    )

    assert picks == []


# ---------------------------------------------------------------------------
# The pages somebody left a note on


def test_a_noted_page_goes_after_the_bought_and_data_noted_missing_first():
    site = snapshot(
        stored_person("pub", "Jan Kowalski", "https://rejestr.io/osoby/1"),
        stored_person("bought", "Ewa Lis", "https://rejestr.io/osoby/3"),
        stored_person("missing", "Olga Wilk", "https://rejestr.io/osoby/4"),
        stored_person("asked", "Piotr Sowa", "https://rejestr.io/osoby/5"),
        stored_person("both", "Adam Kos", "https://rejestr.io/osoby/6"),
    )
    published = person(
        "Jan Kowalski",
        "https://rejestr.io/osoby/1",
        Company(krs=PUBLIC, start="2026-09-01"),
    )
    bought = person(
        "Ewa Lis",
        "https://rejestr.io/osoby/3",
        Company(krs=PRIVATE, start="2019-05-01"),
    )
    missing = person(
        "Olga Wilk",
        "https://rejestr.io/osoby/4",
        elections=[
            Election(election_type="Samorząd", election_year="2024", teryt="1465")
        ],
    )
    asked = person(
        "Piotr Sowa",
        "https://rejestr.io/osoby/5",
        Company(krs=PRIVATE, start="2026-09-20"),
    )
    both = person("Adam Kos", "https://rejestr.io/osoby/6", parties=["PSL"])

    picks = prioritised(
        [],
        [published, asked, both, missing, bought],
        site,
        public_krs={PUBLIC},
        published_ids={"pub", "missing"},
        bought={"3"},
        noted={
            "missing": frozenset({"missing"}),
            "asked": frozenset({"change_request"}),
            "both": frozenset({"change_request", "missing"}),
            # Bought as well: the tier before.
            "bought": frozenset({"missing"}),
        },
        today=TODAY,
        recent_days=30,
    )

    # Published or not, and ahead of anything newer in the tiers after.
    assert [(p.person.name, p.tier, p.since) for p in picks] == [
        ("Ewa Lis", BOUGHT, "2019-05-01"),
        ("Olga Wilk", NOTED_MISSING, "2024-01-01"),
        ("Adam Kos", NOTED_MISSING, None),
        ("Piotr Sowa", NOTED, "2026-09-20"),
        ("Jan Kowalski", PUBLISHED, "2026-09-01"),
    ]


def test_a_note_on_a_company_counts_for_the_pages_whose_payload_names_it():
    site = snapshot(
        stored_person("p1", "Jan Kowalski", "https://rejestr.io/osoby/1"),
        stored_person("p2", "Ewa Lis", "https://rejestr.io/osoby/3"),
        stored_person("p3", "Olga Wilk", "https://rejestr.io/osoby/4"),
    )
    at_the_company = person(
        "Jan Kowalski",
        "https://rejestr.io/osoby/1",
        Company(krs=PUBLIC, start="2019-01-01"),
    )
    elsewhere = person(
        "Ewa Lis",
        "https://rejestr.io/osoby/3",
        Company(krs=PRIVATE, start="2026-09-01"),
    )
    # A company the site has no page for has no note either.
    at_a_new_company = person(
        "Olga Wilk",
        "https://rejestr.io/osoby/4",
        Company(krs="0000000099", start="2026-09-02"),
    )

    picks = prioritised(
        [],
        [elsewhere, at_a_new_company, at_the_company],
        site,
        public_krs={PUBLIC},
        published_ids=set(),
        bought=set(),
        noted={"place-public": frozenset({"missing"})},
        today=TODAY,
        recent_days=30,
    )

    assert [(p.person.name, p.tier) for p in picks] == [
        ("Jan Kowalski", NOTED_MISSING),
        ("Olga Wilk", ON_SITE),
        ("Ewa Lis", ON_SITE),
    ]


def test_a_noted_page_the_payload_would_not_change_is_left_out():
    site = snapshot(
        stored_person("p1", "Jan Kowalski", "https://rejestr.io/osoby/1"),
        edges=(employed("p1", "place-public", "2020-01-01"),),
    )
    unchanged = person(
        "Jan Kowalski",
        "https://rejestr.io/osoby/1",
        Company(krs=PUBLIC, role="Prezes", start="2020-01-01"),
    )

    picks = prioritised(
        [],
        [unchanged],
        site,
        public_krs={PUBLIC},
        published_ids=set(),
        bought=set(),
        noted={"p1": frozenset({"missing"}), "place-public": frozenset({"missing"})},
        today=TODAY,
        recent_days=30,
    )

    assert picks == []


def test_the_open_notes_are_read_by_page_off_the_export_s_output(tmp_path):
    """What `noted_pages` reads is `KorytaNotes`' output, read back off disk
    with its dtypes: a page id of digits keeps its zeros, and an entry an admin
    has closed - or a source nobody asked anything of - is no note at all."""
    entries = [
        PageNote("p1", "missing", "", True),
        PageNote("p1", "source", "", False),
        PageNote("p2", "change_request", "", True),
        PageNote("p2", "missing", "resolved", False),
        PageNote("p3", "source", "unresolved", True),
        PageNote("p4", "missing", "resolved", False),
        PageNote("0042", "missing", "", True),
    ]
    path = tmp_path / "koryta_notes.jsonl"
    pd.DataFrame.from_records([asdict(e) for e in entries]).to_json(
        path, orient="records", lines=True
    )
    read = pd.read_json(path, lines=True, dtype=KorytaNotes.dtype)

    with patch.object(sys, "argv", ["koryta", "PeoplePayloads", "--all"]):
        with patch.object(KorytaNotes, "read_or_process", return_value=read):
            noted = PeoplePayloads().noted_pages(None)

    assert noted == {
        "p1": {"missing"},
        "p2": {"change_request"},
        "p3": {"source"},
        "0042": {"missing"},
    }


def test_no_notes_read_back_is_no_note_on_any_page():
    # An empty output reads back off disk as a frame without columns.
    with patch.object(sys, "argv", ["koryta", "PeoplePayloads", "--all"]):
        with patch.object(KorytaNotes, "read_or_process", return_value=pd.DataFrame()):
            assert PeoplePayloads().noted_pages(None) == {}


def test_a_payload_is_filed_under_the_id_its_register_link_ends_in():
    assert register_id(person("Jan", "https://rejestr.io/osoby/2479295")) == "2479295"
    assert register_id(person("Jan", "https://rejestr.io/osoby/2479295/")) == (
        "2479295"
    )
    assert register_id(person("Jan", None)) is None  # type: ignore[arg-type]
