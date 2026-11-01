"""The people mode's list is the night's newest, joined to what the search found."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from analysis.bip_people_of_interest import BipPeopleOfInterest
from entities.bip import BipPersonOfInterest
from jobs.bip_crawler import people_list
from jobs.bip_crawler.people_list import (
    candidacies,
    found,
    outcomes,
    read_list,
    to_search,
)
from scrapers.stores import PersonRow, with_outcomes
from stores.bip_people import MemoryBipPeopleStore


def poi(key: str, priority: int, koryta_ids: list[str]) -> BipPersonOfInterest:
    return BipPersonOfInterest(
        key=key,
        full_name="Jan Kowalski",
        first_name="Jan",
        last_name="Kowalski",
        teryt="146501",
        unit_level="gmina",
        office="Rada",
        election_year=2024,
        priority=priority,
        koryta_ids=koryta_ids,
    )


@pytest.fixture
def night(monkeypatch):
    """BipPeopleOfInterest as a run sees it: what the shared cache holds, what
    is on disk, and whether anybody tried to build it."""
    state = {"cache": None, "disk": [], "built": False, "asked": 0}

    def restore(self, ctx):
        state["asked"] += 1
        if state["cache"] is None:
            return False
        state["disk"] = state["cache"]
        return True

    def build(self, ctx):
        state["built"] = True
        raise AssertionError("the crawler never builds the list")

    monkeypatch.setattr(
        BipPeopleOfInterest, "restore_output_from_shared_cache", restore
    )
    monkeypatch.setattr(
        BipPeopleOfInterest, "read_list", lambda self, ctx: state["disk"]
    )
    monkeypatch.setattr(BipPeopleOfInterest, "output_time", lambda self, ctx: 1.7e9)
    monkeypatch.setattr(BipPeopleOfInterest, "process", build)
    return state


def test_the_night_s_newer_list_wins_over_the_one_on_disk(night):
    # On 11-01 the crawl still read its own copy of 10-29: an undated draft.
    night["disk"] = [poi("k", 0, ["page"])]
    night["cache"] = [poi("k", 1, ["page"])]  # the night saw its birth date

    [row] = read_list(None)  # type: ignore[arg-type]

    assert row.priority == 1 and night["asked"] == 1 and not night["built"]


def test_without_the_cache_the_copy_on_disk_is_read_and_its_age_said(night, capsys):
    night["disk"] = [poi("k", 0, ["page"])]

    [row] = read_list(None)  # type: ignore[arg-type]

    assert row.priority == 0 and not night["built"]
    assert "reading the one on disk, written 2023-11-14" in capsys.readouterr().out


def test_who_a_candidacy_is_comes_from_the_list_what_was_found_from_the_store(
    monkeypatch,
):
    store = MemoryBipPeopleStore()
    store.record_person("dated", "found", "named", 2, "r1")
    store.record_person("dropped", "found", "named", 1, "r1")  # left the list
    store.record_person("missing", "not_found", "not_listed", 0, "r1")
    listed = [
        PersonRow("dated", "146501", 1, 2024, "Jan", "Kowalski", {"koryta_ids": ["p"]}),
        PersonRow("missing", "146501", 0, 2024, "Ewa", "Lis", {}),
        PersonRow("new", "146501", 2, 2024, "Ola", "Mak", {}),
    ]
    monkeypatch.setattr(people_list, "read_list", lambda ctx: listed)

    rows = candidacies(store, None)  # type: ignore[arg-type]

    assert [(r.key, r.priority, r.status, r.docs) for r in rows] == [
        ("dated", 1, "found", 2),
        ("missing", 0, "not_found", 0),
        ("new", 2, "pending", 0),
    ]
    assert [r.key for r in found(rows)] == ["dated"]
    assert outcomes(rows) == {"found": 1, "not_found:not_listed": 1, "pending": 1}
    assert [
        r.key for r in to_search(rows, refresh=False, max_priority=None, limit=None)
    ] == ["new"]


def test_a_retry_cutoff_reads_when_the_search_last_looked():
    store = MemoryBipPeopleStore()
    store.record_person("k", "not_found", "unreachable", 0, "r1")
    listed = [PersonRow("k", "u", 0, 2024, "Jan", "Nowak", {})]
    rows = with_outcomes(listed, store.searched())
    retry = frozenset({"unreachable"})
    before = datetime(2020, 1, 1, tzinfo=timezone.utc)
    after = datetime(2100, 1, 1, tzinfo=timezone.utc)

    def due(cutoff: datetime) -> list[str]:
        picked = to_search(
            rows,
            refresh=False,
            max_priority=None,
            limit=None,
            retry=retry,
            retry_before=cutoff,
        )
        return [r.key for r in picked]

    assert due(before) == [] and due(after) == ["k"]
