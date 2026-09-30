"""PostgreSQL connection pool shared by the crawlers.

Extracted from `scrapers.article.postgres_queue` so the BIP crawler uses the
same client instead of a second implementation.
"""

import logging
import os
import time
from contextlib import contextmanager

import psycopg
from psycopg_pool import ConnectionPool, PoolTimeout

logger = logging.getLogger(__name__)


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

    def executemany(self, sql: str, rows: list[tuple], max_attempts: int = 5) -> None:
        if not rows:
            return
        for attempt in range(1, max_attempts + 1):
            try:
                with self.transaction() as cursor:
                    cursor.executemany(sql, rows)
                return
            except psycopg.errors.DeadlockDetected as exc:
                if attempt == max_attempts:
                    logger.error(
                        "Deadlock detected in executemany (attempt %d/%d). Giving up.",
                        attempt,
                        max_attempts,
                    )
                    raise
                backoff = 0.1 * 2**attempt
                logger.warning(
                    "Deadlock detected in executemany (attempt %d/%d). "
                    "Retrying after %.2fs. Error: %s",
                    attempt,
                    max_attempts,
                    backoff,
                    exc,
                )
                time.sleep(backoff)

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
