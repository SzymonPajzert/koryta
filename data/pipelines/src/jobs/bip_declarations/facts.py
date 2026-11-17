"""The declarations in people: what predator and the night hand the site, which
counts the people a declaration can publish, each in the stage they are in
(`frontend/shared/declarationPeople.ts`, at `/api/ingest/declarations/facts`).

Half of what the site counts from is its own: the pages, their public posts,
what was published and what readers settled. The other half is predator's, and
the site cannot read predator's Postgres. So:

- predator, after every crawl chunk, cut and upload (`read_facts`, written by
  `stores.bip_declaration_facts`): for each candidacy of the list, what the
  search made of it, whether a file of theirs is not cut yet (`uncut`),
  whether a file a link names them in is cut (`cut_named`) and whether a crop
  of theirs waits for the upload (`waiting`). A council's file that names
  nobody counts for a person only through a page with their name on it: the
  crops the upload sends for them (`upload.extract_records`);
- the night (`site_rows`): the newest of those parts, joined to its own list,
  a row a candidacy with a page on the site - its pages, its unit and how many
  Poles carry the surname (`names`), which the namesake estimate goes by.

No name travels: the part knows a candidacy by its key, and the site gets the
bearers' count, not the surname.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field, replace
from typing import Any

from jobs.bip_declarations.names import Names
from jobs.bip_declarations.upload import (
    MAX_KIDS,
    RETRIED_SKIPS,
    candidacy_record,
    extract_records,
)
from scrapers.stores import BipDeclarationStore, PersonRow, SentRow
from stores.bip_declaration_facts import CandidacyFacts

# The site's limits (`declarationFactsIngestSchema`, frontend/shared/declarations.ts).
STATUSES = frozenset({"pending", "found", "unconfirmed", "not_found"})
KEY = re.compile(r"[0-9a-f]{8,64}")
TERYT = re.compile(r"[0-9]{6}")
FIRST_YEAR, LAST_YEAR = 1990, 2100
MAX_PAGE_ID = 64
MAX_UNIT_NAME = 200
MAX_REASON = 40
MAX_BEARERS = 100_000_000


def coming(sent: SentRow | None, digest: str) -> bool:
    """Whether the site is yet to get an extract whose record hashes to
    `digest`: never sent, or skipped and due again (`upload.due`) - for want
    of something that may be there now (`RETRIED_SKIPS`), or changed since.
    Stored, even with an older digest, the site holds the crop; skipped and
    unchanged, it will not come."""
    return sent is None or (
        sent.result == "skipped"
        and (sent.reason in RETRIED_SKIPS or sent.digest != digest)
    )


def read_facts(store: BipDeclarationStore, version: int) -> list[CandidacyFacts]:
    """Each candidacy of the store's list, by key, with what the crawl, the
    cut and the upload did for it. `version`: the cutter's; a file cut by an
    older one is not cut yet."""
    candidacies = store.candidacies()
    people = {row.key: row for row in candidacies}
    uncut: set[str] = set()
    cut_named: set[str] = set()
    cuts = store.cuts()
    for link in store.links():
        if link.key not in people:
            continue
        cut = cuts.get(link.sha256)
        if cut is None or cut.version < version:
            uncut.add(link.key)
        elif link.named:
            cut_named.add(link.key)
    # The crops go only for the candidacies the upload sends, and of a
    # council's file only for the people whose name is read on the page.
    on_site = {
        key for key, row in people.items() if candidacy_record(row, []) is not None
    }
    sent = store.sent("extract")
    waiting: set[str] = set()
    for extract in extract_records(store, on_site, people):
        if extract.record.get("outcome") != "failed" and coming(
            sent.get(extract.id), extract.digest
        ):
            waiting.update(extract.record["candidacies"])
    return [
        CandidacyFacts(
            key=row.key,
            status=row.status,
            reason=row.reason,
            uncut=row.key in uncut,
            cut_named=row.key in cut_named,
            waiting=row.key in waiting,
        )
        for row in candidacies
    ]


def facts_summary(facts: Iterable[CandidacyFacts]) -> str:
    """One line on a part: its candidacies by status and its flags."""
    rows = list(facts)
    statuses = Counter(row.status for row in rows)
    said = ", ".join(f"{s} {n:,}" for s, n in sorted(statuses.items()))
    return (
        f"{len(rows):,} candidacies ({said}); a file not cut "
        f"{sum(r.uncut for r in rows):,}, a named file cut "
        f"{sum(r.cut_named for r in rows):,}, a crop waiting for the upload "
        f"{sum(r.waiting for r in rows):,}"
    )


def page_ids(value: object) -> list[str]:
    """The list's koryta_ids, as many as the site takes."""
    if not isinstance(value, (list, tuple)):
        return []
    ids = [str(i) for i in value]
    return [i for i in ids if 0 < len(i) <= MAX_PAGE_ID][:MAX_KIDS]


@dataclass
class SiteRows:
    """The night's rows for the site, and what did not go as the part said."""

    rows: list[dict[str, Any]] = field(default_factory=list)
    #: Candidacies with a page the part does not know: new on tonight's list,
    #: or the part older than the list. They go as pending.
    not_in_part: int = 0
    #: Statuses the site does not know, by status. They go as pending.
    unknown_status: Counter[str] = field(default_factory=Counter)
    #: Candidacies with a page whose row the site's contract cannot take.
    left_out: int = 0


def site_rows(
    people: Iterable[PersonRow], facts: Mapping[str, CandidacyFacts], names: Names
) -> SiteRows:
    """A row a candidacy of the list with a page on the site, by key: who the
    list says it is, and what the part says predator did for it."""
    out = SiteRows()
    # Once a key, as the store takes the list.
    by_key = {row.key: row for row in people}
    for row in (by_key[key] for key in sorted(by_key)):
        kids = page_ids(row.person.get("koryta_ids"))
        if not kids:
            continue
        teryt = str(row.person.get("teryt") or row.unit)
        year = row.election_year
        if not (KEY.fullmatch(row.key) and TERYT.fullmatch(teryt)) or not (
            FIRST_YEAR <= year <= LAST_YEAR
        ):
            out.left_out += 1
            continue
        known = facts.get(row.key)
        if known is None:
            out.not_in_part += 1
            known = CandidacyFacts(row.key)
        elif known.status not in STATUSES:
            out.unknown_status[known.status] += 1
            known = replace(known, status="pending", reason="")
        out.rows.append(
            {
                "key": row.key,
                "kids": kids,
                "teryt": teryt,
                "unitName": str(row.person.get("unit_name") or "")[:MAX_UNIT_NAME],
                "year": year,
                "status": known.status,
                "reason": known.reason[:MAX_REASON],
                "uncut": known.uncut,
                "cutNamed": known.cut_named,
                "waiting": known.waiting,
                "bearers": min(
                    names.bearers(row.first_name, row.last_name), MAX_BEARERS
                ),
            }
        )
    return out
