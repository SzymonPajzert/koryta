"""Who a capped people upload sends first: new hires, the people bought from
rejestr.io, the pages somebody left a note on, the people the site lacks in a
public post that is not new, published pages, the rest."""

import sys
from dataclasses import asdict
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd

from analysis.payloads.person import (
    PeoplePayloads,
    matching_one_page,
    missing_from_koryta,
)
from analysis.payloads.priority import (
    BOUGHT,
    NEW_HIRE,
    NOTED,
    NOTED_MISSING,
    ODPIS_ONLY_CURRENT,
    ON_SITE,
    PUBLISHED,
    REJESTRIO_CURRENT,
    current_public_seats,
    newest_public_start,
    prioritised,
    register_id,
)
from analysis.payloads.site import UNRESOLVED_REGION, SiteSnapshot
from entities.composite import Company, Election, Person
from entities.person import PageNote
from entities.priority_groups import parse_group
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


def test_people_without_a_current_public_post_or_a_change_are_left_out():
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
    # Public no longer, however recent the private post.
    old_hire = person(
        "Anna Nowak",
        "https://rejestr.io/osoby/2",
        Company(krs=PUBLIC, start="2025-01-01", end="2025-12-31"),
        Company(krs=PRIVATE, start="2026-09-20"),
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
    # may be a namesake's: nobody with an entry but a new hire gets a page.
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


def test_each_pick_says_whether_its_page_is_published_whatever_the_tier():
    """A run caps the changes to published pages across the tiers
    (`--max-published` in `jobs.people_import`), so a bought or a noted page
    says it is published as a page of the published tier does."""
    site = snapshot(
        stored_person("pub", "Jan Kowalski", "https://rejestr.io/osoby/1"),
        stored_person("pub-bought", "Ewa Lis", "https://rejestr.io/osoby/3"),
        stored_person("draft-bought", "Olga Wilk", "https://rejestr.io/osoby/4"),
        stored_person("pub-noted", "Piotr Sowa", "https://rejestr.io/osoby/5"),
        stored_person("draft-noted", "Adam Kos", "https://rejestr.io/osoby/6"),
        stored_person("draft", "Celina Lis", "https://rejestr.io/osoby/7"),
    )

    def changed(name: str, register: str, start: str) -> Person:
        return person(name, register, Company(krs=PRIVATE, start=start))

    hire = person(
        "Anna Nowak",
        "https://rejestr.io/osoby/2",
        Company(krs=PUBLIC, start="2026-09-10"),
    )
    picks = prioritised(
        [hire],
        [
            changed("Jan Kowalski", "https://rejestr.io/osoby/1", "2026-09-01"),
            changed("Ewa Lis", "https://rejestr.io/osoby/3", "2026-08-02"),
            changed("Olga Wilk", "https://rejestr.io/osoby/4", "2026-08-01"),
            changed("Piotr Sowa", "https://rejestr.io/osoby/5", "2026-07-02"),
            changed("Adam Kos", "https://rejestr.io/osoby/6", "2026-07-01"),
            changed("Celina Lis", "https://rejestr.io/osoby/7", "2026-06-01"),
        ],
        site,
        public_krs={PUBLIC},
        published_ids={"pub", "pub-bought", "pub-noted"},
        bought={"3", "4"},
        noted={
            "pub-noted": frozenset({"change_request"}),
            "draft-noted": frozenset({"change_request"}),
        },
        today=TODAY,
        recent_days=30,
    )

    assert [(p.person.name, p.tier, p.published) for p in picks] == [
        ("Anna Nowak", NEW_HIRE, False),
        ("Ewa Lis", BOUGHT, True),
        ("Olga Wilk", BOUGHT, False),
        ("Piotr Sowa", NOTED, True),
        ("Adam Kos", NOTED, False),
        ("Jan Kowalski", PUBLISHED, True),
        ("Celina Lis", ON_SITE, False),
    ]


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


# ---------------------------------------------------------------------------
# The people only an odpis names in a public post that is not new


def odpis_only(name: str, *companies: Company) -> Person:
    """Somebody with no rejestr.io entry: the ingest finds them by their name
    and birth date alone."""
    return person(name, None, *companies, birthDate="1971-03-14")  # type: ignore[arg-type]


def test_somebody_only_an_odpis_names_in_an_older_public_post_goes_after_the_noted():
    site = snapshot(
        stored_person("pub", "Jan Kowalski", "https://rejestr.io/osoby/1"),
        stored_person("asked", "Piotr Sowa", "https://rejestr.io/osoby/5"),
    )
    # Hired lately: a new hire, whatever else they hold.
    hire = odpis_only(
        "Anna Nowak",
        Company(krs=PUBLIC, start="2026-09-20"),
        Company(krs=OTHER_PUBLIC, start="2015-01-01"),
    )
    seated = odpis_only(
        "Beata Kos",
        Company(krs=PUBLIC, start="2019-03-01"),
        Company(krs=OTHER_PUBLIC, start="2023-05-01"),
        Company(krs=PUBLIC, start="2025-01-01", end="2025-06-01"),
    )
    # With a rejestr.io entry: the tier after theirs.
    linked = person(
        "Celina Lis",
        "https://rejestr.io/osoby/7",
        Company(krs=PUBLIC, start="2020-01-01"),
    )
    ended = odpis_only(
        "Dorota Wilk", Company(krs=PUBLIC, start="2020-01-01", end="2024-01-01")
    )
    private = odpis_only("Ewa Mazur", Company(krs=PRIVATE, start="2020-01-01"))
    asked = person(
        "Piotr Sowa",
        "https://rejestr.io/osoby/5",
        Company(krs=PRIVATE, start="2026-09-20"),
    )
    published = person(
        "Jan Kowalski",
        "https://rejestr.io/osoby/1",
        Company(krs=PUBLIC, start="2026-09-01"),
    )

    picks = prioritised(
        [private, ended, linked, seated, hire],
        [published, asked],
        site,
        public_krs={PUBLIC, OTHER_PUBLIC},
        published_ids={"pub"},
        bought=set(),
        noted={"asked": frozenset({"change_request"})},
        today=TODAY,
        recent_days=30,
    )

    # Ahead of the published pages, newer as theirs may be.
    assert [(p.person.name, p.tier, p.since) for p in picks] == [
        ("Anna Nowak", NEW_HIRE, "2026-09-20"),
        ("Piotr Sowa", NOTED, "2026-09-20"),
        ("Beata Kos", ODPIS_ONLY_CURRENT, "2023-05-01"),
        ("Celina Lis", REJESTRIO_CURRENT, "2020-01-01"),
        ("Jan Kowalski", PUBLISHED, "2026-09-01"),
    ]
    assert current_public_seats(seated, {PUBLIC, OTHER_PUBLIC}) == [
        "2019-03-01",
        "2023-05-01",
    ]


def test_the_newest_post_first_and_on_one_day_a_company_the_site_has_first():
    """Most ties are a board appointed at once: 499 of the 980 people of
    2026-10-11 shared their day with another."""
    fourth = "0000000004"
    site = snapshot()  # A page for PUBLIC; none for OTHER_PUBLIC or the fourth.
    newer = odpis_only("Karol Nowy", Company(krs=PUBLIC, start="2025-02-01"))
    at_a_page = odpis_only("Zofia Zając", Company(krs=PUBLIC, start="2024-05-01"))
    board = [
        odpis_only("Barbara Lis", Company(krs=OTHER_PUBLIC, start="2024-05-01")),
        odpis_only("Adam Bąk", Company(krs=OTHER_PUBLIC, start="2024-05-01")),
    ]
    # Between the two by name; after both by company, so the board stays whole.
    elsewhere = odpis_only("Agata Ryba", Company(krs=fourth, start="2024-05-01"))
    # A start the register does not give goes after every dated one.
    undated = odpis_only("Olga Stara", Company(krs=PUBLIC))

    picks = prioritised(
        [undated, elsewhere, board[0], at_a_page, newer, board[1]],
        [],
        site,
        public_krs={PUBLIC, OTHER_PUBLIC, fourth},
        published_ids=set(),
        bought=set(),
        noted={},
        today=TODAY,
        recent_days=30,
    )

    assert [(p.person.name, p.since) for p in picks] == [
        ("Karol Nowy", "2025-02-01"),
        ("Zofia Zając", "2024-05-01"),
        ("Adam Bąk", "2024-05-01"),
        ("Barbara Lis", "2024-05-01"),
        ("Agata Ryba", "2024-05-01"),
        ("Olga Stara", None),
    ]
    assert {p.tier for p in picks} == {ODPIS_ONLY_CURRENT}


def test_somebody_only_an_odpis_names_in_a_current_seat_keeps_a_new_page_s_guards():
    """The tier is what `missing_from_koryta` keeps, as the new hires are: a
    payload the ingest would hold behind a page of the name with no birth
    date (its 409), and two born the same day under one name, which the
    ingest could put on one page, get none."""
    site = snapshot({"id": "undated", "type": "person", "name": "Jan Nowak"})
    held = odpis_only("Jan Nowak", Company(krs=PUBLIC, start="2020-01-01"))
    twins = [
        odpis_only("Ewa Lis", Company(krs=PUBLIC, start="2019-01-01")),
        odpis_only("Ewa Lis", Company(krs=OTHER_PUBLIC, start="2018-01-01")),
    ]
    kept = odpis_only("Anna Kos", Company(krs=PUBLIC, start="2021-01-01"))
    payloads = [held, *twins, kept]

    picks = prioritised(
        missing_from_koryta(payloads, site),
        matching_one_page(payloads, site),
        site,
        public_krs={PUBLIC, OTHER_PUBLIC},
        published_ids=set(),
        bought=set(),
        noted={},
        today=TODAY,
        recent_days=30,
    )

    assert [(p.person.name, p.tier) for p in picks] == [
        ("Anna Kos", ODPIS_ONLY_CURRENT)
    ]


# ---------------------------------------------------------------------------
# The people with a rejestr.io entry in a public post that is not new


def test_somebody_with_an_entry_in_any_current_public_post_gets_a_page():
    """Szymon, 2026-10-16: everybody employed at a publicly owned company goes
    up - "count employed in any way to not complicate the logic". A
    prokurent, a pełnomocnik, a seat on a hospital's unpaid rada społeczna
    (the register calls every supervisory seat "Rada Nadzorcza") count as a
    board does."""
    site = snapshot()
    seats = [
        person(
            f"Osoba {role}",
            f"https://rejestr.io/osoby/{i}",
            Company(krs=PUBLIC, role=role, start="2021-01-01"),
        )
        for i, role in enumerate(
            ["Zarząd", "Rada Nadzorcza", "Prokurent", "Pełnomocnik"], start=10
        )
    ]
    ended = person(
        "Dorota Wilk",
        "https://rejestr.io/osoby/20",
        Company(krs=PUBLIC, start="2020-01-01", end="2024-01-01"),
    )
    private = person(
        "Ewa Mazur",
        "https://rejestr.io/osoby/21",
        Company(krs=PRIVATE, start="2020-01-01"),
    )

    picks = prioritised(
        [*seats, ended, private],
        [],
        site,
        public_krs={PUBLIC},
        published_ids=set(),
        bought=set(),
        noted={},
        today=TODAY,
        recent_days=30,
    )

    assert sorted((p.person.name, p.tier) for p in picks) == [
        ("Osoba Pełnomocnik", REJESTRIO_CURRENT),
        ("Osoba Prokurent", REJESTRIO_CURRENT),
        ("Osoba Rada Nadzorcza", REJESTRIO_CURRENT),
        ("Osoba Zarząd", REJESTRIO_CURRENT),
    ]


def test_people_with_an_entry_in_a_current_seat_go_as_the_odpis_only_ones_do():
    """Newest post first; on one day a company the site has a page for first,
    then a company's people together, then by name; undated last."""
    fourth = "0000000004"
    site = snapshot()  # A page for PUBLIC; none for OTHER_PUBLIC or the fourth.

    def linked(name: str, number: int, *companies: Company) -> Person:
        return person(name, f"https://rejestr.io/osoby/{number}", *companies)

    newer = linked("Karol Nowy", 1, Company(krs=PUBLIC, start="2025-02-01"))
    at_a_page = linked("Zofia Zając", 2, Company(krs=PUBLIC, start="2024-05-01"))
    board = [
        linked("Barbara Lis", 3, Company(krs=OTHER_PUBLIC, start="2024-05-01")),
        linked("Adam Bąk", 4, Company(krs=OTHER_PUBLIC, start="2024-05-01")),
    ]
    elsewhere = linked("Agata Ryba", 5, Company(krs=fourth, start="2024-05-01"))
    undated = linked("Olga Stara", 6, Company(krs=PUBLIC))

    picks = prioritised(
        [undated, elsewhere, board[0], at_a_page, newer, board[1]],
        [],
        site,
        public_krs={PUBLIC, OTHER_PUBLIC, fourth},
        published_ids=set(),
        bought=set(),
        noted={},
        today=TODAY,
        recent_days=30,
    )

    assert [(p.person.name, p.since) for p in picks] == [
        ("Karol Nowy", "2025-02-01"),
        ("Zofia Zając", "2024-05-01"),
        ("Adam Bąk", "2024-05-01"),
        ("Barbara Lis", "2024-05-01"),
        ("Agata Ryba", "2024-05-01"),
        ("Olga Stara", None),
    ]
    assert {p.tier for p in picks} == {REJESTRIO_CURRENT}


def test_somebody_with_an_entry_in_a_current_seat_keeps_a_new_page_s_guards():
    """The tier is what `missing_from_koryta` keeps: somebody whose entry the
    site has lands on their page and is no new page; of two born the same day
    under one name the one with the entry goes, and the one only an odpis
    names, whom the ingest would put on the page just made, waits."""
    site = snapshot(stored_person("p1", "Jan Kowalski", "https://rejestr.io/osoby/1"))
    on_site = person(
        "Jan Kowalski",
        "https://rejestr.io/osoby/1",
        Company(krs=PUBLIC, start="2020-01-01"),
    )
    born = "1971-03-14"
    linked_twin = person(
        "Ewa Lis",
        "https://rejestr.io/osoby/8",
        Company(krs=PUBLIC, start="2019-01-01"),
        birthDate=born,
    )
    odpis_twin = odpis_only("Ewa Lis", Company(krs=PUBLIC, start="2018-01-01"))
    assert odpis_twin.birthDate == born
    payloads = [on_site, linked_twin, odpis_twin]

    picks = prioritised(
        missing_from_koryta(payloads, site),
        matching_one_page(payloads, site),
        site,
        public_krs={PUBLIC},
        published_ids=set(),
        bought=set(),
        noted={},
        today=TODAY,
        recent_days=30,
    )

    assert [(p.person.name, p.tier) for p in picks] == [
        ("Ewa Lis", REJESTRIO_CURRENT),
        ("Jan Kowalski", ON_SITE),
    ]
    assert picks[0].person.rejestrIo == "https://rejestr.io/osoby/8"


# ---------------------------------------------------------------------------
# Priority groups


def test_each_pick_names_the_groups_whose_companies_the_person_holds_a_post_at():
    """Szymon, 2026-10-27: groups of companies whose people go first, the
    Treasury's to begin with. A member holds a post there now - not one that
    ended - and a group changes no tier, and no order."""
    site = snapshot(
        stored_person("draft", "Ewa Lis", "https://rejestr.io/osoby/3"),
        stored_person("other", "Olga Wilk", "https://rejestr.io/osoby/4"),
    )
    new = [
        person(
            "Anna Nowak",
            "https://rejestr.io/osoby/1",
            Company(krs=PUBLIC, start="2021-01-01"),
        ),
        person(
            "Beata Kos",
            "https://rejestr.io/osoby/2",
            Company(krs=PUBLIC, start="2022-01-01"),
            Company(krs=OTHER_PUBLIC, start="2023-01-01"),
        ),
        person(
            "Dorota Mazur",
            "https://rejestr.io/osoby/5",
            Company(krs=PUBLIC, start="2019-01-01", end="2020-01-01"),
            Company(krs=OTHER_PUBLIC, start="2020-02-01"),
        ),
    ]
    on_site = [
        person(
            "Ewa Lis",
            "https://rejestr.io/osoby/3",
            Company(krs=PUBLIC, start="2020-03-01"),
        ),
        person(
            "Olga Wilk",
            "https://rejestr.io/osoby/4",
            Company(krs=PRIVATE, start="2026-08-01"),
        ),
    ]

    def picks(groups):
        return prioritised(
            new,
            on_site,
            site,
            public_krs={PUBLIC, OTHER_PUBLIC},
            published_ids=set(),
            bought=set(),
            noted={},
            today=TODAY,
            recent_days=30,
            groups=groups,
        )

    grouped = picks({"skarb": {PUBLIC}, "druga": {OTHER_PUBLIC}})

    assert [(p.person.name, p.groups) for p in grouped] == [
        ("Beata Kos", ("skarb", "druga")),
        ("Anna Nowak", ("skarb",)),
        ("Dorota Mazur", ("druga",)),
        ("Olga Wilk", ()),
        ("Ewa Lis", ("skarb",)),
    ]
    assert [(p.person.name, p.tier, p.since) for p in grouped] == [
        (p.person.name, p.tier, p.since) for p in picks(None)
    ]
    assert all(p.groups == () for p in picks(None))


def test_a_group_s_companies_are_its_category_s_public_ones():
    """By the rule the site's filter and `--company-category` read: Skarb
    Państwa off the Treasury's share on Prokuratoria's list, a sector off the
    codes - less a private firm the codes reach too."""
    companies = pd.DataFrame(
        {
            "krs": [PUBLIC, OTHER_PUBLIC, PRIVATE],
            "activity": [["70.10.Z"], ["35.13.Z"], ["35.11.Z"]],
            "form": [None, None, None],
            # Read back from an output, a company off the list holds NaN.
            "treasury_share": ["60.86", float("nan"), "0.5"],
        }
    )
    payloads = PeoplePayloads()
    payloads.people = SimpleNamespace(  # type: ignore[assignment]
        companies=SimpleNamespace(read_or_process=lambda ctx: companies),
        public_companies=lambda ctx: {PUBLIC, OTHER_PUBLIC},
    )

    def found(text: str) -> frozenset[str]:
        return payloads.group_companies(None, parse_group(text))  # type: ignore[arg-type]

    assert found("skarb-panstwa:10") == {PUBLIC}
    assert found("energetyka:10") == {OTHER_PUBLIC}
