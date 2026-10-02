"""Asking the register, writing the answers down, and stopping cleanly."""

import gzip
import sys
from datetime import datetime

import pandas as pd
import pytest

import jobs.krs_register_owners as job
from jobs.krs_register_owners import fetch
from jobs.krs_register_owners.log import ResponseLog
from scrapers.krs.register import (
    RESPONSE_LOG,
    STATUS_FAILED,
    STATUS_NOT_FOUND,
    STATUS_OK,
    STATUS_STRUCK_OFF,
    RegisterRead,
)

AN_ODPIS = {"odpis": {"naglowekA": {"numerKRS": "0000225512"}, "dane": {}}}
NOT_FOUND = {"title": "Not Found", "status": 404}


def clock() -> datetime:
    return datetime.fromisoformat("2026-09-29T10:00:00+02:00")


class Response:
    def __init__(self, status_code: int, body: dict | None = None):
        self.status_code = status_code
        self.body = body

    def json(self):
        return self.body


class Session:
    """Answers each register from a script, one response per request."""

    def __init__(self, **by_register: list[Response]):
        self.by_register = by_register
        self.asked: list[str] = []

    def get(self, url: str, timeout: float) -> Response:
        rejestr = url.split("rejestr=")[1][0]
        self.asked.append(rejestr)
        return self.by_register[rejestr].pop(0)


@pytest.fixture(autouse=True)
def no_sleeping(monkeypatch):
    monkeypatch.setattr(fetch.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(job.time, "sleep", lambda seconds: None)


def ask(session: Session) -> RegisterRead:
    return fetch.ask(session, "0000225512", 0, clock, "run-1")  # type: ignore[arg-type]


def test_a_204_is_an_entry_that_was_struck_off():
    # 0000758251 answers 204 in P and 404 in S; S is never needed.
    session = Session(P=[Response(204)])

    read = ask(session)

    assert (read.status, read.rejestr) == (STATUS_STRUCK_OFF, "P")
    assert session.asked == ["P"]


def test_the_other_register_is_asked_when_the_first_has_nothing():
    session = Session(P=[Response(404, NOT_FOUND)], S=[Response(200, AN_ODPIS)])

    read = ask(session)

    assert (read.status, read.rejestr, read.body) == (STATUS_OK, "S", AN_ODPIS)
    assert (read.read_at, read.run) == ("2026-09-29T10:00:00+02:00", "run-1")


def test_a_not_found_body_on_a_200_is_a_miss_too():
    session = Session(P=[Response(200, NOT_FOUND)], S=[Response(404, NOT_FOUND)])

    assert ask(session).status == STATUS_NOT_FOUND


@pytest.mark.parametrize("body", [{"title": "Service Unavailable"}, [], None])
def test_a_200_that_is_neither_an_odpis_nor_a_miss_is_a_failure(body):
    session = Session(P=[Response(200, body)])

    read = ask(session)

    assert (read.status, read.rejestr) == (STATUS_FAILED, "P")
    assert read.error is not None and read.error.startswith("200: ")


def test_a_server_error_is_a_failure_to_ask_again():
    session = Session(P=[Response(503), Response(503), Response(503)])

    read = ask(session)

    assert (read.status, read.error) == (STATUS_FAILED, "HTTP 503")
    assert session.asked == ["P", "P", "P"]


class Bucket:
    """A write-once store, as `Client.create_object` is."""

    def __init__(self, fail_first: int = 0):
        self.objects: dict[str, bytes] = {}
        self.fail_first = fail_first

    def put(self, name: str, data: bytes) -> str:
        if self.fail_first:
            self.fail_first -= 1
            raise OSError("503 from GCS")
        assert name not in self.objects, f"{name} written twice"
        self.objects[name] = data
        return f"gs://bucket/{name}"

    def reads(self) -> list[RegisterRead]:
        return [
            RegisterRead.from_line(line)
            for name in sorted(self.objects)
            for line in gzip.decompress(self.objects[name]).decode().splitlines()
        ]


def a_read(krs: str, status=STATUS_STRUCK_OFF) -> RegisterRead:
    return RegisterRead(krs, "2026-09-29T10:00:00+02:00", status, "P")


def test_a_part_is_written_every_so_many_reads_and_at_the_end():
    bucket = Bucket()
    log = ResponseLog(bucket.put, "run-1", flush_every=2)
    for krs in ("1", "2", "3"):
        log.add(a_read(krs))
    log.flush()

    assert sorted(bucket.objects) == [
        f"{RESPONSE_LOG.prefix}date=2026-09-29/run-1-00000.jsonl.gz",
        f"{RESPONSE_LOG.prefix}date=2026-09-29/run-1-00001.jsonl.gz",
    ]
    assert [r.krs for r in bucket.reads()] == ["1", "2", "3"]
    assert log.reads_written == 3


def test_a_part_that_failed_to_write_is_kept_for_the_next_flush():
    bucket = Bucket(fail_first=1)
    log = ResponseLog(bucket.put, "run-1", flush_every=10)
    log.add(a_read("1"))

    with pytest.raises(OSError):
        log.flush()
    log.flush()

    assert [r.krs for r in bucket.reads()] == ["1"]


def test_every_answer_is_logged_and_flushed(monkeypatch):
    answers = iter([a_read("1"), a_read("2", STATUS_OK)])
    monkeypatch.setattr(job, "ask", lambda *args: next(answers))
    bucket = Bucket()

    code = job.read_register(["1", "2"], ResponseLog(bucket.put, "run-1"), 0, "run-1")

    assert code == 0
    assert [r.krs for r in bucket.reads()] == ["1", "2"]


def test_a_run_of_failures_stops_the_job_as_a_temporary_failure(monkeypatch):
    monkeypatch.setattr(job, "ask", lambda s, krs, *a: a_read(krs, STATUS_FAILED))
    bucket = Bucket()
    todo = [str(n) for n in range(job.MAX_CONSECUTIVE_FAILURES + 5)]

    code = job.read_register(todo, ResponseLog(bucket.put, "run-1"), 0, "run-1")

    assert code == job.EXIT_UPSTREAM_REFUSING
    assert len(bucket.reads()) == job.MAX_CONSECUTIVE_FAILURES


def test_the_jobs_flags_never_reach_the_pipelines(monkeypatch):
    """PeoplePKW reads --limit, and `--lim`, off sys.argv on its own."""
    seen: list[list[str]] = []

    def setup_context(**kwargs):
        seen.append(list(sys.argv))
        raise RuntimeError("stop here")

    monkeypatch.setattr(job, "setup_context", setup_context)
    monkeypatch.setattr(sys, "argv", ["koryta_krs_register_owners", "--reads", "5"])

    with pytest.raises(RuntimeError, match="stop here"):
        job.main(["--reads", "5"])

    assert seen == [["koryta_krs_register_owners"]]


def test_an_unknown_flag_is_refused_rather_than_passed_on():
    with pytest.raises(SystemExit):
        job.parser().parse_args(["--lim", "5"])


def test_a_retried_flush_sends_the_same_bytes(monkeypatch):
    """So `create_object` can tell its own landed write from a reused name."""
    ticks = iter([1_800_000_000.0, 1_800_000_060.0])
    monkeypatch.setattr(gzip.time, "time", lambda: next(ticks))  # gzip stamps it
    sent: list[bytes] = []

    def put(name: str, data: bytes) -> str:
        sent.append(data)
        if len(sent) == 1:
            raise OSError("response lost")
        return name

    log = ResponseLog(put, "run-1")
    log.add(a_read("1"))
    with pytest.raises(OSError):
        log.flush()
    log.flush()

    assert sent[0] == sent[1]


# ---------------------------------------------------------------------------
# What the run reports to /admin/procesy (stores.job_runs)


class RecordingRun:
    """Stands in for `JobRun`, keeping what the job told it."""

    def __init__(self, job_id="krs_register_owners", **kwargs):
        self.job = job_id
        self.kwargs = kwargs
        self.calls: list[tuple[str, dict]] = []

    def __enter__(self):
        self.calls.append(("start", {}))
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.calls.append(("exit", {"raised": exc_type}))

    def progress(self, done=None, **kwargs):
        self.calls.append(("progress", {"done": done, **kwargs}))

    def finish(self, state, **kwargs):
        self.calls.append(("finish", {"state": state, **kwargs}))

    def ending(self) -> dict:
        [end] = [args for call, args in self.calls if call == "finish"]
        return end

    def done(self) -> list:
        return [args["done"] for call, args in self.calls if call == "progress"]


def read_with(monkeypatch, reads, todo):
    """`read_register` over `todo`, `ask` answering from `reads(krs)`."""
    monkeypatch.setattr(job, "ask", lambda session, krs, *args: reads(krs))
    status = RecordingRun()
    code = job.read_register(
        todo,
        ResponseLog(Bucket().put, "run-1"),
        0,
        "run-1",
        status=status,  # type: ignore[arg-type]
    )
    return code, status


def test_a_run_that_reads_everything_is_reported_as_a_success(monkeypatch):
    answers = {"1": STATUS_STRUCK_OFF, "2": STATUS_OK}

    code, status = read_with(
        monkeypatch, lambda krs: a_read(krs, answers[krs]), ["1", "2"]
    )

    assert code == 0
    assert status.done() == [0, 1, 2]
    assert status.calls[0][1]["total"] == 2
    assert status.ending() == {
        "state": "succeeded",
        "stop_reason": None,
        "errors": [],
        "exit_code": 0,
        "counters": {
            STATUS_OK: 1,
            STATUS_STRUCK_OFF: 1,
            STATUS_NOT_FOUND: 0,
            STATUS_FAILED: 0,
            "logged": 2,
        },
        "done": 2,
    }


def test_the_register_refusing_is_reported_as_a_failure(monkeypatch):
    def refused(krs):
        read = a_read(krs, STATUS_FAILED)
        read.error = "HTTP 503"
        return read

    todo = [str(n) for n in range(job.MAX_CONSECUTIVE_FAILURES + 5)]
    code, status = read_with(monkeypatch, refused, todo)

    assert code == job.EXIT_UPSTREAM_REFUSING
    end = status.ending()
    assert (end["state"], end["exit_code"]) == ("failed", 75)
    assert end["stop_reason"] == f"{job.MAX_CONSECUTIVE_FAILURES} reads in a row failed"
    assert end["errors"][:2] == ["0: HTTP 503", "1: HTTP 503"]
    assert end["counters"][STATUS_FAILED] == job.MAX_CONSECUTIVE_FAILURES


def test_sigterm_is_a_partial_run(monkeypatch):
    handlers = []

    def install(signum, handler):
        handlers.append(handler)

    monkeypatch.setattr(job.signal, "signal", install)

    def read_then_sigterm(krs):
        handlers[0](15, None)
        return a_read(krs)

    code, status = read_with(monkeypatch, read_then_sigterm, ["1", "2", "3"])

    assert code == 0
    end = status.ending()
    assert (end["state"], end["stop_reason"], end["done"]) == ("partial", "SIGTERM", 1)


def test_ctrl_c_is_a_partial_run(monkeypatch):
    def interrupted_on_the_second(krs):
        if krs == "2":
            raise KeyboardInterrupt
        return a_read(krs)

    code, status = read_with(monkeypatch, interrupted_on_the_second, ["1", "2", "3"])

    assert code == 0
    end = status.ending()
    assert (end["state"], end["stop_reason"], end["done"]) == (
        "partial",
        "przerwany",
        1,
    )


@pytest.fixture
def runs(monkeypatch) -> list[RecordingRun]:
    made: list[RecordingRun] = []

    def record(job_id, **kwargs):
        made.append(RecordingRun(job_id, **kwargs))
        return made[-1]

    monkeypatch.setattr(job, "JobRun", record)
    return made


@pytest.fixture
def a_queue(monkeypatch):
    class Queue:
        def read_or_process(self, ctx):
            return pd.DataFrame({"krs": [1, 2, 3], "reason": ["new", "new", "changed"]})

    monkeypatch.setattr(job, "setup_context", lambda **kwargs: ("ctx", None))
    monkeypatch.setattr(job, "KRSRegisterQueue", Queue)


@pytest.mark.parametrize("argv", [["--reads", "0"], ["--reads", "5", "--dry-run"]])
def test_a_run_that_asks_nothing_reports_nothing(runs, a_queue, argv):
    assert job.main(argv) == 0

    assert runs == []


def test_a_run_is_reported_under_its_log_run_id(monkeypatch, runs, a_queue):
    seen: dict = {}

    class Client:
        def create_object(self, *args, **kwargs):
            raise AssertionError("nothing is written here")

    def read_register(todo, log, interval, run, status=None):
        seen.update(todo=todo, run=run, status=status)
        return 0

    monkeypatch.setattr(job, "Client", Client)
    monkeypatch.setattr(job, "read_register", read_register)

    assert job.main(["--reads", "2"]) == 0

    [run] = runs
    assert run.job == "krs_register_owners"
    assert run.kwargs == {"run_id": seen["run"], "unit": "odczytów", "total": 2}
    assert seen["status"] is run
    assert seen["todo"] == ["0000000001", "0000000002"]
    assert run.calls[-1] == ("exit", {"raised": None})
