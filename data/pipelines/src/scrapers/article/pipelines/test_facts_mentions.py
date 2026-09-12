"""Tests for the ArticleFacts / ArticleAnalyzed consumption of mentions."""

import json
from pathlib import Path

import pytest

from scrapers.article.pipelines.article_analyzed_pipeline import _koryta_ids_by_url
from scrapers.article.pipelines.facts_pipeline import (
    _iter_extractable_records,
    _mentioned_people_by_url,
)

_MENTIONS = [
    {
        "url": "a.pl/x",
        "person": "Jan Kowalski",
        "person_id": "k1",
        "verdict": "yes",
    },
    {
        "url": "a.pl/x",
        "person": "Anna Nowak",
        "person_id": "k2",
        "verdict": "no",
    },
    {
        "url": "b.pl/y",
        "person": "Jan Kowalski",
        "person_id": "k1",
        "verdict": "unknown",
    },
    {
        "url": "b.pl/y",
        "person": "Piotr Lis",
        "person_id": "k3",
        "verdict": "yes",
    },
    {
        "url": "b.pl/y",
        "person": "Piotr Lis",
        "person_id": "k3",
        "verdict": "yes",
    },
    {"url": "c.pl/z", "person_id": "k4", "verdict": "yes"},
]


def _write_mentions(tmp_path) -> Path:
    path = tmp_path / "mentions.jsonl"
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in _MENTIONS) + "\n",
        encoding="utf-8",
    )
    return path


def test_mentioned_people_by_url_keeps_only_yes_verdicts(tmp_path):
    by_url = _mentioned_people_by_url(_write_mentions(tmp_path))
    assert by_url["a.pl/x"] == [("Jan Kowalski", "k1")]
    assert by_url["b.pl/y"] == [("Piotr Lis", "k3"), ("Piotr Lis", "k3")]
    # 'c.pl/z' has no person name -> skipped entirely.
    assert "c.pl/z" not in by_url


def test_mentioned_people_by_url_missing_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        _mentioned_people_by_url(tmp_path / "missing.jsonl")


def test_koryta_ids_by_url_yes_only_deduped_in_order(tmp_path):
    by_url = _koryta_ids_by_url(_write_mentions(tmp_path))
    assert by_url["a.pl/x"] == ["k1"]
    assert by_url["b.pl/y"] == ["k3"]
    # A yes row needs only a person_id here (the name is not required).
    assert by_url["c.pl/z"] == ["k4"]


def test_koryta_ids_by_url_missing_file(tmp_path):
    assert _koryta_ids_by_url(tmp_path / "missing.jsonl") == {}


# --- _extractable_records: mentions optional, never a gate ------------------ #

_PARSED_ROWS = [
    {
        "url": "a.pl/1",
        "parse_status": "ok",
        "article_content_hash": "h1",
        "article_content": "Treść pierwszego artykułu.",
    },
    {
        "url": "b.pl/2",
        "parse_status": "ok",
        "article_content_hash": "h2",
        "article_content": "Treść drugiego artykułu.",
    },
    {
        "url": "c.pl/3",
        "parse_status": "error",
        "article_content_hash": "h3",
        "article_content": "treść",
    },
]

_SCORE_ROWS = [
    {"url": "a.pl/1", "llm_is_article": True, "koryciarski_llm_score": 7},
    {"url": "b.pl/2", "llm_is_article": True, "koryciarski_llm_score": 0},
    {"url": "c.pl/3", "llm_is_article": True, "koryciarski_llm_score": 5},
    {"url": "d.pl/4", "llm_is_article": False, "koryciarski_llm_score": 9},
]


def _write_parsed(tmp_path: Path) -> Path:
    path = tmp_path / "parsed.jsonl"
    path.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in _PARSED_ROWS) + "\n",
        encoding="utf-8",
    )
    return path


def _write_scores(tmp_path: Path) -> Path:
    path = tmp_path / "scores.jsonl"
    path.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in _SCORE_ROWS) + "\n",
        encoding="utf-8",
    )
    return path


def test_extractable_records_without_mentions_includes_all_scored(tmp_path):
    # Empty mentions -> every scored+parsed article is extracted with no hint.
    records = list(
        _iter_extractable_records(_write_parsed(tmp_path), _write_scores(tmp_path), {})
    )
    urls = {r["url"]: r for r in records}
    assert set(urls) == {"a.pl/1", "b.pl/2"}
    assert urls["b.pl/2"]["people_mentioned"] == []  # zero score still included
    # 'c.pl/3' is scored but parse_status != ok; 'd.pl/4' is not an article.
    assert "c.pl/3" not in urls
    assert "d.pl/4" not in urls


def test_extractable_records_mentions_add_hint_without_gate(tmp_path):
    mentioned = {"b.pl/2": [("Jan Kowalski", "k1")]}
    records = list(
        _iter_extractable_records(
            _write_parsed(tmp_path), _write_scores(tmp_path), mentioned
        )
    )
    urls = {r["url"]: r for r in records}
    # The mention file listing only 'b.pl/2' must NOT drop 'a.pl/1'.
    assert set(urls) == {"a.pl/1", "b.pl/2"}
    assert urls["a.pl/1"]["people_mentioned"] == []
    assert urls["b.pl/2"]["people_mentioned"] == ["Jan Kowalski"]


def test_extractable_records_only_mentioned_is_a_real_gate(tmp_path):
    # The --article-facts-require-mentions behavior: only mentioned URLs survive
    # (scored + mentioned), and it is applied while reading -- not after a
    # full-corpus dict was built.
    mentioned = {"b.pl/2": [("Jan Kowalski", "k1")]}
    records = list(
        _iter_extractable_records(
            _write_parsed(tmp_path),
            _write_scores(tmp_path),
            mentioned,
            only_mentioned=True,
        )
    )
    urls = {r["url"]: r for r in records}
    # A URL only exists as a key once it has at least one confirmed (yes) row.
    assert set(urls) == {"b.pl/2"}
    assert urls["b.pl/2"]["people_mentioned"] == ["Jan Kowalski"]
