import time

import pytest

from scrapers.stores import (
    CrawlQueue,
    CrawlQueueItem,
    DoneUrl,
    NewUrl,
)


def test_put_get_roundtrip(crawl_queue: CrawlQueue):
    crawl_queue.put([NewUrl("https://example.com/a", 10)])
    row = crawl_queue.get("worker-1", max_retries=1)
    assert row is not None
    assert isinstance(row, CrawlQueueItem)
    assert isinstance(row.uid, str)
    assert isinstance(row.url, str)
    assert row.url == "example.com/a"


def test_mark_done_removes_from_queue(crawl_queue: CrawlQueue):
    crawl_queue.put([NewUrl("https://example.com/a", 10)])
    row = crawl_queue.get("worker-1", max_retries=1)
    assert row is not None
    crawl_queue.mark_done(row.uid, None)
    assert crawl_queue.get("worker-2", max_retries=1) is None


def test_mark_error_retries_until_max(crawl_queue: CrawlQueue):
    crawl_queue.put([NewUrl("https://example.com/a", 10)])
    row = crawl_queue.get("worker-1", max_retries=2)
    assert row is not None
    crawl_queue.mark_error(row.uid, "boom")

    row = crawl_queue.get("worker-2", max_retries=2)
    assert row is not None
    crawl_queue.mark_error(row.uid, "boom2")

    assert crawl_queue.get("worker-3", max_retries=2) is None


def test_release_allows_reget(crawl_queue: CrawlQueue):
    crawl_queue.put([NewUrl("https://example.com/a", 10)])
    row = crawl_queue.get("worker-1", max_retries=1)
    assert row is not None
    crawl_queue.release(row.uid)
    row2 = crawl_queue.get("worker-2", max_retries=1)
    assert row2 is not None


def test_put_rejects_out_of_range_priority(crawl_queue: CrawlQueue):
    with pytest.raises(ValueError):
        crawl_queue.put([NewUrl("https://example.com/a", 101)])


def test_priority_affects_order(crawl_queue: CrawlQueue):
    crawl_queue.put(
        [
            NewUrl("https://example.com/low", 5),
            NewUrl("https://example.com/high", 80),
        ]
    )
    first = crawl_queue.get("worker-1", max_retries=1)
    second = crawl_queue.get("worker-2", max_retries=1)
    assert first is not None and second is not None
    assert first.url == "example.com/low"
    assert second.url == "example.com/high"



def test_timeout_allows_reget(crawl_queue: CrawlQueue):
    crawl_queue.put([NewUrl("https://example.com/a", 10)])
    row = crawl_queue.get("worker-1", max_retries=1)
    assert row is not None
    row2 = crawl_queue.get("worker-2", max_retries=1, timeout_seconds=0)
    assert row2 is not None


def test_timeout_blocks_until_expired(crawl_queue: CrawlQueue):
    crawl_queue.put([NewUrl("https://example.com/locked", 10)])
    row = crawl_queue.get("worker-1", max_retries=1)
    assert row is not None

    timeout_seconds: float = 0.1
    blocked = crawl_queue.get(
        "worker-2", max_retries=1, timeout_seconds=timeout_seconds
    )
    assert blocked is None

    time.sleep(timeout_seconds + 0.01)
    reclaimed = crawl_queue.get(
        "worker-2", max_retries=1, timeout_seconds=timeout_seconds
    )
    assert reclaimed == row


def test_late_mark_done_is_accepted_after_timeout(crawl_queue: CrawlQueue):
    crawl_queue.put([NewUrl("https://example.com/late", 10)])
    timeout_seconds: float = 0.1
    row = crawl_queue.get("worker-1", max_retries=1, timeout_seconds=timeout_seconds)
    assert row is not None

    time.sleep(timeout_seconds + 0.01)
    reclaimed = crawl_queue.get(
        "worker-2", max_retries=1, timeout_seconds=timeout_seconds
    )
    assert reclaimed == row
    crawl_queue.mark_done(reclaimed.uid, "s3://bucket/late-v2")

    # Worker-1 finishes late; we accept the late mark_done overwrite.
    # Note that in practice, the path for each url will be the same, so that's
    # not really an issue.
    crawl_queue.mark_done(row.uid, "s3://bucket/late-v1")

    done_rows = crawl_queue.get_done_urls(limit=5)
    assert done_rows == [
        DoneUrl(row.uid, "example.com/late", "s3://bucket/late-v1")
    ]


def test_put_is_idempotent(crawl_queue: CrawlQueue):
    crawl_queue.put([NewUrl("https://example.com/a", 10)])
    crawl_queue.put([NewUrl("https://example.com/a", 20)])
    row1 = crawl_queue.get("worker-1", max_retries=1)
    row2 = crawl_queue.get("worker-2", max_retries=1)
    assert row1 is not None
    assert row1.url == "example.com/a"
    assert row2 is None


def test_reprioritize_updates_order(crawl_queue: CrawlQueue):
    crawl_queue.put(
        [
            NewUrl("https://example.com/low", 10),
            NewUrl("https://example.com/high", 90),
        ]
    )
    crawl_queue.reprioritize(lambda url: 1 if "high" in url else 99)
    first = crawl_queue.get("worker-1", max_retries=1)
    second = crawl_queue.get("worker-2", max_retries=1)
    assert first is not None and second is not None
    assert first.url == "example.com/high"
    assert second.url == "example.com/low"


def test_get_done_urls_returns_done(crawl_queue: CrawlQueue):
    crawl_queue.put([NewUrl("https://example.com/a", 10)])
    row = crawl_queue.get("worker-1", max_retries=1)
    assert row is not None
    crawl_queue.mark_done(row.uid, "s3://bucket/a")
    rows = crawl_queue.get_done_urls(limit=5)
    assert rows == [DoneUrl(row.uid, "example.com/a", "s3://bucket/a")]


def test_reset_clears_queue(crawl_queue: CrawlQueue):
    crawl_queue.put([NewUrl("https://example.com/reset", 10)])
    assert crawl_queue.get("worker-1", max_retries=1) is not None
    crawl_queue.reset()
    assert crawl_queue.get("worker-1", max_retries=1) is None
