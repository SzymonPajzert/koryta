"""What the paid job tells /admin/procesy about what it bought.

Nothing here reaches rejestr.io, a bucket or Firestore: the queue is a list,
rejestr.io a function, and the run is written to a dictionary.
"""

from collections.abc import Callable
from types import SimpleNamespace

import pytest

import jobs.krs_scrape_paid as job
from scrapers.krs.scrape import PLN_PER_CALL
from stores.job_runs import JobRun

ANSWERED = "https://rejestr.io/api/v2/org/0000000029"
DECLINED = "https://rejestr.io/api/v2/org/0000000031"
UNANSWERED = "https://rejestr.io/api/v2/org/0000000041"
FREE = "https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000000029?rejestr=P"


class Firestore:
    """Just enough of a Firestore client for `JobRun`, keeping the documents."""

    def __init__(self):
        self.docs: dict[str, dict] = {}

    def collection(self, name: str):
        return SimpleNamespace(document=lambda document: f"{name}/{document}")

    def batch(self):
        return Batch(self)


class Batch:
    def __init__(self, db: Firestore):
        self.db = db
        self.ops: list[tuple[str, dict]] = []

    def set(self, ref: str, data: dict, merge: bool = False) -> None:
        self.ops.append((ref, data))

    def update(self, ref: str, data: dict) -> None:
        self.ops.append((ref, data))

    def commit(self, retry=None, timeout=None) -> None:
        for ref, data in self.ops:
            self.db.docs.setdefault(ref, {}).update(data)


class Queue:
    """`ScrapeRejestrIO` as the job reads it."""

    def __init__(self, queries):
        self.queries = queries
        self.companies = SimpleNamespace(read_or_process=lambda ctx: None)

    def read_or_process_list(self, ctx):
        return self.queries

    def owned_per_the_register(self, ctx):
        return []


def query(*urls: str, cost: float) -> SimpleNamespace:
    return SimpleNamespace(urls=lambda: list(urls), cost=lambda: cost)


class PaidRun:
    """The job over one free and three paid URLs, with the bill accepted."""

    def __init__(self, monkeypatch):
        self.monkeypatch = monkeypatch
        self.db = Firestore()
        self.uploaded: list[str] = []
        queries = [
            query(FREE, ANSWERED, cost=0.05),
            query(DECLINED, UNANSWERED, cost=0.10),
        ]
        monkeypatch.setattr(job, "setup_context", lambda *a, **k: ("ctx", None))
        monkeypatch.setattr(job, "ScrapeRejestrIO", lambda: Queue(queries))
        monkeypatch.setattr(job, "public_krs_ids", lambda companies: set())
        monkeypatch.setattr(job, "cost_breakdown", lambda queries, public: "")
        monkeypatch.setattr("builtins.input", lambda *a: "")
        monkeypatch.setattr(
            job, "upload_result", lambda ctx, url, result: self.uploaded.append(url)
        )
        monkeypatch.setattr(
            job,
            "JobRun",
            lambda *a, **k: JobRun(
                *a, run_id="r", trigger="manual", client=self.db, **k
            ),
        )

    def __call__(self, answers: Callable[[str], object]) -> None:
        rejestr = SimpleNamespace(get_rejestr_io=answers)
        self.monkeypatch.setattr(
            job, "RejestrIO", SimpleNamespace(from_context=lambda ctx: rejestr)
        )
        job.scrape_krs_paid(sleep_time=0)

    @property
    def run(self) -> dict:
        return self.db.docs["jobRuns/r"]


@pytest.fixture
def paid(monkeypatch) -> PaidRun:
    return PaidRun(monkeypatch)


def test_only_what_rejestr_io_answered_is_bought_and_paid_for(paid):
    answers: dict[str, object] = {
        ANSWERED: '{"id": 29}',
        DECLINED: {},
        UNANSWERED: None,
    }

    paid(answers.get)

    assert paid.uploaded == [ANSWERED]
    assert paid.run["state"] == "succeeded"
    assert paid.run["progress"] == {"done": 3, "total": 3, "unit": "zapytań"}
    # Declined at the per-query prompt (`{}`) is not bought and costs nothing,
    # and what was spent is kept apart from the bill that was accepted.
    assert paid.run["counters"] == {
        "bought": 1,
        "skipped": 2,
        "pln": PLN_PER_CALL,
        "pln_planned": pytest.approx(0.15),
    }


def test_ctrl_c_while_buying_leaves_the_run_partial(paid):
    def interrupted(url):
        if url == DECLINED:
            raise KeyboardInterrupt
        return '{"id": 29}'

    with pytest.raises(KeyboardInterrupt):
        paid(interrupted)

    assert (paid.run["state"], paid.run["stopReason"]) == ("partial", "przerwany")
    assert paid.run["counters"]["bought"] == 1
