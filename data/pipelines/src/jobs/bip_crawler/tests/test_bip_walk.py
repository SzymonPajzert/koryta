"""`koryta_scrape_bip walk` and `plan`: the parts that need no network."""

from __future__ import annotations

import json

import pytest

from jobs.bip_crawler import build_parser
from jobs.bip_crawler.people import apply_unit_starts, selected
from jobs.bip_crawler.people_list import read_list_file
from jobs.bip_crawler.walk import (
    MemoryDocIndex,
    chosen,
    folded,
    plan_lines,
    report,
    tried_starts,
)
from scrapers.bip.units import UnitSeed
from scrapers.stores import DocRow, PersonDocRow, PersonOutcome, PersonRow, UnitRow
from stores.bip_people import MemoryBipPeopleStore


def _row(
    key: str, unit: str, first: str, last: str, priority: int = 1, year: int = 2024
) -> PersonRow:
    return PersonRow(
        key=key,
        unit=unit,
        priority=priority,
        election_year=year,
        first_name=first,
        last_name=last,
    )


PEOPLE = [
    _row("a", "020800", "Michał", "Cisakowski"),
    _row("b", "020800", "Anna", "Łukaszewska", priority=2),
    _row("c", "021203", "Mariola", "Szczęsna", year=2018),
]


def test_walk_takes_the_units_keys_and_names_asked() -> None:
    assert [r.key for r in chosen(PEOPLE, {"020800"})] == ["a", "b"]
    assert [r.key for r in chosen(PEOPLE, {"020800", "021203"}, keys={"c"})] == ["c"]
    # Case and diacritics do not matter, ł included.
    assert [r.key for r in chosen(PEOPLE, {"020800"}, person="LUKASZ")] == ["b"]
    assert [r.key for r in chosen(PEOPLE, {"021203"}, person="szczesna")] == ["c"]
    assert chosen(PEOPLE, {"999999"}) == []
    assert folded("Łukasz Ćwik") == "lukasz cwik"


def test_walk_counts_a_downloaded_file_once() -> None:
    index = MemoryDocIndex()
    doc = DocRow(
        sha256="s1",
        url="https://bip.example/a.pdf",
        host="bip.example",
        content_type="application/pdf",
        size=10,
        filename="a.pdf",
        bundle="b1",
    )
    assert index.doc_bundle("s1") is None
    assert index.record_docs([doc, doc], "crawl") == 1
    assert index.doc_bundle("s1") == "b1"
    assert index.record_docs([doc], "crawl") == 0


def test_walk_reports_each_candidacy_with_its_files() -> None:
    store = MemoryBipPeopleStore()
    store.record_unit(
        UnitRow("020800", "searched", ["https://bip.example/"], 40, 3), "run"
    )
    store.record_person("a", "found", "", 1, "run")
    store.record_person_docs(
        [
            PersonDocRow(
                key="a",
                url="https://bip.example/a.pdf",
                status="ok",
                score=0.9,
                anchor="Oświadczenie majątkowe Michał Cisakowski",
                page_url="https://bip.example/radni",
            )
        ],
        "run",
    )
    store.record_person("b", "not_found", "not_listed", 0, "run")
    result = report(PEOPLE, store)
    assert result["outcomes"] == {
        "found": 1,
        "not_found:not_listed": 1,
        "pending": 1,
    }
    assert [(u["unit"], u["pages"]) for u in result["units"]] == [("020800", 40)]
    by_key = {c["key"]: c for c in result["candidacies"]}
    assert by_key["a"]["status"] == "found"
    assert [d["url"] for d in by_key["a"]["docs"]] == ["https://bip.example/a.pdf"]
    assert (by_key["b"]["reason"], by_key["b"]["docs"]) == ("not_listed", [])
    # A unit the walk never reached leaves its candidacies pending.
    assert by_key["c"]["status"] == "pending"


def test_plan_says_what_a_chunk_would_take() -> None:
    searched = {
        "a": PersonOutcome("found"),
        "b": PersonOutcome("not_found", "not_listed"),
    }
    args = build_parser().parse_args(["plan", "--poi-retry", "not_listed"])
    rows, todo = selected(args, PEOPLE, searched)
    assert sorted(r.key for r in todo) == ["b", "c"]
    lines = plan_lines(rows, todo, top=5)
    assert lines[0] == (
        "people of interest: 3 candidacies (1 pending); 2 to search in 2 units"
    )
    assert lines[1] == "by outcome: not_found:not_listed 1, pending 1"
    assert lines[2] == "by priority: 1 1, 2 1"
    assert lines[3] == "biggest units: 020800 1, 021203 1"
    # The default retry leaves a not_listed one alone; --poi-units keeps a unit.
    args = build_parser().parse_args(["plan", "--poi-units", "020800"])
    assert selected(args, PEOPLE, searched)[1] == []


def test_crawl_and_walk_share_the_walk_flags() -> None:
    walk = build_parser().parse_args(
        ["walk", "020800,021203", "--person", "bieda", "--no-render"]
        + ["--max-unit-minutes", "10"]
    )
    assert walk.units == frozenset({"020800", "021203"})
    assert (walk.person, walk.no_render, walk.max_unit_minutes) == ("bieda", True, 10)
    assert walk.known_urls is None and walk.func.__name__ == "cmd_walk"
    crawl = build_parser().parse_args(
        ["crawl", "--people-of-interest", "--workers", "20", "--max-minutes", "95"]
        + ["--poi-retry", "robots", "--poi-units", "020800"]
        + ["--max-unit-minutes", "45", "--known-urls", "known.jsonl"]
    )
    assert crawl.poi_units == frozenset({"020800"})
    assert (crawl.max_unit_minutes, crawl.known_urls) == (45, "known.jsonl")
    assert crawl.func.__name__ == "cmd_crawl"


def test_walk_tries_a_start_as_a_unit_starts_row_would() -> None:
    assert tried_starts({"021203"}, None, None) == []
    rows = tried_starts(
        {"021203"},
        "https://bip.lwowekslaski.pl/",
        ["https://bip.lwowekslaski.pl/a", "https://bip.lwowekslaski.pl/b"],
    )
    seeds = {"021203": UnitSeed("021203", bip_urls=["https://lwowekslaski.pl/"])}
    apply_unit_starts(seeds, rows)
    assert seeds["021203"].bip_urls == [
        "https://bip.lwowekslaski.pl/a",
        "https://bip.lwowekslaski.pl/b",
        "https://bip.lwowekslaski.pl/",
    ]
    assert seeds["021203"].declarations == [
        "https://bip.lwowekslaski.pl/a",
        "https://bip.lwowekslaski.pl/b",
    ]
    with pytest.raises(SystemExit, match="one unit"):
        tried_starts({"021203", "020800"}, "https://bip.example/", None)


def test_walk_reads_a_saved_list_keeping_the_units_zeros(tmp_path) -> None:  # noqa: ANN001
    saved = tmp_path / "people.jsonl"
    row = {
        "key": "k1",
        "full_name": "Mariola Szczęsna",
        "first_name": "Mariola",
        "last_name": "SZCZĘSNA",
        "teryt": "021203",
        "unit_level": "gmina",
        "office": "Burmistrz",
        "election_year": 2018,
        "priority": 1,
        "a_field_from_a_newer_night": True,
    }
    saved.write_text(json.dumps(row, ensure_ascii=False) + "\n\n", encoding="utf-8")
    (person,) = read_list_file(saved)
    assert (person.key, person.unit, person.priority) == ("k1", "021203", 1)
    assert person.last_name == "SZCZĘSNA" and person.status == "pending"
