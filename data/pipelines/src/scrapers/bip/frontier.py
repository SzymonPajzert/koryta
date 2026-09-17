"""SQLite state store for the BIP crawler.

The frontier is the crawler's source of truth: one row per host, URL and stored
document, with `state`/`first_seen`/`last_checked` so reruns are incremental
instead of full crawls. Claim/lock/retry semantics were deliberately left out
(unlike the article crawler's Postgres queue) because BIP crawling is a state
machine, not a work queue.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path

from scrapers.bip.models import DocRow, HostRow, UrlRow

_SCHEMA = """
CREATE TABLE IF NOT EXISTS hosts (
  host TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  teryt TEXT NOT NULL DEFAULT '',
  entry_count INTEGER NOT NULL DEFAULT 1,
  platform TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'new',
  last_crawled TEXT
);
CREATE TABLE IF NOT EXISTS urls (
  url TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'page',
  discovered_from TEXT NOT NULL DEFAULT '',
  depth INTEGER NOT NULL DEFAULT 0,
  section TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  last_status INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_checked TEXT,
  state TEXT NOT NULL DEFAULT 'new'
);
CREATE INDEX IF NOT EXISTS urls_host_idx ON urls(host);
CREATE INDEX IF NOT EXISTS urls_sha_idx ON urls(sha256);
CREATE TABLE IF NOT EXISTS docs (
  sha256 TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  host TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  filename TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  bundle TEXT NOT NULL DEFAULT '',
  chain TEXT NOT NULL DEFAULT '[]',
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS docs_host_idx ON docs(host);
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  started TEXT NOT NULL DEFAULT (datetime('now')),
  finished TEXT,
  hosts INTEGER NOT NULL DEFAULT 0,
  pages INTEGER NOT NULL DEFAULT 0,
  docs_new INTEGER NOT NULL DEFAULT 0,
  docs_unchanged INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0
);
"""


class Frontier:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self._lock = threading.Lock()
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.executescript(_SCHEMA)
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    # -- hosts ---------------------------------------------------------------
    def upsert_hosts(self, hosts: list[HostRow]) -> tuple[int, int]:
        """Insert new hosts, refresh names of known ones. (inserted, updated)."""
        with self._lock:
            return self._upsert_hosts(hosts)

    def _upsert_hosts(self, hosts: list[HostRow]) -> tuple[int, int]:
        inserted = 0
        for host in hosts:
            row = self.conn.execute(
                "SELECT 1 FROM hosts WHERE host = ?", (host.host,)
            ).fetchone()
            if row is None:
                self.conn.execute(
                    "INSERT INTO hosts (host, name, source_url, teryt, entry_count)"
                    " VALUES (?, ?, ?, ?, ?)",
                    (
                        host.host,
                        host.name,
                        host.source_url,
                        host.teryt,
                        host.entry_count,
                    ),
                )
                inserted += 1
            else:
                self.conn.execute(
                    "UPDATE hosts SET name = ?, entry_count = ?, teryt = ?"
                    " WHERE host = ?",
                    (host.name, host.entry_count, host.teryt, host.host),
                )
        self.conn.commit()
        return inserted, len(hosts) - inserted

    def iter_hosts(
        self, limit: int | None = None, offset: int = 0, status: str | None = None
    ) -> list[HostRow]:
        query = "SELECT host, name, source_url, teryt, entry_count, platform, status"
        query += " FROM hosts"
        params: list[object] = []
        if status is not None:
            query += " WHERE status = ?"
            params.append(status)
        query += " ORDER BY rowid LIMIT ? OFFSET ?"
        params.extend([limit if limit is not None else -1, offset])
        rows = self.conn.execute(query, params).fetchall()
        return [
            HostRow(
                host=r[0],
                name=r[1],
                source_url=r[2],
                teryt=r[3],
                entry_count=r[4],
                platform=r[5],
                status=r[6],
            )
            for r in rows
        ]

    def mark_host(self, host: str, status: str, crawled: bool = False) -> None:
        with self._lock:
            self._mark_host(host, status, crawled)

    def _mark_host(self, host: str, status: str, crawled: bool = False) -> None:
        if crawled:
            self.conn.execute(
                "UPDATE hosts SET status = ?,"
                " last_crawled = datetime('now') WHERE host = ?",
                (status, host),
            )
        else:
            self.conn.execute(
                "UPDATE hosts SET status = ? WHERE host = ?", (status, host)
            )
        self.conn.commit()

    # -- urls / docs ---------------------------------------------------------
    def record_urls(self, rows: list[UrlRow]) -> None:
        with self._lock:
            self._record_urls(rows)

    def _record_urls(self, rows: list[UrlRow]) -> None:
        self.conn.executemany(
            "INSERT INTO urls (url, host, kind, discovered_from, depth, section,"
            " content_type, size, sha256, title, last_status, state, last_checked)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))"
            " ON CONFLICT(url) DO UPDATE SET"
            " content_type = excluded.content_type,"
            " size = excluded.size,"
            " sha256 = excluded.sha256,"
            " title = CASE WHEN excluded.title <> '' THEN excluded.title"
            "              ELSE urls.title END,"
            " last_status = excluded.last_status,"
            " state = excluded.state,"
            " last_checked = datetime('now')",
            [
                (
                    r.url,
                    r.host,
                    r.kind,
                    r.discovered_from,
                    r.depth,
                    r.section,
                    r.content_type,
                    r.size,
                    r.sha256,
                    r.title,
                    r.last_status,
                    r.state,
                )
                for r in rows
            ],
        )
        self.conn.commit()

    def record_docs(self, rows: list[DocRow]) -> int:
        """Insert documents, ignoring duplicates by sha256. Returns new count."""
        with self._lock:
            return self._record_docs(rows)

    def _record_docs(self, rows: list[DocRow]) -> int:
        new = 0
        for row in rows:
            exists = self.conn.execute(
                "SELECT 1 FROM docs WHERE sha256 = ?", (row.sha256,)
            ).fetchone()
            if exists is None:
                new += 1
            self.conn.execute(
                "INSERT INTO docs (sha256, url, host, content_type, size,"
                " filename, title, bundle, chain)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
                " ON CONFLICT(sha256) DO UPDATE SET"
                " bundle = excluded.bundle,"
                " url = excluded.url,"
                " last_seen = datetime('now')",
                (
                    row.sha256,
                    row.url,
                    row.host,
                    row.content_type,
                    row.size,
                    row.filename,
                    row.title,
                    row.bundle,
                    json.dumps(row.chain),
                ),
            )
        self.conn.commit()
        return new

    def doc_bundle(self, sha256: str) -> str | None:
        """The bundle a stored document points at, if the document is known."""
        row = self.conn.execute(
            "SELECT bundle FROM docs WHERE sha256 = ?", (sha256,)
        ).fetchone()
        if row is None:
            return None
        return str(row[0])

    def url_count(self) -> int:
        return int(self.conn.execute("SELECT COUNT(*) FROM urls").fetchone()[0])

    def stats(self) -> dict[str, int]:
        host_count = int(
            self.conn.execute("SELECT COUNT(*) FROM hosts").fetchone()[0]
        )
        doc_count = int(self.conn.execute("SELECT COUNT(*) FROM docs").fetchone()[0])
        doc_bytes = int(
            self.conn.execute(
                "SELECT COALESCE(SUM(size), 0) FROM docs"
            ).fetchone()[0]
        )
        return {
            "hosts": host_count,
            "urls": self.url_count(),
            "docs": doc_count,
            "doc_bytes": doc_bytes,
        }
