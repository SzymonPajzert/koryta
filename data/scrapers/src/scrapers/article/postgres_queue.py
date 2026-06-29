"""PostgreSQL-backed crawl queue for the article crawler.

All direct psycopg access is encapsulated here.
"""

import logging
import os
import time
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Callable
from uuid import uuid4
from zoneinfo import ZoneInfo

import psycopg
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool, PoolTimeout

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
        *,
        max_size: int = 4,
    ):
        try:
            self._pool = ConnectionPool(
                kwargs={
                    "host": host,
                    "port": port,
                    "dbname": database,
                    "user": user,
                    "password": password,
                },
                timeout=5,
                min_size=1,
                max_size=max_size,
                open=True,
            )
        except PoolTimeout as e:
            raise ConnectionError("Start postgres server with docker compose up") from e

    @contextmanager
    def transaction(self):
        with self._pool.connection() as conn:
            with conn.cursor() as cursor:
                yield cursor

    def execute(self, sql: str, params=None) -> None:
        with self.transaction() as cursor:
            cursor.execute(sql, params)

    def executemany(self, sql: str, rows: list[tuple]) -> None:
        if not rows:
            return
        with self.transaction() as cursor:
            cursor.executemany(sql, rows)

    def fetchone(self, sql: str, params=None):
        with self.transaction() as cursor:
            cursor.execute(sql, params)
            return cursor.fetchone()

    def fetchall(self, sql: str, params=None) -> list[tuple]:
        with self.transaction() as cursor:
            cursor.execute(sql, params)
            return cursor.fetchall()

    def close(self) -> None:
        self._pool.close()

    @classmethod
    def from_env(cls, max_size: int = 4) -> "PostgresClient":
        return cls(
            host=os.getenv("POSTGRES_HOST", "localhost"),
            database=os.getenv("POSTGRES_DB", "crawler_db"),
            user=os.getenv("POSTGRES_USER", "crawler_user"),
            password=os.getenv("POSTGRES_PASSWORD", "crawler_password"),
            port=int(os.getenv("POSTGRES_PORT", "5432")),
            max_size=max_size,
        )


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
                    mined_from_url TEXT,
                    metadata JSONB DEFAULT '{}'::jsonb
                );
                """
            )
            transaction.execute(
                """
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
                    (self._normalize_url(row.domain), row.reason) for row in rows
                ]
                transaction.executemany(
                    "INSERT INTO blocked_domains (domain, reason) VALUES (%s, %s) "
                    "ON CONFLICT(domain) DO UPDATE SET reason = EXCLUDED.reason",
                    normalized,
                )
                logger.info("Loaded %d blocked domains.", len(rows))
            else:
                logger.info("No blocked domains to load.")

    def get_blocked_domains(self) -> set[str]:
        """Return normalized blocked domain hostnames for in-memory filtering."""
        rows = self.pg.fetchall("SELECT domain FROM blocked_domains;")
        return {row[0] for row in rows}

    def get(
        self, worker_id: str, max_retries: int = 3, timeout_seconds: float = 60
    ) -> CrawlQueueItem | None:
        """Atomically select and lock a URL for crawling.

        Returns CrawlQueueItem or None if nothing available.
        """
        now = datetime.now(warsaw_tz)
        with self.pg.transaction() as transaction:
            transaction.execute(
                """
                WITH candidate AS (
                    SELECT wi.id
                    FROM website_index wi
                    WHERE wi.done = FALSE
                      AND wi.num_retries < %s
                      AND (wi.locked_by_worker_id IS NULL OR wi.locked_at <= %s)
                    ORDER BY wi.priority ASC, wi.id ASC
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                )
                UPDATE website_index wi
                SET locked_by_worker_id = %s, locked_at = %s
                FROM candidate
                WHERE wi.id = candidate.id
                RETURNING wi.id, wi.url, wi.priority;
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
            return CrawlQueueItem(row[0], row[1], row[2])

    def get_batch(
        self,
        worker_id: str,
        batch_size: int = 16,
        max_retries: int = 3,
        timeout_seconds: float = 60,
    ) -> list[CrawlQueueItem]:
        """Atomically claim up to batch_size URLs in a single query."""
        now = datetime.now(warsaw_tz)
        with self.pg.transaction() as transaction:
            transaction.execute(
                """
                WITH candidates AS (
                    SELECT wi.id
                    FROM website_index wi
                    WHERE wi.done = FALSE
                      AND wi.num_retries < %s
                      AND (wi.locked_by_worker_id IS NULL OR wi.locked_at <= %s)
                    ORDER BY wi.priority ASC, wi.id ASC
                    LIMIT %s
                    FOR UPDATE SKIP LOCKED
                )
                UPDATE website_index wi
                SET locked_by_worker_id = %s, locked_at = %s
                FROM candidates
                WHERE wi.id = candidates.id
                RETURNING wi.id, wi.url, wi.priority;
                """,
                (
                    max_retries,
                    now - timedelta(seconds=timeout_seconds),
                    batch_size,
                    worker_id,
                    now,
                ),
            )
            rows = transaction.fetchall()
        return [CrawlQueueItem(r[0], r[1], r[2]) for r in rows]

    def mark_done(
        self,
        uid: str,
        storage_path: str | None,
        metadata: dict[str, object] | None = None,
    ) -> None:
        """Mark a URL as successfully crawled."""
        if metadata is None:
            metadata = {}
        self.pg.execute(
            "UPDATE website_index SET done = TRUE, date_finished = %s, "
            "locked_by_worker_id = NULL, locked_at = NULL, "
            "storage_path = %s, metadata = %s WHERE id = %s",
            [datetime.now(warsaw_tz), storage_path, Jsonb(metadata), uid],
        )

    def mark_error(self, uid: str, error: str) -> None:
        """Record an error and increment retries."""
        self.pg.execute(
            "UPDATE website_index SET num_retries = COALESCE(num_retries, 0) + 1, "
            "errors = array_append(COALESCE(errors, '{}'::text[]), %s), "
            "locked_by_worker_id = NULL, locked_at = NULL WHERE id = %s",
            [error, uid],
        )

    def mark_done_batch(
        self,
        items: list[tuple[str, str | None, dict]],
    ) -> None:
        """Batch-mark URLs done in a single executemany call."""
        if not items:
            return
        now = datetime.now(warsaw_tz)
        self.pg.executemany(
            "UPDATE website_index SET done = TRUE, date_finished = %s, "
            "locked_by_worker_id = NULL, locked_at = NULL, "
            "storage_path = %s, metadata = %s WHERE id = %s",
            [
                (now, storage_path, Jsonb(metadata), uid)
                for uid, storage_path, metadata in items
            ],
        )

    def mark_error_batch(self, items: list[tuple[str, str]]) -> None:
        """Batch-record errors in a single executemany call."""
        if not items:
            return
        self.pg.executemany(
            "UPDATE website_index SET num_retries = COALESCE(num_retries, 0) + 1, "
            "errors = array_append(COALESCE(errors, '{}'::text[]), %s), "
            "locked_by_worker_id = NULL, locked_at = NULL WHERE id = %s",
            [(error, uid) for uid, error in items],
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

    def _insert_urls(self, rows: list[tuple[str, int, datetime]]) -> None:
        """Batch insert discovered URLs.

        Each row: (url, priority, date_added)
        """
        if not rows:
            return
        prepared: list[
            tuple[str, str, int, bool, list[str], int, datetime, None, None]
        ] = [
            (
                str(uuid4()),
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
        sql = (
            "INSERT INTO website_index ("
            "id, url, priority, done, errors, num_retries, "
            "date_added, date_finished, mined_from_url) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) "
            "ON CONFLICT(url) DO NOTHING"
        )
        max_attempts = 5
        for attempt in range(1, max_attempts + 1):
            try:
                self.pg.executemany(sql, prepared)
                return
            except psycopg.errors.DeadlockDetected as exc:
                if attempt == max_attempts:
                    logger.error(
                        "Deadlock detected while inserting URLs (attempt %d/%d). "
                        "Giving up.",
                        attempt,
                        max_attempts,
                    )
                    raise
                backoff = 0.1 * 2**attempt
                logger.warning(
                    "Deadlock detected while inserting URLs (attempt %d/%d). "
                    "Retrying after %.2fs. Error: %s",
                    attempt,
                    max_attempts,
                    backoff,
                    exc,
                )
                time.sleep(backoff)

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

    def get_done_urls(self, limit: int | None = None) -> list[DoneUrl]:
        """Fetch crawled pages that have a storage_path, for parsing."""
        _base = (
            "SELECT id, url, storage_path, metadata->>'media_type'"
            " FROM website_index"
            " WHERE done = TRUE AND storage_path IS NOT NULL"
            " ORDER BY date_finished DESC"
        )
        if limit is None:
            rows = self.pg.fetchall(_base + ";")
        else:
            rows = self.pg.fetchall(_base + " LIMIT %s;", (limit,))
        return [DoneUrl(row[0], row[1], row[2], row[3]) for row in rows]

    def bump_small_domains(
        self, target_count: int, seed_domains: list[str]
    ) -> tuple[int, Counter]:
        """Set priority=0 for pending URLs on under-crawled seed domains.

        For each domain in seed_domains with fewer than target_count done URLs,
        promotes enough pending URLs to priority 0 so that
        done + promoted = target_count.
        Selection is random via UUID4 id ordering.

        Returns (total bumped, per-domain counter).
        """
        rows = self.pg.fetchall(
            """
            WITH seed AS (
                SELECT unnest(%s::text[]) AS domain
            ),
            domain_stats AS (
                SELECT
                    split_part(url, '/', 1) AS domain,
                    COUNT(*) FILTER (WHERE done = TRUE) AS done_count
                FROM website_index
                WHERE split_part(url, '/', 1) = ANY(%s::text[])
                GROUP BY split_part(url, '/', 1)
            ),
            ranked_pending AS (
                SELECT
                    wi.id,
                    split_part(wi.url, '/', 1) AS domain,
                    ROW_NUMBER() OVER (
                        PARTITION BY split_part(wi.url, '/', 1)
                        ORDER BY wi.id
                    ) AS rn
                FROM website_index wi
                WHERE wi.done = FALSE
                  AND wi.priority != 0
                  AND split_part(wi.url, '/', 1) = ANY(%s::text[])
            ),
            to_bump AS (
                SELECT rp.id
                FROM ranked_pending rp
                LEFT JOIN domain_stats ds ON rp.domain = ds.domain
                WHERE COALESCE(ds.done_count, 0) < %s
                  AND rp.rn <= (%s - COALESCE(ds.done_count, 0))
            )
            UPDATE website_index
            SET priority = 0
            FROM to_bump
            WHERE website_index.id = to_bump.id
            RETURNING split_part(website_index.url, '/', 1) AS domain
            """,
            (seed_domains, seed_domains, seed_domains, target_count, target_count),
        )
        return len(rows), Counter(row[0] for row in rows)

    @classmethod
    def _normalize_url(cls, value: str) -> str:
        value = value.strip()
        parsed = NormalizedParse.parse(value)
        return f"{parsed.hostname_normalized}{parsed.path}"

    @classmethod
    def from_env(cls) -> "PostgresCrawlQueue":
        client = PostgresClient.from_env()
        return cls(client)
