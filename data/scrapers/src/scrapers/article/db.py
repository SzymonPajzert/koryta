"""PostgreSQL database abstraction for the article crawler.

All direct psycopg2 access is encapsulated here. The constructor takes
explicit connection parameters (no os.getenv), and data-loading methods
accept pre-parsed data (no csv/file I/O) so the module stays import-linter
compliant.
"""

import logging
from collections import Counter
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import psycopg2
from uuid_extensions import uuid7str

logger = logging.getLogger(__name__)

warsaw_tz = ZoneInfo("Europe/Warsaw")


class CrawlerDB:
    def __init__(self, host: str, database: str, user: str, password: str):
        self.host = host
        self.database = database
        self.user = user
        self.password = password

    def _connect(self):
        return psycopg2.connect(
            host=self.host,
            database=self.database,
            user=self.user,
            password=self.password,
        )

    def init_tables(self, urls: list[str], reset: bool = False):
        """Create the website_index table and insert seed URLs.

        Args:
            urls: Pre-parsed list of URL strings (file reading done by caller).
            reset: Drop and recreate the table.
        """
        logger.info("Initializing database...")
        with self._connect() as conn:
            with conn.cursor() as cur:
                if reset:
                    logger.info("Resetting database by dropping website_index table.")
                    cur.execute("DROP TABLE IF EXISTS website_index;")

                cur.execute(
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

                    DO $$ BEGIN
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='website_index' AND column_name='locked_by_worker_id') THEN
                            ALTER TABLE website_index ADD COLUMN locked_by_worker_id TEXT;
                        END IF;
                    END $$;

                    DO $$ BEGIN
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='website_index' AND column_name='locked_at') THEN
                            ALTER TABLE website_index ADD COLUMN locked_at TIMESTAMP WITH TIME ZONE;
                        END IF;
                    END $$;

                    DO $$ BEGIN
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='website_index' AND column_name='storage_path') THEN
                            ALTER TABLE website_index ADD COLUMN storage_path TEXT;
                        END IF;
                    END $$;

                    DO $$ BEGIN
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='website_index' AND column_name='mined_from_url') THEN
                            ALTER TABLE website_index ADD COLUMN mined_from_url TEXT;
                        END IF;
                    END $$;
                    """
                )
                conn.commit()

                if urls:
                    now = datetime.now(warsaw_tz)
                    rows = [
                        (uuid7str(), url, 0, False, [], 0, now, None, None)
                        for url in urls
                    ]
                    cur.executemany(
                        "INSERT INTO website_index (id, url, priority, done, errors, num_retries, date_added, date_finished, mined_from_url) "
                        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT(url) DO NOTHING",
                        rows,
                    )
                    conn.commit()
                    logger.info("Added or ignored %d URLs.", len(urls))

        logger.info("Database initialization complete.")

    def load_blocked_domains(self, rows: list[tuple[str, str]]):
        """Create blocked_domains table and upsert rows.

        Args:
            rows: List of (domain, reason) tuples (CSV parsing done by caller).
        """
        logger.info("Loading blocked domains...")
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS blocked_domains (
                        domain TEXT PRIMARY KEY,
                        reason TEXT
                    );
                    """
                )
                conn.commit()

                if rows:
                    cur.executemany(
                        "INSERT INTO blocked_domains (domain, reason) VALUES (%s, %s) "
                        "ON CONFLICT(domain) DO UPDATE SET reason = EXCLUDED.reason",
                        rows,
                    )
                    conn.commit()
                    logger.info("Loaded %d blocked domains.", len(rows))
                else:
                    logger.info("No blocked domains to load.")

    def get_and_lock_url(self, worker_id: str, max_retries: int) -> tuple | None:
        """Atomically select and lock a URL for crawling.

        Returns (id, url, priority, num_retries) or None if nothing available.
        """
        timeout_seconds = 60
        now = datetime.now(warsaw_tz)
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    r"""
                    UPDATE website_index
                    SET locked_by_worker_id = %s, locked_at = %s
                    WHERE id = (
                        SELECT wi.id
                        FROM website_index wi
                        WHERE wi.done = FALSE
                          AND wi.num_retries < %s
                          AND (wi.locked_by_worker_id IS NULL OR wi.locked_at < %s)
                          AND NOT EXISTS (
                              SELECT 1 FROM blocked_domains bd
                              WHERE wi.url ~ ('https?://(www\.)?' || regexp_replace(bd.domain, '\.', '\\.', 'g') || '(/|$)')
                          )
                        ORDER BY wi.priority ASC, RANDOM()
                        LIMIT 1
                        FOR UPDATE SKIP LOCKED
                    )
                    RETURNING id, url, priority, num_retries;
                    """,
                    (worker_id, now, max_retries, now - timedelta(seconds=timeout_seconds)),
                )
                row = cur.fetchone()
                conn.commit()
                return row

    def mark_done(self, uid: str, storage_path: str | None):
        """Mark a URL as successfully crawled."""
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE website_index SET done = TRUE, date_finished = %s, "
                    "locked_by_worker_id = NULL, locked_at = NULL, storage_path = %s WHERE id = %s",
                    [datetime.now(warsaw_tz), storage_path, uid],
                )
                conn.commit()

    def propagate_error(self, uid: str, error: str):
        """Record an error and increment retries."""
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE website_index SET num_retries = num_retries + 1, "
                    "errors = array_append(errors, %s), "
                    "locked_by_worker_id = NULL, locked_at = NULL WHERE id = %s",
                    [error, uid],
                )
                conn.commit()

    def release_lock(self, uid: str):
        """Release a lock without marking done or error."""
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE website_index SET locked_by_worker_id = NULL, locked_at = NULL WHERE id = %s",
                    [uid],
                )
                conn.commit()

    def insert_urls(self, rows: list[tuple]):
        """Batch insert discovered URLs.

        Each row: (id, url, priority, done, errors, num_retries, date_added, date_finished, mined_from_url)
        """
        if not rows:
            return
        with self._connect() as conn:
            with conn.cursor() as cur:
                processed = []
                for row in rows:
                    r = list(row)
                    if r[4] is None:
                        r[4] = []
                    processed.append(tuple(r))

                cur.executemany(
                    "INSERT INTO website_index (id, url, priority, done, errors, num_retries, date_added, date_finished, mined_from_url) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT(url) DO NOTHING",
                    processed,
                )
                conn.commit()

    def get_pages_to_parse(self, limit: int) -> list[tuple]:
        """Fetch crawled pages that have a storage_path, for parsing."""
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, url, storage_path FROM website_index "
                    "WHERE done = TRUE AND storage_path IS NOT NULL "
                    "ORDER BY date_finished DESC LIMIT %s;",
                    (limit,),
                )
                return cur.fetchall()

    def get_stats(self) -> dict:
        """Return crawler statistics as a dict (printing happens in the entrypoint)."""
        stats: dict = {}
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM website_index;")
                stats["total_urls"] = cur.fetchone()[0]

                cur.execute("SELECT COUNT(*) FROM website_index WHERE done = TRUE;")
                stats["finished_urls"] = cur.fetchone()[0]

                cur.execute("SELECT COUNT(*) FROM website_index WHERE done = FALSE;")
                stats["pending_urls"] = cur.fetchone()[0]

                cur.execute("SELECT COUNT(*) FROM website_index WHERE array_length(errors, 1) > 0;")
                stats["urls_with_errors"] = cur.fetchone()[0]

                cur.execute("SELECT SUM(array_length(errors, 1)) FROM website_index WHERE array_length(errors, 1) > 0;")
                stats["total_errors"] = cur.fetchone()[0] or 0

                cur.execute("SELECT unnest(errors) AS error_msg FROM website_index WHERE array_length(errors, 1) > 0;")
                all_errors = [row[0] for row in cur.fetchall()]
                if all_errors:
                    stats["top_errors"] = Counter(all_errors).most_common(5)
                else:
                    stats["top_errors"] = []

                cur.execute(
                    "SELECT AVG(EXTRACT(EPOCH FROM (date_finished - date_added))) "
                    "FROM website_index WHERE done = TRUE AND date_finished IS NOT NULL;"
                )
                stats["avg_processing_seconds"] = cur.fetchone()[0]

                now = datetime.now()
                timeframes = {"1min": 1, "10min": 10, "60min": 60}
                stats["recent"] = {}
                for label, minutes in timeframes.items():
                    start_time = now - timedelta(minutes=minutes)
                    cur.execute(
                        "SELECT COUNT(*) FROM website_index WHERE done = TRUE AND date_finished >= %s;",
                        (start_time,),
                    )
                    successes = cur.fetchone()[0]
                    cur.execute(
                        "SELECT COUNT(*) FROM website_index WHERE array_length(errors, 1) > 0 AND date_added >= %s;",
                        (start_time,),
                    )
                    errors = cur.fetchone()[0]
                    stats["recent"][label] = {"successes": successes, "errors": errors}

        return stats
