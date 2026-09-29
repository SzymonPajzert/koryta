"""Asking the register, writing the answers down, and stopping cleanly."""

import gzip
import sys
from datetime import datetime

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
