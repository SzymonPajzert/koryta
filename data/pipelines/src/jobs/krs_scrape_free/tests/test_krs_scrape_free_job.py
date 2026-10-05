"""Asking api-krs unattended: what a run counts, when it stops, what it exits with."""

import json
import sys
import threading
from datetime import UTC, date, datetime

import pytest
import requests

import jobs.krs_bulletin as bulletin
import jobs.krs_scrape_free as job
from entities.company import KRS
from entities.person import RejestrIOKey
from jobs.krs_common import answer_name
from scrapers.krs.scrape import QueryType, RejestrIOQuery
from stores.storage import SHARED_BUCKET

BOTH_REGISTERS = [
    QueryType.API_KRS_ODPIS_AKTUALNY_P,
    QueryType.API_KRS_ODPIS_AKTUALNY_S,
]
AN_ODPIS = '{"odpis": {}}'


def company(n: int, queries=BOTH_REGISTERS) -> RejestrIOQuery:
    return RejestrIOQuery(krs=KRS(id=str(n)), queries=list(queries))


def summary_for(queries) -> job.RunSummary:
    return job.RunSummary(
        run="run-1", started="2026-10-03T00:30:00+02:00", queries=len(queries)
    )


def answering(answer):
    """A fetch answering each url with `answer(url)`, raising it if it is an error."""

    def fetch(url, verbose=True):
        result = answer(url)
        if isinstance(result, Exception):
            raise result
        return result

    return fetch


class Store:
    def __init__(self, failing=()):
        self.stored: dict[str, str] = {}
        self.failing = set(failing)

    def __call__(self, ctx, url, result, verbose=True) -> bool:
        if url in self.failing:
            return False
        self.stored[url] = result
        return True


def p_answers_s_is_empty(url):
    return AN_ODPIS if "rejestr=P" in url else None


def url_of(n: int, rejestr: str) -> str:
    return next(u for u in company(n).urls(only_free=True) if f"rejestr={rejestr}" in u)


@pytest.fixture(autouse=True)
def no_sleeping(monkeypatch):
    monkeypatch.setattr(job.time, "sleep", lambda seconds: None)


def test_every_answer_is_stored_and_a_complete_run_exits_0():
    queries = [company(1), company(2)]
    summary, store = summary_for(queries), Store()

    fetch = answering(p_answers_s_is_empty)
    job.scrape(None, queries, 0, summary, fetch=fetch, store=store)

    assert (summary.answered, summary.empty, summary.failed) == (2, 2, 0)
    # An empty answer is stored as an empty object, as before.
    assert store.stored[url_of(1, "S")] == ""
    assert store.stored[url_of(1, "P")] == AN_ODPIS
    assert summary.queries_done == 2
    assert summary.code() == 0


def test_a_failed_request_is_counted_and_the_run_carries_on():
    broken = url_of(1, "P")
    queries = [company(1), company(2)]
    summary, store = summary_for(queries), Store()

    def answer(url):
        if url == broken:
            return requests.ConnectionError("reset by peer")
        return p_answers_s_is_empty(url)

    job.scrape(None, queries, 0, summary, fetch=answering(answer), store=store)

    assert summary.failed == 1
    assert broken not in store.stored, "nothing stored, so the next run asks again"
    assert summary.queries_done == 2
    assert summary.errors == [f"{broken}: reset by peer"]
    assert summary.code() == job.EXIT_TRY_LATER


def test_an_answer_the_parser_refuses_does_not_end_the_run():
    """`query_krs_api` raises ValueError on a body it does not recognise."""
    odd = url_of(1, "S")
    queries = [company(1), company(2)]
    summary = summary_for(queries)

    def answer(url):
        return ValueError("Unexpected response") if url == odd else AN_ODPIS

    job.scrape(None, queries, 0, summary, fetch=answering(answer), store=Store())

    assert (summary.answered, summary.failed, summary.queries_done) == (3, 1, 2)


def test_a_run_stops_once_api_krs_stops_answering():
    queries = [company(n) for n in range(1, 31)]
    summary = summary_for(queries)

    job.scrape(
        None,
        queries,
        0,
        summary,
        fetch=answering(lambda url: requests.Timeout("read timed out")),
        store=Store(),
    )

    # Two requests a company, so the limit is reached on the tenth.
    assert summary.failed == job.MAX_CONSECUTIVE_FAILURES
    assert summary.queries_done == job.MAX_CONSECUTIVE_FAILURES // 2
    assert "in a row" in summary.stopped
    assert len(summary.errors) == job.ERRORS_KEPT
    assert summary.code() == job.EXIT_TRY_LATER


def test_an_answer_that_did_not_upload_is_counted():
    queries = [company(1)]
    summary = summary_for(queries)

    job.scrape(
        None,
        queries,
        0,
        summary,
        fetch=answering(lambda url: AN_ODPIS),
        store=Store(failing={url_of(1, "P")}),
    )

    assert (summary.answered, summary.upload_failed) == (2, 1)
    assert summary.code() == job.EXIT_TRY_LATER


def test_an_upload_that_raises_is_counted_too():
    class Raising(Store):
        def __call__(self, ctx, url, result, verbose=True) -> bool:
            if "rejestr=S" in url:
                raise RuntimeError("503 from storage")
            return super().__call__(ctx, url, result, verbose)

    queries = [company(1), company(2)]
    summary = summary_for(queries)

    job.scrape(
        None,
        queries,
        0,
        summary,
        fetch=answering(lambda url: AN_ODPIS),
        store=Raising(),
    )

    assert (summary.answered, summary.upload_failed) == (4, 2)


def test_answers_upload_while_the_next_ones_are_asked():
    """Uploaded in turn, the answers were 43% of the loop on 2026-10-02."""
    lock = threading.Lock()
    in_flight, most = 0, 0

    class Slow(Store):
        def __call__(self, ctx, url, result, verbose=True) -> bool:
            nonlocal in_flight, most
            with lock:
                in_flight += 1
                most = max(most, in_flight)
            threading.Event().wait(0.05)
            with lock:
                in_flight -= 1
            return super().__call__(ctx, url, result, verbose)

    queries = [company(n) for n in range(1, 9)]
    summary, store = summary_for(queries), Slow()

    job.scrape(
        None, queries, 0, summary, fetch=answering(lambda url: AN_ODPIS), store=store
    )

    assert most > 1
    assert len(store.stored) == 16, "every upload has landed when scrape returns"
    assert summary.upload_failed == 0


def test_an_answer_nothing_expected_does_not_end_the_run():
    """A KeyError out of the parser ended the run 894 companies in on 2026-10-02."""
    odd = url_of(1, "P")
    queries = [company(1), company(2)]
    summary, store = summary_for(queries), Store()

    def answer(url):
        return KeyError("miejscowosc") if url == odd else AN_ODPIS

    job.scrape(None, queries, 0, summary, fetch=answering(answer), store=store)

    assert (summary.answered, summary.failed, summary.queries_done) == (3, 1, 2)
    assert odd not in store.stored, "nothing stored, so the next run asks again"


def test_the_deadline_leaves_the_rest_of_the_queue_for_the_next_run():
    queries = [company(n) for n in range(1, 6)]
    summary = summary_for(queries)
    ticks = iter([0, 5, 10, 15, 20])
    should_stop = job.stop_rule(10, signalled=lambda: False, clock=lambda: next(ticks))
    fetch = answering(lambda url: AN_ODPIS)

    job.scrape(None, queries, 0, summary, should_stop, fetch=fetch, store=Store())

    assert summary.queries_done == 2
    assert summary.stopped == "deadline"
    assert summary.code() == job.EXIT_TRY_LATER


def test_sigterm_stops_after_the_company_in_hand():
    queries = [company(1), company(2)]
    summary = summary_for(queries)
    signalled = []

    def answer(url):
        signalled.append(True)
        return AN_ODPIS

    should_stop = job.stop_rule(None, signalled=lambda: bool(signalled))
    fetch = answering(answer)
    job.scrape(None, queries, 0, summary, should_stop, fetch=fetch, store=Store())

    assert (summary.queries_done, summary.answered) == (1, 2)
    assert summary.stopped == "SIGTERM"


def test_only_companies_with_a_free_url_are_queued():
    free = company(1)
    paid_only = company(2, [QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE])
    person = RejestrIOQuery(
        person=RejestrIOKey(id="123"),
        queries=[QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_AKTUALNE],
    )

    assert job.free_queries([person, paid_only, free]) == [free]


def test_the_queue_is_rebuilt_without_the_people_merge(monkeypatch):
    seen = {}

    def setup_context(policy):
        seen["policy"] = policy
        return "ctx", None

    class Queue:
        def read_or_process_list(self, ctx):
            return [company(1)]

    monkeypatch.setattr(job, "setup_context", setup_context)
    monkeypatch.setattr(job, "ScrapeRejestrIO", Queue)

    assert job.build_queue() == ("ctx", [company(1)])
    policy = seen["policy"]
    assert policy.should_refresh("ScrapeRejestrIO")
    assert not policy.should_refresh("PeopleMerged")
    assert "PeopleMerged" in policy.exclude_refresh


class Client:
    def __init__(self, error: Exception | None = None):
        self.error = error
        self.created: list[tuple[str, str, bytes, str]] = []

    def create_object(self, bucket, name, data, content_type):
        if self.error:
            raise self.error
        self.created.append((bucket, name, data, content_type))
        return f"gs://{bucket}/{name}"


def test_the_summary_is_written_once_under_the_day_the_run_started():
    summary = summary_for([company(1)])
    summary.exit_code = 0
    client = Client()

    url = job.write_summary(summary, client)

    [(bucket, name, data, content_type)] = client.created
    assert bucket == SHARED_BUCKET
    assert name == "jobs/krs_scrape_free/runs/date=2026-10-03/run-1.json"
    assert url == f"gs://{SHARED_BUCKET}/{name}"
    assert content_type == "application/json"
    written = json.loads(data)
    assert written["queries"] == 1 and written["exit_code"] == 0
    assert written["finished"]


def test_a_summary_that_cannot_be_written_does_not_fail_the_run():
    summary = summary_for([company(1)])

    assert job.write_summary(summary, Client(error=PermissionError("403"))) == ""


def test_the_job_keeps_its_flags_from_the_pipelines(monkeypatch):
    seen = {}

    def fake_run(sleep_time, summary, should_stop, status=None):
        seen["argv"] = list(sys.argv)
        seen["sleep_time"] = sleep_time
        summary.queries = summary.queries_done = 1
        return summary

    monkeypatch.setattr(job, "scrape_krs_free", fake_run)
    monkeypatch.setattr(job, "write_summary", lambda summary: "")
    monkeypatch.setattr(sys, "argv", ["koryta_scrape_krs_free", "--max-minutes", "170"])

    code = job.main(["--max-minutes", "170", "--interval", "0.5"])

    assert seen == {"argv": ["koryta_scrape_krs_free"], "sleep_time": 0.5}
    assert code == 0


def test_a_crash_is_recorded_before_it_ends_the_run(monkeypatch):
    written = []

    def broken(sleep_time, summary, should_stop, status=None):
        raise RuntimeError("CompaniesKRS failed")

    monkeypatch.setattr(job, "scrape_krs_free", broken)
    monkeypatch.setattr(job, "write_summary", written.append)

    with pytest.raises(RuntimeError):
        job.main([])

    [summary] = written
    assert summary.stopped == "raised RuntimeError"
    assert "CompaniesKRS failed" in summary.errors[0]


def test_the_bulletin_day_ends_at_midnight_in_warsaw(monkeypatch):
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            # 00:30 in Warsaw in summer, still the 2nd in UTC.
            return datetime(2026, 10, 2, 22, 30, tzinfo=UTC).astimezone(tz)

    monkeypatch.setattr(bulletin, "datetime", Clock)

    assert bulletin.warsaw_today() == date(2026, 10, 3)


def test_a_bulletin_day_on_file_is_not_asked_for_again():
    """Asked by KRSUpdates' rows, a day nobody's entry changed on looked
    unfetched: 2025-09-20 and 09-21 were fetched again on every run."""
    on_file = {"2025-06-01", "2025-06-03"}  # 06-03 named nobody

    assert bulletin.days_to_fetch(on_file, date(2025, 6, 5)) == [
        "2025-06-02",
        "2025-06-04",
    ]


def test_a_bulletin_day_long_missing_at_the_source_does_not_fail_the_run():
    """2025-11-21..27 answer HTTP 500 every time: counted, every run exited 75."""
    run = bulletin.BulletinRun()
    today = date(2026, 10, 3)

    run.missed("2025-11-21", today)
    run.missed("2026-10-02", today)

    assert (run.unavailable, run.failed) == (["2025-11-21"], ["2026-10-02"])
    summary = summary_for([])
    summary.bulletin_unavailable = run.unavailable
    assert summary.code() == 0
    summary.bulletin_failed = run.failed
    assert summary.code() == job.EXIT_TRY_LATER


def test_what_the_bucket_holds_for_today_is_not_asked_again():
    """Asked again, the answer is refused as already there: on 2026-10-02 a
    run asked 256 requests that an earlier run had, for nothing."""
    held = {answer_name(url_of(1, "P"), job.today())}
    asked: list[str] = []

    def fetch(url, verbose=True):
        asked.append(url)
        return AN_ODPIS

    queries = [company(1)]
    summary = summary_for(queries)
    job.scrape(None, queries, 0, summary, fetch=fetch, store=Store(), held_today=held)

    assert asked == [url_of(1, "S")]
    assert (summary.asked_today, summary.answered, summary.queries_done) == (1, 1, 1)


# ---------------------------------------------------------------------------
# What the run reports to /admin/procesy (stores.job_runs)


class RecordingRun:
    """Stands in for `JobRun`, keeping what the job told it."""

    def __init__(self, job_id, **kwargs):
        self.job = job_id
        self.kwargs = kwargs
        self.calls: list[tuple[str, dict]] = []

    def start(self, *, phase=None):
        self.calls.append(("start", {"phase": phase}))
        return self

    def progress(self, done=None, **kwargs):
        self.calls.append(("progress", {"done": done, **kwargs}))

    def finish(self, state, **kwargs):
        self.calls.append(("finish", {"state": state, **kwargs}))

    def ending(self) -> dict:
        [end] = [args for call, args in self.calls if call == "finish"]
        return end


@pytest.fixture
def runs(monkeypatch) -> list[RecordingRun]:
    made: list[RecordingRun] = []

    def record(job_id, **kwargs):
        made.append(RecordingRun(job_id, **kwargs))
        return made[-1]

    monkeypatch.setattr(job, "JobRun", record)
    return made


SUMMARY_URL = f"gs://{SHARED_BUCKET}/jobs/krs_scrape_free/runs/date=2026-10-03/r.json"


def a_night(monkeypatch, outcome, summary_url=SUMMARY_URL):
    """Run `main` with the scrape replaced by `outcome(summary)`."""

    def fake_run(sleep_time, summary, should_stop, status=None):
        outcome(summary)
        return summary

    monkeypatch.setattr(job, "scrape_krs_free", fake_run)
    monkeypatch.setattr(job, "write_summary", lambda summary: summary_url)
    return job.main([])


def test_a_complete_night_is_reported_as_a_success(monkeypatch, runs):
    def everything(summary):
        summary.queries = summary.queries_done = 2
        summary.answered, summary.empty = 3, 1
        summary.bulletin_fetched = ["2026-10-02"]

    assert a_night(monkeypatch, everything) == 0

    [run] = runs
    assert run.job == "krs_scrape_free"
    assert run.kwargs["unit"] == "firm"
    assert run.calls[0] == ("start", {"phase": "biuletyn"})
    assert run.ending() == {
        "state": "succeeded",
        "stop_reason": None,
        "errors": [],
        "exit_code": 0,
        "counters": {
            "answered": 3,
            "empty": 1,
            "failed": 0,
            "upload_failed": 0,
            "bulletin_fetched": 1,
            "bulletin_failed": 0,
        },
        "done": 2,
        "summary_path": SUMMARY_URL,
    }


def test_the_run_is_reported_under_the_summarys_id(monkeypatch, runs):
    ids = []

    def note_id(summary):
        ids.append(summary.run)

    a_night(monkeypatch, note_id)

    assert runs[0].kwargs["run_id"] == ids[0]


@pytest.mark.parametrize(
    ("stop", "state"),
    [
        ("deadline", "partial"),
        ("SIGTERM", "partial"),
        ("20 requests in a row failed", "failed"),
    ],
)
def test_an_early_stop_is_partial_unless_api_krs_refused(
    monkeypatch, runs, stop, state
):
    def stopped(summary):
        summary.queries, summary.queries_done = 10, 4
        summary.stopped = stop

    assert a_night(monkeypatch, stopped) == job.EXIT_TRY_LATER

    end = runs[0].ending()
    assert (end["state"], end["stop_reason"], end["exit_code"]) == (state, stop, 75)
    assert end["done"] == 4


def test_the_stop_scrape_writes_when_refused_is_the_one_read_as_a_failure():
    queries = [company(n) for n in range(1, 31)]
    summary = summary_for(queries)
    timeout = answering(lambda url: requests.Timeout("read timed out"))

    job.scrape(None, queries, 0, summary, fetch=timeout, store=Store())

    assert job.run_state(summary) == "failed"


@pytest.mark.parametrize(
    "left",
    [
        {"failed": 1},
        {"upload_failed": 1},
        {"bulletin_failed": ["2026-10-02"]},
    ],
)
def test_a_few_misses_are_partial_not_failed(monkeypatch, runs, left):
    def mostly(summary):
        summary.queries = summary.queries_done = 3
        for name, value in left.items():
            setattr(summary, name, value)

    assert a_night(monkeypatch, mostly) == job.EXIT_TRY_LATER

    assert runs[0].ending()["state"] == "partial"


def test_a_summary_that_was_not_written_is_not_linked(monkeypatch, runs):
    def everything(summary):
        summary.queries = summary.queries_done = 1

    a_night(monkeypatch, everything, summary_url="")

    assert runs[0].ending()["summary_path"] is None


def test_a_crash_is_reported_as_a_failure(monkeypatch, runs):
    def broken(sleep_time, summary, should_stop, status=None):
        raise RuntimeError("CompaniesKRS failed")

    monkeypatch.setattr(job, "scrape_krs_free", broken)
    monkeypatch.setattr(job, "write_summary", lambda summary: SUMMARY_URL)

    with pytest.raises(RuntimeError):
        job.main([])

    end = runs[0].ending()
    assert (end["state"], end["stop_reason"]) == ("failed", "raised RuntimeError")
    assert end["exit_code"] is None
    assert "CompaniesKRS failed" in end["errors"][0]
    assert end["summary_path"] == SUMMARY_URL
    assert end["done"] is None, "it never got to the queue"


def test_a_crash_after_twenty_failed_requests_is_the_error_the_page_keeps(
    monkeypatch, runs
):
    summaries: list[job.RunSummary] = []

    def broken(sleep_time, summary, should_stop, status=None):
        summary.errors = [f"{url_of(n, 'P')}: timeout" for n in range(job.ERRORS_KEPT)]
        raise RuntimeError("the odpis parser crashed")

    monkeypatch.setattr(job, "scrape_krs_free", broken)
    monkeypatch.setattr(
        job, "write_summary", lambda summary: summaries.append(summary) or ""
    )

    with pytest.raises(RuntimeError):
        job.main([])

    errors = runs[0].ending()["errors"]
    assert "the odpis parser crashed" in errors[0]
    assert errors[1:] == [f"{url_of(n, 'P')}: timeout" for n in range(20)]
    # The summary in the shared cache keeps them all, in the order they came.
    [summary] = summaries
    assert len(summary.errors) == 21 and "crashed" in summary.errors[-1]


def test_ctrl_c_leaves_the_rest_for_the_next_run(monkeypatch, runs):
    def interrupted(sleep_time, summary, should_stop, status=None):
        summary.queries, summary.queries_done = 10, 3
        raise KeyboardInterrupt

    monkeypatch.setattr(job, "scrape_krs_free", interrupted)
    monkeypatch.setattr(job, "write_summary", lambda summary: "")

    with pytest.raises(KeyboardInterrupt):
        job.main([])

    end = runs[0].ending()
    assert (end["state"], end["stop_reason"]) == ("partial", "raised KeyboardInterrupt")
    assert end["done"] == 3


def test_a_dry_run_reports_nothing(monkeypatch, runs):
    monkeypatch.setattr(job, "build_queue", lambda: ("ctx", []))

    assert job.main(["--dry-run"]) == 0

    assert runs == []


def test_each_phase_is_reported_as_it_begins_and_each_company_as_it_is_done(
    monkeypatch,
):
    monkeypatch.setattr(
        job,
        "scrape_updates_by_dates",
        lambda sleep_time: bulletin.BulletinRun(fetched=["2026-10-02"]),
    )
    monkeypatch.setattr(job, "build_queue", lambda: ("ctx", [company(1), company(2)]))
    monkeypatch.setattr(job, "answered_today", lambda ctx, day: set())

    def scrape(
        ctx, queries, sleep_time, summary, should_stop, fetch, held_today, progress
    ):
        for _ in queries:
            summary.answered += 2
            summary.queries_done += 1
            progress()

    monkeypatch.setattr(job, "scrape", scrape)
    status = RecordingRun("krs_scrape_free")

    job.scrape_krs_free(0, summary_for([]), status=status)  # type: ignore[arg-type]

    reported = [
        (args["phase"], args["done"], args["total"], args["force"])
        for call, args in status.calls
    ]
    assert reported == [
        ("kolejka", None, None, True),
        ("odpisy", 0, 2, True),
        (None, 1, 2, False),
        (None, 2, 2, False),
    ]
    assert status.calls[0][1]["counters"]["bulletin_fetched"] == 1
    assert status.calls[-1][1]["counters"]["answered"] == 4


def test_scrape_reports_after_every_company():
    queries = [company(1), company(2)]
    summary = summary_for(queries)
    seen: list[int] = []

    job.scrape(
        None,
        queries,
        0,
        summary,
        fetch=answering(lambda url: AN_ODPIS),
        store=Store(),
        progress=lambda: seen.append(summary.queries_done),
    )

    assert seen == [1, 2]
