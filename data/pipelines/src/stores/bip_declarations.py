"""What the declarations job cut and sent, beside the people mode's tables.

The job (`jobs.bip_declarations`) reads the people mode's ``bip_poi``,
``bip_poi_docs``, ``bip_units`` and ``bip_docs``, and keeps three tables of its
own in the same database, created on first use like theirs:

- ``bip_decl_cuts``: one row per file - what the cutter made of it and with
  which version of the cutter, so a new version cuts everything again;
- ``bip_decl_crops``: one row per page that had the date's line - the crops as
  PNG bytes and what was read on it;
- ``bip_decl_sent``: one row per record sent to the site - a hash of what was
  sent and the site's answer, so a run sends only what is new or changed.

The crops are pictures of named people's birth dates, so they stay in this
database on the machine that cut them, and go nowhere but the site's ingest.
"""

from __future__ import annotations

import hashlib
import json

from scrapers.common.pg import PostgresClient
from scrapers.stores import (
    BipDeclarationStore,
    DeclarationCropRow,
    DeclarationCutRow,
    DeclarationFile,
    DeclarationLink,
    PersonRow,
    SentRow,
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS bip_decl_cuts (
  sha256     text PRIMARY KEY,
  version    int  NOT NULL,
  status     text NOT NULL,
  kind       text NOT NULL DEFAULT '',
  pages      int  NOT NULL DEFAULT 0,
  pages_read int  NOT NULL DEFAULT 0,
  seconds    real NOT NULL DEFAULT 0,
  error      text NOT NULL DEFAULT '',
  cut_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bip_decl_crops (
  sha256           text NOT NULL,
  page             int  NOT NULL,
  rotation         int  NOT NULL DEFAULT 0,
  sort             text NOT NULL DEFAULT '',
  birth_date       text NOT NULL DEFAULT '',
  score            real NOT NULL DEFAULT 0,
  name             text NOT NULL DEFAULT '',
  declaration_year int,
  date_png         bytea,
  name_png         bytea,
  date_png_hash    text NOT NULL DEFAULT '',
  name_png_hash    text NOT NULL DEFAULT '',
  notes            text NOT NULL DEFAULT '',
  PRIMARY KEY (sha256, page)
);
CREATE TABLE IF NOT EXISTS bip_decl_sent (
  kind    text NOT NULL,
  id      text NOT NULL,
  digest  text NOT NULL,
  result  text NOT NULL,
  reason  text NOT NULL DEFAULT '',
  run_id  text NOT NULL DEFAULT '',
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, id)
)
"""

_CROP_COLUMNS = (
    "sha256, page, rotation, sort, birth_date, score, name, declaration_year, "
    "date_png_hash, name_png_hash, notes"
)


def png_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest() if data else ""


def with_hashes(crop: DeclarationCropRow) -> DeclarationCropRow:
    """The crop with its pictures' hashes filled in."""
    return DeclarationCropRow(
        **{
            **crop.__dict__,
            "date_png_hash": png_hash(crop.date_png),
            "name_png_hash": png_hash(crop.name_png),
        }
    )


def _crop(
    row: tuple, date_png: bytes = b"", name_png: bytes = b""
) -> DeclarationCropRow:
    sha, page, rotation, sort, born, score, name, year, date_hash, name_hash, notes = (
        row
    )
    return DeclarationCropRow(
        sha,
        int(page),
        int(rotation),
        sort,
        born,
        float(score),
        name,
        year,
        bytes(date_png or b""),
        bytes(name_png or b""),
        date_hash,
        name_hash,
        notes,
    )


class PostgresBipDeclarationStore(BipDeclarationStore):
    def __init__(self, pg: PostgresClient) -> None:
        self.pg = pg
        self.ensure_schema()

    def ensure_schema(self) -> None:
        for statement in _SCHEMA.split(";"):
            if statement.strip():
                self.pg.execute(statement)

    def files_to_cut(self, version: int, limit: int | None) -> list[DeclarationFile]:
        rows = self.pg.fetchall(
            """
            SELECT d.sha256, d.host, d.url, d.bundle, d.filename,
                   NOT bool_or(p.named)
                   OR count(DISTINCT lower(b.first_name || ' ' || b.last_name))
                        FILTER (WHERE p.named) > 1
              FROM bip_poi_docs p
              JOIN bip_docs d ON d.sha256 = p.sha256
              JOIN bip_poi b ON b.key = p.key
              LEFT JOIN bip_decl_cuts c ON c.sha256 = p.sha256
             WHERE p.status = 'ok' AND p.sha256 <> ''
               AND (c.sha256 IS NULL OR c.version < %s)
             GROUP BY d.sha256, d.host, d.url, d.bundle, d.filename
             ORDER BY bool_or(jsonb_array_length(b.person -> 'koryta_ids') > 0) DESC,
                      min(b.priority), d.sha256
             LIMIT %s
            """,
            (version, limit),
        )
        return [DeclarationFile(*row) for row in rows]

    def record_cut(
        self, cut: DeclarationCutRow, crops: list[DeclarationCropRow]
    ) -> None:
        with self.pg.transaction() as cur:
            cur.execute(
                """
                INSERT INTO bip_decl_cuts
                    (sha256, version, status, kind, pages, pages_read, seconds, error)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (sha256) DO UPDATE
                   SET version = EXCLUDED.version, status = EXCLUDED.status,
                       kind = EXCLUDED.kind, pages = EXCLUDED.pages,
                       pages_read = EXCLUDED.pages_read, seconds = EXCLUDED.seconds,
                       error = EXCLUDED.error, cut_at = now()
                """,
                (
                    cut.sha256,
                    cut.version,
                    cut.status,
                    cut.kind,
                    cut.pages,
                    cut.pages_read,
                    cut.seconds,
                    cut.error,
                ),
            )
            cur.execute("DELETE FROM bip_decl_crops WHERE sha256 = %s", (cut.sha256,))
            for crop in map(with_hashes, crops):
                cur.execute(
                    f"""
                    INSERT INTO bip_decl_crops ({_CROP_COLUMNS}, date_png, name_png)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        crop.sha256,
                        crop.page,
                        crop.rotation,
                        crop.sort,
                        crop.birth_date,
                        crop.score,
                        crop.name,
                        crop.declaration_year,
                        crop.date_png_hash,
                        crop.name_png_hash,
                        crop.notes,
                        crop.date_png or None,
                        crop.name_png or None,
                    ),
                )

    def candidacies(self) -> list[PersonRow]:
        rows = self.pg.fetchall(
            """
            SELECT key, unit, priority, election_year, first_name, last_name,
                   person, status, reason, docs
              FROM bip_poi ORDER BY key
            """
        )
        people = []
        for (
            key,
            unit,
            priority,
            year,
            first,
            last,
            person,
            status,
            reason,
            docs,
        ) in rows:
            if isinstance(person, str):
                person = json.loads(person)
            people.append(
                PersonRow(
                    key,
                    unit,
                    priority,
                    year,
                    first,
                    last,
                    person or {},
                    status,
                    reason,
                    docs,
                )
            )
        return people

    def links(self) -> list[DeclarationLink]:
        rows = self.pg.fetchall(
            """
            SELECT key, sha256, url, page_url, anchor, context, named
              FROM bip_poi_docs WHERE status = 'ok' AND sha256 <> ''
             ORDER BY key, score DESC, url
            """
        )
        return [DeclarationLink(*row) for row in rows]

    def unit_roots(self) -> dict[str, list[str]]:
        rows = self.pg.fetchall("SELECT unit, roots FROM bip_units")
        roots = {}
        for unit, value in rows:
            if isinstance(value, str):
                value = json.loads(value)
            roots[unit] = [str(url) for url in value or []]
        return roots

    def cuts(self) -> dict[str, DeclarationCutRow]:
        rows = self.pg.fetchall(
            """
            SELECT sha256, version, status, kind, pages, pages_read, seconds, error
              FROM bip_decl_cuts
            """
        )
        return {row[0]: DeclarationCutRow(*row) for row in rows}

    def crops(self, with_images: bool = False) -> list[DeclarationCropRow]:
        images = ", date_png, name_png" if with_images else ""
        rows = self.pg.fetchall(
            f"SELECT {_CROP_COLUMNS}{images} FROM bip_decl_crops ORDER BY sha256, page"
        )
        if with_images:
            return [_crop(row[:11], row[11], row[12]) for row in rows]
        return [_crop(row) for row in rows]

    def crop_images(
        self, ids: list[tuple[str, int]]
    ) -> dict[tuple[str, int], tuple[bytes, bytes]]:
        if not ids:
            return {}
        rows = self.pg.fetchall(
            """
            SELECT c.sha256, c.page, c.date_png, c.name_png
              FROM bip_decl_crops c
              JOIN unnest(%s::text[], %s::int[]) AS wanted(sha256, page)
                ON wanted.sha256 = c.sha256 AND wanted.page = c.page
            """,
            ([sha for sha, _ in ids], [page for _, page in ids]),
        )
        return {
            (sha, int(page)): (bytes(date or b""), bytes(name or b""))
            for sha, page, date, name in rows
        }

    def sent(self, kind: str) -> dict[str, SentRow]:
        rows = self.pg.fetchall(
            "SELECT kind, id, digest, result, reason FROM bip_decl_sent "
            "WHERE kind = %s",
            (kind,),
        )
        return {row[1]: SentRow(*row) for row in rows}

    def record_sent(self, rows: list[SentRow], run_id: str) -> None:
        if not rows:
            return
        with self.pg.transaction() as cur:
            for row in rows:
                cur.execute(
                    """
                    INSERT INTO bip_decl_sent (kind, id, digest, result, reason, run_id)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (kind, id) DO UPDATE
                       SET digest = EXCLUDED.digest, result = EXCLUDED.result,
                           reason = EXCLUDED.reason, run_id = EXCLUDED.run_id,
                           sent_at = now()
                    """,
                    (row.kind, row.id, row.digest, row.result, row.reason, run_id),
                )


class MemoryBipDeclarationStore(BipDeclarationStore):
    """The same in memory, with the people mode's rows handed in: for tests."""

    def __init__(
        self,
        people: list[PersonRow] | None = None,
        files: list[DeclarationFile] | None = None,
        links: list[DeclarationLink] | None = None,
        roots: dict[str, list[str]] | None = None,
    ) -> None:
        self.people = list(people or [])
        self.files = {f.sha256: f for f in files or []}
        self.link_rows = list(links or [])
        self.roots = dict(roots or {})
        self.cut_rows: dict[str, DeclarationCutRow] = {}
        self.crop_rows: dict[tuple[str, int], DeclarationCropRow] = {}
        self.sent_rows: dict[tuple[str, str], SentRow] = {}

    def ensure_schema(self) -> None:
        return None

    def files_to_cut(self, version: int, limit: int | None) -> list[DeclarationFile]:
        on_site = {p.key for p in self.people if p.person.get("koryta_ids")}
        priority = {p.key: p.priority for p in self.people}
        linked: dict[str, list[DeclarationLink]] = {}
        for link in self.link_rows:
            linked.setdefault(link.sha256, []).append(link)

        def order(sha: str) -> tuple[bool, int, str]:
            keys = [link.key for link in linked[sha]]
            return (
                not any(k in on_site for k in keys),
                min(priority.get(k, 9) for k in keys),
                sha,
            )

        due = [
            sha
            for sha in linked
            if sha in self.files
            and (sha not in self.cut_rows or self.cut_rows[sha].version < version)
        ]
        return [self.files[sha] for sha in sorted(due, key=order)][:limit]

    def record_cut(
        self, cut: DeclarationCutRow, crops: list[DeclarationCropRow]
    ) -> None:
        self.cut_rows[cut.sha256] = cut
        for key in [k for k in self.crop_rows if k[0] == cut.sha256]:
            del self.crop_rows[key]
        for crop in map(with_hashes, crops):
            self.crop_rows[(crop.sha256, crop.page)] = crop

    def candidacies(self) -> list[PersonRow]:
        return sorted(self.people, key=lambda p: p.key)

    def links(self) -> list[DeclarationLink]:
        return list(self.link_rows)

    def unit_roots(self) -> dict[str, list[str]]:
        return dict(self.roots)

    def cuts(self) -> dict[str, DeclarationCutRow]:
        return dict(self.cut_rows)

    def crops(self, with_images: bool = False) -> list[DeclarationCropRow]:
        rows = [self.crop_rows[k] for k in sorted(self.crop_rows)]
        if with_images:
            return rows
        return [
            DeclarationCropRow(**{**row.__dict__, "date_png": b"", "name_png": b""})
            for row in rows
        ]

    def crop_images(
        self, ids: list[tuple[str, int]]
    ) -> dict[tuple[str, int], tuple[bytes, bytes]]:
        return {
            key: (self.crop_rows[key].date_png, self.crop_rows[key].name_png)
            for key in ids
            if key in self.crop_rows
        }

    def sent(self, kind: str) -> dict[str, SentRow]:
        return {row.id: row for (k, _), row in self.sent_rows.items() if k == kind}

    def record_sent(self, rows: list[SentRow], run_id: str) -> None:
        for row in rows:
            self.sent_rows[(row.kind, row.id)] = row
