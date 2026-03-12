import pytest

from scrapers.stores import CrawlQueue


def test_put_get_roundtrip(crawl_queue: CrawlQueue):
    crawl_queue.put([("https://example.com/a", 10)])
    row = crawl_queue.get("worker-1", max_retries=1)
    assert row is not None
    assert row[1] == "https://example.com/a"


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
    assert first[1] == "https://example.com/low"
    assert second[1] == "https://example.com/high"
