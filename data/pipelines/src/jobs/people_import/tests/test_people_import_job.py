"""The daily people import: what it builds, what it sends, when it stops."""

import argparse
import gzip
import json
import math
import sys
import typing
from datetime import date
from types import SimpleNamespace

import pandas as pd
import pytest

import jobs.people_import as job
from analysis.payloads.target import NEW, Targeted
from entities.person import RejestrIOKey
from jobs.krs_common import answer_name
from jobs.people_import import payloads as build
from scrapers.krs.scrape import PEOPLE_QUERIES, RejestrIOQuery
from scrapers.stores import ProcessPolicy
from stores import job_requests
from stores.job_requests import Request
from stores.storage import CRAWLED_BUCKET, SHARED_BUCKET
from uploader import Args, PersonUploader

ENDPOINT = "https://autopush.koryta.pl"


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
    """Everything the job touches, faked: the build, the bucket, the site."""

    def __init__(self):
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

    def sent(self) -> list[str]:
        return [e.removeprefix("send ") for e in self.events if e.startswith("send ")]

    def summary(self) -> dict:
        [name] = [name for name in self.objects if name.startswith(job.RUNS_PREFIX)]
        return json.loads(self.objects[name])


@pytest.fixture
def world(monkeypatch) -> World:
    w = World()

    def build_payloads(scope, koryta_date, policy):
        w.events.append("build")
        w.built.append(
            {
                "scope": scope,
                "date": koryta_date,
                "policy": policy,
                "argv": list(sys.argv),
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


def test_pages_within_max_new_are_listed_but_are_no_error(world):
    world.payloads = people(2)
    world.answers = [person("created", "n1"), person()]

    assert job.main(["--scope", "not-on-koryta", "--max-new", "5"]) == 0

    assert world.run().ending()["errors"] == []
    assert world.summary()["created"] == ["Osoba 1 (n1)"]
    assert world.summary()["scope"] == "not-on-koryta"


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


# ---------------------------------------------------------------------------
# Flags, and what reaches the pipelines


def test_the_jobs_flags_never_reach_the_pipelines(world, monkeypatch):
    monkeypatch.setattr(sys, "argv", ["koryta_people_import", "--max-uploads", "5"])
    world.payloads = []

    job.main(["--max-uploads", "5", "--koryta-date", "2026-10-01"])

    [built] = world.built
    assert built["argv"] == ["koryta_people_import"]
    assert (built["scope"], built["date"]) == ("on-koryta", "2026-10-01")


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
    ],
)
def test_a_flag_the_job_does_not_know_is_refused(argv):
    with pytest.raises(SystemExit):
        job.parse_args(argv)


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


def candidate(name: str, tier: str, since: str | None = None) -> build.Candidate:
    payload = {
        "name": name,
        "companies": [],
        "rejestrIo": f"https://rejestr.io/osoby/{name.rsplit(maxsplit=1)[-1]}",
    }
    return build.Candidate(payload, tier, since)


@pytest.fixture
def priority(world, monkeypatch) -> World:
    """The world, with a priority build, a memory of what was sent, and the
    people bought lately."""

    def build_priority(koryta_date, policy, today, recent_days, bought):
        world.events.append("build")
        world.built.append(
            {
                "date": koryta_date,
                "today": today,
                "recent_days": recent_days,
                "bought": set(bought),
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
MISSING, NOTED = "noted_missing", "noted"


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
        PUBLISHED: 1,
        ON_SITE: 0,
    }


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


def test_what_the_site_refused_is_not_remembered_as_sent(priority):
    priority.candidates = [
        candidate("Jan Kowalski", PUBLISHED),
        candidate("Ewa Lis", ON_SITE),
    ]
    priority.answers = [REFUSED, person("unchanged")]

    job.main(["--scope", "priority"])

    assert [row["name"] for row in sent_part(priority)] == ["Ewa Lis"]


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
        "'published': 1, 'on_site': 0" in out
    )


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
        "'noted': 0, 'published': 1, 'on_site': 0}" in out
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

    class Bucket:
        def list_blobs(self, prefix):
            return [SimpleNamespace(name=n) for n in names if n.startswith(prefix)]

    class Storage:
        def bucket(self, name):
            assert name == CRAWLED_BUCKET
            return Bucket()

    client = typing.cast(job.Client, SimpleNamespace(storage_client=Storage()))

    assert job.bought_since(client, "2026-10-07") == {"1134749", "2447520"}


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
