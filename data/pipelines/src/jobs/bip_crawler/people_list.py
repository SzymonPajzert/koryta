"""The candidacies the people mode looks for: the night's list, with what the
search made of each.

The list is `BipPeopleOfInterest`, which the night rebuilds every morning from
the site's export (`data/nightly`), so who has a page (`koryta_ids`), and
whether it shows a birth date or is published (`priority`), are as of last
night. Every run here takes the newest copy from the shared cache and never
builds one. The crawl's Postgres keeps only what the search itself found, by
candidacy key (`stores.bip_people`), and the two meet in `candidacies`.

Until 11-01 the crawl copied the list into Postgres, from the copy on its own
disk, and everything after it read that copy: on 11-01 it still ranked the site
of 10-29, so the drafts the night had dated since were not priority 1 to the
declarations upload.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import asdict
from datetime import datetime, timezone

from analysis.bip_people_of_interest import BipPeopleOfInterest
from entities.bip import BipPersonOfInterest
from scrapers.stores import (
    BipPeopleStore,
    Context,
    PersonRow,
    ProcessPolicy,
    with_outcomes,
)

#: Read, never rebuilt: the night builds the list. Unpinned, a workspace with
#: the list but not every tree under its inputs took it for stale: the second
#: run rebuilt the list, the third PeopleMerged as well, and each went up to
#: the shared cache.
PINNED = frozenset({"BipPeopleOfInterest", "PeopleMerged"})


def list_policy() -> ProcessPolicy:
    return ProcessPolicy(set(), exclude_refresh=set(PINNED))


def person_row(person: BipPersonOfInterest) -> PersonRow:
    return PersonRow(
        key=person.key,
        unit=person.teryt,
        priority=person.priority,
        election_year=person.election_year,
        first_name=person.first_name,
        last_name=person.last_name,
        person=asdict(person),
    )


def read_list(ctx: Context) -> list[PersonRow]:
    """The newest list in the shared cache (the night's, or this user's own if
    newer), put on disk first; the copy on disk only when the cache has none or
    cannot be reached, said with its age. `ctx` comes from `list_policy`."""
    pipeline = BipPeopleOfInterest()
    if not pipeline.restore_output_from_shared_cache(ctx):
        mtime = pipeline.output_time(ctx)
        when = (
            datetime.fromtimestamp(mtime, timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
            if mtime
            else "nowhere"
        )
        print(
            f"people of interest: no list from the shared cache; "
            f"reading the one on disk, written {when}",
            flush=True,
        )
    return [person_row(p) for p in pipeline.read_list(ctx)]


def candidacies(store: BipPeopleStore, ctx: Context) -> list[PersonRow]:
    """The night's list, with the search's outcomes."""
    return with_outcomes(read_list(ctx), store.searched())


def wanted(row: PersonRow) -> tuple[int, int, str, str]:
    """Most wanted first: by priority, the newest term first, then by unit."""
    return (row.priority, -row.election_year, row.unit, row.key)


def to_search(
    rows: Iterable[PersonRow],
    *,
    refresh: bool,
    max_priority: int | None,
    limit: int | None,
    retry: frozenset[str] = frozenset(),
    retry_before: datetime | None = None,
) -> list[PersonRow]:
    """Pending candidacies, and the not_found ones whose reason (or the
    unconfirmed ones, for "unconfirmed") is in ``retry``, with ``retry_before``
    only those last searched before it; all of them with ``refresh``. Most
    wanted first."""

    def due(row: PersonRow) -> bool:
        if refresh or row.status == "pending":
            return True
        again = (row.status == "not_found" and row.reason in retry) or (
            row.status == "unconfirmed" and "unconfirmed" in retry
        )
        return again and (
            retry_before is None
            or (row.checked_at is not None and row.checked_at < retry_before)
        )

    picked = sorted(
        (
            row
            for row in rows
            if due(row) and (max_priority is None or row.priority <= max_priority)
        ),
        key=wanted,
    )
    return picked if limit is None else picked[:limit]


def found(rows: Iterable[PersonRow]) -> list[PersonRow]:
    """The candidacies a declaration was downloaded for (status found), most
    wanted first."""
    return sorted((row for row in rows if row.status == "found"), key=wanted)


def _label(row: PersonRow) -> str:
    return f"{row.status}:{row.reason}" if row.status == "not_found" else row.status


def outcomes(rows: Iterable[PersonRow]) -> dict[str, int]:
    """Counts by status and reason: {"found": 12, "not_found:not_listed": 4}."""
    counts: dict[str, int] = {}
    for row in rows:
        counts[_label(row)] = counts.get(_label(row), 0) + 1
    return dict(sorted(counts.items()))


def outcomes_by_year(rows: Iterable[PersonRow]) -> dict[int, dict[str, int]]:
    """``outcomes`` per election year: what a term's BIPs still hold."""
    by_year: dict[int, list[PersonRow]] = {}
    for row in rows:
        by_year.setdefault(row.election_year, []).append(row)
    return {year: outcomes(group) for year, group in sorted(by_year.items())}
