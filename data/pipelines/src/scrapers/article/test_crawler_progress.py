"""The crawler's progress hook: what a run has stored, failed and skipped so far."""

from scrapers.article import crawler
from scrapers.article.crawler import CrawlOptions, CrawlResult
from scrapers.stores import CrawlQueueItem


class Queue:
    """A crawl queue handing out `batches` in turn, then nothing."""

    def __init__(self, batches: list[list[CrawlQueueItem]]):
        self.batches = batches
        self.done: list = []
        self.errors: list = []
        self.released: list = []
        self.discovered: list = []

    def get_batch(self, worker, batch_size, max_retries, timeout_seconds):
        return self.batches.pop(0) if self.batches else []

    def mark_done_batch(self, items):
        self.done += items

    def mark_error_batch(self, items):
        self.errors += items

    def release_batch(self, items):
        self.released += items

    def put(self, urls):
        self.discovered += urls


def options() -> CrawlOptions:
    return CrawlOptions(
        worker_id="w",
        storage_type="local",
        local_output=None,
        per_url_max_retries=3,
        lock_timeout_seconds=60,
        per_domain_wait_between_requests_s=0,
        url_scoring_function="default",
        worker_threads=2,
        queue_flush_size=2,
    )


def item(n: int) -> CrawlQueueItem:
    return CrawlQueueItem(uid=str(n), url=f"https://portal.pl/artykul-{n}", priority=0)


def test_a_batch_says_what_it_held():
    pending = [
        (item(1), CrawlResult(storage_path="a", discovered_urls=["https://x.pl/1"])),
        (item(2), CrawlResult(storage_path=None, media_type="application/pdf")),
        (item(3), CrawlResult(error="http 500")),
        (item(4), CrawlResult(hit_rate_limit=True)),
    ]
    queue = Queue([])

    counts = crawler._flush_batch(pending, queue, options(), set(), "w_0")  # type: ignore[arg-type]

    assert counts == {
        "stored": 1,
        "not_html": 1,
        "errors": 1,
        "rate_limited": 1,
        "discovered": 1,
    }
    assert len(queue.done) == 2 and len(queue.errors) == 1


def test_the_hook_hears_the_running_totals_after_every_batch(monkeypatch):
    def crawl_url(ctx, parsed, options):
        if parsed.full_url.endswith("-3"):
            return CrawlResult(error="http 404")
        return CrawlResult(storage_path=f"hostname=portal.pl/{parsed.path}")

    monkeypatch.setattr(crawler, "crawl_url", crawl_url)
    queue = Queue([[item(1), item(2)], [item(3), item(4)]])
    heard: list[dict[str, int]] = []

    crawler._coordinator(0, options(), queue, None, set(), heard.append)  # type: ignore[arg-type]

    assert heard, "no batch was reported"
    assert heard[-1] == {
        "stored": 3,
        "not_html": 0,
        "errors": 1,
        "rate_limited": 0,
        "discovered": 0,
    }
    stored = [totals["stored"] for totals in heard]
    assert stored == sorted(stored), "totals, not one batch's counts"


def test_without_a_hook_the_crawl_runs_as_before(monkeypatch):
    monkeypatch.setattr(
        crawler, "crawl_url", lambda ctx, parsed, options: CrawlResult(storage_path="a")
    )
    queue = Queue([[item(1)]])

    crawler._coordinator(0, options(), queue, None, set())  # type: ignore[arg-type]

    assert len(queue.done) == 1
