from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from datetime import datetime, timedelta
from pathlib import Path

import pytest

try:
    from pytest_postgresql import factories  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - local env without test deps
    pytest.skip("pytest-postgresql not installed", allow_module_level=True)

from scrapers.article.postgres_queue import PostgresClient, PostgresCrawlQueue

postgresql_proc = factories.postgresql_proc()
postgresql = factories.postgresql("postgresql_proc")


def _env_flag(name: str) -> bool:
    try:
        data = Path("/proc/self/environ").read_bytes()
    except FileNotFoundError:
        return False
    return f"{name}=1".encode() in data


@pytest.fixture
def db(postgresql) -> PostgresCrawlQueue:
    params = postgresql.info.get_parameters()
    pg = PostgresClient(
        params.get("host", "localhost"),
        params.get("dbname", "postgres"),
        params.get("user", "postgres"),
        params.get("password"),
        port=int(params.get("port", 5432)),
    )
    queue = PostgresCrawlQueue(pg)  # type: ignore[arg-type]
    queue.reset()
    return queue


def test_put_populates_urls(db: PostgresCrawlQueue):
    db.put(
        [
            ("https://example.com", 0),
            ("https://example.org", 0),
        ]
    )
    count = db.pg.fetchone("SELECT COUNT(*) FROM website_index;")[0]
    assert count == 2


def test_get_skips_blocked(db: PostgresCrawlQueue):
    db.put(
        [
            ("https://blocked.test/a", 0),
            ("https://ok.test/b", 0),
        ]
    )
    db.add_blocked_domains([("blocked.test", "testing")])

    row = db.get("worker-1", max_retries=3)
    assert row is not None
    _, url = row
    assert url == "ok.test/b"


def test_load_blocked_domains_upserts(db: PostgresCrawlQueue):
    db.add_blocked_domains([("blocked.test", "first")])
    db.add_blocked_domains([("blocked.test", "second")])
    reason = db.pg.fetchone(
        "SELECT reason FROM blocked_domains WHERE domain = %s", ("blocked.test",)
    )[0]
    assert reason == "second"


def test_mark_done_and_get_pages(db: PostgresCrawlQueue):
    db.put([("https://example.com/a", 0)])
    uid = db.pg.fetchone("SELECT id FROM website_index LIMIT 1;")[0]
    db.mark_done(uid, "s3://bucket/a")
    rows = db.get_done_urls(limit=5)
    assert rows == [(uid, "example.com/a", "s3://bucket/a")]


def test_insert_urls_and_reprioritize(db: PostgresCrawlQueue):
    now = datetime.now()
    rows: list[tuple] = [
        ("https://example.com/a", 0, now),
        ("https://example.com/b", 0, now),
    ]
    db._insert_urls(rows)
    db.reprioritize(lambda url: 30)
    priorities = db.pg.fetchall(
        "SELECT id, priority FROM website_index ORDER BY id;"
    )
    assert len(priorities) == 2
    assert [priority for _, priority in priorities] == [30, 30]


def test_get_stats(db: PostgresCrawlQueue):
    now = datetime.now()
    earlier = now - timedelta(minutes=5)
    rows = [
        ("https://example.com/a", 0, earlier),
        ("https://example.com/b", 0, earlier),
        ("https://example.com/c", 0, earlier),
    ]
    db._insert_urls(rows)
    uid1 = db.pg.fetchone(
        "SELECT id FROM website_index WHERE url = %s", ("example.com/a",)
    )[0]
    uid2 = db.pg.fetchone(
        "SELECT id FROM website_index WHERE url = %s", ("example.com/b",)
    )[0]
    db.pg.execute(
        "UPDATE website_index SET done = TRUE, date_finished = %s WHERE id = %s",
        [now, uid1],
    )
    db.pg.execute(
        "UPDATE website_index SET errors = %s, num_retries = %s WHERE id = %s",
        [["e1", "e2"], 2, uid2],
    )
    stats = db._get_stats()
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
def test_concurrent_get_and_lock(db: PostgresCrawlQueue):
    urls = [f"https://example.com/{i}" for i in range(200)]
    now = datetime.now()
    db._insert_urls([(url, 0, now) for url in urls])

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
