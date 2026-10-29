"""The daily people import: what it builds, what it sends, when it stops."""

import argparse
import gzip
import json
import math
import os
import sys
import typing
from dataclasses import replace
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from types import SimpleNamespace

import pandas as pd
import pytest

import jobs.people_import as job
from analysis.payloads.priority import Pick
from analysis.payloads.site import SiteSnapshot
from analysis.payloads.target import NEW, Targeted
from entities.composite import Company, Person
from entities.person import RejestrIOKey
from entities.priority_groups import parse_group
from jobs.krs_common import answer_name
from jobs.nightly import Export
from jobs.people_import import payloads as build
from scrapers.koryta.download import CURRENT_DATE, KorytaEdges, KorytaNodes
from scrapers.krs.scrape import PEOPLE_QUERIES, RejestrIOQuery
from scrapers.stores import ProcessPolicy
from stores import job_requests
from stores.job_requests import Request
from stores.storage import CRAWLED_BUCKET, LISTING_FIELDS, SHARED_BUCKET, warsaw_tz
from uploader import Args, PersonUploader

ENDPOINT = "https://autopush.koryta.pl"


def warsaw(day: str, hour: int, minute: int = 0, second: int = 0) -> datetime:
    return datetime.combine(
        date.fromisoformat(day), time(hour, minute, second), tzinfo=warsaw_tz
    )


def stamp(moment: datetime) -> str:
    """An export folder's stamp for an export taken at `moment`."""
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.242Z")


def taken_at(moment: datetime) -> Export:
    """An export taken at `moment`, done three minutes later."""
    return Export(stamp(moment), moment + timedelta(minutes=3))


#: The day the snapshot's frames are named after when no --koryta-date says.
TODAY = CURRENT_DATE
#: This morning's export, as Firestore stamps it.
MORNING = warsaw(TODAY, 4, 0, 59)
#: When the night's reprocess wrote the snapshot's frames.
REPROCESS = warsaw(TODAY, 5, 26)
YESTERDAY = (date.fromisoformat(TODAY) - timedelta(days=1)).isoformat()


class Response:
    def __init__(self, status_code: int = 200, body: object = None, text: str = ""):
        self.status_code = status_code
        self.body = body
        self.text = text or json.dumps(body)

    def json(self):
        if self.body is None:
            raise ValueError("not json")
        return self.body


def person(outcome: str = "updated", person_id: str = "p") -> Response:
    return Response(200, {"personId": person_id, "person": outcome, "companies": []})


REFUSED = Response(500, text="Internal Server Error")


def people(n: int) -> list[dict]:
    return [
        {
            "name": f"Osoba {i}",
            "companies": [],
            "rejestrIo": f"https://rejestr.io/osoby/{i}",
        }
        for i in range(1, n + 1)
    ]


class Tokens:
    who = "a test"
    interactive = False

    def __init__(self, events: list[str]):
        self.events = events

    def token(self) -> str:
        self.events.append("token")
        return "id-token"

    def refresh(self) -> str:
        return "id-token"


class RecordingRun:
    """Stands in for `JobRun`, keeping what the job told it."""

    def __init__(self, job_id, **kwargs):
        self.job = job_id
        self.kwargs = kwargs
        self.calls: list[tuple[str, dict]] = []

    def start(self, phase=None):
        self.calls.append(("start", {"phase": phase}))
        return self

    def progress(self, done=None, **kwargs):
        self.calls.append(("progress", {"done": done, **kwargs}))

    def finish(self, state, **kwargs):
        self.calls.append(("finish", {"state": state, **kwargs}))

    def ending(self) -> dict:
        [end] = [args for call, args in self.calls if call == "finish"]
        return end


class World:
    """Everything the job touches, faked: the build, the bucket, the site, the
    clock, the newest export and the frames of it on disk."""

    def __init__(self, versioned: Path):
        #: Noon today, after this morning's export, and the frames the night
        #: built from it.
        self.clock = warsaw(TODAY, 12)
        self.export: Export | None = taken_at(MORNING)
        self.versioned = versioned
        for pipeline in (KorytaNodes, KorytaEdges):
            self.write_frame(pipeline(None), REPROCESS)
        #: What the build returns, or raises.
        self.payloads: list[dict] | BaseException = []
        #: What the site answers each person, in order; a callable is called.
        self.answers: list = []
        self.events: list[str] = []
        self.objects: dict[str, bytes] = {}
        self.failing_writes: tuple[str, ...] = ()
        self.runs: list[RecordingRun] = []
        self.built: list[dict] = []
        self.tokens = Tokens(self.events)
        #: A priority run's build, what it remembers sending, and who the
        #: crawl bucket says was bought from rejestr.io.
        self.candidates: list[build.Candidate] = []
        self.already_sent: set[tuple[str, str]] = set()
        self.memory_since: list[str] = []
        self.bought: set[str] = set()
        self.bought_since: list[str] = []
        #: What a run asked for one page's people is told to send.
        self.targeted = Targeted()

    def run(self) -> RecordingRun:
        [run] = self.runs
        return run

    def write_frame(self, pipeline, when: datetime | None) -> None:
        """Put the pipeline's output on disk as written at `when`, or take it
        off with None."""
        path = self.versioned / pipeline.output_path()
        if when is None:
            path.unlink(missing_ok=True)
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{}\n")
        os.utime(path, (when.timestamp(), when.timestamp()))

    def sent(self) -> list[str]:
        return [e.removeprefix("send ") for e in self.events if e.startswith("send ")]

    def summary(self) -> dict:
        [name] = [name for name in self.objects if name.startswith(job.RUNS_PREFIX)]
        return json.loads(self.objects[name])


@pytest.fixture
def world(monkeypatch, tmp_path) -> World:
    w = World(tmp_path)

    def build_payloads(scope, koryta_date, policy, company_category=None):
        w.events.append("build")
        w.built.append(
            {
                "scope": scope,
                "date": koryta_date,
                "policy": policy,
                "argv": list(sys.argv),
                "category": company_category,
            }
        )
        if isinstance(w.payloads, BaseException):
            raise w.payloads
        return [dict(payload) for payload in w.payloads]

    class Bucket:
        def create_object(self, bucket, name, data, content_type):
            w.events.append(f"write {name.split('/')[2]}")
            if name.startswith(w.failing_writes):
                raise OSError("403 Forbidden")
            assert name not in w.objects, f"{name} written twice"
            w.objects[name] = data
            return f"gs://{bucket}/{name}"

    class Site:
        def post(self, url, data=None, headers=None, timeout=None):
            w.events.append(f"send {json.loads(data)['name']}")
            answer = w.answers.pop(0)
            if callable(answer):
                answer = answer()
            if isinstance(answer, BaseException):
                raise answer
            return answer

    def make_uploader(endpoint, tokens):
        args = argparse.Namespace(endpoint=endpoint, type="person", limit=None)
        return PersonUploader(
            typing.cast(Args, args),
            tokens=tokens,
            session=Site(),  # type: ignore[arg-type]
        )

    def record(job_id, **kwargs):
        w.runs.append(RecordingRun(job_id, **kwargs))
        return w.runs[-1]

    def latest_export(client):
        w.events.append("export")
        return w.export

    monkeypatch.setattr(job, "warsaw_now", lambda: w.clock)
    monkeypatch.setattr(job, "latest_export", latest_export)
    monkeypatch.setattr(job, "VERSIONED_DIR", str(w.versioned))
    monkeypatch.setattr(job, "build_payloads", build_payloads)
    monkeypatch.setattr(job, "Client", Bucket)
    monkeypatch.setattr(job, "make_uploader", make_uploader)
    monkeypatch.setattr(job, "JobRun", record)
    monkeypatch.setattr(job, "token_source", lambda endpoint: w.tokens)
    monkeypatch.setattr(job, "pesel_salt", lambda: "a key")
    monkeypatch.setattr(job.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(sys, "argv", ["koryta_people_import"])
    return w


# ---------------------------------------------------------------------------
# A run that goes as planned


def test_a_run_sends_everything_planned_and_exits_0(world):
    world.payloads = people(2)
    world.answers = [person("updated"), person("unchanged")]

    assert job.main([]) == 0

    assert world.sent() == ["Osoba 1", "Osoba 2"]
    run = world.run()
    assert run.job == "people_import"
    assert run.kwargs["unit"] == "osób"
    zeros = dict.fromkeys(job.PERSON_COUNTERS, 0)
    assert run.calls[:3] == [
        ("start", {"phase": "paczki"}),
        (
            "progress",
            {"done": 0, "total": 2, "counters": {"planned": 2, **zeros}, "force": True},
        ),
        ("progress", {"done": None, "phase": "wysyłanie", "force": True}),
    ]
    assert [args["done"] for call, args in run.calls[3:-1]] == [1, 2]
    end = run.ending()
    assert end["state"] == "succeeded"
    assert end["stop_reason"] is None
    assert (end["exit_code"], end["done"], end["errors"]) == (0, 2, [])
    assert end["counters"] == {**zeros, "planned": 2, "updated": 1, "unchanged": 1}
    assert end["summary_path"].startswith(f"gs://{SHARED_BUCKET}/{job.RUNS_PREFIX}")


def test_the_run_is_reported_under_the_id_its_files_carry(world):
    world.payloads = people(1)
    world.answers = [person()]

    job.main([])

    run_id = world.run().kwargs["run_id"]
    assert sorted(world.objects) == [
        f"{job.PAYLOADS_PREFIX}date={date_of(world)}/{run_id}.jsonl.gz",
        f"{job.RUNS_PREFIX}date={date_of(world)}/{run_id}.json",
    ]


def date_of(world: World) -> str:
    return world.summary()["started"][:10]


def test_what_is_sent_is_written_first_byte_for_byte(world):
    world.payloads = [
        {"name": "Łukasz Żółć", "companies": [{"krs": "0000000001", "end": None}]},
        {"name": "Anna Nowak", "birthDate": "1970-01-01"},
    ]
    world.answers = [person(), person()]

    job.main([])

    [part] = [name for name in world.objects if name.startswith(job.PAYLOADS_PREFIX)]
    lines = gzip.decompress(world.objects[part]).decode("utf-8").splitlines()
    assert lines == [json.dumps(p, ensure_ascii=False) for p in world.payloads]
    assert world.events.index("write payloads") < world.events.index("send Łukasz Żółć")
    assert world.summary()["payloads"] == f"gs://{SHARED_BUCKET}/{part}"


def test_the_summary_says_what_the_run_did(world):
    world.payloads = people(3)
    world.answers = [person("created"), person(), REFUSED]

    code = job.main(["--max-new", "1"])

    summary = world.summary()
    assert code == summary["exit_code"] == job.EXIT_TRY_LATER
    assert summary["run"] == world.run().kwargs["run_id"]
    assert (summary["scope"], summary["endpoint"]) == ("on-koryta", ENDPOINT)
    assert (summary["planned"], summary["state"]) == (3, "partial")
    assert summary["stopped"] == "nieudane: 1 z 3"
    assert summary["errors"] == ["Osoba 3: 500 Internal Server Error"]
    assert summary["counters"]["created"] == 1
    assert summary["counters"]["updated"] == 1
    assert summary["counters"]["failed"] == 1
    assert summary["finished"] >= summary["started"]


def test_nothing_to_send_is_a_success_with_no_payloads_written(world):
    world.payloads = []

    assert job.main([]) == 0

    assert [name.split("/")[2] for name in world.objects] == ["runs"]
    assert world.run().ending()["state"] == "succeeded"


def test_an_unattended_sign_in_is_tried_before_the_payloads_are_built(world):
    world.payloads = people(1)
    world.answers = [person()]

    job.main([])

    assert world.events.index("token") < world.events.index("build")


# ---------------------------------------------------------------------------
# The guardrails


def test_the_first_max_uploads_are_sent_and_the_rest_left(world):
    world.payloads = people(5)
    world.answers = [person()] * 5

    assert job.main(["--max-uploads", "3"]) == job.EXIT_TRY_LATER

    assert world.sent() == ["Osoba 1", "Osoba 2", "Osoba 3"]
    end = world.run().ending()
    assert (end["state"], end["stop_reason"], end["done"]) == ("partial", "limit", 3)


def test_a_page_created_by_an_on_koryta_run_stops_it_at_once(world):
    world.payloads = people(3)
    world.answers = [person(), person("created", "new-node"), person()]

    assert job.main([]) == job.EXIT_FAILED

    assert world.sent() == ["Osoba 1", "Osoba 2"]
    end = world.run().ending()
    assert end["state"] == "failed"
    assert end["stop_reason"] == "utworzył 1 stronę, a wolno 0 (--max-new)"
    # Which page, where somebody looks first, and in the summary.
    assert end["errors"] == ["utworzona strona: Osoba 2 (new-node)"]
    assert world.summary()["created"] == ["Osoba 2 (new-node)"]


def test_pages_beyond_max_new_stop_the_run(world):
    world.payloads = people(4)
    world.answers = [person("created", f"n{i}") for i in range(1, 5)]

    assert job.main(["--max-new", "2"]) == job.EXIT_FAILED

    assert world.sent() == ["Osoba 1", "Osoba 2", "Osoba 3"]
    end = world.run().ending()
    assert end["stop_reason"] == "utworzył 3 strony, a wolno 2 (--max-new)"
    assert len(end["errors"]) == 3


def test_what_the_site_did_not_write_is_listed_in_the_summary(world):
    """Counted on the page, and named in the summary: who, which job, why."""
    kept = {
        "edgeId": "e1",
        "krs": "0000073772",
        "field": "end_date",
        "stored": "2026-07-01",
        "sent": None,
        "reason": "kept",
    }
    answered = person("updated", "n1")
    answered.body["droppedChanges"] = [kept]
    world.payloads = people(2)
    world.answers = [answered, person()]

    assert job.main([]) == 0

    end = world.run().ending()
    assert end["state"] == "succeeded"
    assert end["errors"] == []
    assert end["counters"]["dropped_changes"] == 1
    assert world.summary()["dropped"] == [{"name": "Osoba 1", "node": "n1", **kept}]


def test_pages_within_max_new_are_listed_but_are_no_error(world):
    world.payloads = people(2)
    world.answers = [person("created", "n1"), person()]

    assert job.main(["--scope", "not-on-koryta", "--max-new", "5"]) == 0

    assert world.run().ending()["errors"] == []
    assert world.summary()["created"] == ["Osoba 1 (n1)"]
    assert world.summary()["scope"] == "not-on-koryta"


def test_a_sector_s_people_the_site_lacks(world):
    """`--company-category` reaches the build, and the summary says which
    sector the pages it made are from."""
    world.payloads = people(2)
    world.answers = [person("created", "n1"), person("created", "n2")]

    argv = ["--scope", "not-on-koryta", "--max-new", "5"]
    assert job.main([*argv, "--company-category", "obronnosc"]) == 0

    [built] = world.built
    assert (built["scope"], built["category"]) == ("not-on-koryta", "obronnosc")
    summary = world.summary()
    assert (summary["scope"], summary["company_category"]) == (
        "not-on-koryta",
        "obronnosc",
    )
    assert summary["created"] == ["Osoba 1 (n1)", "Osoba 2 (n2)"]


def test_twenty_refusals_in_a_row_stop_the_run_as_failed(world):
    world.payloads = people(job.MAX_REFUSED_IN_A_ROW + 5)
    world.answers = [person()] + [REFUSED] * (job.MAX_REFUSED_IN_A_ROW + 4)

    assert job.main([]) == job.EXIT_FAILED

    assert len(world.sent()) == job.MAX_REFUSED_IN_A_ROW + 1
    end = world.run().ending()
    assert end["state"] == "failed"
    assert end["stop_reason"] == "20 żądań z rzędu odrzuconych"
    assert len(end["errors"]) == job.ERRORS_KEPT


def test_a_person_taken_between_refusals_starts_the_count_again(world):
    refusals = job.MAX_REFUSED_IN_A_ROW - 1
    world.payloads = people(2 * refusals + 1)
    world.answers = [REFUSED] * refusals + [person()] + [REFUSED] * refusals

    assert job.main([]) == job.EXIT_TRY_LATER

    assert len(world.sent()) == 2 * refusals + 1
    end = world.run().ending()
    assert (end["state"], end["stop_reason"]) == ("partial", "nieudane: 38 z 39")


def test_every_person_refused_fails_the_run(world):
    world.payloads = people(2)
    world.answers = [REFUSED, REFUSED]

    assert job.main([]) == job.EXIT_FAILED

    end = world.run().ending()
    assert (end["state"], end["stop_reason"]) == (
        "failed",
        "strona odrzuciła wszystkie wysyłki (2)",
    )


def test_the_deadline_leaves_the_rest_for_the_next_run(world, monkeypatch):
    clock = {"now": 0.0}

    def a_minute_passes(seconds):
        clock["now"] += 61

    # The job's own clock and pause, so the deadline a minute after the start
    # falls between the first person and the second.
    monkeypatch.setattr(
        job,
        "time",
        SimpleNamespace(monotonic=lambda: clock["now"], sleep=a_minute_passes),
    )
    world.payloads = people(3)
    world.answers = [person()] * 3

    assert job.main(["--max-minutes", "1"]) == job.EXIT_TRY_LATER

    assert world.sent() == ["Osoba 1"]
    end = world.run().ending()
    assert (end["state"], end["stop_reason"]) == ("partial", "koniec czasu")


def test_sigterm_stops_after_the_person_in_hand(world, monkeypatch):
    handlers: list = []

    def install(signum, handler):
        handlers.append(handler)
        return "the handler before"

    monkeypatch.setattr(job.signal, "signal", install)

    def answer_then_sigterm():
        handlers[0](15, None)
        return person()

    world.payloads = people(3)
    world.answers = [answer_then_sigterm, person(), person()]

    assert job.main([]) == job.EXIT_TRY_LATER

    assert world.sent() == ["Osoba 1"]
    end = world.run().ending()
    assert (end["state"], end["stop_reason"], end["done"]) == ("partial", "SIGTERM", 1)
    assert handlers[-1] == "the handler before"


def test_ctrl_c_while_sending_keeps_what_was_sent(world):
    world.payloads = people(3)
    world.answers = [person(), KeyboardInterrupt(), person()]

    assert job.main([]) == job.EXIT_TRY_LATER

    end = world.run().ending()
    assert (end["state"], end["stop_reason"], end["done"]) == (
        "partial",
        "przerwany",
        1,
    )
    assert world.summary()["counters"]["updated"] == 1


def test_ctrl_c_while_building_is_a_partial_run(world):
    world.payloads = KeyboardInterrupt()

    assert job.main([]) == job.EXIT_TRY_LATER

    end = world.run().ending()
    assert (end["state"], end["stop_reason"]) == ("partial", "przerwany")
    assert world.summary()["planned"] == 0


def test_a_crash_is_recorded_before_it_ends_the_run(world):
    world.payloads = RuntimeError("the export is missing")

    with pytest.raises(RuntimeError):
        job.main([])

    end = world.run().ending()
    assert (end["state"], end["stop_reason"]) == ("failed", "wyjątek RuntimeError")
    assert end["errors"] == ["RuntimeError('the export is missing')"]
    assert world.summary()["exit_code"] == job.EXIT_FAILED


def test_payloads_that_cannot_be_written_are_not_sent(world):
    world.payloads = people(2)
    world.failing_writes = (job.PAYLOADS_PREFIX,)

    assert job.main([]) == job.EXIT_FAILED

    assert world.sent() == []
    end = world.run().ending()
    assert (end["state"], end["stop_reason"]) == ("failed", "nie zapisano paczek")
    assert end["errors"] == ["OSError: 403 Forbidden"]


def test_a_summary_that_cannot_be_written_is_not_linked(world):
    world.payloads = people(1)
    world.answers = [person()]
    world.failing_writes = (job.RUNS_PREFIX,)

    assert job.main([]) == 0

    assert world.run().ending()["summary_path"] is None


# ---------------------------------------------------------------------------
# A dry run


def test_a_dry_run_builds_counts_and_reports_but_sends_and_writes_nothing(
    world, monkeypatch
):
    def no_sign_in(endpoint):
        raise AssertionError("a dry run signs in to nothing")

    monkeypatch.setattr(job, "token_source", no_sign_in)
    world.payloads = people(4)

    assert job.main(["--dry-run"]) == 0

    assert world.sent() == []
    assert world.objects == {}
    run = world.run()
    assert run.calls[1] == (
        "progress",
        {"done": 0, "total": 4, "counters": {"planned": 4}, "force": True},
    )
    assert run.ending() == {
        "state": "succeeded",
        "stop_reason": "próba - nic nie wysłano",
        "counters": {"planned": 4},
        "exit_code": 0,
        "done": 0,
    }


def test_a_dry_run_says_how_many_the_cap_would_send(world, capsys):
    """The 2026-10-05 night's said 9,542 people of a run capped at 100."""
    world.payloads = people(5)

    assert job.main(["--dry-run", "--max-uploads", "2"]) == 0

    assert (
        f"Dry run: 2 people would be sent to {ENDPOINT}, the first 2 of 5 planned "
        "(--max-uploads): Osoba 1, Osoba 2\n"
    ) in capsys.readouterr().out


def test_a_dry_run_within_the_cap_names_the_first_three(world, capsys):
    world.payloads = people(4)

    assert job.main(["--dry-run"]) == 0

    assert (
        f"Dry run: 4 people would be sent to {ENDPOINT}: Osoba 1, Osoba 2, "
        "Osoba 3, ...\n"
    ) in capsys.readouterr().out


# ---------------------------------------------------------------------------
# Flags, and what reaches the pipelines


def test_the_jobs_flags_never_reach_the_pipelines(world, monkeypatch):
    monkeypatch.setattr(sys, "argv", ["koryta_people_import", "--max-uploads", "5"])
    world.payloads = []

    job.main(["--max-uploads", "5", "--koryta-date", TODAY])

    [built] = world.built
    assert built["argv"] == ["koryta_people_import"]
    assert (built["scope"], built["date"]) == ("on-koryta", TODAY)


def test_the_pipelines_see_the_cli_flags_and_only_while_they_run(monkeypatch):
    seen: list = []
    dumped: list = []

    class Dumper:
        def dump_pandas(self):
            dumped.append(list(sys.argv))

    def run_people_payloads(ctx):
        seen.append(list(sys.argv))
        return pd.DataFrame(
            {
                "name": ["Anna Nowak", "Jan Kowalski"],
                "birthDate": [date(1970, 1, 2), math.nan],
                "companies": [[{"krs": "0000000001"}], []],
            }
        )

    monkeypatch.setattr(build, "setup_context", lambda *a, **k: ("ctx", Dumper()))
    monkeypatch.setattr(build, "run_people_payloads", run_people_payloads)
    monkeypatch.setattr(sys, "argv", ["koryta_people_import"])

    payloads = build.build_payloads("not-on-koryta", "2026-10-01", ProcessPolicy(set()))

    assert seen == [
        [
            "koryta_people_import",
            "--all",
            "--not-on-koryta",
            "--only-changed",
            "--koryta-date",
            "2026-10-01",
        ]
    ]
    assert dumped == seen
    assert sys.argv == ["koryta_people_import"]
    # What `koryta`'s printer would have put on the pipe: a date as its string,
    # a missing value as null.
    assert payloads == [
        {
            "name": "Anna Nowak",
            "birthDate": "1970-01-02",
            "companies": [{"krs": "0000000001"}],
        },
        {"name": "Jan Kowalski", "birthDate": None, "companies": []},
    ]


def test_a_sector_stands_in_for_everybody(monkeypatch):
    """Extract refuses `--all` beside `--company-category`, and a sector's
    people are the ones in a post there now, at a public company."""
    seen: list = []

    class Dumper:
        def dump_pandas(self):
            pass

    def run_people_payloads(ctx):
        seen.append(list(sys.argv))
        return pd.DataFrame({"name": ["Anna Nowak"]})

    monkeypatch.setattr(build, "setup_context", lambda *a, **k: ("ctx", Dumper()))
    monkeypatch.setattr(build, "run_people_payloads", run_people_payloads)
    monkeypatch.setattr(sys, "argv", ["koryta_people_import"])

    build.build_payloads(
        "not-on-koryta", "2026-10-20", ProcessPolicy(set()), "obronnosc"
    )

    assert seen == [
        [
            "koryta_people_import",
            "--company-category",
            "obronnosc",
            "--currently-employed",
            "--public-employer",
            "--not-on-koryta",
            "--only-changed",
            "--koryta-date",
            "2026-10-20",
        ]
    ]
    assert sys.argv == ["koryta_people_import"]


def test_sys_argv_comes_back_when_the_pipelines_fail(monkeypatch):
    def broken(ctx):
        raise RuntimeError("no export")

    class Dumper:
        def dump_pandas(self):
            pass

    monkeypatch.setattr(build, "setup_context", lambda *a, **k: ("ctx", Dumper()))
    monkeypatch.setattr(build, "run_people_payloads", broken)
    monkeypatch.setattr(sys, "argv", ["koryta_people_import"])

    with pytest.raises(RuntimeError):
        build.build_payloads("on-koryta", None, ProcessPolicy(set()))

    assert sys.argv == ["koryta_people_import"]


@pytest.mark.parametrize(
    "argv",
    [
        ["--reads", "5"],
        ["--dry"],  # spelled out, or refused
        ["--scope", "everyone"],
        ["--max-uploads", "-1"],
        ["--koryta-date", "01-10-2026"],
        ["--scope", "not-on-koryta"],
        ["--refresh", "PeopleMergd"],
        [
            "--scope",
            "not-on-koryta",
            "--max-new",
            "5",
            "--company-category",
            "lotniska",
        ],
    ],
)
def test_a_flag_the_job_does_not_know_is_refused(argv):
    with pytest.raises(SystemExit):
        job.parse_args(argv)


@pytest.mark.parametrize(
    "argv",
    [
        ["--scope", "priority", "--company-category", "obronnosc"],
        ["--request", "run-asked", "--company-category", "obronnosc"],
        ["--company-category", "obronnosc", "--companies-only"],
    ],
)
def test_only_the_two_halves_of_everybody_keep_to_a_sector(argv):
    with pytest.raises(SystemExit):
        job.parse_args(argv)


def test_a_sector_s_pages_to_refresh_need_no_number_of_pages():
    args = job.parse_args(["--company-category", "koleje"])

    assert (args.scope, args.company_category, args.max_new) == (
        "on-koryta",
        "koleje",
        0,
    )


def test_adding_people_needs_a_number_of_pages_it_may_create():
    args = job.parse_args(["--scope", "not-on-koryta", "--max-new", "50"])

    assert (args.scope, args.max_new) == ("not-on-koryta", 50)


def test_the_defaults_are_the_daily_run():
    args = job.parse_args([])

    assert (args.scope, args.endpoint, args.max_uploads) == (
        "on-koryta",
        ENDPOINT,
        3000,
    )
    assert (args.max_new, args.max_minutes, args.interval) == (0, 120, 0.3)
    assert (args.dry_run, args.refresh, args.koryta_date) == (False, None, None)


# ---------------------------------------------------------------------------
# What is rebuilt


def test_every_pipeline_rebuilt_by_default_is_one_the_payloads_read():
    assert set(job.DEFAULT_REFRESH) <= build.pipeline_names()


def test_by_default_the_sources_and_the_chain_above_them_are_rebuilt(monkeypatch):
    monkeypatch.setattr(job, "pesel_salt", lambda: "a key")

    policy = job.refresh_policy(None)

    assert policy.refresh_pipelines == set(job.DEFAULT_REFRESH)
    assert policy.exclude_refresh == set()
    for name in ("PeopleKRS", "KrsOdpisSeats", "KorytaPeople", "PeopleMerged"):
        assert policy.should_refresh(name)
    assert not policy.should_refresh("ProcessWiki")


def test_named_pipelines_replace_the_default_and_colon_holds_one(monkeypatch):
    monkeypatch.setattr(job, "pesel_salt", lambda: "a key")

    policy = job.refresh_policy(["KorytaPeople", ":PeopleMerged"])

    assert policy.refresh_pipelines == {"KorytaPeople"}
    assert policy.exclude_refresh == {"PeopleMerged"}


def test_holding_one_alone_takes_it_out_of_the_default(monkeypatch):
    monkeypatch.setattr(job, "pesel_salt", lambda: "a key")

    policy = job.refresh_policy([":PeopleMerged"])

    assert policy.refresh_pipelines == set(job.DEFAULT_REFRESH) - {"PeopleMerged"}
    assert not policy.should_refresh("PeopleMerged")


@pytest.mark.parametrize("asked", [None, ["all"]])
def test_without_the_pesel_key_the_seats_are_restored_not_rebuilt(monkeypatch, asked):
    monkeypatch.setattr(job, "pesel_salt", lambda: None)

    policy = job.refresh_policy(asked)

    assert not policy.should_refresh("KrsOdpisSeats")
    assert policy.should_refresh("PeopleKRSCombined")


# ---------------------------------------------------------------------------
# The export the payloads are compared with


def test_a_run_says_which_export_it_compared_with(world, capsys):
    world.payloads = people(1)
    world.answers = [person()]

    assert job.main([]) == 0

    assert world.events.index("export") < world.events.index("build")
    assert world.summary()["export"] == stamp(MORNING)
    # The night built both frames after the export was done: neither again.
    [built] = world.built
    assert not built["policy"].should_refresh("KorytaNodes")
    assert not built["policy"].should_refresh("KorytaEdges")
    assert f"Comparing with the export of {stamp(MORNING)}\n" in capsys.readouterr().out


@pytest.mark.parametrize(
    "argv",
    [[], ["--dry-run"], ["--scope", "not-on-koryta", "--max-new", "50"]],
)
def test_a_hand_run_between_midnight_and_four_is_refused(world, argv):
    """Yesterday's export has none of the pages yesterday's night created:
    compared with it, `not-on-koryta` would create them again."""
    yesterdays = warsaw(YESTERDAY, 4, 0, 35)
    world.clock = warsaw(TODAY, 2, 30)
    world.export = taken_at(yesterdays)
    world.payloads = people(1)

    assert job.main(argv) == job.EXIT_FAILED

    assert "build" not in world.events
    assert world.sent() == []
    end = world.run().ending()
    assert (end["state"], end["exit_code"]) == ("failed", job.EXIT_FAILED)
    assert end["stop_reason"] == (
        f"brak dzisiejszej kopii bazy (najnowsza z {stamp(yesterdays)})"
    )


def test_no_finished_export_at_all_is_refused(world):
    world.export = None
    world.payloads = people(1)

    assert job.main([]) == job.EXIT_FAILED

    assert "build" not in world.events
    assert world.summary()["stopped"] == "brak dzisiejszej kopii bazy (żadnej)"


def test_a_koryta_date_that_is_not_the_newest_exports_day_is_refused(world):
    world.payloads = people(1)

    assert job.main(["--koryta-date", YESTERDAY]) == job.EXIT_FAILED

    assert "build" not in world.events
    assert world.run().ending()["stop_reason"] == (
        f"porównanie z kopią bazy z {YESTERDAY}, a najnowsza jest z {stamp(MORNING)}"
    )


@pytest.mark.parametrize("refresh", [[], ["--refresh", "none"]])
def test_a_frame_cached_under_todays_name_before_the_export_is_rebuilt(
    world, refresh, capsys
):
    """A run at two built `koryta_nodes_<today>` from yesterday's export, the
    only one there was; `--refresh none` would have taken it as it is."""
    for pipeline in (KorytaNodes, KorytaEdges):
        world.write_frame(pipeline(None), warsaw(TODAY, 2))
    world.payloads = people(1)
    world.answers = [person()]

    assert job.main(refresh) == 0

    [built] = world.built
    assert built["policy"].should_refresh("KorytaNodes")
    assert built["policy"].should_refresh("KorytaEdges")
    if refresh:
        assert built["policy"].refresh_pipelines == {"KorytaNodes", "KorytaEdges"}
    out = capsys.readouterr().out
    assert "rebuilding KorytaNodes, KorytaEdges, not built from it" in out


@pytest.mark.parametrize(
    "written",
    [
        None,  # a fresh disk: restored, it would be whatever was uploaded last
        MORNING + timedelta(minutes=1),  # read while the export was written
    ],
)
def test_a_frame_not_written_after_the_export_was_done_is_rebuilt(world, written):
    world.write_frame(KorytaEdges(None), written)
    world.payloads = people(1)
    world.answers = [person()]

    assert job.main(["--refresh", "none"]) == 0

    [built] = world.built
    assert built["policy"].refresh_pipelines == {"KorytaEdges"}


def test_a_request_in_the_afternoon_reads_the_export_the_night_built(asked):
    asked.clock = warsaw(TODAY, 15)
    plan_for(asked, ["Anna Nowak"], [])
    asked.answers = [person("updated")]

    assert job.main(["--request", "run-asked", "--refresh", "none"]) == 0

    [built] = asked.built
    assert built["policy"].refresh_pipelines == set()
    assert asked.summary()["export"] == stamp(MORNING)


def test_an_export_taken_by_hand_later_in_the_day_is_read_once_rebuilt(asked):
    asked.clock = warsaw(TODAY, 15)
    asked.export = taken_at(warsaw(TODAY, 14, 7, 8))
    plan_for(asked, ["Anna Nowak"], [])
    asked.answers = [person("updated")]

    assert job.main(["--request", "run-asked", "--refresh", "none"]) == 0

    [built] = asked.built
    assert built["policy"].refresh_pipelines == {"KorytaNodes", "KorytaEdges"}
    assert asked.summary()["export"] == stamp(warsaw(TODAY, 14, 7, 8))
    assert asked.sent() == ["Anna Nowak"]


@pytest.mark.parametrize(
    ("taken", "at", "refused"),
    [
        # This morning's, stamped 02:00:59Z in summer...
        (warsaw("2026-10-10", 4, 0, 59), warsaw("2026-10-10", 12), False),
        # ...and 03:00:12Z in winter: four in Warsaw either way.
        (warsaw("2026-11-10", 4, 0, 12), warsaw("2026-11-10", 12), False),
        # One taken by hand since.
        (warsaw("2026-10-10", 14, 7), warsaw("2026-10-10", 15), False),
        # At half past two, before the night's export.
        (warsaw("2026-10-09", 4, 0, 35), warsaw("2026-10-10", 2, 30), True),
        # Taken by hand at a quarter to midnight: the night's run came after.
        (warsaw("2026-10-09", 23, 45), warsaw("2026-10-10", 9), True),
    ],
)
def test_only_an_export_taken_today_at_four_or_later_is_compared_with(
    taken, at, refused
):
    export = taken_at(taken)

    assert bool(job.export_refusal(export, export.stamp[:10], at)) == refused


@pytest.mark.parametrize(
    ("argv", "code"),
    [
        (["--export", stamp(warsaw(YESTERDAY, 23))], 0),
        ([], job.EXIT_FAILED),
    ],
)
def test_the_night_has_its_people_compared_with_the_export_it_took(world, argv, code):
    """A night forced at three, before the 04:00 export: its export step
    takes the one taken by hand at eleven, within its six hours, and names
    it. Named, the job compares with it; a hand run names none, and is
    refused as before."""
    eleven = warsaw(YESTERDAY, 23)
    world.clock = warsaw(TODAY, 3, 10)
    world.export = taken_at(eleven)
    for pipeline in (KorytaNodes, KorytaEdges):
        world.write_frame(pipeline(None), warsaw(TODAY, 2, 50))
    world.payloads = people(1)
    world.answers = [person()]

    assert job.main(argv) == code

    if code == 0:
        assert world.summary()["export"] == stamp(eleven)
        # Written after it was done, under today's name: read as they are.
        [built] = world.built
        assert not built["policy"].should_refresh("KorytaNodes")
    else:
        assert world.run().ending()["stop_reason"] == (
            f"brak dzisiejszej kopii bazy (najnowsza z {stamp(eleven)})"
        )


@pytest.mark.parametrize(
    ("newest", "day", "refusal"),
    [
        # The one the night took...
        ("2026-10-09T21:00:12.004Z", "2026-10-10", ""),
        # ...or one taken since, which the frames would read anyway.
        ("2026-10-10T02:00:59.242Z", "2026-10-10", ""),
        # Older than the one named: the named one is not finished.
        (
            "2026-10-09T02:00:35.112Z",
            "2026-10-10",
            "brak kopii bazy z 2026-10-09T21:00:12.004Z "
            "(najnowsza z 2026-10-09T02:00:35.112Z)",
        ),
        # Frames named after the day before read the export before it.
        (
            "2026-10-10T02:00:59.242Z",
            "2026-10-09",
            "porównanie z kopią bazy z 2026-10-09, a najnowsza jest z "
            "2026-10-10T02:00:59.242Z",
        ),
    ],
)
def test_an_export_named_is_compared_with_or_a_newer_one(newest, day, refusal):
    export = Export(newest, None)
    noon = warsaw("2026-10-10", 12)

    assert (
        job.export_refusal(export, day, noon, accepted="2026-10-09T21:00:12.004Z")
        == refusal
    )


def test_an_export_named_has_to_be_an_export_stamp():
    assert job.parse_args(["--export", "2026-10-10T02:00:59.242Z"]).export == (
        "2026-10-10T02:00:59.242Z"
    )
    with pytest.raises(SystemExit):
        job.parse_args(["--export", "dzisiejsza"])
    # Without its zone it could not be compared with the newest export's.
    with pytest.raises(SystemExit):
        job.parse_args(["--export", "2026-10-10T02:00:59"])


def test_the_newest_export_is_the_newest_finished_and_done_when_its_marker_was():
    done = datetime(2026, 10, 10, 2, 3, 11, tzinfo=UTC)
    markers = {
        "2026-10-09T19:01:27.973Z": datetime(2026, 10, 9, 19, 4, 15, tzinfo=UTC),
        "2026-10-10T02:00:59.242Z": done,
    }

    def stamp_of(name: str) -> str:
        folder, marker = name.removeprefix("hostname=koryta.pl/").split("/")
        assert marker == f"{folder}.overall_export_metadata"
        return folder.removeprefix("date=")

    class Listing(list):
        prefixes = {f"hostname=koryta.pl/date={s}/" for s in markers} | {
            "hostname=koryta.pl/date=2026-10-10T12:00:00.000Z/",  # still writing
        }

    class Bucket:
        def list_blobs(self, prefix, delimiter):
            return Listing()

        def blob(self, name):
            return SimpleNamespace(exists=lambda: stamp_of(name) in markers)

        def get_blob(self, name):
            found = markers.get(stamp_of(name))
            return SimpleNamespace(updated=found) if found else None

    class Storage:
        def bucket(self, name):
            assert name == CRAWLED_BUCKET
            return Bucket()

    client = typing.cast(job.Client, SimpleNamespace(storage_client=Storage()))

    assert job.latest_export(client) == Export("2026-10-10T02:00:59.242Z", done)


# ---------------------------------------------------------------------------
# Small parts


def test_the_deadline_and_sigterm_are_told_apart():
    signalled = False
    now = 0.0
    should_stop = job.stop_rule(60.0, lambda: signalled, clock=lambda: now)

    assert should_stop() == ""
    now = 60.0
    assert should_stop() == "koniec czasu"
    signalled = True
    assert should_stop() == "SIGTERM"


@pytest.mark.parametrize(
    ("n", "form"),
    [(1, "stronę"), (2, "strony"), (4, "strony"), (5, "stron"), (12, "stron")]
    + [(22, "strony"), (25, "stron"), (112, "stron")],
)
def test_pages_are_counted_in_polish(n, form):
    assert job.plural(n, "stronę", "strony", "stron") == form


# ---------------------------------------------------------------------------
# A priority run: new hires, then published pages, then the rest


def candidate(
    name: str, tier: str, since: str | None = None, published: bool | None = None
) -> build.Candidate:
    """A payload of the tier; on a published page if `published` says so, or,
    unless it says otherwise, if the tier is the published pages'."""
    payload = {
        "name": name,
        "companies": [],
        "rejestrIo": f"https://rejestr.io/osoby/{name.rsplit(maxsplit=1)[-1]}",
    }
    live = tier == PUBLISHED if published is None else published
    return build.Candidate(payload, tier, since, live)


@pytest.fixture
def priority(world, monkeypatch) -> World:
    """The world, with a priority build, a memory of what was sent, and the
    people bought lately."""

    def build_priority(koryta_date, policy, today, recent_days, bought, groups=()):
        world.events.append("build")
        world.built.append(
            {
                "date": koryta_date,
                "today": today,
                "recent_days": recent_days,
                "bought": set(bought),
                "groups": list(groups),
            }
        )
        return list(world.candidates)

    def sent_recently(client, since):
        world.memory_since.append(since)
        return set(world.already_sent)

    def bought_since(client, since):
        world.bought_since.append(since)
        return set(world.bought)

    monkeypatch.setattr(job, "build_priority", build_priority)
    monkeypatch.setattr(job, "sent_recently", sent_recently)
    monkeypatch.setattr(job, "bought_since", bought_since)
    return world


def sent_part(world: World) -> list[dict]:
    [name] = [name for name in world.objects if name.startswith(job.SENT_PREFIX)]
    lines = gzip.decompress(world.objects[name]).decode("utf-8").splitlines()
    return [json.loads(line) for line in lines]


HIRE, BOUGHT, PUBLISHED, ON_SITE = "new_hire", "bought", "published", "on_site"
MISSING, NOTED, SEATED = "noted_missing", "noted", "odpis_only_current"
LINKED = "rejestrio_current"


def test_a_priority_run_sends_by_tier_up_to_the_cap(priority):
    priority.candidates = [
        candidate("Anna Nowak", HIRE, "2026-09-30"),
        candidate("Beata Kos", HIRE, "2026-09-10"),
        candidate("Jan Kowalski", PUBLISHED, "2026-08-01"),
        candidate("Ewa Lis", ON_SITE, None),
    ]
    priority.answers = [person("created"), person("created"), person("updated")]

    code = job.main(["--scope", "priority", "--max-uploads", "3"])

    assert code == job.EXIT_TRY_LATER
    assert priority.sent() == ["Anna Nowak", "Beata Kos", "Jan Kowalski"]
    summary = priority.summary()
    assert summary["tiers"] == {
        HIRE: 2,
        BOUGHT: 0,
        MISSING: 0,
        NOTED: 0,
        SEATED: 0,
        LINKED: 0,
        PUBLISHED: 1,
        ON_SITE: 1,
    }
    assert (summary["state"], summary["stopped"]) == ("partial", "limit")
    assert summary["created"] == ["Anna Nowak (p)", "Beata Kos (p)"]
    assert [
        (row["name"], row["tier"], row["outcome"]) for row in sent_part(priority)
    ] == [
        ("Anna Nowak", HIRE, "created"),
        ("Beata Kos", HIRE, "created"),
        ("Jan Kowalski", PUBLISHED, "updated"),
    ]
    assert summary["sent"].startswith(f"gs://{SHARED_BUCKET}/{job.SENT_PREFIX}")


def test_new_hires_past_max_new_make_room_for_the_pages_after_them(priority):
    priority.candidates = [
        candidate("Anna Nowak", HIRE, "2026-09-30"),
        candidate("Beata Kos", HIRE, "2026-09-10"),
        candidate("Jan Kowalski", PUBLISHED),
    ]
    priority.answers = [person("created"), person("updated")]

    assert job.main(["--scope", "priority", "--max-new", "1"]) == 0

    assert priority.sent() == ["Anna Nowak", "Jan Kowalski"]
    assert priority.summary()["tiers"] == {
        HIRE: 1,
        BOUGHT: 0,
        MISSING: 0,
        NOTED: 0,
        SEATED: 0,
        LINKED: 0,
        PUBLISHED: 1,
        ON_SITE: 0,
    }


def odpis_only(
    name: str, since: str | None = None, tier: str = HIRE
) -> build.Candidate:
    """A new hire with no rejestr.io entry: the ingest finds them by their name
    and birth date alone. Or, as `SEATED`, somebody like that in a public
    post that is not new."""
    payload = {"name": name, "companies": [], "birthDate": "1971-03-14"}
    return build.Candidate(payload, tier, since)


def test_new_hires_only_an_odpis_names_leave_the_run_to_the_pages_after_them(
    priority, capsys
):
    """On the 2026-10-09 night 109 of 118 new hires were people only an odpis
    names, and at --max-new = --max-uploads = 100 they took all 100 slots."""
    priority.candidates = [
        odpis_only("Anna Nowak", "2026-10-01"),
        candidate("Beata Kos", HIRE, "2026-09-30"),
        odpis_only("Celina Lis", "2026-09-20"),
        odpis_only("Dorota Wilk", "2026-09-10"),
        candidate("Olga Sowa", BOUGHT),
        candidate("Jan Kowalski", PUBLISHED),
    ]
    priority.answers = [person("created")] * 2 + [person("updated")] * 2

    argv = ["--scope", "priority", "--max-uploads", "10", "--max-new-odpis-only", "1"]
    assert job.main(argv) == 0

    assert priority.sent() == ["Anna Nowak", "Beata Kos", "Olga Sowa", "Jan Kowalski"]
    assert priority.summary()["tiers"][HIRE] == 2
    assert "New hires only an odpis names: 1 of 3 planned" in capsys.readouterr().out


def test_a_tenth_of_a_priority_run_may_be_people_only_an_odpis_names():
    def cap(*argv: str) -> int | None:
        return job.parse_args(["--scope", "priority", *argv]).max_new_odpis_only

    assert cap("--max-uploads", "100") == 10
    assert cap("--max-uploads", "5") == 1
    assert cap("--max-uploads", "0") == 0
    assert cap("--max-uploads", "100", "--max-new-odpis-only", "40") == 40
    assert job.parse_args(["--max-uploads", "100"]).max_new_odpis_only is None


def test_planning_counts_only_the_new_hires_without_an_entry_to_their_cap():
    hires = [odpis_only("Anna Nowak"), candidate("Beata Kos", HIRE)]
    hires += [odpis_only("Celina Lis"), candidate("Ewa Lis", HIRE)]

    def names(max_new: int, max_new_odpis_only: int) -> list[str]:
        planned, _ = job.plan_priority(hires, set(), max_new, max_new_odpis_only)
        return [c.payload["name"] for c in planned]

    assert names(max_new=5, max_new_odpis_only=1) == [
        "Anna Nowak",
        "Beata Kos",
        "Ewa Lis",
    ]
    assert names(max_new=2, max_new_odpis_only=5) == ["Anna Nowak", "Beata Kos"]


def test_people_only_an_odpis_names_in_an_older_post_take_ten_a_run(priority, capsys):
    """980 of them on 2026-10-11, and Szymon's choice that day: ten a night,
    their pages made as a new hire's are."""
    priority.candidates = [
        candidate("Anna Nowak", HIRE, "2026-09-30"),
        candidate("Olga Sowa", BOUGHT),
        *[odpis_only(f"Osoba {i}", "2025-01-01", SEATED) for i in range(1, 13)],
        candidate("Jan Kowalski", PUBLISHED),
    ]
    priority.answers = [person("created"), person("updated")]
    priority.answers += [person("created", f"page-{i}") for i in range(1, 11)]
    priority.answers += [person("updated")]

    assert job.main(["--scope", "priority", "--max-uploads", "100"]) == 0

    sent = priority.sent()
    assert sent[:2] == ["Anna Nowak", "Olga Sowa"]
    assert sent[2:12] == [f"Osoba {i}" for i in range(1, 11)]
    assert sent[12:] == ["Jan Kowalski"]
    summary = priority.summary()
    assert summary["state"] == "succeeded"
    assert summary["tiers"][SEATED] == 10
    assert len(summary["created"]) == 11
    assert [row["tier"] for row in sent_part(priority)].count(SEATED) == 10
    out = capsys.readouterr().out
    assert (
        "'noted': 0, 'odpis_only_current': 10, 'rejestrio_current': 0, "
        "'published': 1" in out
    )
    assert (
        "People only an odpis names in an older public post: 10 of 12 planned "
        "(--max-odpis-only-current 10)" in out
    )


def test_the_pages_of_both_kinds_count_against_max_new_together():
    found = [candidate("Anna Nowak", HIRE), odpis_only("Beata Kos", tier=HIRE)]
    found += [odpis_only("Celina Lis", tier=SEATED), candidate("Jan Lis", PUBLISHED)]
    found += [odpis_only("Dorota Wilk", tier=SEATED)]

    def names(max_new: int, max_odpis_only_current: int | None) -> list[str]:
        planned, _ = job.plan_priority(found, set(), max_new, 5, max_odpis_only_current)
        return [c.payload["name"] for c in planned]

    everybody = ["Anna Nowak", "Beata Kos", "Celina Lis", "Jan Lis", "Dorota Wilk"]
    assert names(max_new=5, max_odpis_only_current=None) == everybody
    assert names(max_new=5, max_odpis_only_current=1) == everybody[:4]
    assert names(max_new=5, max_odpis_only_current=0) == [
        "Anna Nowak",
        "Beata Kos",
        "Jan Lis",
    ]
    # Planned past --max-new, the run would stop as failed on its own plan.
    assert names(max_new=3, max_odpis_only_current=10) == everybody[:4]
    assert names(max_new=2, max_odpis_only_current=10) == [
        "Anna Nowak",
        "Beata Kos",
        "Jan Lis",
    ]


def test_ten_a_priority_run_may_be_people_only_an_odpis_names_in_an_older_post():
    def cap(*argv: str) -> int | None:
        return job.parse_args(["--scope", "priority", *argv]).max_odpis_only_current

    assert cap() == 10
    # Not a share of the run: the backlog waits however many go up.
    assert cap("--max-uploads", "300") == 10
    assert cap("--max-odpis-only-current", "0") == 0
    assert job.parse_args([]).max_odpis_only_current is None


def test_a_page_made_for_somebody_in_an_older_post_does_not_stop_the_run(priority):
    priority.candidates = [
        odpis_only("Celina Lis", "2024-05-01", SEATED),
        candidate("Jan Kowalski", PUBLISHED),
    ]
    priority.answers = [person("created", "new-page"), person("updated")]

    assert job.main(["--scope", "priority"]) == 0

    assert priority.sent() == ["Celina Lis", "Jan Kowalski"]
    assert priority.summary()["created"] == ["Celina Lis (new-page)"]


def test_people_with_an_entry_in_an_older_post_take_fifty_a_run(priority, capsys):
    """13,518 of them on 2026-10-16, against 89 new hires, and Szymon's choice
    that day: fifty a night, their pages made as a new hire's are - after the
    people only an odpis names, and ahead of the published pages."""
    priority.candidates = [
        candidate("Anna Nowak", HIRE, "2026-09-30"),
        candidate("Olga Sowa", BOUGHT),
        odpis_only("Beata Kos", "2025-01-01", SEATED),
        *[candidate(f"Osoba {i}", LINKED, "2024-01-01") for i in range(1, 53)],
        candidate("Jan Kowalski", PUBLISHED),
    ]
    priority.answers = [person("created"), person("updated")]
    priority.answers += [person("created", f"page-{i}") for i in range(0, 51)]
    priority.answers += [person("updated")]

    assert job.main(["--scope", "priority", "--max-uploads", "100"]) == 0

    sent = priority.sent()
    assert sent[:3] == ["Anna Nowak", "Olga Sowa", "Beata Kos"]
    assert sent[3:53] == [f"Osoba {i}" for i in range(1, 51)]
    assert sent[53:] == ["Jan Kowalski"]
    summary = priority.summary()
    # A page made for one of them is one the run was meant to make.
    assert summary["state"] == "succeeded"
    assert summary["tiers"][LINKED] == 50
    assert len(summary["created"]) == 52
    assert [row["tier"] for row in sent_part(priority)].count(LINKED) == 50
    out = capsys.readouterr().out
    assert (
        "People with a rejestr.io entry in an older public post: 50 of 52 "
        "planned (--max-rejestrio-current 50)" in out
    )


def test_the_pages_of_all_three_kinds_count_against_max_new_together():
    found = [candidate("Anna Nowak", HIRE), odpis_only("Beata Kos", tier=SEATED)]
    found += [candidate("Celina Mazur", LINKED), candidate("Jan Lis", PUBLISHED)]
    found += [candidate("Dorota Wilk", LINKED)]

    def names(max_new: int, max_rejestrio_current: int | None) -> list[str]:
        planned, _ = job.plan_priority(
            found, set(), max_new, 5, 5, max_rejestrio_current=max_rejestrio_current
        )
        return [c.payload["name"] for c in planned]

    everybody = ["Anna Nowak", "Beata Kos", "Celina Mazur", "Jan Lis", "Dorota Wilk"]
    assert names(max_new=5, max_rejestrio_current=None) == everybody
    assert names(max_new=5, max_rejestrio_current=1) == everybody[:4]
    assert names(max_new=5, max_rejestrio_current=0) == [
        "Anna Nowak",
        "Beata Kos",
        "Jan Lis",
    ]
    # Planned past --max-new, the run would stop as failed on its own plan.
    assert names(max_new=3, max_rejestrio_current=50) == everybody[:4]
    assert names(max_new=2, max_rejestrio_current=50) == [
        "Anna Nowak",
        "Beata Kos",
        "Jan Lis",
    ]


def test_fifty_a_priority_run_may_be_people_with_an_entry_in_an_older_post():
    def cap(*argv: str) -> int | None:
        return job.parse_args(["--scope", "priority", *argv]).max_rejestrio_current

    assert cap() == 50
    # Not a share of the run, as the odpis-only people's cap is not either.
    assert cap("--max-uploads", "300") == 50
    assert cap("--max-rejestrio-current", "0") == 0
    assert job.parse_args([]).max_rejestrio_current is None


def test_published_pages_past_max_published_wait_and_the_pages_after_them_go(
    priority, capsys
):
    """Szymon, 2026-10-15: a cap on how many published pages a night changes,
    so that it leaves no more to review than that - the bought and the noted
    counted as much as the published."""
    priority.candidates = [
        candidate("Anna Nowak", HIRE, "2026-09-30"),
        candidate("Ewa Lis", BOUGHT, published=True),
        candidate("Olga Wilk", BOUGHT),
        candidate("Piotr Sowa", NOTED, published=True),
        candidate("Jan Kowalski", PUBLISHED),
        candidate("Adam Kos", PUBLISHED),
        candidate("Celina Lis", ON_SITE),
    ]
    priority.answers = [person("created")] + [person("updated")] * 4

    assert job.main(["--scope", "priority", "--max-published", "2"]) == 0

    assert priority.sent() == [
        "Anna Nowak",
        "Ewa Lis",
        "Olga Wilk",
        "Piotr Sowa",
        "Celina Lis",
    ]
    summary = priority.summary()
    assert (summary["published_pages"], summary["published_left"]) == (2, 2)
    assert summary["tiers"][PUBLISHED] == 0
    assert summary["state"] == "succeeded"
    out = capsys.readouterr().out
    assert "Published pages to change: 2 of 4 planned (--max-published 2)" in out


def test_planning_counts_every_change_to_a_published_page_to_its_cap():
    sent = candidate("Beata Kos", PUBLISHED)
    found = [
        candidate("Anna Nowak", HIRE),
        candidate("Ewa Lis", BOUGHT, published=True),
        candidate("Olga Wilk", MISSING),
        sent,
        candidate("Piotr Sowa", NOTED, published=True),
        candidate("Jan Kowalski", PUBLISHED),
        candidate("Celina Lis", ON_SITE),
    ]
    # Left out as sent unchanged, it takes none of the cap.
    already = {(job.person_key(sent.payload), job.payload_hash(sent.payload))}

    def names(max_published: int | None) -> list[str]:
        planned, _ = job.plan_priority(found, already, 5, max_published=max_published)
        return [c.payload["name"] for c in planned]

    assert names(None) == [
        "Anna Nowak",
        "Ewa Lis",
        "Olga Wilk",
        "Piotr Sowa",
        "Jan Kowalski",
        "Celina Lis",
    ]
    assert names(2) == [
        "Anna Nowak",
        "Ewa Lis",
        "Olga Wilk",
        "Piotr Sowa",
        "Celina Lis",
    ]
    assert names(0) == ["Anna Nowak", "Olga Wilk", "Celina Lis"]


def test_published_pages_have_no_cap_of_their_own_unless_one_is_asked_for():
    def cap(*argv: str) -> int | None:
        return job.parse_args(["--scope", "priority", *argv]).max_published

    assert cap() is None
    assert cap("--max-uploads", "300") is None
    assert cap("--max-published", "50") == 50
    assert cap("--max-published", "0") == 0


def test_a_payload_sent_unchanged_lately_is_left_out(priority):
    unchanged = candidate("Anna Nowak", HIRE, "2026-09-30")
    changed = candidate("Jan Kowalski", PUBLISHED)
    priority.candidates = [unchanged, changed]
    priority.already_sent = {
        (job.person_key(unchanged.payload), job.payload_hash(unchanged.payload)),
        # The same person, sent with what the payload said before: not this one.
        (job.person_key(changed.payload), job.payload_hash({"name": "older"})),
    }
    priority.answers = [person("updated")]

    assert job.main(["--scope", "priority"]) == 0

    assert priority.sent() == ["Jan Kowalski"]
    assert priority.summary()["already_sent"] == 1
    [since] = priority.memory_since
    started = date.fromisoformat(priority.summary()["started"][:10])
    assert (started - date.fromisoformat(since)).days == 30


def test_resend_after_0_sends_everything_again(priority):
    priority.candidates = [candidate("Anna Nowak", PUBLISHED)]
    priority.answers = [person("updated")]

    assert job.main(["--scope", "priority", "--resend-after", "0"]) == 0

    assert priority.memory_since == []
    assert priority.sent() == ["Anna Nowak"]


def test_a_page_made_for_somebody_planned_onto_a_page_stops_the_run(priority):
    priority.candidates = [
        candidate("Jan Kowalski", PUBLISHED),
        candidate("Ewa Lis", ON_SITE),
    ]
    priority.answers = [person("created", "new-node")]

    assert job.main(["--scope", "priority"]) == job.EXIT_FAILED

    assert priority.sent() == ["Jan Kowalski"]
    summary = priority.summary()
    assert summary["state"] == "failed"
    assert summary["stopped"].startswith("utworzył stronę dla osoby, która już ma")
    assert "utworzona strona: Jan Kowalski (new-node)" in summary["errors"]


def test_what_was_sent_names_the_page_each_person_went_to(priority):
    # The scoring models read the pages a run created off this part, so they
    # can rate the people the night added before the next export has them
    # (`scrapers.koryta.created`).
    priority.candidates = [
        candidate("Anna Nowak", HIRE, "2026-09-30"),
        candidate("Jan Kowalski", PUBLISHED),
    ]
    priority.answers = [person("created", "new-page"), person("updated", "old-page")]

    assert job.main(["--scope", "priority"]) == 0

    assert [
        (row["name"], row["outcome"], row["node"], row["rejestrIo"])
        for row in sent_part(priority)
    ] == [
        ("Anna Nowak", "created", "new-page", "https://rejestr.io/osoby/Nowak"),
        ("Jan Kowalski", "updated", "old-page", "https://rejestr.io/osoby/Kowalski"),
    ]


#: What a line of the sent part says the site wrote besides the person node.
EDGES = (
    "employments_created",
    "employments_published",
    "candidacies_created",
    "proposals_filed",
)


def test_what_was_sent_says_what_came_with_a_page_answered_unchanged(priority):
    """`unchanged` is the person node alone. 91 of the 106 bought pages sent
    2026-10-24..28 were answered so, and every one had edges written - most
    of them jobs its bought feed named, put live - which the part did not
    say, so a night's bought tier read as sent for nothing."""
    priority.candidates = [
        candidate("Jan Kowalski", BOUGHT, published=True),
        candidate("Ewa Lis", ON_SITE),
    ]
    wrote = Response(
        200,
        {
            "personId": "kowalski",
            "person": "unchanged",
            "companies": [
                {"nodeId": "c1", "edgeId": "j1", "created": True, "published": True},
                {"nodeId": "c2", "edgeId": "j2", "created": True, "published": False},
                {"nodeId": "c3", "edgeId": "j3", "created": False, "published": False},
            ],
            "elections": [{"nodeId": "r1", "edgeId": "b1", "created": True}],
            "proposals": {"created": 1, "unchanged": 2},
        },
    )
    priority.answers = [wrote, person("unchanged", "lis")]

    assert job.main(["--scope", "priority"]) == 0

    kowalski, lis = sent_part(priority)
    assert {name: kowalski[name] for name in EDGES} == {
        "employments_created": 2,
        "employments_published": 1,
        "candidacies_created": 1,
        "proposals_filed": 1,
    }
    assert {name: lis[name] for name in EDGES} == dict.fromkeys(EDGES, 0)
    assert priority.summary()["sent_by_tier"] == {
        BOUGHT: {
            "unchanged": 1,
            "employments_created": 2,
            "employments_published": 1,
            "candidacies_created": 1,
            "proposals_filed": 1,
        },
        ON_SITE: {"unchanged": 1, **dict.fromkeys(EDGES, 0)},
    }


def test_somebody_only_an_odpis_names_is_remembered_by_name_and_birth_date():
    """No link and no page id: two such people may share a name, never a name
    and a day - and their PESEL is not the pipeline's to write down here."""
    odpis_only = {"name": "Anna Nowak", "birthDate": "1971-03-14"}

    assert job.person_key(odpis_only) == "Anna Nowak 1971-03-14"
    assert job.person_key({**odpis_only, "birthDate": "1980-01-01"}) != (
        job.person_key(odpis_only)
    )
    assert job.person_key({**odpis_only, "korytaId": "page"}) == "page"
    assert job.person_key({"name": "Anna Nowak"}) == "Anna Nowak"


def test_what_the_site_refused_is_not_remembered_as_sent(priority):
    priority.candidates = [
        candidate("Jan Kowalski", PUBLISHED),
        candidate("Ewa Lis", ON_SITE),
    ]
    priority.answers = [REFUSED, person("unchanged")]

    job.main(["--scope", "priority"])

    assert [row["name"] for row in sent_part(priority)] == ["Ewa Lis"]


#: A board seat at a company the site has no page for, as the person ingest
#: reports a job it left out (`unplacedEmployments`).
UNPLACED_JOB = {
    "krs": "0000000009",
    "role": "Rada Nadzorcza",
    "start": "2026-02-09",
    "reason": "no-company",
}


def taken_without_a_job(person_id: str = "p") -> Response:
    body = typing.cast(dict, person("updated", person_id).body)
    return Response(200, {**body, "unplacedEmployments": [UNPLACED_JOB]})


def test_a_person_taken_without_a_job_is_listed_and_sent_again_next_run(
    priority, monkeypatch
):
    """Until 2026-10-14 the site refused such a person whole, and they were
    sent again the next night; now it takes them, and the job left out keeps
    them out of what the next run leaves alone as sent."""
    # Nothing in `Companies` to create the company from.
    monkeypatch.setattr(PersonUploader, "company_payloads", property(lambda _: {}))
    priority.candidates = [
        candidate("Jan Kowalski", PUBLISHED),
        candidate("Ewa Lis", ON_SITE),
    ]
    priority.answers = [taken_without_a_job("n1"), person("unchanged")]

    assert job.main(["--scope", "priority"]) == job.EXIT_TRY_LATER

    # Sent once: with no company created, there is nothing a second request
    # would place.
    assert priority.sent() == ["Jan Kowalski", "Ewa Lis"]
    summary = priority.summary()
    assert (summary["state"], summary["stopped"]) == (
        "partial",
        "zatrudnienia bez strony firmy: 1",
    )
    assert summary["counters"]["updated"] == 1
    assert summary["counters"]["failed"] == 0
    assert summary["counters"]["employments_unplaced"] == 1
    assert summary["unplaced_employments"] == [
        {"name": "Jan Kowalski", "node": "n1", **UNPLACED_JOB}
    ]
    assert summary["errors"] == [
        "Jan Kowalski: firma 0000000009: ValueError: "
        "Couldn't look up 0000000009 in Companies pipeline"
    ]
    rows = sent_part(priority)
    assert [(row["name"], row["unplaced"]) for row in rows] == [
        ("Jan Kowalski", ["0000000009"]),
        ("Ewa Lis", []),
    ]
    assert [job.remembered(row) for row in rows] == [False, True]


def test_a_line_from_before_unplaced_jobs_were_recorded_is_remembered():
    rows = [
        {"person": "a", "payload": "1"},
        {"person": "b", "payload": "2", "unplaced": []},
        {"person": "c", "payload": "3", "unplaced": ["0000000009"]},
    ]

    assert [job.remembered(row) for row in rows] == [True, True, False]


def test_a_priority_dry_run_shows_the_tiers_and_writes_nothing(priority, capsys):
    priority.candidates = [
        candidate("Anna Nowak", HIRE, "2026-09-30"),
        candidate("Olga Wilk", BOUGHT),
        candidate("Jan Kowalski", PUBLISHED),
        candidate("Ewa Lis", ON_SITE),
    ]

    assert job.main(["--scope", "priority", "--dry-run", "--max-uploads", "3"]) == 0

    assert priority.sent() == []
    assert priority.objects == {}
    out = capsys.readouterr().out
    assert "The first 3 (--max-uploads) by tier:" in out
    assert (
        "'new_hire': 1, 'bought': 1, 'noted_missing': 0, 'noted': 0, "
        "'odpis_only_current': 0, 'rejestrio_current': 0, 'published': 1, "
        "'on_site': 0" in out
    )
    assert "Of the first 3, changes to published pages: 1" in out


def test_a_priority_run_may_create_as_many_pages_as_it_sends():
    args = job.parse_args(["--scope", "priority", "--max-uploads", "100"])

    assert (args.max_new, args.recent_days, args.resend_after) == (100, 30, 30)
    assert args.bought_days == 7
    assert job.parse_args(["--scope", "priority", "--max-new", "10"]).max_new == 10


def test_planning_keeps_the_order_and_tells_a_person_from_their_payload():
    first = candidate("Anna Nowak", HIRE)
    second = candidate("Beata Kos", HIRE)
    page = candidate("Jan Kowalski", PUBLISHED)
    sent = {(job.person_key(second.payload), job.payload_hash(second.payload))}

    planned, skipped = job.plan_priority([first, second, page], sent, max_new=5)

    assert [c.payload["name"] for c in planned] == ["Anna Nowak", "Jan Kowalski"]
    assert skipped == 1


# ---------------------------------------------------------------------------
# A priority run: what it sent, whatever order a payload lists things in


POSTS = [
    {"krs": "0000287447", "role": "Zarząd", "start": "2023-05-16", "end": None},
    {
        "krs": "0000012707",
        "role": "Rada Nadzorcza",
        "start": "2019-01-09",
        "end": "2023-06-12",
    },
    {
        "krs": "0000219532",
        "role": "Rada Nadzorcza",
        "start": "2018-10-01",
        "end": "2024-06-27",
    },
]


def holding(posts: list[dict], name: str = "Jan Kowalski", **fields) -> dict:
    """The payload of somebody holding `posts`, listed in that order."""
    return {
        "name": name,
        "companies": posts,
        "elections": [],
        "parties": [],
        "rejestrIo": f"https://rejestr.io/osoby/{name.rsplit(maxsplit=1)[-1]}",
        **fields,
    }


def test_a_payload_listing_the_same_things_in_another_order_is_one_hash():
    """Of the 100 people the 2026-10-13 and 10-14 nights sent, 33 and 40 had
    gone up before under another hash of the same posts: the build listed
    them in another order."""
    sent = job.payload_hash(holding(POSTS))

    assert job.payload_hash(holding(POSTS[::-1])) == sent
    assert job.payload_hash(holding(POSTS, parties=["PSL", "Inne"])) == (
        job.payload_hash(holding(POSTS, parties=["Inne", "PSL"]))
    )
    # What it lists still counts, and how many times.
    assert job.payload_hash(holding(POSTS[1:])) != sent
    assert job.payload_hash(holding([*POSTS, POSTS[0]])) != sent
    ended = [{**POSTS[0], "end": "2026-10-01"}, *POSTS[1:]]
    assert job.payload_hash(holding(ended)) != sent


def test_a_payload_sent_with_its_posts_in_another_order_is_left_out():
    sent = holding(POSTS)
    tonight = build.Candidate(holding(POSTS[::-1]), PUBLISHED, None)

    planned, skipped = job.plan_priority(
        [tonight], {(job.person_key(sent), job.payload_hash(sent))}, max_new=5
    )

    assert (planned, skipped) == ([], 1)


def gzipped(rows: list[dict]) -> bytes:
    """A part as the job writes one: JSON lines, Polish letters as they are."""
    lines = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
    return gzip.compress(lines.encode("utf-8"))


def test_a_part_is_read_line_by_line_at_newlines_alone():
    """A name may carry a line separator, which the part keeps raw."""
    rows = [{"name": "Anna\u2028Nowak"}, {"name": "Jan Kowalski"}]

    assert list(job.json_lines(gzipped(rows))) == rows


class Shared:
    """The shared cache's bucket, as the job writes its parts into it and
    `sent_recently` reads them back - and the job's `Client` onto it."""

    def __init__(self, objects: dict[str, bytes] | None = None):
        self.objects = objects if objects is not None else {}
        self.storage_client = SimpleNamespace(bucket=self.bucket)

    def bucket(self, name: str) -> "Shared":
        assert name == SHARED_BUCKET
        return self

    def create_object(self, bucket, name, data, content_type):
        assert name not in self.objects, f"{name} written twice"
        self.objects[name] = data
        return f"gs://{bucket}/{name}"

    def list_blobs(self, prefix, start_offset=""):
        return [
            self.get_blob(name)
            for name in sorted(self.objects)
            if name.startswith(prefix) and name >= start_offset
        ]

    def get_blob(self, name):
        if name not in self.objects:
            return None
        return SimpleNamespace(name=name, download_as_bytes=lambda: self.objects[name])


def test_a_night_leaves_alone_what_an_earlier_one_sent_listed_otherwise(
    world, monkeypatch
):
    shared = Shared()
    tonight: list[build.Candidate] = []
    monkeypatch.setattr(job, "Client", lambda: shared)
    monkeypatch.setattr(job, "build_priority", lambda *args: list(tonight))
    monkeypatch.setattr(job, "bought_since", lambda client, since: set())

    tonight[:] = [build.Candidate(holding(POSTS), PUBLISHED, None)]
    world.answers = [person("unchanged")]
    assert job.main(["--scope", "priority"]) == 0
    tonight[:] = [
        build.Candidate(holding(POSTS[::-1]), PUBLISHED, None),
        candidate("Ewa Lis", ON_SITE),
    ]
    world.answers = [person("updated")]
    assert job.main(["--scope", "priority"]) == 0

    assert world.sent() == ["Jan Kowalski", "Ewa Lis"]
    summaries = [
        json.loads(data)
        for name, data in shared.objects.items()
        if name.startswith(job.RUNS_PREFIX)
    ]
    assert sorted(summary["already_sent"] for summary in summaries) == [0, 1]


def test_a_line_hashed_as_listed_is_hashed_again_off_its_runs_payloads(capsys):
    """Every line written before the hash took lists in any order holds the
    hash of the payload as it was listed. Matched to the payload its run
    wrote, and hashed again, it still leaves that person out."""
    before, other = holding(POSTS), holding([], "Ewa Lis")
    part = "date=2026-10-12/06acc632.jsonl.gz"
    shared = Shared(
        {
            f"{job.SENT_PREFIX}{part}": gzipped(
                [
                    {
                        "person": job.person_key(payload),
                        "payload": job.hash_as_listed(payload),
                        "outcome": "unchanged",
                    }
                    for payload in (before, other)
                ]
            ),
            f"{job.PAYLOADS_PREFIX}{part}": gzipped(
                [before, other, holding([], "Olga Sowa")]
            ),
        }
    )

    seen = job.sent_recently(typing.cast(job.Client, shared), "2026-10-10")

    tonight = [
        build.Candidate(holding(POSTS[::-1]), PUBLISHED, None),
        build.Candidate(holding([], "Ewa Lis"), PUBLISHED, None),
        build.Candidate(holding([], "Olga Sowa"), PUBLISHED, None),
    ]
    planned, skipped = job.plan_priority(tonight, seen, max_new=5)
    assert [c.payload["name"] for c in planned] == ["Olga Sowa"]
    assert skipped == 2
    out = capsys.readouterr().out
    assert "Sent with the hash of the payload as listed: 2; 2 hashed again" in out


def test_a_line_whose_run_left_no_payloads_is_kept_as_it_was(capsys):
    """Nothing to hash it again from, so it leaves out only a payload whose
    lists come in an order that hashes the same either way."""
    unlisted, listed = holding([], "Ewa Lis"), holding(POSTS)
    part = "date=2026-10-12/06acc632.jsonl.gz"
    shared = Shared(
        {
            f"{job.SENT_PREFIX}{part}": gzipped(
                [
                    {
                        "person": job.person_key(payload),
                        "payload": job.hash_as_listed(payload),
                    }
                    for payload in (unlisted, listed)
                ]
            ),
        }
    )

    seen = job.sent_recently(typing.cast(job.Client, shared), "2026-10-10")

    assert (job.person_key(unlisted), job.payload_hash(unlisted)) in seen
    assert (job.person_key(listed), job.payload_hash(listed)) not in seen
    out = capsys.readouterr().out
    assert f"No payloads for {job.SENT_PREFIX}{part}: 2 lines left as they" in out


def test_a_line_taken_without_a_job_is_not_left_alone_however_it_was_hashed():
    """What a night reads back: the person the site took without a job goes
    again, with the hash of either kind, and the rest are left alone."""
    without = {"unplaced": ["0000000009"]}
    shared = Shared(
        {
            f"{job.SENT_PREFIX}date=2026-10-15/06ad03ac.jsonl.gz": gzipped(
                [
                    {"person": "a", "payload": "1", "hashed": job.HASHED},
                    {"person": "b", "payload": "2", "hashed": job.HASHED, **without},
                    {"person": "c", "payload": "3", "unplaced": []},
                    {"person": "d", "payload": "4", **without},
                ]
            ),
        }
    )

    seen = job.sent_recently(typing.cast(job.Client, shared), "2026-10-10")

    assert seen == {("a", "1"), ("c", "3")}


def test_what_was_sent_says_how_its_hash_was_made(priority):
    hire = candidate("Anna Nowak", HIRE, "2026-09-30")
    priority.candidates = [hire]
    priority.answers = [person("created")]

    assert job.main(["--scope", "priority"]) == 0

    [line] = sent_part(priority)
    assert (line["payload"], line["hashed"]) == (
        job.payload_hash(hire.payload),
        job.HASHED,
    )


# ---------------------------------------------------------------------------
# A priority run: the people bought from rejestr.io


def test_the_people_bought_this_week_go_up_in_a_tier_of_their_own(priority, capsys):
    priority.bought = {"Lis", "Wilk"}
    priority.candidates = [
        candidate("Anna Nowak", HIRE, "2026-09-30"),
        candidate("Ewa Lis", BOUGHT, "2026-08-01"),
        candidate("Jan Kowalski", PUBLISHED),
    ]
    priority.answers = [person("created"), person("updated"), person("updated")]

    assert job.main(["--scope", "priority"]) == 0

    assert priority.sent() == ["Anna Nowak", "Ewa Lis", "Jan Kowalski"]
    # The build is told whose feeds were bought, a week back from today.
    [built] = priority.built
    assert built["bought"] == {"Lis", "Wilk"}
    [since] = priority.bought_since
    assert (built["today"] - date.fromisoformat(since)).days == 7
    summary = priority.summary()
    assert summary["tiers"] == {
        HIRE: 1,
        BOUGHT: 1,
        MISSING: 0,
        NOTED: 0,
        SEATED: 0,
        LINKED: 0,
        PUBLISHED: 1,
        ON_SITE: 0,
    }
    # Two bought, one of them with a page to change.
    assert summary["bought_people"] == 2
    assert [(row["name"], row["tier"]) for row in sent_part(priority)] == [
        ("Anna Nowak", HIRE),
        ("Ewa Lis", BOUGHT),
        ("Jan Kowalski", PUBLISHED),
    ]
    out = capsys.readouterr().out
    assert (
        "Planned by tier: {'new_hire': 1, 'bought': 1, 'noted_missing': 0, "
        "'noted': 0, 'odpis_only_current': 0, 'rejestrio_current': 0, "
        "'published': 1, 'on_site': 0}" in out
    )


# ---------------------------------------------------------------------------
# A priority run: the pages somebody left a note on


def test_the_noted_pages_go_up_after_the_bought_in_tiers_of_their_own(priority):
    priority.candidates = [
        candidate("Ewa Lis", BOUGHT, "2026-08-01"),
        candidate("Olga Wilk", MISSING, "2024-01-01"),
        candidate("Piotr Sowa", NOTED),
        candidate("Jan Kowalski", PUBLISHED, "2026-09-01"),
    ]
    priority.answers = [person("updated")] * 3

    assert job.main(["--scope", "priority", "--max-uploads", "3"]) == (
        job.EXIT_TRY_LATER
    )

    assert priority.sent() == ["Ewa Lis", "Olga Wilk", "Piotr Sowa"]
    assert priority.summary()["tiers"] == {
        HIRE: 0,
        BOUGHT: 1,
        MISSING: 1,
        NOTED: 1,
        SEATED: 0,
        LINKED: 0,
        PUBLISHED: 1,
        ON_SITE: 0,
    }
    assert [(row["name"], row["tier"]) for row in sent_part(priority)] == [
        ("Ewa Lis", BOUGHT),
        ("Olga Wilk", MISSING),
        ("Piotr Sowa", NOTED),
    ]


def test_a_page_made_for_somebody_noted_stops_the_run(priority):
    # The noted are pages the site has: one created is the identity lookup
    # missing somebody, as for any page but a new hire's.
    priority.candidates = [candidate("Olga Wilk", MISSING)]
    priority.answers = [person("created", "new-node")]

    assert job.main(["--scope", "priority"]) == job.EXIT_FAILED

    assert priority.summary()["stopped"].startswith(
        "utworzył stronę dla osoby, która już ma"
    )


def test_bought_days_0_takes_todays_purchases_alone(priority):
    priority.candidates = [candidate("Anna Nowak", PUBLISHED)]
    priority.answers = [person("updated")]

    assert job.main(["--scope", "priority", "--bought-days", "0"]) == 0

    [built] = priority.built
    assert priority.bought_since == [built["today"].isoformat()]


def test_who_was_bought_is_read_off_the_names_the_answers_are_stored_under():
    def stored(person_id: str, day: str) -> list[str]:
        # Named as the paid job names what it buys: both feeds of a person.
        feeds = RejestrIOQuery(
            person=RejestrIOKey(person_id), queries=list(PEOPLE_QUERIES)
        )
        return [answer_name(url, day) for url in feeds.urls()]

    names = [
        *stored("1134749", "2026-10-08"),
        *stored("2447520", "2026-10-07"),
        *stored("1037389", "2026-10-06"),  # before the day asked for
        "hostname=rejestr.io/api/v2/org/0000012345/krs-powiazania/"
        "aktualnosc_aktualne/date=2026-10-08",
    ]

    masks: list[str | None] = []

    class Bucket:
        def list_blobs(self, prefix, fields=None):
            masks.append(fields)
            # A name and nothing else, as the masked listing hands a blob back:
            # reading any other attribute raises here rather than at night.
            return [SimpleNamespace(name=n) for n in names if n.startswith(prefix)]

    class Storage:
        def bucket(self, name):
            assert name == CRAWLED_BUCKET
            return Bucket()

    client = typing.cast(job.Client, SimpleNamespace(storage_client=Storage()))

    assert job.bought_since(client, "2026-10-07") == {"1134749", "2447520"}
    # Names only, as `Client.list_blobs` lists: unmasked, the 5,000 feeds
    # cost 5.5 MB of metadata a night rather than 0.6 MB.
    assert masks == [LISTING_FIELDS]


# ---------------------------------------------------------------------------
# A run asked for on a page (--request)


COMPANY = Request(
    run_id="run-asked",
    job="people_request",
    target="company",
    node_id="place-1",
    name="Wodociągi Miejskie",
    krs="0000000001",
    by="uid-1",
)


@pytest.fixture
def asked(world, monkeypatch) -> World:
    """The world, with a request on the site and a build for one page."""
    world.request = COMPANY
    world.targeted = Targeted()

    def read_request(run_id):
        world.events.append(f"read {run_id}")
        assert run_id == world.request.run_id
        return world.request

    def build_targeted(target, koryta_date, policy):
        world.events.append("build")
        world.built.append({"target": target, "policy": policy})
        return list(world.candidates), world.targeted

    monkeypatch.setattr(job, "read_request", read_request)
    monkeypatch.setattr(job, "build_targeted", build_targeted)
    return world


def plan_for(world: World, changed: list[str], new: list[str], **counts) -> None:
    world.candidates = [candidate(name, ON_SITE) for name in changed] + [
        candidate(name, NEW) for name in new
    ]
    world.targeted = Targeted(
        new=[object()] * len(new),  # type: ignore[list-item]
        changed=[object()] * len(changed),  # type: ignore[list-item]
        **counts,
    )


def test_a_run_asked_for_on_a_page_goes_on_in_the_run_the_site_queued(asked):
    plan_for(asked, ["Anna Nowak"], ["Jan Kowalski"], matched=3, up_to_date=1)
    asked.answers = [person("updated"), person("created", "new-node")]

    assert job.main(["--request", "run-asked"]) == 0

    run = asked.run()
    assert run.job == "people_request"
    assert run.kwargs == {
        "run_id": "run-asked",
        "trigger": "request",
        "adopt": True,
        "unit": "osób",
    }
    assert asked.events.index("read run-asked") < asked.events.index("build")
    [built] = asked.built
    assert built["target"].kind == "company"
    assert (built["target"].node_id, built["target"].krs) == ("place-1", "0000000001")
    assert asked.sent() == ["Anna Nowak", "Jan Kowalski"]

    end = run.ending()
    assert end["state"] == "succeeded"
    assert end["counters"]["matched"] == 3
    assert end["counters"]["up_to_date"] == 1
    assert end["counters"]["created"] == 1
    summary = asked.summary()
    assert summary["run"] == "run-asked"
    assert (summary["scope"], summary["target"]) == ("request", COMPANY.describe())
    # What it took is remembered, so the night leaves these people alone.
    assert [row["name"] for row in sent_part(asked)] == ["Anna Nowak", "Jan Kowalski"]


def test_a_page_made_for_somebody_the_site_has_stops_an_asked_for_run(asked):
    plan_for(asked, ["Anna Nowak", "Ewa Lis"], [])
    asked.answers = [person("created", "new-node")]

    assert job.main(["--request", "run-asked"]) == job.EXIT_FAILED

    assert asked.sent() == ["Anna Nowak"]
    assert asked.summary()["state"] == "failed"


def test_an_asked_for_run_creates_no_more_pages_than_it_was_asked_to(asked):
    plan_for(asked, [], ["Jan Kowalski"])
    asked.answers = [person("created", "a"), person("created", "b")]
    # One person the site lacks, but two pages made: the second one stops it.
    asked.candidates.append(candidate("Anna Nowak", NEW))

    assert job.main(["--request", "run-asked"]) == job.EXIT_FAILED

    assert asked.sent() == ["Jan Kowalski", "Anna Nowak"]
    assert "(--max-new)" in asked.summary()["stopped"]


def test_a_page_with_nothing_new_says_so(asked):
    plan_for(asked, [], [], matched=2, up_to_date=2)

    assert job.main(["--request", "run-asked"]) == 0

    assert asked.sent() == []
    end = asked.run().ending()
    assert end["state"] == "succeeded"
    assert end["stop_reason"] == job.STOP_UP_TO_DATE
    assert end["counters"]["up_to_date"] == 2


def test_a_person_nobody_can_be_sure_of_is_said_so(asked):
    asked.request = Request(
        run_id="run-asked",
        job="people_request",
        target="person",
        node_id="p-1",
        name="Anna Nowak",
        rejestr_io="https://rejestr.io/osoby/5",
    )
    asked.targeted = Targeted(
        matched=2, left_out=2, reason="2 osoby z danych trafiłyby na tę stronę"
    )

    assert job.main(["--request", "run-asked"]) == 0

    [built] = asked.built
    assert (built["target"].kind, built["target"].register) == ("person", "5")
    end = asked.run().ending()
    assert end["stop_reason"] == "2 osoby z danych trafiłyby na tę stronę"
    assert end["counters"]["left_out"] == 2


def test_a_request_for_a_count_alone_sends_nothing(asked):
    asked.request = Request(**{**COMPANY.__dict__, "dry_run": True})
    plan_for(asked, ["Anna Nowak"], ["Jan Kowalski"], matched=2)

    assert job.main(["--request", "run-asked"]) == 0

    assert asked.sent() == []
    assert "token" not in asked.events
    assert asked.objects == {}
    end = asked.run().ending()
    assert end["stop_reason"] == job.STOP_DRY_RUN
    assert end["counters"] == {
        "planned": 2,
        "matched": 2,
        "to_change": 1,
        "to_create": 1,
        "up_to_date": 0,
        "left_out": 0,
    }


def test_a_request_that_cannot_be_read_fails_its_run(asked, monkeypatch):
    def unreadable(run_id):
        raise job_requests.RequestError(f"{run_id}: no request")

    monkeypatch.setattr(job, "read_request", unreadable)

    with pytest.raises(job_requests.RequestError):
        job.main(["--request", "run-asked"])

    end = asked.run().ending()
    assert end["state"] == "failed"
    assert "no request" in end["errors"][0]


# ---------------------------------------------------------------------------
# --companies-only: the companies the night's people need, before them


def naming(
    name: str, *krs: str, tier: str = HIRE, published: bool | None = None
) -> build.Candidate:
    """A candidate whose payload names these companies, none of which the
    export has a page for."""
    found = candidate(name, tier, "2026-09-30", published)
    posts = [{"krs": number, "role": "Prezes Zarządu"} for number in krs]
    return build.Candidate(
        {**found.payload, "companies": posts},
        found.tier,
        found.since,
        found.published,
        tuple(krs),
    )


@pytest.fixture
def on_file(monkeypatch) -> dict[str, dict]:
    """`Companies`, which the uploader creates a company from, without
    running it: 0000000009 is not in it."""
    rows: dict[str, dict] = {
        krs: {"krs": krs, "name": f"Spółka {krs[-1]}", "parents": []}
        for krs in ("0000000001", "0000000002", "0000000003")
    }
    monkeypatch.setattr(PersonUploader, "company_payloads", property(lambda _: rows))
    return rows


def company(outcome: str = "created") -> Response:
    return Response(200, {"id": "c", "code": 200, "company": outcome})


def companies_summary(world: World) -> dict:
    [name] = [n for n in world.objects if n.startswith(job.COMPANIES_PREFIX)]
    return json.loads(world.objects[name])


COMPANIES_FIRST = ["--scope", "priority", "--companies-only"]


def test_the_companies_tonights_people_need_are_created_and_no_person_sent(
    priority, on_file
):
    """Szymon, 2026-10-15: before the people go up, the companies they name
    that the export has no page for - so that no job of theirs waits for the
    uploader to create its company on the way, as 16 did on 10-14."""
    priority.candidates = [
        naming("Anna Nowak", "0000000001", "0000000002"),
        # Named twice, created once.
        naming("Beata Kos", "0000000002", tier=BOUGHT),
        candidate("Jan Kowalski", PUBLISHED),
        # Past --max-uploads: not one of tonight's people.
        naming("Ewa Lis", "0000000003", tier=ON_SITE),
    ]
    priority.answers = [company(), company()]

    assert job.main([*COMPANIES_FIRST, "--max-uploads", "3"]) == 0

    assert priority.sent() == ["Spółka 1", "Spółka 2"]
    run = priority.run()
    assert (run.job, run.kwargs["unit"]) == ("company_import", "firm")
    assert run.calls[0] == ("start", {"phase": "paczki"})
    assert ("progress", {"done": None, "phase": "firmy", "force": True}) in run.calls
    end = run.ending()
    assert (end["state"], end["stop_reason"], end["exit_code"]) == (
        "succeeded",
        None,
        0,
    )
    assert end["counters"] == {
        "planned": 2,
        "companies_created": 2,
        "updated": 0,
        "unchanged": 0,
        "failed": 0,
    }
    assert end["done"] == 2
    # Its summary alone: no payloads part, and nothing remembered as sent.
    summary = companies_summary(priority)
    name = (
        f"{job.COMPANIES_PREFIX}date={summary['started'][:10]}/{run.kwargs['run_id']}"
    )
    assert list(priority.objects) == [f"{name}.json"]
    assert end["summary_path"] == f"gs://{SHARED_BUCKET}/{name}.json"
    assert (summary["planned"], summary["people"]) == (4, 3)
    assert summary["companies"] == [
        {
            "krs": "0000000001",
            "name": "Spółka 1",
            "people": ["Anna Nowak"],
            "outcome": "created",
        },
        {
            "krs": "0000000002",
            "name": "Spółka 2",
            "people": ["Anna Nowak", "Beata Kos"],
            "outcome": "created",
        },
    ]


def test_people_whose_companies_are_all_on_the_site_need_nothing_and_say_so(
    priority, on_file
):
    priority.candidates = [candidate("Jan Kowalski", PUBLISHED)]

    assert job.main(COMPANIES_FIRST) == 0

    assert priority.sent() == []
    end = priority.run().ending()
    assert (end["state"], end["stop_reason"]) == ("succeeded", job.STOP_NO_COMPANIES)
    assert companies_summary(priority)["companies"] == []


def test_a_company_that_cannot_be_created_is_left_to_the_people_run(priority, on_file):
    """It tries again, and leaves the job off the person's page if it cannot
    either - which is why this is partial and never failed."""
    priority.candidates = [
        naming("Anna Nowak", "0000000009", "0000000001"),
        naming("Beata Kos", "0000000002", tier=BOUGHT),
    ]
    priority.answers = [company(), Response(500, text="Internal Server Error")]

    assert job.main(COMPANIES_FIRST) == job.EXIT_TRY_LATER

    # Nothing in `Companies` to make 0000000009 from: never sent.
    assert priority.sent() == ["Spółka 1", "Spółka 2"]
    end = priority.run().ending()
    assert (end["state"], end["stop_reason"]) == ("partial", "nie dodano firm: 2 z 3")
    assert end["counters"]["companies_created"] == 1
    assert end["counters"]["failed"] == 2
    assert end["errors"] == [
        "firma 0000000009: ValueError: Couldn't look up 0000000009 in Companies "
        "pipeline",
        "firma 0000000002: 500 Internal Server Error",
    ]
    assert [
        (row["krs"], row["outcome"], row.get("error", "")[:14])
        for row in companies_summary(priority)["companies"]
    ] == [
        ("0000000009", "failed", "firma 00000000"),
        ("0000000001", "created", ""),
        ("0000000002", "failed", "firma 00000000"),
    ]


def test_a_company_made_since_the_export_is_counted_as_the_site_answered(
    priority, on_file
):
    priority.candidates = [naming("Anna Nowak", "0000000001", "0000000002")]
    priority.answers = [company("unchanged"), company("updated")]

    assert job.main(COMPANIES_FIRST) == 0

    counters = priority.run().ending()["counters"]
    assert (counters["companies_created"], counters["unchanged"]) == (0, 1)
    assert counters["updated"] == 1
    assert [row["outcome"] for row in companies_summary(priority)["companies"]] == [
        "unchanged",
        "updated",
    ]


def test_a_companies_dry_run_counts_them_and_sends_and_writes_nothing(
    priority, on_file, monkeypatch, capsys
):
    def no_sign_in(endpoint):
        raise AssertionError("a dry run signs in to nothing")

    monkeypatch.setattr(job, "token_source", no_sign_in)
    priority.candidates = [
        naming("Anna Nowak", "0000000001", "0000000002"),
        naming("Beata Kos", "0000000003", tier=BOUGHT),
    ]

    assert job.main([*COMPANIES_FIRST, "--dry-run", "--max-uploads", "1"]) == 0

    assert priority.sent() == [] and priority.objects == {}
    assert priority.run().ending() == {
        "state": "succeeded",
        "stop_reason": "próba - nic nie wysłano",
        "counters": {"planned": 2},
        "exit_code": 0,
        "done": 0,
    }
    out = capsys.readouterr().out
    assert (
        "The first 1 of 2 people planned (--max-uploads) name 2 companies the "
        "export has no page for: 0000000001, 0000000002\n"
    ) in out
    assert f"Dry run: 2 companies would be created at {ENDPOINT}" in out


def test_the_companies_are_refused_the_export_the_people_would_be(priority):
    priority.export = None

    assert job.main(COMPANIES_FIRST) == job.EXIT_FAILED

    assert priority.sent() == [] and priority.built == []
    end = priority.run().ending()
    assert (end["state"], end["stop_reason"]) == (
        "failed",
        "brak dzisiejszej kopii bazy (żadnej)",
    )
    assert end["summary_path"].startswith(
        f"gs://{SHARED_BUCKET}/{job.COMPANIES_PREFIX}"
    )


def test_sigterm_stops_the_companies_after_the_one_in_hand(
    priority, on_file, monkeypatch
):
    handlers: list = []

    def install(signum, handler):
        handlers.append(handler)
        return "the handler before"

    monkeypatch.setattr(job.signal, "signal", install)

    def answer_then_sigterm():
        handlers[0](15, None)
        return company()

    priority.candidates = [naming("Anna Nowak", "0000000001", "0000000002")]
    priority.answers = [answer_then_sigterm, company()]

    assert job.main(COMPANIES_FIRST) == job.EXIT_TRY_LATER

    assert priority.sent() == ["Spółka 1"]
    end = priority.run().ending()
    assert (end["state"], end["stop_reason"], end["done"]) == ("partial", "SIGTERM", 1)


@pytest.mark.parametrize(
    "argv",
    [
        ["--companies-only"],
        ["--scope", "on-koryta", "--companies-only"],
        ["--request", "run-asked", "--companies-only"],
    ],
)
def test_companies_first_needs_a_priority_run_to_plan_the_people(argv):
    with pytest.raises(SystemExit):
        job.parse_args(argv)


def test_the_needed_companies_go_once_each_in_the_order_the_people_go():
    payloads = [{"name": "Anna Nowak"}, {"name": "Jan Kowalski"}, {"name": "Ewa Lis"}]
    missing = [("0000000002", "0000000001"), (), ("0000000001",)]

    assert job.companies_needed(payloads, missing) == {
        "0000000002": ["Anna Nowak"],
        "0000000001": ["Anna Nowak", "Ewa Lis"],
    }


def test_each_planned_person_says_which_companies_the_export_has_no_page_for(
    monkeypatch,
):
    class Dumper:
        def dump_pandas(self):
            pass

    hire = Person(
        name="Anna Nowak",
        companies=[
            Company(krs="0000000009", role="Prezes", start="2026-09-30"),
            Company(krs="0000000001", role="Prokurent"),
        ],
        elections=[],
        sources=[],
        rejestrIo="https://rejestr.io/osoby/2",
    )
    on_site = SiteSnapshot(
        pd.DataFrame.from_records(
            [{"id": "c1", "type": "place", "name": "Spółka", "krsNumber": "0000000001"}]
        ),
        pd.DataFrame(),
    )

    class Payloads:
        def prioritised(self, ctx, today, recent_days, bought, groups=()):
            return [Pick(hire, HIRE, "2026-09-30")]

        def site_snapshot(self, ctx):
            return on_site

    monkeypatch.setattr(build, "setup_context", lambda *a, **k: ("ctx", Dumper()))
    monkeypatch.setattr(
        build.Pipeline, "create", staticmethod(lambda kind, nested=0: Payloads())
    )
    monkeypatch.setattr(sys, "argv", ["koryta_people_import"])

    [found] = build.build_priority(
        None, ProcessPolicy(set()), date(2026, 10, 15), 30, set()
    )

    assert (found.payload["name"], found.tier) == ("Anna Nowak", HIRE)
    assert found.missing == ("0000000009",)


# ---------------------------------------------------------------------------
# Priority groups: companies whose people go right after the noted pages


def member(name: str, tier: str, *groups: str) -> build.Candidate:
    """A payload of the tier, of somebody in a post now at the companies of
    each of `groups`."""
    return replace(candidate(name, tier), groups=groups)


def charged(planned: list[build.Candidate]) -> list[tuple[str, str, str]]:
    """Who goes, in their tier, for which group ("" for the run's own tiers)."""
    return [(c.payload["name"], c.tier, c.group) for c in planned]


SKARB = "skarb-panstwa:3:new=2"


def test_a_group_goes_after_the_noted_out_of_a_budget_of_its_own():
    """Szymon, 2026-10-27: "if a person payload is uploaded for a higher
    priority group, it doesn't count against a lower priority group"; and
    2026-10-28: the groups go after the noted pages."""
    found = [
        candidate("Anna Nowak", HIRE),
        member("Beata Kos", HIRE, "skarb-panstwa"),
        candidate("Olga Sowa", BOUGHT),
        candidate("Piotr Lis", NOTED),
        odpis_only("Celina Bąk", tier=SEATED),
        member("Jan Mazur", LINKED, "skarb-panstwa"),
        candidate("Adam Wójcik", LINKED),
        member("Ewa Wilk", LINKED, "skarb-panstwa"),
        member("Iga Pawlak", LINKED, "skarb-panstwa"),
        member("Zofia Kruk", PUBLISHED, "skarb-panstwa"),
        member("Marta Sikora", ON_SITE, "skarb-panstwa"),
        candidate("Marek Zając", ON_SITE),
    ]

    planned, _ = job.plan_priority(
        found,
        set(),
        50,
        max_odpis_only_current=1,
        max_published=1,
        max_rejestrio_current=1,
        groups=[parse_group(SKARB)],
    )

    assert charged(planned) == [
        ("Anna Nowak", HIRE, ""),
        # A new hire goes ahead of every group anyway.
        ("Beata Kos", HIRE, ""),
        ("Olga Sowa", BOUGHT, ""),
        ("Piotr Lis", NOTED, ""),
        ("Jan Mazur", LINKED, "skarb-panstwa"),
        ("Ewa Wilk", LINKED, "skarb-panstwa"),
        # Two pages are the group's new=2: the third goes a draft's way.
        ("Marta Sikora", ON_SITE, "skarb-panstwa"),
        ("Celina Bąk", SEATED, ""),
        # The run's own one, as if there were no group; Iga Pawlak, past both
        # the group's pages and the run's own cap, waits.
        ("Adam Wójcik", LINKED, ""),
        # A published page keeps the run's own cap: a reviewer's.
        ("Zofia Kruk", PUBLISHED, ""),
        ("Marek Zając", ON_SITE, ""),
    ]


def test_members_past_a_group_s_budget_go_in_their_own_tier_as_without_it():
    found = [member(f"Osoba {i}", LINKED, "skarb-panstwa") for i in range(1, 6)]
    found.append(candidate("Jan Mazur", ON_SITE))

    planned, _ = job.plan_priority(
        found,
        set(),
        50,
        max_rejestrio_current=1,
        groups=[parse_group("skarb-panstwa:2")],
    )

    assert charged(planned) == [
        ("Osoba 1", LINKED, "skarb-panstwa"),
        ("Osoba 2", LINKED, "skarb-panstwa"),
        ("Osoba 3", LINKED, ""),
        ("Jan Mazur", ON_SITE, ""),
    ]


def test_somebody_in_two_groups_is_sent_for_the_first_with_room():
    found = [
        member("Anna Nowak", LINKED, "skarb-panstwa", "energetyka"),
        member("Beata Kos", LINKED, "skarb-panstwa", "energetyka"),
        member("Ewa Lis", ON_SITE, "energetyka"),
    ]
    groups = [parse_group("skarb-panstwa:1"), parse_group("energetyka:5")]

    planned, _ = job.plan_priority(
        found, set(), 50, max_rejestrio_current=0, groups=groups
    )

    assert charged(planned) == [
        ("Anna Nowak", LINKED, "skarb-panstwa"),
        ("Beata Kos", LINKED, "energetyka"),
        ("Ewa Lis", ON_SITE, "energetyka"),
    ]


def test_the_pages_a_group_makes_count_against_max_new_after_the_new_hires():
    """--max-new is every page a run may make before it stops as failed, so
    a group's pages count too: after the new hires', ahead of the run's own."""
    found = [
        candidate("Anna Nowak", HIRE),
        member("Jan Mazur", LINKED, "skarb-panstwa"),
        member("Ewa Wilk", LINKED, "skarb-panstwa"),
        candidate("Adam Wójcik", LINKED),
        member("Zofia Kruk", ON_SITE, "skarb-panstwa"),
    ]

    planned, _ = job.plan_priority(
        found, set(), 2, groups=[parse_group("skarb-panstwa:5")]
    )

    assert charged(planned) == [
        ("Anna Nowak", HIRE, ""),
        ("Jan Mazur", LINKED, "skarb-panstwa"),
        ("Zofia Kruk", ON_SITE, "skarb-panstwa"),
    ]


def test_a_group_with_no_budget_or_nobody_in_it_changes_nothing():
    found = [
        candidate("Anna Nowak", HIRE),
        odpis_only("Beata Kos", tier=HIRE),
        candidate("Olga Sowa", BOUGHT, published=True),
        candidate("Piotr Lis", MISSING),
        candidate("Iga Pawlak", NOTED, published=True),
        odpis_only("Celina Bąk", tier=SEATED),
        odpis_only("Dorota Wilk", tier=SEATED),
        member("Jan Mazur", LINKED, "skarb-panstwa"),
        candidate("Adam Wójcik", LINKED),
        member("Ewa Lis", LINKED, "skarb-panstwa"),
        member("Zofia Kruk", PUBLISHED, "skarb-panstwa"),
        candidate("Marek Zając", PUBLISHED),
        member("Marta Sikora", ON_SITE, "skarb-panstwa"),
    ]

    def plan(*groups: str) -> list[build.Candidate]:
        planned, _ = job.plan_priority(
            found,
            set(),
            50,
            max_new_odpis_only=0,
            max_odpis_only_current=1,
            max_published=2,
            max_rejestrio_current=2,
            groups=[parse_group(group) for group in groups],
        )
        return planned

    assert plan("skarb-panstwa:0") == plan()
    assert plan("koleje:100") == plan()


def test_the_fill_gives_the_slots_left_to_the_people_past_their_cap_alone():
    """Once the drafts to change run out, every tier left has a cap and a run
    sends ~250 of its 500. The fill gives the rest to the people with a
    rejestr.io entry in an older public post, never to a published page or
    to somebody only an odpis names, and within --max-new."""
    found = [
        candidate("Anna Nowak", HIRE),
        odpis_only("Celina Bąk", tier=SEATED),
        odpis_only("Dorota Wilk", tier=SEATED),
        *[candidate(f"Osoba {i}", LINKED) for i in range(1, 6)],
        candidate("Zofia Kruk", PUBLISHED),
        candidate("Marek Zając", PUBLISHED),
    ]

    def plan(fill_to: int | None, max_new: int = 50) -> list[tuple[str, bool]]:
        planned, _ = job.plan_priority(
            found,
            set(),
            max_new,
            max_odpis_only_current=1,
            max_published=1,
            max_rejestrio_current=2,
            fill_to=fill_to,
        )
        return [(c.payload["name"], c.filled) for c in planned]

    head = [(name, False) for name in ("Anna Nowak", "Celina Bąk")]
    head += [(name, False) for name in ("Osoba 1", "Osoba 2", "Zofia Kruk")]
    assert plan(None) == head
    assert plan(5) == head
    assert plan(7) == head + [("Osoba 3", True), ("Osoba 4", True)]
    assert plan(100) == head + [(f"Osoba {i}", True) for i in (3, 4, 5)]
    # Four pages already: one more to the fifth.
    assert plan(100, max_new=5) == head + [("Osoba 3", True)]


def test_a_run_with_a_priority_group_says_what_it_planned_and_sent_for_it(
    priority, capsys
):
    group = parse_group("skarb-panstwa:2:new=1")
    priority.candidates = [
        candidate("Anna Nowak", HIRE, "2026-09-30"),
        member("Beata Kos", HIRE, "skarb-panstwa"),
        member("Jan Mazur", LINKED, "skarb-panstwa"),
        member("Ewa Wilk", LINKED, "skarb-panstwa"),
        candidate("Adam Wójcik", LINKED),
        member("Marta Sikora", ON_SITE, "skarb-panstwa"),
        candidate("Marek Zając", ON_SITE),
    ]
    priority.answers = [person("created", page) for page in ("a", "b", "c")]
    priority.answers += [person("updated", "d"), person("created", "e")]
    priority.answers += [person("updated", "f")]
    argv = ["--scope", "priority", "--max-uploads", "10"]
    argv += ["--max-rejestrio-current", "1", "--priority-group", group.text]

    assert job.main(argv) == 0

    assert [built["groups"] for built in priority.built] == [[group]]
    assert priority.sent() == [
        "Anna Nowak",
        "Beata Kos",
        "Jan Mazur",
        "Marta Sikora",
        "Ewa Wilk",
        "Marek Zając",
    ]
    summary = priority.summary()
    assert summary["state"] == "succeeded"
    assert summary["groups"] == {
        "skarb-panstwa": {
            "budget": 2,
            "new": 1,
            "members": {HIRE: 1, LINKED: 2, ON_SITE: 1},
            "planned": 2,
            "to_create": 1,
            "planned_in_own_tiers": 2,
            "sent": {"created": 1, "updated": 1},
        }
    }
    assert summary["order"] == [
        ["", HIRE, 2],
        ["skarb-panstwa", LINKED, 1],
        ["skarb-panstwa", ON_SITE, 1],
        ["", LINKED, 1],
        ["", ON_SITE, 1],
    ]
    assert summary["tiers"][LINKED] == 2
    assert [row["group"] for row in sent_part(priority)] == [
        None,
        None,
        "skarb-panstwa",
        "skarb-panstwa",
        None,
        None,
    ]
    out = capsys.readouterr().out
    assert (
        "Priority group skarb-panstwa: 2 of 4 members planned (budget 2), 1 of them "
        "pages to create (new=1); 2 more in the run's own tiers" in out
    )
    assert (
        "People with a rejestr.io entry in an older public post: 2 of 3 "
        "planned (--max-rejestrio-current 1; 1 more for priority groups or "
        "the fill)" in out
    )


def test_a_priority_dry_run_shows_the_first_by_group(priority, capsys):
    priority.candidates = [
        candidate("Anna Nowak", HIRE),
        member("Jan Mazur", LINKED, "skarb-panstwa"),
        candidate("Ewa Lis", ON_SITE),
    ]
    argv = ["--scope", "priority", "--dry-run", "--max-uploads", "2"]

    assert job.main([*argv, "--priority-group", "skarb-panstwa:5"]) == 0

    assert priority.sent() == [] and priority.objects == {}
    assert (
        "The first 2 (--max-uploads) by priority group: {'skarb-panstwa': 1}; the "
        "run's own tiers: 1" in capsys.readouterr().out
    )


def test_the_fill_keeps_a_run_at_max_uploads(priority, capsys):
    priority.candidates = [
        candidate("Anna Nowak", HIRE),
        *[candidate(f"Osoba {i}", LINKED) for i in range(1, 6)],
    ]
    priority.answers = [person("created", f"page-{i}") for i in range(4)]
    argv = ["--scope", "priority", "--max-uploads", "4"]
    argv += ["--max-rejestrio-current", "1", "--fill-rejestrio-current"]

    assert job.main(argv) == 0

    assert priority.sent() == ["Anna Nowak", "Osoba 1", "Osoba 2", "Osoba 3"]
    summary = priority.summary()
    assert (summary["filled"], len(summary["created"])) == (2, 4)
    assert summary["order"] == [["", HIRE, 1], ["", LINKED, 3]]
    assert (
        "Filled up to --max-uploads 4: 2 more people with a rejestr.io entry "
        "in an older public post" in capsys.readouterr().out
    )


def test_a_priority_run_takes_its_groups_in_order_and_the_fill():
    args = job.parse_args(
        [
            "--scope",
            "priority",
            "--priority-group",
            "skarb-panstwa:100:new=50",
            "--priority-group",
            "obronnosc:20",
            "--fill-rejestrio-current",
        ]
    )

    assert [(g.name, g.budget, g.new) for g in args.priority_group] == [
        ("skarb-panstwa", 100, 50),
        ("obronnosc", 20, 20),
    ]
    assert args.fill_rejestrio_current
    assert job.parse_args(["--scope", "priority"]).priority_group is None


@pytest.mark.parametrize(
    "argv",
    [
        ["--priority-group", "skarb-panstwa:100"],
        ["--scope", "not-on-koryta", "--max-new", "5", "--fill-rejestrio-current"],
        ["--request", "run-asked", "--priority-group", "skarb-panstwa:100"],
        ["--scope", "priority", "--priority-group", "prokuratoria:100"],
        [
            "--scope",
            "priority",
            "--priority-group",
            "skarb-panstwa:100",
            "--priority-group",
            "skarb-panstwa:5",
        ],
    ],
)
def test_groups_and_the_fill_are_a_priority_run_s_and_named_once(argv):
    with pytest.raises(SystemExit):
        job.parse_args(argv)


def test_each_planned_person_names_the_priority_groups_they_belong_to(monkeypatch):
    class Dumper:
        def dump_pandas(self):
            pass

    seated = Person(
        name="Jan Mazur",
        companies=[Company(krs="0000000001", role="Prezes", start="2020-01-01")],
        elections=[],
        sources=[],
        rejestrIo="https://rejestr.io/osoby/3",
    )
    asked: list[list] = []

    class Payloads:
        def prioritised(self, ctx, today, recent_days, bought, groups=()):
            asked.append(list(groups))
            return [Pick(seated, LINKED, "2020-01-01", groups=("skarb-panstwa",))]

        def site_snapshot(self, ctx):
            return SiteSnapshot(pd.DataFrame(), pd.DataFrame())

    monkeypatch.setattr(build, "setup_context", lambda *a, **k: ("ctx", Dumper()))
    monkeypatch.setattr(
        build.Pipeline, "create", staticmethod(lambda kind, nested=0: Payloads())
    )
    monkeypatch.setattr(sys, "argv", ["koryta_people_import"])
    group = parse_group("skarb-panstwa:10")

    [found] = build.build_priority(
        None, ProcessPolicy(set()), date(2026, 10, 28), 30, set(), [group]
    )

    assert asked == [[group]]
    assert (found.payload["name"], found.groups) == ("Jan Mazur", ("skarb-panstwa",))
