"""Asking api-krs unattended: what a run counts, when it stops, what it exits with."""

import json
import sys
from datetime import UTC, date, datetime

import pytest
import requests

import jobs.krs_bulletin as bulletin
import jobs.krs_scrape_free as job
from entities.company import KRS
from entities.person import RejestrIOKey
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

    def fake_run(sleep_time, summary, should_stop):
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

    def broken(sleep_time, summary, should_stop):
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
