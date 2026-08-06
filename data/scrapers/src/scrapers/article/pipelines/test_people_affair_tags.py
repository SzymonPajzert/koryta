from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pandas as pd

import scrapers.article.pipelines.incremental as incremental_module
from scrapers.article.pipelines.people_affair_tags_pipeline import (
    PeopleAffairTags,
    _atomize_tags,
    _is_interesting_tag,
    _normalize,
)


class FakeDumper:
    """Minimal stand-in for stores.duckdb.EntityDumper."""

    def __init__(self) -> None:
        self.records: list[Any] = []

    def insert_into(self, record: Any, sort_by: list[str]) -> None:
        self.records.append(record)

    def dump_pandas(self) -> None:
        pass


def _mention(url: str, tags: list[str], people: list[str], date: str | None = None):
    return {
        "url": url,
        "domain": "example.pl",
        "title": "T",
        "date": date,
        "tags": tags,
        "people_mentioned": people,
    }


def test_normalize_strips_diacritics_and_lowercases():
    assert _normalize("Afera Wizowa") == "afera wizowa"
    assert _normalize("Śląska Sieć") == "slaska siec"
    assert _normalize("  Zamach Na Sądy  ") == "zamach na sady"


def test_atomize_tags_splits_bundles():
    atoms = _atomize_tags(["polityka", "afera, afera wizowa", "sąd; wyrok"])
    assert atoms == ["polityka", "afera", "afera wizowa", "sad", "wyrok"]


def test_interesting_tags_are_named_affairs_only():
    interesting = [
        "afera wizowa",
        "afera taśmowa",
        "afera endoprotezowa",
        "pegasus",
        "komisja śledcza ds. pegasusa",
        "komisja kopertowa",
        "amber gold",
        "fundusz sprawiedliwości",
        "reprywatyzacja",
        "szwalnia",
    ]
    generic = [
        "polityka",
        "prokuratura",
        "sport",
        "wybory",
        "sąd",
        "śledztwo",
        "afera",
        "skandal",
        "korupcja",
        "policja",
        "zamach stanu",
        "katastrofa smoleńska",
        "strajk kobiet",
        "pedofilia",
    ]
    for tag in interesting:
        assert _is_interesting_tag(_normalize(tag)), f"expected interesting: {tag}"
    for tag in generic:
        assert not _is_interesting_tag(_normalize(tag)), f"expected generic: {tag}"


def test_process_aggregates_tags_per_person(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(incremental_module, "VERSIONED_DIR", tmp_path)
    mentions = tmp_path / "article_person_mentions" / "article_person_mentions.jsonl"
    mentions.parent.mkdir(parents=True, exist_ok=True)
    mentions.write_text(
        "\n".join(
            json.dumps(record, ensure_ascii=False)
            for record in [
                _mention(
                    "u1",
                    ["Polityka", "afera wizowa", "Pegasus"],
                    ["Jan Kowalski", "Adam Nowak"],
                    "2023-01-01",
                ),
                _mention(
                    "u2",
                    ["afera wizowa", "sport"],
                    ["Jan Kowalski"],
                    "2023-05-01",
                ),
                _mention(
                    "u3",
                    ["polityka", "wybory"],
                    ["Adam Nowak"],
                    "2023-06-01",
                ),
            ]
        ),
        encoding="utf-8",
    )

    pipeline = PeopleAffairTags()
    pipeline.mentions = SimpleNamespace(final_output_path=mentions)  # type: ignore[assignment]

    dumper = FakeDumper()
    ctx = SimpleNamespace(  # type: ignore[var-annotated]
        io=SimpleNamespace(dumper=dumper),
        refresh_policy=SimpleNamespace(
            tree_printed=True,
            refreshed_pipelines=set(),
            execution_decisions={},
            build_and_print_tree=lambda *a, **k: None,
            add_refreshed_pipeline=lambda *a, **k: None,
        ),
    )
    result = pipeline.process(ctx)  # type: ignore[arg-type]
    assert isinstance(result, pd.DataFrame)

    by_person = {r.person: r for r in dumper.records}
    assert set(by_person) == {"Jan Kowalski", "Adam Nowak"}

    jan = by_person["Jan Kowalski"]
    tags = {t["tag"]: t for t in jan.tags}
    assert tags["afera wizowa"]["count"] == 2
    assert tags["afera wizowa"]["first_date"] == "2023-01-01"
    assert tags["afera wizowa"]["last_date"] == "2023-05-01"
    assert tags["pegasus"]["count"] == 1
    assert jan.total_articles == 3

    adam = by_person["Adam Nowak"]
    assert [t["tag"] for t in adam.tags] == ["afera wizowa", "pegasus"]
    assert adam.total_articles == 2


def test_process_skips_people_without_interesting_tags(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(incremental_module, "VERSIONED_DIR", tmp_path)
    mentions = tmp_path / "article_person_mentions" / "article_person_mentions.jsonl"
    mentions.parent.mkdir(parents=True, exist_ok=True)
    mentions.write_text(
        json.dumps(
            _mention("u1", ["polityka", "sport"], ["Jan Kowalski"], "2023-01-01"),
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    pipeline = PeopleAffairTags()
    pipeline.mentions = SimpleNamespace(final_output_path=mentions)  # type: ignore[assignment]

    dumper = FakeDumper()
    ctx = SimpleNamespace(  # type: ignore[var-annotated]
        io=SimpleNamespace(dumper=dumper),
        refresh_policy=SimpleNamespace(
            tree_printed=True,
            refreshed_pipelines=set(),
            execution_decisions={},
            build_and_print_tree=lambda *a, **k: None,
            add_refreshed_pipeline=lambda *a, **k: None,
        ),
    )
    pipeline.process(ctx)  # type: ignore[arg-type]
    assert dumper.records == []
