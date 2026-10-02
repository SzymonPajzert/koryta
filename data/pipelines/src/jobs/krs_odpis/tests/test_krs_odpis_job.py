"""The odpis job: who is asked, how politely, what is kept, and what it exits with.

Nothing here reaches the ministry or a bucket: the service is a table, the
bucket a list, the clock a counter.
"""

import gzip
import json

import pandas as pd
import pytest
import requests

import jobs.krs_odpis as job
from entities.company import KRS
from entities.person import RejestrIOKey
from jobs.krs_odpis import crawl, plan, search
from jobs.krs_odpis.log import RUN_LOG, RunLog
from scrapers.krs import odpis_files
from scrapers.krs.scrape import QueryType, RejestrIOQuery

A, B, C, D = "0000000029", "0000000031", "0000000041", "0000000043"
TODAY = "2026-10-02"


# ------------------------------------------------------------------ the plan
def test_a_krs_file_reads_hints_and_skips_comments(tmp_path):
    path = tmp_path / "todo.tsv"
    path.write_text(f"# head\n{A}\tS\t5250001090\t3\n\n{B}\n{A}\tP\n{C}\tX\n")
    assert plan.read_krs_file(path) == [
        plan.Candidate(A, plan.REASON_FILE, hint="S"),
        plan.Candidate(B, plan.REASON_FILE),
        plan.Candidate(C, plan.REASON_FILE),
    ]


def test_a_krs_file_refuses_what_is_not_a_krs(tmp_path):
    path = tmp_path / "todo.tsv"
    path.write_text(f"{A}\n123\n")
    with pytest.raises(SystemExit, match="todo.tsv:2"):
        plan.read_krs_file(path)


def test_only_the_company_part_of_the_queue_is_taken():
    queries = [
        RejestrIOQuery(
            krs=KRS("29"),
            queries=[
                QueryType.API_KRS_ODPIS_AKTUALNY_P,
                QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE,
                QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_HISTORYCZNE,
            ],
            reasons=["refresh", "owned"],
        ),
        RejestrIOQuery(
            person=RejestrIOKey("2145029"),
            queries=[QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_AKTUALNE],
        ),
        RejestrIOQuery(krs=KRS("31"), queries=[QueryType.REJESTRIO_ORG]),
        RejestrIOQuery(krs=KRS("29"), queries=[QueryType.REJESTRIO_ORG]),
    ]
    assert plan.from_queries(queries) == [
        plan.Candidate(A, "refresh", paid_calls=2),
        plan.Candidate(B, "unrecorded", paid_calls=0),
    ]


def test_a_404_in_one_register_hints_the_other():
    settled = {
        A: {QueryType.API_KRS_ODPIS_AKTUALNY_S},
        B: {QueryType.API_KRS_ODPIS_AKTUALNY_P},
        C: {QueryType.API_KRS_ODPIS_AKTUALNY_P, QueryType.API_KRS_ODPIS_AKTUALNY_S},
    }
    assert plan.register_hints(settled) == {A: "P", B: "S"}


def stored(krs, day, register="P"):
    name = odpis_files.blob_name(krs, register, day)
    return odpis_files.StoredOdpis(krs=krs, register=register, day=day, blob=name)


def test_select_asks_the_new_and_the_changed_and_keeps_order():
    candidates = [plan.Candidate(k, "owned") for k in (A, B, C, D)]
    held = {
        B: stored(B, "2026-09-14", register="S"),  # moved on the day it was fetched
        C: stored(C, "2026-09-14"),  # unchanged since
        D: stored(D, TODAY),  # fetched today
    }
    changes = {B: "2026-09-14", C: "2026-09-13"}
    the_plan = plan.select(candidates, held, changes, {A: "S"}, TODAY, limit=10)
    assert [(a.krs, a.registers, a.refresh) for a in the_plan.asks] == [
        (A, ("S", "P"), False),
        (B, ("S", "P"), True),
    ]
    assert (the_plan.held, the_plan.fetched_today, the_plan.deferred) == (1, 1, 0)


def test_the_cap_defers_rather_than_drops_and_a_file_hint_wins():
    candidates = [plan.Candidate(A, "f", hint="S"), plan.Candidate(B, "f")]
    the_plan = plan.select(candidates, {}, {}, {A: "P"}, TODAY, limit=1)
    assert [(a.krs, a.registers) for a in the_plan.asks] == [(A, ("S", "P"))]
    assert the_plan.deferred == 1


def test_the_graph_puts_its_public_companies_first():
    companies = pd.DataFrame(
        {"krs": ["31", A, C, "31"], "is_public": [False, True, None, False]}
    )
    assert [(c.krs, c.reason) for c in plan.from_graph(companies)] == [
        (A, plan.REASON_GRAPH),
        (B, plan.REASON_GRAPH),
        (C, plan.REASON_GRAPH),
    ]


def test_changed_since_keeps_what_the_bulletin_names_on_or_after_the_day():
    candidates = [plan.Candidate(k, "graph") for k in (A, B, C)]
    changes = {A: "2026-09-25", B: "2026-09-24"}
    kept = plan.changed_since(candidates, changes, "2026-09-25")
    assert [c.krs for c in kept] == [A]


def test_the_report_says_what_the_paid_job_would_have_bought():
    the_plan = plan.Plan(asks=[plan.Ask(A, ("P", "S"), "refresh", paid_calls=2)])
    text = plan.report(the_plan, [1, 2], "ScrapeRejestrIO")
    assert "2 rejestr.io connection calls" in text and "0.10 PLN" in text


# ----------------------------------------------------------------- the crawl
class Service:
    """Answers in turn: bytes, None (in neither register) or an exception."""

    def __init__(self, answers):
        self.answers = list(answers)
        self.asked = []

    def __call__(self, ask):
        self.asked.append(ask.krs)
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return None if answer is None else ("P", answer)


class Clock:
    """Each fetch takes `step` seconds; nothing else takes time."""

    def __init__(self, steps):
        self.steps = list(steps)
        self.now = 0.0
        self.calls = 0

    def __call__(self):
        self.calls += 1
        if self.calls % 2 == 0:  # the second reading of a fetch
            self.now += self.steps.pop(0) if self.steps else 1.0
        return self.now


def asks(n):
    return [plan.Ask(f"{i:010d}", ("P", "S"), "owned") for i in range(1, n + 1)]


def run(answers, n, steps=(), **kwargs):
    record = []
    result = crawl.crawl(
        asks(n),
        Service(answers),
        record.append,
        0.5,
        sleep=lambda s: None,
        clock=Clock(steps),
        say=lambda m: None,
        **kwargs,
    )
    return result, record


GATEWAY = search.OdpisUnavailable("HTTP 504", status=504)


def test_every_attempt_is_recorded_and_classified():
    result, record = run(
        [b"%PDF", None, GATEWAY, requests.ConnectionError("DNS"), ValueError("bug")]
        + [b"%PDF", b"%PDF"],
        5,
    )
    first = [o.status for o in record[:5]]
    assert first == ["fetched", "absent", "gateway", "network", "failed"]
    # the gateway and the network get a second try; the rest stand
    assert [(o.krs, o.attempt, o.status) for o in record[5:]] == [
        ("0000000003", 2, "fetched"),
        ("0000000004", 2, "fetched"),
    ]
    assert result.unanswered == ["0000000005"]
    assert result.code == crawl.EXIT_UPSTREAM_REFUSING


def test_a_clean_run_exits_zero():
    result, _ = run([b"%PDF"] * 3 + [None], 4)
    assert (result.stopped, result.code) == ("", 0)


def test_twenty_dead_attempts_in_a_row_stop_the_run():
    result, record = run([requests.Timeout("t")] * 25, 25)
    assert len(record) == crawl.MAX_CONSECUTIVE_FAILURES
    assert "in a row" in result.stopped and result.code == 75


def test_a_slowing_service_stops_the_run_without_a_second_pass():
    steps = [0.5] * 50 + [3.0] * 50
    result, record = run([b"%PDF"] * 120, 120, steps=steps)
    assert "ceiling" in result.stopped
    assert len(record) < 120 and all(o.attempt == 1 for o in record)


def test_asked_to_stop_stops_before_the_next_company():
    calls = iter([False, False, True])
    result, record = run([b"%PDF"] * 5, 5, should_stop=lambda: next(calls))
    assert len(record) == 2 and result.stopped == "asked to stop"


def test_the_stop_rule():
    window = [0.8] * crawl.WINDOW
    assert crawl.stop_reason(window, 0.8, [0] * 50) == ""
    assert "ceiling" in crawl.stop_reason([2.6] * 50, 0.8, [0] * 50)
    assert crawl.stop_reason(window, 0.8, [1] * 10 + [0] * 40) == ""
    assert "got no answer" in crawl.stop_reason(window, 0.8, [1] * 11 + [0] * 39)
    assert crawl.stop_reason([2.6] * 49, 0.8, [1] * 11) == ""


# ------------------------------------------------------------ the run record
def test_the_record_is_written_once_per_part_and_survives_a_failed_write():
    written, refuse = {}, [True]

    def put(name, data):
        if refuse.pop(0) if refuse else False:
            raise RuntimeError("503")
        written[name] = data
        return name

    log = RunLog(put, "run1", flush_every=2, now=lambda: pd.Timestamp("2026-10-02"))
    outcome = crawl.Outcome(A, "fetched", "owned", False, 1, 0.8, "P", 1000)
    log.add(outcome)
    with pytest.raises(RuntimeError):
        log.add(outcome)  # the first flush fails and keeps both pending
    log.add(outcome)
    log.flush()
    name = f"{RUN_LOG.prefix}date=2026-10-02/run1-00000.jsonl.gz"
    assert list(written) == [name]
    lines = gzip.decompress(written[name]).decode().splitlines()
    assert len(lines) == 3 and json.loads(lines[0])["krs"] == A
    assert log.attempts_written == 3


# ------------------------------------------------------------------- the job
def test_one_crawler_at_a_time(tmp_path):
    lock = tmp_path / "locks" / "service.lock"
    with job.one_crawler(lock):
        with pytest.raises(job.CrawlerRunning), job.one_crawler(lock):
            pass
    with job.one_crawler(lock):
        pass


class FakeClient:
    def __init__(self):
        self.objects = {}

    def create_object(self, bucket, blob_name, data, content_type):
        self.objects[(bucket, blob_name)] = (data, content_type)
        return f"gs://{bucket}/{blob_name}"


def test_a_run_files_each_pdf_and_records_each_attempt(monkeypatch):
    answers = {(A, "S"): b"%PDF-A", (B, "P"): None, (B, "S"): None}
    monkeypatch.setattr(
        search,
        "fetch_odpis_pdf",
        lambda krs, register="P", full=True, session=None, timeout=60.0: answers.get(
            (krs, register)
        ),
    )
    monkeypatch.setattr(job, "warsaw_day", lambda: TODAY)
    client = FakeClient()
    the_plan = plan.Plan(
        asks=[plan.Ask(A, ("S", "P"), "file"), plan.Ask(B, ("P", "S"), "file")]
    )
    code = job.run(the_plan, interval=0, flush_every=100, client=client, session=None)
    assert code == 0
    pdfs = {k: v for k, v in client.objects.items() if k[0] == "koryta-pl-crawled"}
    assert pdfs == {
        ("koryta-pl-crawled", odpis_files.blob_name(A, "S", TODAY)): (
            b"%PDF-A",
            "application/pdf",
        )
    }
    records = [k for k in client.objects if k[0] == "koryta-pl-sharedcache"]
    assert len(records) == 1 and records[0][1].startswith(RUN_LOG.prefix)


@pytest.fixture
def offline(monkeypatch):
    """`main` with the pipelines and the service swapped out; returns its policies."""
    policies = []

    def setup_context(policy):
        policies.append(policy)
        return object(), None

    monkeypatch.setattr(job, "setup_context", setup_context)
    monkeypatch.setattr(
        job, "bulletin_changes", lambda ctx: {A: TODAY, C: "2026-09-01"}
    )
    monkeypatch.setattr(
        job,
        "make_plan",
        lambda ctx, candidates, changes, today, limit: plan.select(
            candidates, {}, changes, {}, today, limit
        ),
    )
    monkeypatch.setattr(job, "run", lambda *a, **k: pytest.fail("asked the service"))
    return policies


def test_a_dry_run_plans_and_asks_nothing(tmp_path, offline, capsys):
    path = tmp_path / "todo.tsv"
    path.write_text(f"{A}\n")
    assert job.main(["--krs-file", str(path), "--dry-run", "--max", "5"]) == 0
    assert "Asking about 1" in capsys.readouterr().out
    # A file needs only the bulletin rebuilt, not the paid queue's pipelines.
    assert offline[0].refresh_pipelines == {"KRSUpdates"}


def test_the_queue_is_planned_without_the_people_merge(offline, monkeypatch, capsys):
    """The queue's people are the paid job's; its merge was most of a 10 GB peak."""
    monkeypatch.setattr(
        job, "queue_candidates", lambda ctx: [plan.Candidate(krs=A, reason="owned")]
    )

    assert job.main(["--dry-run"]) == 0

    [policy] = offline
    assert policy.should_refresh("ScrapeRejestrIO")
    assert not policy.should_refresh("PeopleMerged")


def test_the_weekly_refresh_asks_about_the_graph_the_bulletin_names(
    offline, monkeypatch, capsys
):
    monkeypatch.setattr(
        job,
        "graph_candidates",
        lambda ctx: plan.from_graph(pd.DataFrame({"krs": [A, B, C]})),
    )
    argv = ["--graph", "--changed-since", "2026-09-25", "--dry-run"]
    assert job.main(argv) == 0
    out = capsys.readouterr().out
    assert "1 companies from CompaniesKRS the bulletin names since 2026-09-25" in out
    assert "Asking about 1" in out


def test_a_day_that_is_not_a_day_is_refused(capsys):
    with pytest.raises(SystemExit):
        job.parser().parse_args(["--graph", "--changed-since", "last week"])
    assert "YYYY-MM-DD" in capsys.readouterr().err


def test_a_file_and_the_graph_are_one_or_the_other(capsys):
    with pytest.raises(SystemExit):
        job.parser().parse_args(["--graph", "--krs-file", "todo.tsv"])
