"""What the paid job buys, what it tells /admin/procesy, and when it stops.

Nothing here reaches rejestr.io, a bucket or Firestore: the queue is a list,
rejestr.io a function, the shared cache and the run documents dictionaries.
"""

import json
import os
import signal
from collections.abc import Callable
from types import SimpleNamespace

import pandas as pd
import pytest

import jobs.krs_scrape_paid as job
from entities.company import KRS
from entities.person import RejestrIOKey
from scrapers.krs.odpis_attempts import FETCHED, GATEWAY
from scrapers.krs.scrape import PEOPLE_QUERIES, PLN_PER_CALL, QueryType, RejestrIOQuery
from stores.job_runs import JobRun
from stores.rejestr import RejestrRefused, RejestrUnavailable

TODAY = "2026-10-06"

PERSON = "2145029"
FAILED_ODPIS = "0000040284"
FETCHED_ODPIS = "0000832452"
NEVER_ASKED = "0000002092"
FREE_ONLY = "0000000129"

FEEDS = [
    QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE,
    QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_HISTORYCZNE,
]


def person_feed(person: str) -> list[str]:
    return [
        f"https://rejestr.io/api/v2/osoby/{person}/krs-powiazania?aktualnosc={which}"
        for which in ("aktualne", "historyczne")
    ]


def company_feed(krs: str) -> list[str]:
    return [
        f"https://rejestr.io/api/v2/org/{krs}/krs-powiazania?aktualnosc={which}"
        for which in ("aktualne", "historyczne")
    ]


def queue() -> list[RejestrIOQuery]:
    """`ScrapeRejestrIO` as the queue's order has it: KRS order, people last."""
    return [
        RejestrIOQuery(
            krs=KRS(FREE_ONLY), queries=[QueryType.API_KRS_ODPIS_AKTUALNY_P]
        ),
        RejestrIOQuery(krs=KRS(NEVER_ASKED), queries=list(FEEDS), reasons=["refresh"]),
        RejestrIOQuery(
            krs=KRS(FAILED_ODPIS),
            queries=[QueryType.API_KRS_ODPIS_AKTUALNY_P, *FEEDS],
            reasons=["owned"],
        ),
        RejestrIOQuery(krs=KRS(FETCHED_ODPIS), queries=list(FEEDS), reasons=["owned"]),
        RejestrIOQuery(
            person=RejestrIOKey(PERSON),
            queries=list(PEOPLE_QUERIES),
            reasons=["interesting_person"],
        ),
    ]


ATTEMPTS = pd.DataFrame(
    {
        "krs": [FAILED_ODPIS, FETCHED_ODPIS],
        "status": [GATEWAY, FETCHED],
    }
)


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


class Paid:
    """The job, with everything it reaches faked."""

    def __init__(self, monkeypatch):
        self.monkeypatch = monkeypatch
        self.db = Firestore()
        self.objects: dict[str, bytes] = {}
        self.uploaded: list[str] = []
        self.asked: list[str] = []
        self.stored_names: list[str] = []
        self.policies: list = []
        self.answers: Callable[[str], object] = lambda url: '{"id": 1}'
        self.uploads: Callable[[str], bool] = lambda url: True

        def setup_context(*args, policy=None, **kwargs):
            self.policies.append(policy)
            return "ctx", None

        def upload(ctx, url, result):
            ok = self.uploads(url)
            if ok:
                self.uploaded.append(url)
            return ok

        world = self

        class Bucket:
            def create_object(self, bucket, name, data, content_type):
                assert name not in world.objects, f"{name} written twice"
                world.objects[name] = data
                return f"gs://{bucket}/{name}"

        class Client:
            """rejestr.io: whatever `answers` says for each url."""

            def __init__(self, *args, **kwargs):
                pass

            def get_rejestr_io(self, url):
                world.asked.append(url)
                return world.answers(url)

        monkeypatch.setattr(job, "setup_context", setup_context)
        monkeypatch.setattr(job, "ScrapeRejestrIO", lambda: Queue(queue()))
        monkeypatch.setattr(job, "public_krs_ids", lambda companies: set())
        monkeypatch.setattr(job, "cost_breakdown", lambda queries, public: "")
        monkeypatch.setattr(
            job,
            "KrsOdpisAttempts",
            lambda: SimpleNamespace(read_or_process=lambda ctx: ATTEMPTS),
        )
        monkeypatch.setattr(job, "rejestr_names", lambda ctx: self.stored_names)
        monkeypatch.setattr(job, "today", lambda: TODAY)
        monkeypatch.setattr(job, "upload_result", upload)
        monkeypatch.setattr(job, "Rejestr", Client)
        monkeypatch.setattr(job, "UnattendedRejestr", Client)
        monkeypatch.setattr(job, "Client", Bucket)
        monkeypatch.setattr(job, "sleep", lambda seconds: None)
        # The run under a known id, whatever the summary's is.
        monkeypatch.setattr(
            job,
            "JobRun",
            lambda *a, **k: JobRun(
                *a, **{**k, "run_id": "r"}, trigger="schedule", client=self.db
            ),
        )

        def no_questions(*args):
            raise AssertionError("asked a question")

        monkeypatch.setattr("builtins.input", no_questions)

    def __call__(self, *argv: str) -> int:
        return job.main(list(argv))

    @property
    def run(self) -> dict:
        return self.db.docs["jobRuns/r"]

    @property
    def summary(self) -> dict:
        [name] = [n for n in self.objects if n.startswith(job.RUNS_PREFIX)]
        return json.loads(self.objects[name])


@pytest.fixture
def paid(monkeypatch) -> Paid:
    return Paid(monkeypatch)


# ---------------------------------------------------------------------------
# By hand


def test_by_hand_only_what_rejestr_io_answered_is_bought_and_paid_for(
    paid, monkeypatch
):
    monkeypatch.setattr("builtins.input", lambda *a: "")
    answers: dict[str, object] = {
        company_feed(NEVER_ASKED)[0]: '{"id": 29}',
        company_feed(NEVER_ASKED)[1]: {},  # declined at the prompt
        company_feed(FAILED_ODPIS)[0]: None,  # rejestr.io did not answer
    }
    paid.answers = lambda url: answers.get(url, '{"id": 1}')

    assert paid() == 0

    # The whole queue, the person first, and none of the free calls.
    assert paid.asked == [
        *person_feed(PERSON),
        *company_feed(NEVER_ASKED),
        *company_feed(FAILED_ODPIS),
        *company_feed(FETCHED_ODPIS),
    ]
    assert company_feed(NEVER_ASKED)[1] not in paid.uploaded
    assert paid.run["state"] == "succeeded"
    assert paid.run["progress"] == {"done": 8, "total": 8, "unit": "zapytań"}
    # Declined at the prompt ({}) is not bought and costs nothing, and what
    # was spent is kept apart from the bill that was accepted.
    assert paid.run["counters"] == {
        "bought": 6,
        "skipped": 2,
        "failed": 0,
        "deferred": 0,
        "pln": pytest.approx(6 * PLN_PER_CALL),
        "pln_planned": pytest.approx(8 * PLN_PER_CALL),
    }
    # The pipelines are rebuilt as they always were by hand: nothing pinned.
    assert paid.policies[0].exclude_refresh == set()


def test_ctrl_c_while_buying_leaves_the_run_partial(paid, monkeypatch):
    monkeypatch.setattr("builtins.input", lambda *a: "")

    def interrupted(url):
        if url == person_feed(PERSON)[1]:
            raise KeyboardInterrupt
        return '{"id": 29}'

    paid.answers = interrupted

    with pytest.raises(KeyboardInterrupt):
        paid()

    assert (paid.run["state"], paid.run["stopReason"]) == ("partial", "przerwany")
    assert paid.run["counters"]["bought"] == 1
    assert paid.summary["stopped"] == "przerwany"


# ---------------------------------------------------------------------------
# The night: --scope fallback --max-calls


def test_the_night_buys_the_people_and_the_companies_the_free_odpis_failed_for(
    paid,
):
    assert paid("--scope", "fallback", "--max-calls", "50") == 0

    # No questions (input would raise), the person first; the company the
    # odpis job never asked about and the one whose odpis came are not bought.
    assert paid.asked == [*person_feed(PERSON), *company_feed(FAILED_ODPIS)]
    assert paid.uploaded == paid.asked
    assert paid.run["state"] == "succeeded"
    assert paid.run["counters"]["bought"] == 4
    summary = paid.summary
    assert (summary["scope"], summary["max_calls"], summary["planned"]) == (
        "fallback",
        50,
        4,
    )
    assert summary["exit_code"] == 0
    # The odpis job's record is refolded, and PeopleMerged held at its copy.
    policy = paid.policies[0]
    assert "KrsOdpisAttempts" in policy.refresh_pipelines
    assert policy.exclude_refresh == {"PeopleMerged"}


def test_the_cap_is_the_days_and_what_was_bought_today_counts(paid):
    paid.stored_names = [
        f"hostname=rejestr.io/api/v2/org/0000000001/krs-powiazania/aktualnosc_aktualne/date={TODAY}",
        "hostname=rejestr.io/api/v2/org/0000000001/krs-powiazania/aktualnosc_aktualne/date=2026-10-05",
    ]

    assert paid("--scope", "fallback", "--max-calls", "3") == job.EXIT_TRY_LATER

    # 3 a day, 1 already today: the person's two calls fit, the company's do
    # not, and it is not bought by halves.
    assert paid.asked == person_feed(PERSON)
    assert paid.run["state"] == "partial"
    assert paid.run["counters"]["deferred"] == 2
    assert paid.summary["bought_before"] == 1


def test_a_cap_spent_already_buys_nothing_and_says_so(paid):
    paid.stored_names = [f"hostname=rejestr.io/x/date={TODAY}"] * 5

    assert paid("--scope", "fallback", "--max-calls", "5") == job.EXIT_TRY_LATER

    assert paid.asked == []
    assert paid.run["state"] == "partial"
    assert paid.run["progress"]["total"] == 0


def test_nothing_to_buy_is_still_a_run_the_page_hears_of(paid, monkeypatch):
    monkeypatch.setattr(
        job, "ScrapeRejestrIO", lambda: Queue([q for q in queue() if q.krs])
    )
    monkeypatch.setattr(
        job,
        "KrsOdpisAttempts",
        lambda: SimpleNamespace(read_or_process=lambda ctx: pd.DataFrame()),
    )

    assert paid("--scope", "fallback", "--max-calls", "50") == 0

    assert paid.asked == []
    assert paid.run["state"] == "succeeded"
    assert paid.summary["planned"] == 0


def test_an_account_rejestr_io_refuses_stops_the_run_and_fails_it(paid):
    def refused(url):
        raise RejestrRefused(402, "Brak środków")

    paid.answers = refused

    assert paid("--scope", "fallback", "--max-calls", "50") == job.EXIT_FAILED

    assert paid.asked == person_feed(PERSON)[:1]
    assert paid.run["state"] == "failed"
    assert paid.run["stopReason"].startswith("rejestr.io refused: HTTP 402")
    assert paid.summary["refused"] is True


def test_calls_failing_in_a_row_stop_the_run(paid, monkeypatch):
    many = [
        RejestrIOQuery(krs=KRS(f"{n:010d}"), queries=list(FEEDS)) for n in range(1, 6)
    ]
    monkeypatch.setattr(job, "ScrapeRejestrIO", lambda: Queue(many))

    def unavailable(url):
        raise RejestrUnavailable(503)

    paid.answers = unavailable

    assert paid("--max-calls", "50") == job.EXIT_TRY_LATER

    assert len(paid.asked) == job.MAX_CONSECUTIVE_FAILURES
    assert paid.run["state"] == "failed"
    assert paid.run["stopReason"] == f"5 {job.REFUSING}"


def test_one_failed_call_is_left_for_the_next_run(paid):
    def once(url):
        if url == person_feed(PERSON)[0]:
            raise RejestrUnavailable(503)
        return '{"id": 1}'

    paid.answers = once

    assert paid("--scope", "fallback", "--max-calls", "50") == job.EXIT_TRY_LATER

    assert paid.uploaded == [person_feed(PERSON)[1], *company_feed(FAILED_ODPIS)]
    assert paid.run["state"] == "partial"
    assert paid.run["counters"]["failed"] == 1


def test_nothing_under_the_id_is_not_bought_and_not_stored(paid):
    paid.answers = lambda url: None if "osoby" in url else '{"id": 1}'

    assert paid("--scope", "fallback", "--max-calls", "50") == 0

    assert paid.uploaded == company_feed(FAILED_ODPIS)
    assert paid.run["counters"]["skipped"] == 2


def test_an_upload_that_fails_once_is_tried_again(paid):
    tries: dict[str, int] = {}

    def flaky(url):
        tries[url] = tries.get(url, 0) + 1
        # The first answer never lands; every other lands on its second try.
        return url != person_feed(PERSON)[0] and tries[url] > 1

    paid.uploads = flaky

    assert paid("--scope", "fallback", "--max-calls", "50") == job.EXIT_TRY_LATER

    assert paid.uploaded == [person_feed(PERSON)[1], *company_feed(FAILED_ODPIS)]
    assert paid.summary["upload_failed"] == 1
    assert paid.run["counters"]["bought"] == 4


def test_sigterm_stops_after_the_call_in_hand(paid):
    def terminated(url):
        os.kill(os.getpid(), signal.SIGTERM)
        return '{"id": 1}'

    paid.answers = terminated

    assert paid("--scope", "fallback", "--max-calls", "50") == job.EXIT_TRY_LATER

    assert paid.uploaded == person_feed(PERSON)[:1]
    assert (paid.run["state"], paid.run["stopReason"]) == ("partial", "SIGTERM")


def test_a_dry_run_buys_nothing_writes_nothing_and_needs_no_key(paid, monkeypatch):
    def no_key(*args, **kwargs):
        raise AssertionError("made a rejestr.io client")

    monkeypatch.setattr(job, "UnattendedRejestr", no_key)
    monkeypatch.setattr(job, "Rejestr", no_key)

    assert paid("--scope", "fallback", "--max-calls", "50", "--dry-run") == 0
    assert paid("--dry-run") == 0

    assert paid.asked == [] and paid.objects == {} and paid.db.docs == {}


def test_without_a_key_the_night_says_so_before_building_anything(paid, monkeypatch):
    def no_key(*args, **kwargs):
        raise RuntimeError("No rejestr.io key: set REJESTR_KEY")

    monkeypatch.setattr(job, "UnattendedRejestr", no_key)

    assert paid("--scope", "fallback", "--max-calls", "50") == job.EXIT_FAILED

    assert paid.policies == [] and paid.db.docs == {}
