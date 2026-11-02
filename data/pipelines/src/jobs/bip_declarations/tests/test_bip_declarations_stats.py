"""The status command: where the declarations stand, and the units with no file."""

from __future__ import annotations

import csv

import pytest

from jobs.bip_declarations.stats import EmptyUnit, empty_units, report, write_units_csv
from scrapers.stores import (
    DeclarationCropRow,
    DeclarationCutRow,
    DeclarationLink,
    PersonRow,
    SentRow,
)
from stores.bip_declarations import MemoryBipDeclarationStore

CUT, OLD_CUT, NOT_CUT = "1" * 64, "2" * 64, "3" * 64


def person(key, unit, priority, status, reason="", *, on_site=False, **unit_info):
    info = {"koryta_ids": ["p"] if on_site else [], **unit_info}
    return PersonRow(
        key, unit, priority, 2024, "Jan", "Testowy", info, status=status, reason=reason
    )


@pytest.fixture
def store() -> MemoryBipDeclarationStore:
    strzelin = {"unit_name": "Strzelin (gmina)", "unit_level": "gmina"}
    katowice = {"unit_name": "Katowice (gmina miejska)", "unit_level": "gmina"}
    people = [
        person("a", "021704", 0, "found", on_site=True, **strzelin),
        person("b", "021704", 2, "found", **strzelin),
        # Katowice: searched, nothing came down for either.
        person("c", "246901", 1, "not_found", "not_listed", on_site=True, **katowice),
        person("d", "246901", 2, "not_found", "unreachable", **katowice),
        # Files, but nobody's for sure.
        person("e", "180500", 2, "unconfirmed", unit_name="powiat jasielski"),
    ]
    links = [
        DeclarationLink("a", CUT, "https://h/a.pdf"),
        DeclarationLink("b", NOT_CUT, "https://h/b.pdf"),
        DeclarationLink("e", OLD_CUT, "https://h/e.pdf"),
        # Somebody the night's list no longer has.
        DeclarationLink("gone", "9" * 64, "https://h/gone.pdf"),
    ]
    store = MemoryBipDeclarationStore(people, links=links)
    store.record_cut(
        DeclarationCutRow(CUT, 1, "cut"),
        [
            DeclarationCropRow(CUT, 0, sort="handwritten"),
            DeclarationCropRow(CUT, 1, sort="ocr"),
        ],
    )
    store.record_cut(DeclarationCutRow(OLD_CUT, 0, "cut"), [])
    store.record_sent(
        [
            SentRow("candidacy", "a", "d1", "stored"),
            SentRow("extract", f"{CUT}-p0", "d2", "stored"),
        ],
        "run",
    )
    return store


def figures(lines: list[str], label: str) -> list[int]:
    """The numbers of the priority table's row for `label`."""
    row = next(line for line in lines if line.strip().startswith(label))
    return [int(n.replace(",", "")) for n in row.strip()[len(label) :].split()]


def test_status_follows_the_files_from_download_to_the_site(store):
    lines, _ = report(store, version=1)

    assert "files downloaded for them: 3 (for 3 candidacies)" in lines
    # The file cut by an older cutter is not cut yet.
    assert "  cut: 1 (cut 1)" in lines
    assert "  not cut yet: 2" in lines
    assert "  crops (pages with the date's line): 2 (handwritten 1, ocr 1)" in lines
    assert "  crops on the site: 1, not sent 1" in lines
    # all, found, unconfirmed, downloaded, cut, crop, crop sent, candidacy sent
    assert figures(lines, "0 draft, no date") == [1, 1, 0, 1, 1, 1, 1, 1]
    assert figures(lines, "1 draft, dated") == [1, 0, 0, 0, 0, 0, 0, 0]
    assert figures(lines, "2 not on site") == [3, 1, 1, 2, 0, 0, 0, 0]


def test_status_counts_the_tables_whole_on_its_first_line(store):
    lines, _ = report(store, version=1)

    assert lines[0] == (
        "the job's tables, on the list or not: files cut 2, crops 2; "
        "sent: candidacies 1 (stored 1), extracts 1 (stored 1)"
    )


def test_a_unit_is_empty_when_no_candidacy_in_it_has_a_file(store):
    lines, empty = report(store, version=1, units=5)

    assert empty == [
        EmptyUnit(
            "246901",
            "Katowice (gmina miejska)",
            "gmina",
            candidacies=2,
            on_site=1,
            outcomes={"not_found:not_listed": 1, "not_found:unreachable": 1},
        )
    ]
    assert (
        "units (TERYT) with nothing downloaded: 1 of 3, holding 2 candidacies" in lines
    )
    assert "  another 1 have files but no candidacy found" in lines
    assert "  by voivodeship: śląskie 2" in lines
    assert lines[-1] == (
        "  246901       2    1  Katowice (gmina miejska): "
        "not_found:not_listed 1, not_found:unreachable 1"
    )


def test_empty_units_go_biggest_first():
    people = [
        person("a", "020101", 2, "not_found", "no_seed"),
        person("b", "020201", 2, "not_found", "no_seed"),
        person("c", "020201", 2, "not_found", "robots"),
    ]

    assert [u.teryt for u in empty_units(people, {})] == ["020201", "020101"]


def test_units_csv_has_every_empty_unit(store, tmp_path):
    _, empty = report(store, version=1, units=0)
    path = tmp_path / "units.csv"

    write_units_csv(path, empty)

    with path.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    assert rows == [
        {
            "teryt": "246901",
            "unit_name": "Katowice (gmina miejska)",
            "unit_level": "gmina",
            "candidacies": "2",
            "on_site": "1",
            "outcomes": "not_found:not_listed 1, not_found:unreachable 1",
        }
    ]
