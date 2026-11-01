"""The declarations job's store takes who a candidacy is from the night's list
it is handed, and from ``bip_poi`` only what the search found."""

from __future__ import annotations

from datetime import datetime, timezone

from scrapers.stores import PersonRow
from stores.bip_declarations import PostgresBipDeclarationStore
from stores.tests.test_bip_people_store import FakePg

CHECKED = datetime(2026, 10, 31, tzinfo=timezone.utc)


def person(key: str, priority: int, name: str, page: bool) -> PersonRow:
    first, last = name.split()
    return PersonRow(
        key,
        "146501",
        priority,
        2024,
        first,
        last,
        {"koryta_ids": ["p"] if page else []},
    )


LIST = [
    person("draft", 1, "Jan Kowalski", page=True),
    person("other", 0, "Ewa Lis", page=True),
    person("away", 2, "Ola Mak", page=False),
]


def test_files_are_cut_in_the_list_s_order_and_a_council_s_by_its_names():
    docs = [
        # sha, host, url, bundle, filename, candidacy key, named
        ("a", "h", "u/a", "b", "a.pdf", "away", True),  # no page
        ("b", "h", "u/b", "b", "b.pdf", "draft", True),
        ("c", "h", "u/c", "b", "c.pdf", "other", True),
        ("d", "h", "u/d", "b", "d.pdf", "draft", True),  # names two people
        ("d", "h", "u/d", "b", "d.pdf", "other", True),
        ("e", "h", "u/e", "b", "e.pdf", "gone", True),  # nobody on the list
        ("f", "h", "u/f", "b", "f.pdf", "draft", False),  # names nobody
    ]
    store = PostgresBipDeclarationStore(FakePg({"bip_poi_docs": docs}), LIST)  # type: ignore[arg-type]

    files = store.files_to_cut(1, None)

    assert [(f.sha256, f.council) for f in files] == [
        ("c", False),
        ("d", True),
        ("b", False),
        ("f", True),
        ("a", False),
    ]
    assert [f.sha256 for f in store.files_to_cut(1, 2)] == ["c", "d"]


def test_candidacies_are_the_list_with_the_search_s_outcomes():
    pg = FakePg(
        {
            "FROM bip_poi": [
                ("draft", "found", "named", 2, CHECKED),
                ("gone", "found", "named", 1, CHECKED),
            ]
        }
    )
    store = PostgresBipDeclarationStore(pg, LIST)  # type: ignore[arg-type]

    rows = store.candidacies()

    assert [(r.key, r.priority, r.status, r.docs) for r in rows] == [
        ("away", 2, "pending", 0),
        ("draft", 1, "found", 2),
        ("other", 0, "pending", 0),
    ]
    assert not any("CREATE TABLE IF NOT EXISTS bip_poi " in s for s in pg.executed)
