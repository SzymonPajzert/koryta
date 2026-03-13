import pytest

from scrapers.stores import CrawlQueue


def test_put_get_roundtrip(crawl_queue: CrawlQueue):
    crawl_queue.put([("https://example.com/a", 10)])
    row = crawl_queue.get("worker-1", max_retries=1)
    assert row is not None
    assert len(row) == 2
    assert isinstance(row[0], str)
    assert isinstance(row[1], str)
    assert row[1] == "example.com/a"


def test_mark_done_removes_from_queue(crawl_queue: CrawlQueue):
    crawl_queue.put([("https://example.com/a", 10)])
    row = crawl_queue.get("worker-1", max_retries=1)
    assert row is not None
    crawl_queue.mark_done(row[0], None)
    assert crawl_queue.get("worker-2", max_retries=1) is None


def test_mark_error_retries_until_max(crawl_queue: CrawlQueue):
    crawl_queue.put([("https://example.com/a", 10)])
    row = crawl_queue.get("worker-1", max_retries=2)
    assert row is not None
    crawl_queue.mark_error(row[0], "boom")

    row = crawl_queue.get("worker-2", max_retries=2)
    assert row is not None
    crawl_queue.mark_error(row[0], "boom2")

    assert crawl_queue.get("worker-3", max_retries=2) is None


def test_release_allows_reget(crawl_queue: CrawlQueue):
    crawl_queue.put([("https://example.com/a", 10)])
    row = crawl_queue.get("worker-1", max_retries=1)
    assert row is not None
    crawl_queue.release(row[0])
    row2 = crawl_queue.get("worker-2", max_retries=1)
    assert row2 is not None


def test_put_rejects_out_of_range_priority(crawl_queue: CrawlQueue):
    with pytest.raises(ValueError):
        crawl_queue.put([("https://example.com/a", 101)])


def test_priority_affects_order(crawl_queue: CrawlQueue):
    crawl_queue.put(
        [
            ("https://example.com/low", 5),
            ("https://example.com/high", 80),
        ]
    )
    first = crawl_queue.get("worker-1", max_retries=1)
    second = crawl_queue.get("worker-2", max_retries=1)
    assert first is not None and second is not None
    assert first[1] == "example.com/low"
    assert second[1] == "example.com/high"


def test_blocked_domains_are_skipped(crawl_queue: CrawlQueue):
    crawl_queue.add_blocked_domains([("blocked.test", "nope")])
    crawl_queue.put(
        [
            ("https://blocked.test/a", 10),
            ("https://ok.test/b", 20),
        ]
    )
    row = crawl_queue.get("worker-1", max_retries=1)
    assert row is not None
    assert row[1] == "ok.test/b"


def test_blocked_domain_normalizes_scheme(crawl_queue: CrawlQueue):
    crawl_queue.add_blocked_domains([("https://blocked.test", "nope")])
    crawl_queue.put([("blocked.test/path", 10)])
    assert crawl_queue.get("worker-1", max_retries=1) is None


def test_timeout_allows_reget(crawl_queue: CrawlQueue):
    crawl_queue.put([("https://example.com/a", 10)])
    row = crawl_queue.get("worker-1", max_retries=1)
    assert row is not None
    row2 = crawl_queue.get("worker-2", max_retries=1, timeout_seconds=0)
    assert row2 is not None


def test_put_is_idempotent(crawl_queue: CrawlQueue):
    crawl_queue.put([("https://example.com/a", 10)])
    crawl_queue.put([("https://example.com/a", 20)])
    row1 = crawl_queue.get("worker-1", max_retries=1)
    row2 = crawl_queue.get("worker-2", max_retries=1)
    assert row1 is not None
    assert row1[1] == "example.com/a"
    assert row2 is None


def test_reprioritize_updates_order(crawl_queue: CrawlQueue):
    crawl_queue.put(
        [
            ("https://example.com/low", 10),
            ("https://example.com/high", 90),
        ]
    )
    crawl_queue.reprioritize(lambda url: 1 if "high" in url else 99)
    first = crawl_queue.get("worker-1", max_retries=1)
    second = crawl_queue.get("worker-2", max_retries=1)
    assert first is not None and second is not None
    assert first[1] == "example.com/high"
    assert second[1] == "example.com/low"


def test_get_done_urls_returns_done(crawl_queue: CrawlQueue):
    crawl_queue.put([("https://example.com/a", 10)])
    row = crawl_queue.get("worker-1", max_retries=1)
    assert row is not None
    crawl_queue.mark_done(row[0], "s3://bucket/a")
    rows = crawl_queue.get_done_urls(limit=5)
    assert rows == [(row[0], "example.com/a", "s3://bucket/a")]
