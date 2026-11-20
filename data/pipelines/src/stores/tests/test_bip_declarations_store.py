"""The declarations job's store takes who a candidacy is from the night's list
it is handed, and from ``bip_poi`` only what the search found."""

from __future__ import annotations

import contextlib
import json
from collections.abc import Iterator
from datetime import datetime, timezone

from scrapers.stores import (
    DeclarationBandRow,
    DeclarationCropRow,
    DeclarationCutRow,
    DeclarationFile,
    DeclarationLink,
    DeclarationStrip,
    PersonRow,
)
from stores.bip_declarations import (
    MemoryBipDeclarationStore,
    PostgresBipDeclarationStore,
    band_with_hashes,
    png_hash,
)
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


def test_a_store_opened_to_read_creates_nothing():
    """`facts-part` runs beside a crawl chunk or a cut: no DDL there."""
    reading = FakePg({"FROM bip_poi": [("draft", "found", "named", 2, CHECKED)]})
    store = PostgresBipDeclarationStore(reading, LIST, create=False)  # type: ignore[arg-type]

    assert [r.status for r in store.candidacies()] == ["pending", "found", "pending"]
    assert reading.executed == []
    creating = FakePg({})
    PostgresBipDeclarationStore(creating, LIST)  # type: ignore[arg-type]
    assert any(
        "CREATE TABLE IF NOT EXISTS bip_decl_cuts" in sql for sql in creating.executed
    )
    assert any(
        "CREATE TABLE IF NOT EXISTS bip_decl_bands" in sql for sql in creating.executed
    )


# -- the employment cut's bands ----------------------------------------------------

SHA_A, SHA_B = "a" * 64, "b" * 64


def band(sha: str, page: int, name: str, version: int = 1, widen: int = 0):
    return DeclarationBandRow(
        sha,
        page,
        name,
        version,
        widen=widen,
        dpi=300,
        width=2480,
        strips=(
            DeclarationStrip(page, 30, 330, b"\x89PNG one"),
            DeclarationStrip(page + 1, 0, 120, b"\x89PNG two"),
        ),
        lines=((0, 10, 60), (1, 5, 50)),
        ocr_text="Urzad Gminy Testowo",
        score=0.42,
        source="ocr",
    )


def test_bands_are_cut_in_the_list_s_order_once_a_version():
    files = [
        DeclarationFile(SHA_A, "h", "u/a", "b", "a.pdf"),
        DeclarationFile(SHA_B, "h", "u/b", "b", "b.pdf"),
    ]
    links = [
        DeclarationLink("away", SHA_A, "u/a"),  # no page: after the others
        DeclarationLink("draft", SHA_B, "u/b"),
    ]
    store = MemoryBipDeclarationStore(LIST, files, links)
    store.record_cut(DeclarationCutRow(SHA_A, 1, "cut"), [DeclarationCropRow(SHA_A, 0)])
    store.record_cut(
        DeclarationCutRow(SHA_B, 1, "cut"),
        [DeclarationCropRow(SHA_B, 0), DeclarationCropRow(SHA_B, 4, rotation=180)],
    )

    due = store.pages_to_band(1, None)

    assert [(d.file.sha256, d.pages) for d in due] == [
        (SHA_B, ((0, 0), (4, 180))),
        (SHA_A, ((0, 0),)),
    ]
    assert [d.file.sha256 for d in store.pages_to_band(1, 1)] == [SHA_B]
    store.record_bands(SHA_B, 0, 1, [band(SHA_B, 0, "employer")])
    assert [d.pages for d in store.pages_to_band(1, None)][0] == ((4, 180),)
    # Asked for again, a page with bands is due; only the pages named.
    again = store.pages_to_band(1, None, items={f"{SHA_B}-p0"}, again={f"{SHA_B}-p0"})
    assert [(d.file.sha256, d.pages) for d in again] == [(SHA_B, ((0, 0),))]
    assert len(store.pages_to_band(2, None)) == 2


def test_a_page_cut_again_replaces_its_bands_of_that_version_only():
    store = MemoryBipDeclarationStore()
    store.record_bands(SHA_A, 0, 1, [band(SHA_A, 0, "employer"), band(SHA_A, 0, "vii")])
    store.record_bands(SHA_A, 0, 2, [band(SHA_A, 0, "employer", 2)])

    store.record_bands(SHA_A, 0, 1, [band(SHA_A, 0, "employer", widen=1)])

    [row] = store.bands(1, with_images=True)
    assert (row.band, row.widen, row.item) == ("employer", 1, f"{SHA_A}-p0")
    assert [s.png for s in row.strips] == [b"\x89PNG one", b"\x89PNG two"]
    assert row.strips[0].png_hash == png_hash(b"\x89PNG one")
    [light] = store.bands(1)
    assert [s.png for s in light.strips] == [b"", b""]
    assert light.strips[1].png_hash == png_hash(b"\x89PNG two")
    assert len(store.bands(2)) == 1


class Cursor(FakePg):
    """A transaction's cursor too: every statement with what it was given."""

    def __init__(self, answers: dict[str, list[tuple]]) -> None:
        super().__init__(answers)
        self.given: list[tuple[str, tuple]] = []

    @contextlib.contextmanager
    def transaction(self) -> Iterator[Cursor]:
        yield self

    def execute(self, sql: str, params: tuple = ()) -> None:
        super().execute(sql, params)
        self.given.append((" ".join(sql.split()), params))


def test_postgres_keeps_a_bands_strips_lines_and_pictures():
    pg = Cursor({})
    store = PostgresBipDeclarationStore(pg, LIST, create=False)  # type: ignore[arg-type]

    store.record_bands(SHA_A, 0, 1, [band(SHA_A, 0, "viii")])

    (delete, deleted), (insert, values) = pg.given
    assert delete.startswith("DELETE FROM bip_decl_bands") and deleted == (SHA_A, 0, 1)
    assert insert.startswith("INSERT INTO bip_decl_bands")
    assert values[:4] == (SHA_A, 0, "viii", 1)
    assert json.loads(values[8]) == [
        {"page": 0, "top": 30, "bottom": 330, "hash": png_hash(b"\x89PNG one")},
        {"page": 1, "top": 0, "bottom": 120, "hash": png_hash(b"\x89PNG two")},
    ]
    assert json.loads(values[9]) == [[0, 10, 60], [1, 5, 50]]
    assert values[-1] == [b"\x89PNG one", b"\x89PNG two"]

    # Read back as Postgres gives it: jsonb as Python, the pictures last.
    stored = (*values[:8], json.loads(values[8]), json.loads(values[9]), *values[10:-1])
    reading = PostgresBipDeclarationStore(
        FakePg({"FROM bip_decl_bands": [(*stored, values[-1])]}),  # type: ignore[arg-type]
        LIST,
        create=False,
    )
    [row] = reading.bands(1, with_images=True)
    assert row == band_with_hashes(band(SHA_A, 0, "viii"))


def test_postgres_cuts_the_bands_of_date_pages_without_them():
    crops = [
        # sha, host, url, bundle, filename, candidacy key, named, page, rotation
        (SHA_A, "h", "u/a", "b", "a.pdf", "away", True, 0, 0),
        (SHA_B, "h", "u/b", "b", "b.pdf", "draft", True, 0, 0),
        (SHA_B, "h", "u/b", "b", "b.pdf", "draft", True, 4, 90),
    ]
    pg = FakePg({"c.rotation": crops, "DISTINCT sha256, page": [(SHA_B, 0)]})
    store = PostgresBipDeclarationStore(pg, LIST, create=False)  # type: ignore[arg-type]

    due = store.pages_to_band(1, None)

    assert [(d.file.sha256, d.pages) for d in due] == [
        (SHA_B, ((4, 90),)),
        (SHA_A, ((0, 0),)),
    ]
    assert [d.file.sha256 for d in store.pages_to_band(1, None, {f"{SHA_A}-p0"})] == [
        SHA_A
    ]
