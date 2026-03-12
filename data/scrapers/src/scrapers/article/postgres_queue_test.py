from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path

import psycopg2
import pytest

try:
    from pytest_postgresql import factories  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - local env without test deps
    pytest.skip("pytest-postgresql not installed", allow_module_level=True)

from scrapers.article.postgres_queue import PostgresCrawlQueue

postgresql_proc = factories.postgresql_proc()
postgresql = factories.postgresql("postgresql_proc")


def _env_flag(name: str) -> bool:
    try:
        data = Path("/proc/self/environ").read_bytes()
    except FileNotFoundError:
        return False
    return f"{name}=1".encode() in data


class _TestPostgres:
    def __init__(self, host: str, port: int, database: str, user: str, password: str):
        self.host = host
        self.port = port
        self.database = database
        self.user = user
        self.password = password

    def connect(self):
        return psycopg2.connect(
            host=self.host,
            port=self.port,
            database=self.database,
            user=self.user,
            password=self.password,
        )

    @contextmanager
    def transaction(self):
        conn = self.connect()
        try:
            with conn:
                with conn.cursor() as cur:
                    yield cur
        finally:
            conn.close()

    def execute(self, sql: str, params=None) -> None:
        with self.transaction() as cur:
            cur.execute(sql, params)

    def executemany(self, sql: str, rows: list[tuple]) -> None:
        if not rows:
            return
        with self.transaction() as cur:
            cur.executemany(sql, rows)

    def fetchone(self, sql: str, params=None):
        with self.transaction() as cur:
            cur.execute(sql, params)
            return cur.fetchone()

    def fetchall(self, sql: str, params=None) -> list[tuple]:
        with self.transaction() as cur:
            cur.execute(sql, params)
            return cur.fetchall()


@pytest.fixture
def db(postgresql) -> PostgresCrawlQueue:
    params = postgresql.info.get_parameters()
    pg = _TestPostgres(
        params.get("host", "localhost"),
        int(params.get("port", 5432)),
        params.get("dbname", "postgres"),
        params.get("user", "postgres"),
        params.get("password"),
    )
    return PostgresCrawlQueue(pg)  # type: ignore[arg-type]


@pytest.fixture()
def clean_db(db: PostgresCrawlQueue):
    db.pg.execute("DROP TABLE IF EXISTS website_index;")
    db.pg.execute("DROP TABLE IF EXISTS blocked_domains;")
    yield


def test_init_tables_inserts_urls(db: PostgresCrawlQueue, clean_db):
    db.init_tables(["https://example.com", "https://example.org"], reset=True)
    count = db.pg.fetchone("SELECT COUNT(*) FROM website_index;")[0]
    assert count == 2


def test_get_skips_blocked(db: PostgresCrawlQueue, clean_db):
    db.init_tables(["https://blocked.test/a", "https://ok.test/b"], reset=True)
    db.load_blocked_domains([("blocked.test", "testing")])

    row = db.get("worker-1", max_retries=3)
    assert row is not None
    _, url, _, _ = row
    assert "ok.test" in url


def test_load_blocked_domains_upserts(db: PostgresCrawlQueue, clean_db):
    db.load_blocked_domains([("blocked.test", "first")])
    db.load_blocked_domains([("blocked.test", "second")])
    reason = db.pg.fetchone(
        "SELECT reason FROM blocked_domains WHERE domain = %s", ("blocked.test",)
    )[0]
    assert reason == "second"


def test_mark_done_and_get_pages(db: PostgresCrawlQueue, clean_db):
    db.init_tables(["https://example.com/a"], reset=True)
    uid = db.pg.fetchone("SELECT id FROM website_index LIMIT 1;")[0]
    db.mark_done(uid, "s3://bucket/a")
    rows = db.get_pages_to_parse(limit=5)
    assert rows == [(uid, "https://example.com/a", "s3://bucket/a")]


def test_mark_error_and_release(db: PostgresCrawlQueue, clean_db):
    db.init_tables(["https://example.com/a"], reset=True)
    uid = db.pg.fetchone("SELECT id FROM website_index LIMIT 1;")[0]
    db.pg.execute(
        "UPDATE website_index SET locked_by_worker_id = %s, "
        "locked_at = %s WHERE id = %s",
        ("worker-1", datetime.now(), uid),
    )
    db.mark_error(uid, "boom")
    row = db.pg.fetchone(
        "SELECT num_retries, errors, locked_by_worker_id, locked_at "
        "FROM website_index WHERE id = %s",
        (uid,),
    )
    assert row[0] == 1
    assert row[1] == ["boom"]
    assert row[2] is None
    assert row[3] is None

    db.pg.execute(
        "UPDATE website_index SET locked_by_worker_id = %s, "
        "locked_at = %s WHERE id = %s",
        ("worker-2", datetime.now(), uid),
    )
    db.release(uid)
    row = db.pg.fetchone(
        "SELECT locked_by_worker_id, locked_at FROM website_index WHERE id = %s",
        (uid,),
    )
    assert row == (None, None)


def test_insert_urls_and_reprioritize(db: PostgresCrawlQueue, clean_db):
    db.init_tables([], reset=True)
    now = datetime.now()
    rows: list[tuple] = [
        ("id-1", "https://example.com/a", 0, False, None, 0, now, None, None),
        ("id-2", "https://example.com/b", 0, False, [], 0, now, None, None),
    ]
    db.insert_urls(rows)
    db.reprioritize(lambda url: 30)
    priorities = db.pg.fetchall(
        "SELECT id, priority FROM website_index ORDER BY id;"
    )
    assert priorities == [("id-1", 70), ("id-2", 70)]


def test_get_stats(db: PostgresCrawlQueue, clean_db):
    db.init_tables([], reset=True)
    now = datetime.now()
    earlier = now - timedelta(minutes=5)
    rows = [
        ("id-1", "https://example.com/a", 0, True, [], 0, earlier, now, None),
        (
            "id-2",
            "https://example.com/b",
            0,
            False,
            ["e1", "e2"],
            2,
            earlier,
            None,
            None,
        ),
        ("id-3", "https://example.com/c", 0, False, [], 0, earlier, None, None),
    ]
    db.insert_urls(rows)
    stats = db.get_stats()
    assert stats["total_urls"] == 3
    assert stats["finished_urls"] == 1
    assert stats["pending_urls"] == 2
    assert stats["urls_with_errors"] == 1
    assert stats["total_errors"] == 2
    assert set(stats["top_errors"]) == {("e1", 1), ("e2", 1)}
    assert stats["avg_processing_seconds"] is not None
    assert stats["recent"]["10min"]["successes"] == 1
    assert stats["recent"]["10min"]["errors"] == 1


@pytest.mark.skipif(not _env_flag("POSTGRES_STRESS"), reason="set POSTGRES_STRESS=1")
def test_concurrent_get_and_lock(db: PostgresCrawlQueue, clean_db):
    urls = [f"https://example.com/{i}" for i in range(200)]
    db.init_tables(urls, reset=True)

    def worker(idx: int):
        row = db.get(f"worker-{idx}", max_retries=1)
        return row[0] if row else None

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(worker, i) for i in range(100)]
        results = []
        for f in futures:
            try:
                results.append(f.result(timeout=10))
            except FutureTimeout:
                pytest.fail("Concurrent get timed out")

    ids = [r for r in results if r is not None]
    assert len(ids) == len(set(ids))
