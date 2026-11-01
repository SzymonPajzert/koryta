"""What the BIP crawler's people mode found for each candidacy it looks for.

Three tables beside the crawl queue's, created on first use like theirs:

- ``bip_poi``: what the search made of each ``BipPersonOfInterest`` candidacy,
  by its key - found (at least one file downloaded that a link names them in),
  unconfirmed or not_found, with the reason (``no_seed``, ``unreachable``,
  ``robots``, ``no_declarations``, ``not_listed``, ``download_failed``). A
  candidacy with no row is pending.
- ``bip_poi_docs``: every file tried for a candidacy, with the link's label and
  context, and where it is stored (``sha256`` in ``bip_docs`` and its bundle).
- ``bip_units``: each unit searched, where the search started and how many
  pages it read.

Only what the crawl itself found: who a candidacy is, whether the site has a
page for them and how much it wants them come from the night's list, read
afresh each run (`jobs.bip_crawler.people_list`). Until 11-01 ``bip_poi`` held
a copy of the list too, which only a crawl ever rewrote, from the copy on its
own disk, so on 11-01 the upload still ranked the site of 10-29.

A later run picks up the pending candidacies only, so new people of interest
(a new election, a wider list) are searched without redoing the found ones;
``--poi-refresh`` searches everybody again.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from scrapers.common.pg import PostgresClient
from scrapers.stores import BipPeopleStore, PersonDocRow, PersonOutcome, UnitRow

_SCHEMA = """
CREATE TABLE IF NOT EXISTS bip_poi (
  key        text PRIMARY KEY,
  status     text NOT NULL DEFAULT 'pending',
  reason     text NOT NULL DEFAULT '',
  docs       int  NOT NULL DEFAULT 0,
  run_id     text NOT NULL DEFAULT '',
  first_seen timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz
);
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


def read_searched(pg: PostgresClient) -> dict[str, PersonOutcome]:
    """What each candidacy searched so far came to, by key: ``bip_poi`` read
    without creating anything, for the declarations job, which may run under a
    scratch schema."""
    rows = pg.fetchall("SELECT key, status, reason, docs, checked_at FROM bip_poi")
    return {
        key: PersonOutcome(status, reason, int(docs), checked_at)
        for key, status, reason, docs, checked_at in rows
    }


class PostgresBipPeopleStore(BipPeopleStore):
    def __init__(self, pg: PostgresClient) -> None:
        self.pg = pg
        self.ensure_schema()

    def ensure_schema(self) -> None:
        for statement in _SCHEMA.split(";"):
            if statement.strip():
                self.pg.execute(statement)
        # A bip_poi made before 11-01 still has the list's fields (unit,
        # priority, election_year, first_name, last_name, person). Nothing here
        # reads them, and a row the search adds leaves them at their defaults:
        # unit is given one so that it can. Code from before still reads and
        # writes them, so they are dropped by hand once no runner has it.
        old = self.pg.fetchall(
            """
            SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'bip_poi'
               AND column_name = 'unit' AND column_default IS NULL
            """
        )
        if old:
            self.pg.execute("ALTER TABLE bip_poi ALTER COLUMN unit SET DEFAULT ''")

    def searched(self) -> dict[str, PersonOutcome]:
        return read_searched(self.pg)

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
            INSERT INTO bip_poi (key, status, reason, docs, run_id, checked_at)
            VALUES (%s, %s, %s, %s, %s, now())
            ON CONFLICT (key) DO UPDATE
               SET status = EXCLUDED.status, reason = EXCLUDED.reason,
                   docs = EXCLUDED.docs, run_id = EXCLUDED.run_id, checked_at = now()
             -- A search that finds nothing again does not undo an earlier find.
             WHERE bip_poi.status <> 'found' OR EXCLUDED.status = 'found'
            """,
            (key, status, reason, docs, run_id),
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
                     WHERE bip_poi_docs.status <> 'ok' OR EXCLUDED.status = 'ok'
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


class MemoryBipPeopleStore(BipPeopleStore):
    """The same in memory: for tests, and for a run that should leave nothing behind."""

    def __init__(self) -> None:
        self.outcomes: dict[str, PersonOutcome] = {}
        self.docs: dict[tuple[str, str], PersonDocRow] = {}
        self.units: dict[str, UnitRow] = {}

    def ensure_schema(self) -> None:
        return None

    def searched(self) -> dict[str, PersonOutcome]:
        return dict(self.outcomes)

    def record_unit(self, row: UnitRow, run_id: str) -> None:
        self.units[row.unit] = row

    def record_person(
        self, key: str, status: str, reason: str, docs: int, run_id: str
    ) -> None:
        known = self.outcomes.get(key)
        if known is not None and known.status == "found" and status != "found":
            return
        self.outcomes[key] = PersonOutcome(
            status, reason, docs, datetime.now(timezone.utc)
        )

    def record_person_docs(self, rows: list[PersonDocRow], run_id: str) -> None:
        for row in rows:
            known = self.docs.get((row.key, row.url))
            if known is None or known.status != "ok" or row.status == "ok":
                self.docs[(row.key, row.url)] = row

    def person_docs(self, key: str) -> list[PersonDocRow]:
        return sorted(
            (d for (k, _), d in self.docs.items() if k == key),
            key=lambda d: (-d.score, d.url),
        )
