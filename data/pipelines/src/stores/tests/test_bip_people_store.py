"""``bip_poi`` keeps only what the people mode's search found."""

from __future__ import annotations

import contextlib
from collections.abc import Iterator
from datetime import datetime, timezone

import pytest

from scrapers.stores import PersonDocRow
from stores.bip_people import MemoryBipPeopleStore, PostgresBipPeopleStore


class FakePg:
    """Answers each query by a word in it; keeps every statement run."""

    def __init__(self, answers: dict[str, list[tuple]]) -> None:
        self.answers = answers
        self.executed: list[str] = []

    def execute(self, sql: str, params: tuple = ()) -> None:
        self.executed.append(" ".join(sql.split()))

    def fetchall(self, sql: str, params: tuple = ()) -> list[tuple]:
        for word, rows in self.answers.items():
            if word in sql:
                return rows
        return []


def test_a_bip_poi_from_before_takes_new_rows_without_the_list_s_fields():
    old = FakePg({"information_schema.columns": [(1,)]})
    PostgresBipPeopleStore(old)  # type: ignore[arg-type]
    new = FakePg({})
    PostgresBipPeopleStore(new)  # type: ignore[arg-type]

    alter = "ALTER TABLE bip_poi ALTER COLUMN unit SET DEFAULT ''"
    assert alter in old.executed and alter not in new.executed


class Column:
    def __init__(self, name: str) -> None:
        self.name = name


class FakeTables(FakePg):
    """Also a transaction's cursor, over tables whose rows start with the
    candidacy key; logs every statement the cursor runs, in order."""

    def __init__(self, tables: dict[str, tuple[list[str], list[tuple]]]) -> None:
        super().__init__({})
        self.tables = tables
        self.log: list[str] = []
        self.description: list[Column] = []
        self.rowcount = 0
        self._found: list[tuple] = []

    @contextlib.contextmanager
    def transaction(self) -> Iterator[FakeTables]:
        yield self

    def execute(self, sql: str, params: tuple = ()) -> None:
        sql = " ".join(sql.split())
        words = sql.split()
        if sql.startswith("SELECT * FROM"):
            self.log.append(sql)
            columns, rows = self.tables[words[3]]
            self.description = [Column(c) for c in columns]
            self._found = [r for r in rows if r[0] in params[0]]
        elif sql.startswith("DELETE FROM"):
            self.log.append(sql)
            columns, rows = self.tables[words[2]]
            kept = [r for r in rows if r[0] not in params[0]]
            self.rowcount = len(rows) - len(kept)
            self.tables[words[2]] = (columns, kept)
        else:
            self.log.append(sql)
            super().execute(sql, params)

    def fetchall(self, sql: str = "", params: tuple = ()) -> list[tuple]:
        return super().fetchall(sql, params) if sql else self._found


CHECKED = datetime(2026, 11, 6, 3, 12, tzinfo=timezone.utc)


def crawl_tables() -> FakeTables:
    return FakeTables(
        {
            # A bip_poi from before 11-01 keeps the list's fields too.
            "bip_poi": (
                ["key", "status", "reason", "docs", "checked_at", "unit"],
                [
                    ("a", "found", "named", 1, CHECKED, "146501"),
                    ("b", "found", "named", 2, CHECKED, "146501"),
                ],
            ),
            "bip_poi_docs": (
                ["key", "url", "status", "anchor"],
                [
                    ("a", "https://bip.x.pl/statut.pdf", "ok", "Statut"),
                    ("b", "https://bip.x.pl/b.pdf", "ok", "za 2024"),
                ],
            ),
        }
    )


def test_a_reset_hands_over_every_row_it_deletes_before_it_deletes_one():
    pg = crawl_tables()
    store = PostgresBipPeopleStore(pg)  # type: ignore[arg-type]
    kept: list[dict] = []

    def keep(rows: dict) -> None:
        assert not any(s.startswith("DELETE") for s in pg.log)
        kept.append(rows)

    assert store.reset(["a", "gone"], keep) == {"bip_poi": 1, "bip_poi_docs": 1}
    (rows,) = kept
    assert rows["bip_poi"] == [
        {
            "key": "a",
            "status": "found",
            "reason": "named",
            "docs": 1,
            "checked_at": CHECKED,
            "unit": "146501",
        }
    ]
    assert [r["url"] for r in rows["bip_poi_docs"]] == ["https://bip.x.pl/statut.pdf"]
    assert [r[0] for r in pg.tables["bip_poi"][1]] == ["b"]
    assert [r[0] for r in pg.tables["bip_poi_docs"][1]] == ["b"]
    selects = [s for s in pg.log if s.startswith("SELECT * FROM")]
    assert len(selects) == 2 and all(s.endswith("FOR UPDATE") for s in selects)


def test_a_reset_whose_backup_fails_deletes_nothing():
    pg = crawl_tables()
    store = PostgresBipPeopleStore(pg)  # type: ignore[arg-type]

    def keep(rows: dict) -> None:
        raise OSError("disk full")

    with pytest.raises(OSError):
        store.reset(["a"], keep)
    assert not any(s.startswith("DELETE") for s in pg.log)
    assert len(pg.tables["bip_poi"][1]) == 2


def test_the_rows_a_reset_would_delete_are_read_without_a_lock():
    pg = crawl_tables()
    rows = PostgresBipPeopleStore(pg).reset_rows(["b"])  # type: ignore[arg-type]

    assert [r["key"] for r in rows["bip_poi"]] == ["b"]
    assert [r["url"] for r in rows["bip_poi_docs"]] == ["https://bip.x.pl/b.pdf"]
    assert "SET TRANSACTION READ ONLY" in pg.log
    assert not any("FOR UPDATE" in s or s.startswith("DELETE") for s in pg.log)


def test_a_reset_in_memory_makes_the_candidacy_pending_again():
    store = MemoryBipPeopleStore()
    store.record_person("a", "found", "named", 1, "r")
    store.record_person("b", "found", "named", 1, "r")
    store.record_person_docs(
        [PersonDocRow("a", "u/a", "ok"), PersonDocRow("b", "u/b", "ok")], "r"
    )
    seen: list[dict] = []

    def keep(rows: dict) -> None:
        assert "a" in store.searched()  # nothing deleted yet
        seen.append(rows)

    assert store.reset(["a"], keep) == {"bip_poi": 1, "bip_poi_docs": 1}
    assert [r["key"] for r in seen[0]["bip_poi"]] == ["a"]
    assert [r["url"] for r in seen[0]["bip_poi_docs"]] == ["u/a"]
    assert set(store.searched()) == {"b"}
    assert store.person_docs("a") == [] and len(store.person_docs("b")) == 1
