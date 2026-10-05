"""How the article crawl reports its run (crawl_cli.crawl, stores.job_runs).

Here rather than with the crawler: the crawl is a job by `jobs`' own
definition - it fetches and writes - and only predates the split.
"""

import pytest

import crawl_cli
from stores.job_runs import JobRun


class Run(JobRun):
    """A real run that writes nothing and keeps what it heard."""

    def __init__(self, job, **kwargs):
        super().__init__(job, enabled=False, **kwargs)
        self.heard: list[tuple] = []

    def progress(self, done=None, **kwargs):
        self.heard.append((done, kwargs))
        super().progress(done, **kwargs)


@pytest.fixture
def runs(monkeypatch) -> list[Run]:
    made: list[Run] = []

    def record(job, **kwargs):
        made.append(Run(job, **kwargs))
        return made[-1]

    monkeypatch.setattr(crawl_cli, "JobRun", record)
    return made


def crawling(monkeypatch, then=None):
    """`run_crawler` reporting two batches, then raising `then` if given."""

    def run_crawler(ctx, options, on_progress=None):
        on_progress({"stored": 5, "errors": 1})
        on_progress({"stored": 9, "errors": 2})
        if then:
            raise then

    monkeypatch.setattr(crawl_cli, "run_crawler", run_crawler)


def test_an_exhausted_queue_is_a_finished_run(monkeypatch, runs):
    crawling(monkeypatch)

    crawl_cli.crawl(None, None)  # type: ignore[arg-type]

    [run] = runs
    assert (run.job, run.unit) == ("article_crawl", "stron")
    assert run.heard == [
        (5, {"counters": {"stored": 5, "errors": 1}}),
        (9, {"counters": {"stored": 9, "errors": 2}}),
    ]
    assert (run.state, run.stop_reason) == ("succeeded", "kolejka pusta")


def test_ctrl_c_is_a_partial_run(monkeypatch, runs):
    crawling(monkeypatch, then=KeyboardInterrupt())

    with pytest.raises(KeyboardInterrupt):
        crawl_cli.crawl(None, None)  # type: ignore[arg-type]

    assert (runs[0].state, runs[0].stop_reason) == ("partial", "przerwany")


def test_a_crash_fails_the_run(monkeypatch, runs):
    crawling(monkeypatch, then=ConnectionError("postgres went away"))

    with pytest.raises(ConnectionError):
        crawl_cli.crawl(None, None)  # type: ignore[arg-type]

    assert (runs[0].state, runs[0].stop_reason) == ("failed", "raised ConnectionError")
