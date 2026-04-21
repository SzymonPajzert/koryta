"""PostgreSQL-backed crawl queue for the article crawler.

All direct psycopg access is encapsulated here.
"""

import logging
import os
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Callable
from zoneinfo import ZoneInfo

import psycopg
from uuid_extensions import uuid7str  # type: ignore

from entities.util import NormalizedParse
from scrapers.stores import (
    BlockedDomain,
    CrawlQueue,
    CrawlQueueItem,
    DoneUrl,
    NewUrl,
)

logger = logging.getLogger(__name__)

warsaw_tz = ZoneInfo("Europe/Warsaw")


class PostgresClient:
    def __init__(
        self,
        host: str,
        database: str,
        user: str,
        password: str | None,
        port: int = 5432,
    ):
        self.host = host
        self.database = database
        self.user = user
        self.password = password
        self.port = port

    def connect(self):
        return psycopg.connect(
            host=self.host,
            port=self.port,
            dbname=self.database,
            user=self.user,
            password=self.password,
        )

    @classmethod
    def from_env(cls) -> "PostgresClient":
        return cls(
            host=os.getenv("POSTGRES_HOST", "localhost"),
            database=os.getenv("POSTGRES_DB", "crawler_db"),
            user=os.getenv("POSTGRES_USER", "crawler_user"),
            password=os.getenv("POSTGRES_PASSWORD", "crawler_password"),
            port=int(os.getenv("POSTGRES_PORT", "5432")),
        )

    @contextmanager
    def transaction(self):
        conn = self.connect()
        try:
            with conn:
                with conn.cursor() as transaction:
                    yield transaction
        finally:
            conn.close()

    def execute(self, sql: str, params=None) -> None:
        with self.transaction() as transaction:
            transaction.execute(sql, params)

    def executemany(self, sql: str, rows: list[tuple]) -> None:
        if not rows:
            return
        with self.transaction() as transaction:
            transaction.executemany(sql, rows)

    def fetchone(self, sql: str, params=None):
        with self.transaction() as transaction:
            transaction.execute(sql, params)
            return transaction.fetchone()

    def fetchall(self, sql: str, params=None) -> list[tuple]:
        with self.transaction() as transaction:
            transaction.execute(sql, params)
            return transaction.fetchall()


class PostgresCrawlQueue(CrawlQueue):
    def __init__(self, pg: PostgresClient):
        self.pg = pg
        self._init_tables()

    def _init_tables(self, reset: bool = False):
        """Ensure sitemap tables exist and optionally reset.

        Args:
            reset: Drop and recreate the table.
        """
        logger.info("Initializing database...")
        with self.pg.transaction() as transaction:
            if reset:
                logger.info("Resetting database by dropping website_index table.")
                transaction.execute("DROP TABLE IF EXISTS website_index;")
                transaction.execute("DROP TABLE IF EXISTS blocked_domains;")

            transaction.execute(
                """
                CREATE TABLE IF NOT EXISTS website_index (
                    id TEXT PRIMARY KEY,
                    url TEXT UNIQUE,
                    priority INTEGER,
                    done BOOLEAN,
                    errors TEXT[],
                    num_retries INTEGER,
                    date_added TIMESTAMP WITH TIME ZONE,
                    date_finished TIMESTAMP WITH TIME ZONE,
                    locked_by_worker_id TEXT,
                    locked_at TIMESTAMP WITH TIME ZONE,
                    storage_path TEXT,
                    mined_from_url TEXT
                );

                CREATE TABLE IF NOT EXISTS blocked_domains (
                    domain TEXT PRIMARY KEY,
                    reason TEXT
                );
                """
            )

        logger.info("Database initialization complete.")

    def reset(self) -> None:
        """Drop and recreate queue tables so the queue is empty."""
        self._init_tables(reset=True)

    def add_blocked_domains(self, rows: list[BlockedDomain]) -> None:
        """Create blocked_domains table and upsert rows.

        Args:
            rows: List of blocked domains to upsert.
        """
        logger.info("Loading blocked domains...")
        with self.pg.transaction() as transaction:
            transaction.execute(
                """
                CREATE TABLE IF NOT EXISTS blocked_domains (
                    domain TEXT PRIMARY KEY,
                    reason TEXT
                );
                """
            )
            if rows:
                normalized = [
                    (self._normalize_url(row.domain), row.reason)
                    for row in rows
                ]
                transaction.executemany(
                    "INSERT INTO blocked_domains (domain, reason) VALUES (%s, %s) "
                    "ON CONFLICT(domain) DO UPDATE SET reason = EXCLUDED.reason",
                    normalized,
                )
                logger.info("Loaded %d blocked domains.", len(rows))
            else:
                logger.info("No blocked domains to load.")

    def get(
        self, worker_id: str, max_retries: int = 3, timeout_seconds: float = 60
    ) -> CrawlQueueItem | None:
        """Atomically select and lock a URL for crawling.

        Returns CrawlQueueItem or None if nothing available.
        """
        now = datetime.now(warsaw_tz)
        with self.pg.transaction() as transaction:
            transaction.execute(
                r"""
                WITH candidate AS (
                    SELECT wi.id
                    FROM website_index wi
                    WHERE wi.done = FALSE
                      AND wi.num_retries < %s
                      AND (wi.locked_by_worker_id IS NULL OR wi.locked_at <= %s)
                      AND NOT EXISTS (
                          SELECT 1 FROM blocked_domains bd
                          WHERE wi.url = bd.domain
                             OR wi.url LIKE bd.domain || '/%%'
                      )
                    ORDER BY wi.priority ASC, RANDOM()
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                )
                UPDATE website_index wi
                SET locked_by_worker_id = %s, locked_at = %s
                FROM candidate
                WHERE wi.id = candidate.id
                RETURNING wi.id, wi.url;
                """,
                (
                    max_retries,
                    now - timedelta(seconds=timeout_seconds),
                    worker_id,
                    now,
                ),
            )
            row = transaction.fetchone()
            if row is None:
                return None
            return CrawlQueueItem(row[0], row[1])

    def mark_done(self, uid: str, storage_path: str | None) -> None:
        """Mark a URL as successfully crawled."""
        self.pg.execute(
            "UPDATE website_index SET done = TRUE, date_finished = %s, "
            "locked_by_worker_id = NULL, locked_at = NULL, "
            "storage_path = %s WHERE id = %s",
            [datetime.now(warsaw_tz), storage_path, uid],
        )

    def mark_error(self, uid: str, error: str) -> None:
        """Record an error and increment retries."""
        self.pg.execute(
            "UPDATE website_index SET num_retries = COALESCE(num_retries, 0) + 1, "
            "errors = array_append(COALESCE(errors, '{}'::text[]), %s), "
            "locked_by_worker_id = NULL, locked_at = NULL WHERE id = %s",
            [error, uid],
        )

    def release(self, uid: str) -> None:
        """Release a lock without marking done or error."""
        self.pg.execute(
            "UPDATE website_index SET locked_by_worker_id = NULL, "
            "locked_at = NULL WHERE id = %s",
            [uid],
        )

    def put(self, urls: list[NewUrl]) -> None:
        """Insert/enqueue URLs (idempotent)."""
        if not urls:
            return
        now = datetime.now(warsaw_tz)
        rows: list[tuple[str, int, datetime]] = []
        for new_url in urls:
            url = new_url.url
            priority = int(new_url.priority)
            normalized = self._normalize_url(url)
            rows.append((normalized, priority, now))
        self._insert_urls(rows)

    def _insert_urls(
        self,
        rows: list[tuple[str, int, datetime]],
        transaction=None,
    ) -> None:
        """Batch insert discovered URLs.

        Each row: (url, priority, date_added)
        """
        if not rows:
            return
        prepared: list[
            tuple[str, str, int, bool, list[str], int, datetime, None, None]
        ] = [
            (
                uuid7str(),
                self._normalize_url(url),
                priority,
                False,
                [],
                0,
                date_added,
                None,
                None,
            )
            for url, priority, date_added in rows
        ]
        if transaction is None:
            self.pg.executemany(
                "INSERT INTO website_index ("
                "id, url, priority, done, errors, num_retries, "
                "date_added, date_finished, mined_from_url) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) "
                "ON CONFLICT(url) DO NOTHING",
                prepared,
            )
            return
        transaction.executemany(
            "INSERT INTO website_index ("
            "id, url, priority, done, errors, num_retries, "
            "date_added, date_finished, mined_from_url) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) "
            "ON CONFLICT(url) DO NOTHING",
            prepared,
        )

    def reprioritize(self, priority_fn: Callable[[str], int], batch_size: int = 5000):
        """Recalculate priority for all pending URLs using priority function."""
        rows = self.pg.fetchall("SELECT id, url FROM website_index WHERE done = FALSE;")
        logger.info("Reprioritizing %d pending URLs...", len(rows))
        updated = 0
        batch: list[tuple[int, str]] = []
        for uid, url in rows:
            priority = priority_fn(url)
            if not 0 <= priority <= 100:
                raise ValueError(f"Priority must be 0-100, got {priority}")
            batch.append((priority, uid))
            if len(batch) >= batch_size:
                self.pg.executemany(
                    "UPDATE website_index SET priority = %s WHERE id = %s",
                    batch,
                )
                updated += len(batch)
                batch = []
        if batch:
            self.pg.executemany(
                "UPDATE website_index SET priority = %s WHERE id = %s",
                batch,
            )
            updated += len(batch)
        logger.info("Reprioritized %d URLs.", updated)

    def get_done_urls(self, limit: int) -> list[DoneUrl]:
        """Fetch crawled pages that have a storage_path, for parsing."""
        rows = self.pg.fetchall(
            "SELECT id, url, storage_path FROM website_index "
            "WHERE done = TRUE AND storage_path IS NOT NULL "
            "ORDER BY date_finished DESC LIMIT %s;",
            (limit,),
        )
        return [DoneUrl(row[0], row[1], row[2]) for row in rows]

    @classmethod
    def _normalize_url(cls, value: str) -> str:
        value = value.strip()
        parsed = NormalizedParse.parse(value)
        return f"{parsed.hostname_normalized}{parsed.path}"
