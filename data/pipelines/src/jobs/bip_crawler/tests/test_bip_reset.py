"""`koryta_scrape_bip reset` deletes what the crawl found for candidacies only
with every row backed up first, and never under a running crawl."""

from __future__ import annotations

import fcntl
import json
from pathlib import Path

import pytest

from jobs.bip_crawler import build_parser
from jobs.bip_crawler.reset import reset_candidacies
from stores.tests.test_bip_people_store import crawl_tables


def crawl_folder(tmp_path: Path) -> Path:
    out = tmp_path / "bip-people-crawl"
    out.mkdir()
    (out / ".crawl.lock").touch()
    return out


def deletes(pg) -> list[str]:  # type: ignore[no-untyped-def]
    return [s for s in pg.log if s.startswith("DELETE")]


def test_the_keys_come_from_a_list_or_a_file(tmp_path):
    keys = tmp_path / "unfound-keys.txt"
    keys.write_text("a\n# a councillor's menu file\nb\n", encoding="utf-8")
    parser = build_parser()

    from_file = parser.parse_args(["reset", f"@{keys}", "--backup", "b.json"])
    listed = parser.parse_args(["reset", "a,b", "--dry-run"])

    assert from_file.keys == listed.keys == frozenset({"a", "b"})
    assert from_file.backup == Path("b.json") and listed.dry_run


def test_a_dry_run_counts_and_deletes_nothing(tmp_path, capsys):
    pg = crawl_tables()
    counts = reset_candidacies(
        pg,  # type: ignore[arg-type]
        ["a", "gone"],
        out=tmp_path / "nowhere",
        backup=None,
        dry_run=True,
    )

    assert counts == {"bip_poi": 1, "bip_poi_docs": 1}
    assert deletes(pg) == [] and len(pg.tables["bip_poi"][1]) == 2
    assert "would reset 1 of 2 candidacies" in capsys.readouterr().out


def test_every_row_is_on_disk_before_the_first_is_deleted(tmp_path):
    out = crawl_folder(tmp_path)
    backup = tmp_path / "reset.json"
    pg = crawl_tables()
    on_delete: list[dict] = []
    execute = pg.execute

    def watch(sql: str, params: tuple = ()) -> None:
        if sql.startswith("DELETE") and not on_delete:
            on_delete.append(json.loads(backup.read_text(encoding="utf-8")))
        execute(sql, params)

    pg.execute = watch  # type: ignore[method-assign]
    counts = reset_candidacies(pg, ["a"], out=out, backup=backup)  # type: ignore[arg-type]

    assert counts == {"bip_poi": 1, "bip_poi_docs": 1}
    (saved,) = on_delete
    assert saved["keys"] == ["a"]
    assert saved["tables"]["bip_poi"] == [
        {
            "key": "a",
            "status": "found",
            "reason": "named",
            "docs": 1,
            "checked_at": "2026-11-06T03:12:00+00:00",
            "unit": "146501",
        }
    ]
    assert [r["anchor"] for r in saved["tables"]["bip_poi_docs"]] == ["Statut"]
    assert [r[0] for r in pg.tables["bip_poi"][1]] == ["b"]


def test_no_reset_without_a_new_backup_file(tmp_path):
    out = crawl_folder(tmp_path)
    pg = crawl_tables()
    with pytest.raises(SystemExit, match="--backup"):
        reset_candidacies(pg, ["a"], out=out, backup=None)  # type: ignore[arg-type]
    earlier = tmp_path / "earlier.json"
    earlier.write_text("{}", encoding="utf-8")
    with pytest.raises(SystemExit, match="exists"):
        reset_candidacies(pg, ["a"], out=out, backup=earlier)  # type: ignore[arg-type]
    assert deletes(pg) == [] and earlier.read_text(encoding="utf-8") == "{}"


def test_no_reset_while_a_crawl_holds_its_folder(tmp_path):
    out = crawl_folder(tmp_path)
    backup = tmp_path / "reset.json"
    pg = crawl_tables()
    with (out / ".crawl.lock").open("w") as crawl:
        fcntl.flock(crawl, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(SystemExit, match="between chunks"):
            reset_candidacies(pg, ["a"], out=out, backup=backup)  # type: ignore[arg-type]
    assert deletes(pg) == [] and not backup.exists()


def test_no_reset_in_a_folder_no_crawl_ran_in(tmp_path):
    # A mistyped --out would take a lock no crawl holds.
    pg = crawl_tables()
    with pytest.raises(SystemExit, match="no crawl's folder"):
        reset_candidacies(
            pg,  # type: ignore[arg-type]
            ["a"],
            out=tmp_path / "bip-people-craw",
            backup=tmp_path / "reset.json",
        )
    assert deletes(pg) == []
