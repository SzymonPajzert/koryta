"""What the BIP crawler's people mode knows about each candidacy it looks for.

Three tables beside the crawl queue's, created on first use like theirs:

- ``bip_poi``: one row per ``BipPersonOfInterest`` candidacy - pending, found
  (at least one file downloaded that a link names them in) or not_found, with
  the reason (``no_seed``, ``unreachable``, ``robots``, ``no_declarations``,
  ``not_listed``, ``download_failed``).
- ``bip_poi_docs``: every file tried for a candidacy, with the link's label and
  context, and where it is stored (``sha256`` in ``bip_docs`` and its bundle).
- ``bip_units``: each unit searched, where the search started and how many
  pages it read.

A later run picks up the pending candidacies only, so new people of interest
(a new election, a wider list) are searched without redoing the found ones;
``--poi-refresh`` searches everybody again.
"""

from __future__ import annotations

import json

from scrapers.common.pg import PostgresClient
from scrapers.stores import BipPeopleStore, PersonDocRow, PersonRow, UnitRow

_SCHEMA = """
CREATE TABLE IF NOT EXISTS bip_poi (
  key           text PRIMARY KEY,
  unit          text NOT NULL,
  priority      int  NOT NULL DEFAULT 9,
  election_year int  NOT NULL DEFAULT 0,
  first_name    text NOT NULL DEFAULT '',
  last_name     text NOT NULL DEFAULT '',
  person        jsonb NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'pending',
  reason        text NOT NULL DEFAULT '',
  docs          int  NOT NULL DEFAULT 0,
  run_id        text NOT NULL DEFAULT '',
  first_seen    timestamptz NOT NULL DEFAULT now(),
  checked_at    timestamptz
);
CREATE INDEX IF NOT EXISTS bip_poi_status_idx
  ON bip_poi (status, priority, election_year);
CREATE TABLE IF NOT EXISTS bip_poi_docs (
  key        text NOT NULL,
  url        text NOT NULL,
  status     text NOT NULL,
  sha256     text NOT NULL DEFAULT '',
  bundle     text NOT NULL DEFAULT '',
  named      bool NOT NULL DEFAULT true,
  first_name bool NOT NULL DEFAULT false,
  score      real NOT NULL DEFAULT 0,
  anchor     text NOT NULL DEFAULT '',
  context    text NOT NULL DEFAULT '',
  page_url   text NOT NULL DEFAULT '',
  run_id     text NOT NULL DEFAULT '',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, url)
);
CREATE TABLE IF NOT EXISTS bip_units (
  unit              text PRIMARY KEY,
  status            text NOT NULL DEFAULT '',
  roots             jsonb NOT NULL DEFAULT '[]',
  pages             int  NOT NULL DEFAULT 0,
  declaration_pages int  NOT NULL DEFAULT 0,
  run_id            text NOT NULL DEFAULT '',
  checked_at        timestamptz
)
"""

_PERSON_COLUMNS = (
    "key, unit, priority, election_year, first_name, last_name, person, "
    "status, reason, docs"
)


def _person(row: tuple) -> PersonRow:
    key, unit, priority, year, first, last, person, status, reason, docs = row
    if isinstance(person, str):
        person = json.loads(person)
    return PersonRow(
        key, unit, priority, year, first, last, person or {}, status, reason, docs
    )


class PostgresBipPeopleStore(BipPeopleStore):
    def __init__(self, pg: PostgresClient) -> None:
        self.pg = pg
        self.ensure_schema()

    def ensure_schema(self) -> None:
        for statement in _SCHEMA.split(";"):
            if statement.strip():
                self.pg.execute(statement)

    def upsert_people(self, rows: list[PersonRow]) -> int:
        if not rows:
            return 0
        new = 0
        with self.pg.transaction() as cur:
            for row in rows:
                cur.execute(
                    """
                    INSERT INTO bip_poi (key, unit, priority, election_year,
                                         first_name, last_name, person)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (key) DO UPDATE
                       SET unit = EXCLUDED.unit,
                           priority = EXCLUDED.priority,
                           election_year = EXCLUDED.election_year,
                           first_name = EXCLUDED.first_name,
                           last_name = EXCLUDED.last_name,
                           person = EXCLUDED.person
                    RETURNING (xmax = 0) AS inserted
                    """,
                    (
                        row.key,
                        row.unit,
                        row.priority,
                        row.election_year,
                        row.first_name,
                        row.last_name,
                        json.dumps(row.person, ensure_ascii=False, default=str),
                    ),
                )
                inserted = cur.fetchone()
                new += bool(inserted and inserted[0])
        return new

    def people_to_search(
        self, *, refresh: bool, max_priority: int | None, limit: int | None
    ) -> list[PersonRow]:
        rows = self.pg.fetchall(
            f"""
            SELECT {_PERSON_COLUMNS} FROM bip_poi
             WHERE (%s OR status = 'pending')
               AND (%s::int IS NULL OR priority <= %s::int)
             ORDER BY priority, election_year DESC, unit, key
             LIMIT %s
            """,
            (refresh, max_priority, max_priority, limit),
        )
        return [_person(r) for r in rows]

    def record_unit(self, row: UnitRow, run_id: str) -> None:
        self.pg.execute(
            """
            INSERT INTO bip_units
                (unit, status, roots, pages, declaration_pages, run_id, checked_at)
            VALUES (%s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (unit) DO UPDATE
               SET status = EXCLUDED.status, roots = EXCLUDED.roots,
                   pages = EXCLUDED.pages,
                   declaration_pages = EXCLUDED.declaration_pages,
                   run_id = EXCLUDED.run_id,
                   checked_at = now()
            """,
            (
                row.unit,
                row.status,
                json.dumps(row.roots),
                row.pages,
                row.declaration_pages,
                run_id,
            ),
        )

    def record_person(
        self, key: str, status: str, reason: str, docs: int, run_id: str
    ) -> None:
        self.pg.execute(
            """
            UPDATE bip_poi
               SET status = %s, reason = %s, docs = %s, run_id = %s, checked_at = now()
             WHERE key = %s
            """,
            (status, reason, docs, run_id, key),
        )

    def record_person_docs(self, rows: list[PersonDocRow], run_id: str) -> None:
        if not rows:
            return
        with self.pg.transaction() as cur:
            for row in rows:
                cur.execute(
                    """
                    INSERT INTO bip_poi_docs
                        (key, url, status, sha256, bundle, named, first_name,
                                              score, anchor, context, page_url, run_id)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (key, url) DO UPDATE
                       SET status = EXCLUDED.status, sha256 = EXCLUDED.sha256,
                           bundle = EXCLUDED.bundle, named = EXCLUDED.named,
                           first_name = EXCLUDED.first_name, score = EXCLUDED.score,
                           anchor = EXCLUDED.anchor, context = EXCLUDED.context,
                           page_url = EXCLUDED.page_url, run_id = EXCLUDED.run_id,
                           fetched_at = now()
                    """,
                    (
                        row.key,
                        row.url,
                        row.status,
                        row.sha256,
                        row.bundle,
                        row.named,
                        row.first_name,
                        row.score,
                        row.anchor,
                        row.context,
                        row.page_url,
                        run_id,
                    ),
                )

    def person_docs(self, key: str) -> list[PersonDocRow]:
        rows = self.pg.fetchall(
            """
            SELECT key, url, status, sha256, bundle, named, first_name, score,
                   anchor, context, page_url
              FROM bip_poi_docs WHERE key = %s ORDER BY score DESC, url
            """,
            (key,),
        )
        return [PersonDocRow(*r) for r in rows]

    def outcomes(self) -> dict[str, int]:
        rows = self.pg.fetchall(
            """
            SELECT CASE WHEN status = 'not_found' THEN status || ':' || reason
                        ELSE status END,
                   count(*)
              FROM bip_poi GROUP BY 1 ORDER BY 1
            """
        )
        return {str(k): int(v) for k, v in rows}


class MemoryBipPeopleStore(BipPeopleStore):
    """The same in memory: for tests, and for a run that should leave nothing behind."""

    def __init__(self) -> None:
        self.people: dict[str, PersonRow] = {}
        self.docs: dict[tuple[str, str], PersonDocRow] = {}
        self.units: dict[str, UnitRow] = {}

    def ensure_schema(self) -> None:
        return None

    def upsert_people(self, rows: list[PersonRow]) -> int:
        new = 0
        for row in rows:
            known = self.people.get(row.key)
            if known is None:
                self.people[row.key] = row
                new += 1
            else:
                self.people[row.key] = PersonRow(
                    row.key,
                    row.unit,
                    row.priority,
                    row.election_year,
                    row.first_name,
                    row.last_name,
                    row.person,
                    known.status,
                    known.reason,
                    known.docs,
                )
        return new

    def people_to_search(
        self, *, refresh: bool, max_priority: int | None, limit: int | None
    ) -> list[PersonRow]:
        rows = [
            r
            for r in self.people.values()
            if (refresh or r.status == "pending")
            and (max_priority is None or r.priority <= max_priority)
        ]
        rows.sort(key=lambda r: (r.priority, -r.election_year, r.unit, r.key))
        return rows[:limit] if limit else rows

    def record_unit(self, row: UnitRow, run_id: str) -> None:
        self.units[row.unit] = row

    def record_person(
        self, key: str, status: str, reason: str, docs: int, run_id: str
    ) -> None:
        r = self.people[key]
        self.people[key] = PersonRow(
            r.key,
            r.unit,
            r.priority,
            r.election_year,
            r.first_name,
            r.last_name,
            r.person,
            status,
            reason,
            docs,
        )

    def record_person_docs(self, rows: list[PersonDocRow], run_id: str) -> None:
        for row in rows:
            self.docs[(row.key, row.url)] = row

    def person_docs(self, key: str) -> list[PersonDocRow]:
        return sorted(
            (d for (k, _), d in self.docs.items() if k == key),
            key=lambda d: (-d.score, d.url),
        )

    def outcomes(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for r in self.people.values():
            label = f"{r.status}:{r.reason}" if r.status == "not_found" else r.status
            counts[label] = counts.get(label, 0) + 1
        return dict(sorted(counts.items()))
