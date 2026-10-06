"""What a job writes about its runs, and that writing it never hurts the job."""

import threading
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import google.auth
import numpy as np
import pytest
from google.auth import impersonated_credentials
from google.auth.exceptions import RefreshError
from google.cloud import firestore

from stores import job_runs
from stores.job_runs import (
    ERROR_CHARS,
    ERRORS_KEPT,
    HEARTBEAT_EVERY,
    JobRun,
)

#: Taken before `on_a_laptop` swaps it out, for the tests of the client itself.
real_make_client = job_runs.make_client

T0 = datetime(2026, 10, 2, 22, 30, tzinfo=UTC)
RUN = "jobRuns/run-1"
RECORD = "jobs/krs_scrape_free"


class Ref:
    def __init__(self, path: str):
        self.path = path


class Collection:
    def __init__(self, name: str):
        self.name = name

    def document(self, document: str) -> Ref:
        return Ref(f"{self.name}/{document}")


class Batch:
    def __init__(self, client: "Client"):
        self.client = client
        self.ops: list[tuple[str, str, dict]] = []

    def set(self, ref: Ref, data: dict, merge: bool = False) -> None:
        self.ops.append(("merge" if merge else "set", ref.path, deepcopy(data)))

    def update(self, ref: Ref, data: dict) -> None:
        self.ops.append(("update", ref.path, deepcopy(data)))

    def commit(self, retry=None, timeout=None) -> list:
        self.client.timeouts.append(timeout)
        if self.client.failing:
            self.client.failing -= 1
            raise RuntimeError("503 Service Unavailable\n  details: try again")
        for kind, path, data in self.ops:
            if kind == "set":
                self.client.docs[path] = data
            elif kind == "merge":
                self.client.docs.setdefault(path, {}).update(data)
            else:
                assert path in self.client.docs, f"update of missing {path}"
                self.client.docs[path].update(data)
        self.client.commits.append(self.ops)
        return []


class Client:
    """Firestore as far as `JobRun` uses it, keeping the documents it ends up
    with and every batch that landed."""

    def __init__(self, failing: int = 0):
        self.failing = failing
        self.docs: dict[str, dict] = {}
        self.commits: list[list[tuple[str, str, dict]]] = []
        self.timeouts: list[float | None] = []

    def batch(self) -> Batch:
        return Batch(self)

    def collection(self, name: str) -> Collection:
        return Collection(name)


class Clock:
    """Wall clock and monotonic clock moving together, by hand."""

    def __init__(self):
        self.seconds = 0.0

    def now(self) -> datetime:
        return T0 + timedelta(seconds=self.seconds)

    def monotonic(self) -> float:
        return self.seconds

    def at(self, seconds: float) -> datetime:
        return T0 + timedelta(seconds=seconds)


@pytest.fixture(autouse=True)
def on_a_laptop(monkeypatch):
    for name in (
        "CLOUD_RUN_JOB",
        "CLOUD_RUN_EXECUTION",
        "KORYTA_JOB_TRIGGER",
        "KORYTA_JOB_STATUS",
        "KORYTA_VERSION",
        "K_REVISION",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(job_runs.getpass, "getuser", lambda: "szymon")
    monkeypatch.setattr(job_runs.socket, "gethostname", lambda: "predator")
    # Nothing in this file may build a real client.
    monkeypatch.setattr(job_runs, "make_client", _no_real_client)


def _no_real_client():
    raise AssertionError("a test tried to reach Firestore")


@pytest.fixture
def clock() -> Clock:
    return Clock()


def a_run(client: Client, clock: Clock, **kwargs) -> JobRun:
    kwargs.setdefault("run_id", "run-1")
    kwargs.setdefault("unit", "firm")
    return JobRun(
        "krs_scrape_free",
        client=client,
        clock=clock.now,
        monotonic=clock.monotonic,
        **kwargs,
    )


def test_start_writes_the_whole_run_and_the_job_record(clock, capsys):
    client = Client()

    a_run(client, clock, total=40).start(phase="biuletyn")

    assert client.docs[RUN] == {
        "job": "krs_scrape_free",
        "state": "running",
        "trigger": "manual",
        "host": "szymon@predator",
        "startedAt": T0,
        "heartbeatAt": T0,
        "finishedAt": None,
        "progress": {"done": 0, "total": 40, "unit": "firm"},
        "counters": {},
        "phase": "biuletyn",
        "stopReason": None,
        "errors": [],
        "exitCode": None,
        "summaryPath": None,
        "version": None,
    }
    assert client.docs[RECORD] == {
        "job": "krs_scrape_free",
        "lastRunId": "run-1",
        "lastStartedAt": T0,
        "lastState": "running",
        "updatedAt": T0,
    }
    [[(run_kind, _, _), (record_kind, _, _)]] = client.commits
    assert (run_kind, record_kind) == ("set", "merge")
    assert client.timeouts == [10]
    assert capsys.readouterr().out == "job status: agent-tasks/jobRuns/run-1\n"


def test_a_run_the_site_queued_is_filled_in_not_replaced(clock):
    client = Client()
    queued_at = T0 - timedelta(minutes=3)
    client.docs[RUN] = {
        "job": "people_request",
        "state": "queued",
        "trigger": "request",
        "startedAt": queued_at,
        "title": "Wodociągi Miejskie",
        "request": {"target": "company", "nodeId": "place-1", "by": "uid-1"},
    }

    run = JobRun(
        "people_request",
        run_id="run-1",
        trigger="request",
        adopt=True,
        client=client,
        clock=clock.now,
        monotonic=clock.monotonic,
    )
    run.start(phase="paczki")
    run.finish("succeeded", counters={"planned": 2})

    doc = client.docs[RUN]
    # What the site wrote stays; what the run knows replaces the queued state.
    assert doc["request"] == {"target": "company", "nodeId": "place-1", "by": "uid-1"}
    assert doc["title"] == "Wodociągi Miejskie"
    assert (doc["state"], doc["trigger"], doc["startedAt"]) == (
        "succeeded",
        "request",
        T0,
    )
    assert doc["counters"] == {"planned": 2}
    [(run_kind, _, _), _] = client.commits[0]
    assert run_kind == "merge"


def test_adopting_needs_the_id_of_the_run_to_adopt():
    assert JobRun("x", adopt=True, client=Client()).adopt is False


def test_times_are_utc_and_timezone_aware(clock):
    client = Client()

    a_run(client, clock).start()

    started = client.docs[RUN]["startedAt"]
    assert started.tzinfo is not None and started.utcoffset() == timedelta(0)


def test_a_run_has_no_progress_until_it_knows_some():
    client = Client()

    JobRun("article_crawl", run_id="c", unit="stron", client=client).start()

    assert client.docs["jobRuns/c"]["progress"] is None


def test_a_scheduled_run_marks_the_schedule_live(clock):
    client = Client()

    a_run(client, clock, trigger="schedule").start()

    assert client.docs[RUN]["trigger"] == "schedule"
    assert client.docs[RECORD]["lastScheduledAt"] == T0


def test_progress_is_written_once_a_heartbeat_with_the_latest_values(clock):
    client = Client()
    run = a_run(client, clock).start()

    clock.seconds = 10
    run.progress(1, total=40, counters={"answered": 2})
    assert len(client.commits) == 1, "too soon after the start"

    clock.seconds = HEARTBEAT_EVERY + 1
    run.progress(counters={"empty": 1}, phase="odpisy")

    assert len(client.commits) == 2
    [(kind, path, data), (record_kind, record_path, record)] = client.commits[-1]
    assert (kind, path) == ("update", RUN)
    assert data == {
        "heartbeatAt": clock.at(HEARTBEAT_EVERY + 1),
        "progress": {"done": 1, "total": 40, "unit": "firm"},
        "counters": {"answered": 2, "empty": 1},
        "phase": "odpisy",
    }
    assert (record_kind, record_path) == ("merge", RECORD)
    assert record == {
        "lastState": "running",
        "updatedAt": clock.at(HEARTBEAT_EVERY + 1),
    }


def test_force_writes_at_once(clock):
    client = Client()
    run = a_run(client, clock).start(phase="biuletyn")

    clock.seconds = 1
    run.progress(phase="odpisy", force=True)

    assert len(client.commits) == 2
    assert client.docs[RUN]["phase"] == "odpisy"


def test_the_heartbeat_counts_from_the_last_write_not_the_last_call(clock):
    client = Client()
    run = a_run(client, clock).start()

    for second in range(1, 200):
        clock.seconds = second
        run.progress(second)

    # Writes at 60, 120 and 180 on top of the start.
    assert len(client.commits) == 4
    assert client.docs[RUN]["progress"]["done"] == 180


def test_progress_before_the_start_is_carried_by_it(clock):
    client = Client()
    run = a_run(client, clock)

    run.progress(5, total=9, counters={"answered": 5})
    assert client.commits == []
    run.start()

    assert client.docs[RUN]["progress"] == {"done": 5, "total": 9, "unit": "firm"}
    assert client.docs[RUN]["counters"] == {"answered": 5}


def test_counters_are_kept_to_numbers_firestore_can_store(clock):
    client = Client()
    run = a_run(client, clock).start()

    run.progress(
        np.int64(3),  # type: ignore[arg-type]  # what a pandas count is
        counters={
            "pln": Decimal("1.55"),
            "firms": np.int64(7),
            "share": 0.5,
            "flag": True,
            "nan": float("nan"),
            "text": "12",
        },
        force=True,
    )

    data = client.docs[RUN]
    assert data["counters"] == {"pln": 1.55, "firms": 7, "share": 0.5}
    assert type(data["counters"]["firms"]) is int
    assert type(data["progress"]["done"]) is int


def test_finish_records_how_the_run_ended(clock):
    client = Client()
    run = a_run(client, clock, total=40).start(phase="odpisy")

    clock.seconds = 30
    run.finish(
        "partial",
        stop_reason="deadline",
        errors=["https://api-krs/1: timeout"],
        exit_code=75,
        counters={"answered": 30},
        done=31,
        summary_path="gs://koryta-pl-sharedcache/jobs/krs_scrape_free/runs/x.json",
    )

    end = clock.at(30)
    [(kind, path, data), (_, _, record)] = client.commits[-1]
    assert (kind, path) == ("update", RUN)
    assert data == {
        "state": "partial",
        "finishedAt": end,
        "heartbeatAt": end,
        "stopReason": "deadline",
        "errors": ["https://api-krs/1: timeout"],
        "exitCode": 75,
        "summaryPath": "gs://koryta-pl-sharedcache/jobs/krs_scrape_free/runs/x.json",
        "progress": {"done": 31, "total": 40, "unit": "firm"},
        "counters": {"answered": 30},
    }
    assert record == {"lastState": "partial", "lastFinishedAt": end, "updatedAt": end}
    assert "lastSucceededAt" not in client.docs[RECORD]
    assert client.docs[RUN]["phase"] == "odpisy"


def test_a_success_is_remembered_on_the_job(clock):
    client = Client()
    run = a_run(client, clock).start()

    clock.seconds = 5
    run.finish("succeeded", exit_code=0)

    assert client.docs[RECORD]["lastSucceededAt"] == clock.at(5)
    assert client.docs[RECORD]["lastState"] == "succeeded"


def test_only_the_first_finish_counts(clock):
    client = Client()
    run = a_run(client, clock).start()
    run.finish("failed", stop_reason="20 requests in a row failed")

    run.finish("succeeded")
    run.progress(10, force=True)

    assert len(client.commits) == 2
    assert client.docs[RUN]["state"] == "failed"
    assert client.docs[RUN]["stopReason"] == "20 requests in a row failed"
    assert run.state == "failed"


def test_errors_are_capped_in_number_and_length(clock):
    client = Client()
    run = a_run(client, clock).start()

    run.finish("failed", errors=[f"{n}:" + "x" * 1000 for n in range(30)])

    errors = client.docs[RUN]["errors"]
    assert len(errors) == ERRORS_KEPT
    assert all(len(error) == ERROR_CHARS for error in errors)
    assert errors[0].startswith("0:")


def test_finish_refuses_a_state_that_is_not_an_ending(clock):
    run = a_run(Client(), clock).start()

    with pytest.raises(ValueError):
        run.finish("running")  # type: ignore[arg-type]


def test_a_clean_with_block_is_a_success(clock):
    client = Client()

    with a_run(client, clock) as run:
        run.progress(1)

    assert client.docs[RUN]["state"] == "succeeded"


def test_an_exception_fails_the_run_and_carries_on_up(clock):
    client = Client()

    with pytest.raises(RuntimeError, match="CompaniesKRS"):
        with a_run(client, clock):
            raise RuntimeError("CompaniesKRS failed")

    data = client.docs[RUN]
    assert data["state"] == "failed"
    assert data["stopReason"] == "raised RuntimeError"
    assert "CompaniesKRS failed" in data["errors"][0]
    assert client.docs[RECORD]["lastState"] == "failed"


def test_ctrl_c_leaves_the_run_partial_and_carries_on_up(clock):
    client = Client()

    with pytest.raises(KeyboardInterrupt):
        with a_run(client, clock):
            raise KeyboardInterrupt

    data = client.docs[RUN]
    assert (data["state"], data["stopReason"]) == ("partial", "przerwany")
    assert data["errors"] == []
    assert client.docs[RECORD]["lastState"] == "partial"


def test_a_finish_inside_the_block_is_kept(clock):
    client = Client()

    with a_run(client, clock) as run:
        run.finish("partial", stop_reason="SIGTERM")

    assert client.docs[RUN]["state"] == "partial"


def test_a_failing_write_is_printed_once_and_the_job_carries_on(clock, capsys):
    client = Client(failing=2)
    run = a_run(client, clock).start()

    for second in range(1, 300):
        clock.seconds = second
        run.progress(second)
    run.finish("succeeded")

    # The start and the first heartbeat lost; three heartbeats and the finish
    # landed.
    assert len(client.commits) == 4
    assert run.failed_writes == 2
    assert client.docs[RUN]["state"] == "succeeded"
    out = capsys.readouterr().out.splitlines()
    failures = [line for line in out if "failed:" in line]
    assert failures == [
        "job status: writing agent-tasks/jobRuns/run-1 failed: "
        "RuntimeError: 503 Service Unavailable details: try again"
    ]
    assert out[-1] == "job status: 2 writes failed in all"


def test_writes_failing_in_a_row_switch_reporting_off_for_the_rest_of_the_run(
    clock, capsys
):
    client = Client(failing=100)
    run = a_run(client, clock).start()

    for second in range(1, 600):
        clock.seconds = second
        run.progress(second)
    run.finish("succeeded")

    # The start and two heartbeats tried, each one a whole COMMIT_TIMEOUT the
    # job waited; nothing after.
    assert len(client.timeouts) == job_runs.MAX_FAILED_WRITES == 3
    assert run.failed_writes == 3
    assert not run.enabled
    assert run.state == "succeeded", "the job itself carried on"
    assert capsys.readouterr().out.splitlines() == [
        "job status: agent-tasks/jobRuns/run-1",
        "job status: writing agent-tasks/jobRuns/run-1 failed: "
        "RuntimeError: 503 Service Unavailable details: try again",
        "job status: off for the rest of the run, 3 writes in a row failed",
    ]


def test_a_write_that_lands_starts_the_count_again(clock):
    client = Client(failing=2)
    run = a_run(client, clock).start()  # lost
    for beat in (1, 2):  # lost, then landed
        clock.seconds = beat * HEARTBEAT_EVERY
        run.progress(beat)

    client.failing = 2
    for beat in (3, 4):  # both lost: two in a row, not four
        clock.seconds = beat * HEARTBEAT_EVERY
        run.progress(beat)
    run.finish("succeeded")

    assert run.enabled
    assert run.failed_writes == 4
    assert client.docs[RUN]["state"] == "succeeded"


def test_a_lost_start_is_repaired_by_the_next_write(clock):
    client = Client(failing=1)
    run = a_run(client, clock, trigger="schedule").start(phase="biuletyn")
    assert client.docs == {}

    clock.seconds = HEARTBEAT_EVERY
    run.progress(3, total=10)

    [(kind, _, data), (_, _, record)] = client.commits[0]
    assert kind == "set"
    assert data["startedAt"] == T0 and data["job"] == "krs_scrape_free"
    assert data["progress"] == {"done": 3, "total": 10, "unit": "firm"}
    assert record["lastRunId"] == "run-1"
    assert record["lastScheduledAt"] == T0

    # Known to exist from here on, so updated rather than replaced.
    run.finish("succeeded")
    assert client.commits[-1][0][0] == "update"


def test_a_finish_without_a_start_still_writes_a_whole_run(clock):
    client = Client()

    a_run(client, clock).finish("failed", stop_reason="raised ValueError")

    data = client.docs[RUN]
    assert (data["state"], data["startedAt"], data["finishedAt"]) == ("failed", T0, T0)
    assert client.docs[RECORD]["lastRunId"] == "run-1"


def test_switched_off_writes_nothing(clock, monkeypatch, capsys):
    monkeypatch.setenv("KORYTA_JOB_STATUS", "off")
    client = Client()

    with a_run(client, clock) as run:
        run.progress(1, force=True)

    assert client.commits == []
    assert not run.enabled
    assert capsys.readouterr().out == ""


def test_enabled_false_writes_nothing(clock):
    client = Client()

    with a_run(client, clock, enabled=False) as run:
        run.progress(1, force=True)

    assert client.commits == []


def test_a_test_without_a_client_never_writes_anywhere():
    # `make_client` raises in this file; reaching it would fail the test.
    with JobRun("krs_scrape_free", enabled=True) as run:
        run.progress(1, force=True)

    assert not run.enabled
    assert run.state == "succeeded"


def test_a_client_that_cannot_be_made_switches_reporting_off(monkeypatch, capsys):
    made = []

    def broken():
        made.append(True)
        raise OSError("Could not automatically determine credentials")

    monkeypatch.setattr(job_runs, "make_client", broken)
    monkeypatch.setattr(JobRun, "_in_a_test", lambda self: False)

    with JobRun("krs_scrape_free") as run:
        run.progress(1, force=True)

    assert made == [True]
    assert not run.enabled
    lines = capsys.readouterr().out.splitlines()
    assert lines[-1] == (
        "job status: off, no client for agent-tasks: "
        "OSError: Could not automatically determine credentials"
    )
    assert len([line for line in lines if "off" in line]) == 1


# ------------------------------------------------------------- the real client


class Credentials:
    """What google.auth hands back, counting the tokens asked of it."""

    def __init__(self, refusal: Exception | None = None, **kwargs):
        self.refusal = refusal
        self.kwargs = kwargs
        self.refreshed = 0

    def refresh(self, request) -> None:
        self.refreshed += 1
        if self.refusal is not None:
            raise self.refusal


@pytest.fixture
def firestore_clients(monkeypatch) -> list[dict]:
    """Every `firestore.Client` `make_client` builds, by its arguments; and no
    credentials but the ones a test hands in."""
    made: list[dict] = []

    def client(**kwargs):
        made.append(kwargs)
        return Client()

    monkeypatch.setattr(firestore, "Client", client)
    monkeypatch.setattr(google.auth, "default", _no_real_credentials)
    for name in (
        "FIRESTORE_EMULATOR_HOST",
        "GOOGLE_CLOUD_PROJECT",
        "GCLOUD_PROJECT",
        "KORYTA_JOB_STATUS_IMPERSONATE",
    ):
        monkeypatch.delenv(name, raising=False)
    return made


def _no_real_credentials(scopes=None):
    raise AssertionError("a test asked for real credentials")


def test_credentials_give_a_token_before_the_client_is_made(
    monkeypatch, firestore_clients
):
    credentials = Credentials()
    monkeypatch.setattr(google.auth, "default", lambda scopes: (credentials, "p"))

    real_make_client()

    assert credentials.refreshed == 1
    assert firestore_clients == [
        {"project": "koryta-pl", "database": "agent-tasks", "credentials": credentials}
    ]


def test_an_impersonation_iam_refuses_fails_when_the_client_is_made(
    monkeypatch, firestore_clients
):
    source = Credentials()
    made: list[Credentials] = []

    def impersonated(**kwargs):
        made.append(Credentials(RefreshError("Unable to acquire impersonated")))
        made[-1].kwargs = kwargs
        return made[-1]

    monkeypatch.setenv("KORYTA_JOB_STATUS_IMPERSONATE", "ops-writer@x.iam")
    monkeypatch.setattr(google.auth, "default", lambda scopes: (source, "p"))
    monkeypatch.setattr(impersonated_credentials, "Credentials", impersonated)

    with pytest.raises(RefreshError):
        real_make_client()

    [target] = made
    assert target.kwargs["source_credentials"] is source
    assert target.kwargs["target_principal"] == "ops-writer@x.iam"
    assert target.refreshed == 1
    assert firestore_clients == []


def test_credentials_that_give_no_token_switch_reporting_off_before_any_write(
    monkeypatch, firestore_clients, capsys
):
    revoked = Credentials(RefreshError("invalid_grant: Token has been revoked"))
    monkeypatch.setattr(google.auth, "default", lambda scopes: (revoked, "p"))
    monkeypatch.setattr(job_runs, "make_client", real_make_client)
    monkeypatch.setattr(JobRun, "_in_a_test", lambda self: False)

    with JobRun("krs_scrape_paid") as run:
        for done in range(1, 5):
            run.progress(done, force=True)

    assert revoked.refreshed == 1, "asked once, not once a write"
    assert firestore_clients == []
    assert not run.enabled
    off = [line for line in capsys.readouterr().out.splitlines() if "off" in line]
    assert off == [
        "job status: off, no client for agent-tasks: "
        "RefreshError: invalid_grant: Token has been revoked"
    ]


@pytest.mark.parametrize(
    ("env", "project"),
    [
        ({}, "demo-koryta-pl"),
        ({"GCLOUD_PROJECT": "demo-other"}, "demo-other"),
        ({"GOOGLE_CLOUD_PROJECT": "demo-g", "GCLOUD_PROJECT": "demo-other"}, "demo-g"),
        # Nothing to impersonate in the emulator, and no IAM to ask.
        ({"KORYTA_JOB_STATUS_IMPERSONATE": "ops-writer@x.iam"}, "demo-koryta-pl"),
    ],
)
def test_the_emulator_gets_the_dev_stacks_project_and_no_credentials(
    monkeypatch, firestore_clients, env, project
):
    monkeypatch.setenv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080")
    for name, value in env.items():
        monkeypatch.setenv(name, value)

    real_make_client()

    assert firestore_clients == [{"project": project, "database": "agent-tasks"}]


@pytest.mark.parametrize(
    ("env", "trigger", "host"),
    [
        ({}, "manual", "szymon@predator"),
        (
            {
                "CLOUD_RUN_JOB": "krs-scrape-free",
                "CLOUD_RUN_EXECUTION": "krs-scrape-free-x7k",
            },
            "schedule",
            "cloud-run:krs-scrape-free/krs-scrape-free-x7k",
        ),
        (
            {
                "CLOUD_RUN_JOB": "krs-scrape-free",
                "CLOUD_RUN_EXECUTION": "krs-scrape-free-x7k",
                "KORYTA_JOB_TRIGGER": "manual",
            },
            "manual",
            "cloud-run:krs-scrape-free/krs-scrape-free-x7k",
        ),
        ({"KORYTA_JOB_TRIGGER": "event"}, "event", "szymon@predator"),
        ({"KORYTA_JOB_TRIGGER": "request"}, "request", "szymon@predator"),
        ({"KORYTA_JOB_TRIGGER": "nightly"}, "manual", "szymon@predator"),
        (
            {"CLOUD_RUN_EXECUTION": "e1", "KORYTA_JOB_TRIGGER": "?"},
            "schedule",
            "cloud-run:?/e1",
        ),
    ],
)
def test_trigger_and_host_come_from_where_the_run_is(monkeypatch, env, trigger, host):
    for name, value in env.items():
        monkeypatch.setenv(name, value)

    run = JobRun("krs_scrape_free", client=Client())

    assert (run.trigger, run.host) == (trigger, host)


def test_a_trigger_given_wins_over_the_environment(monkeypatch):
    monkeypatch.setenv("CLOUD_RUN_EXECUTION", "e1")

    assert JobRun("x", trigger="manual", client=Client()).trigger == "manual"


def test_a_host_without_a_login_name_still_reports(monkeypatch):
    def no_user():
        raise OSError("No username set in the environment")

    monkeypatch.setattr(job_runs.getpass, "getuser", no_user)

    assert JobRun("x", client=Client()).host == "?@predator"


@pytest.mark.parametrize(
    ("env", "version"),
    [
        ({}, None),
        ({"K_REVISION": "capture-extractor-00042"}, "capture-extractor-00042"),
        ({"KORYTA_VERSION": "abc123", "K_REVISION": "r"}, "abc123"),
    ],
)
def test_the_version_comes_from_the_environment(monkeypatch, env, version):
    for name, value in env.items():
        monkeypatch.setenv(name, value)

    assert JobRun("x", client=Client()).version == version


def test_the_run_id_is_a_fresh_uuid7_by_default():
    a, b = JobRun("x", client=Client()), JobRun("x", client=Client())

    assert a.run_id != b.run_id
    assert a.run_id[14] == "7"  # the version nibble


def test_threads_reporting_at_once_leave_one_consistent_run():
    client = Client()
    ticks = iter(range(10_000_000))
    lock = threading.Lock()

    def monotonic() -> float:
        with lock:
            return float(next(ticks))

    run = JobRun(
        "article_crawl", run_id="c", unit="stron", client=client, monotonic=monotonic
    )
    run.start()

    def worker(n: int) -> None:
        for i in range(200):
            run.progress(i, counters={f"thread_{n}": i})

    threads = [threading.Thread(target=worker, args=(n,)) for n in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    run.finish("succeeded", stop_reason="kolejka pusta")

    data = client.docs["jobRuns/c"]
    assert data["state"] == "succeeded"
    assert data["counters"] == {f"thread_{n}": 199 for n in range(8)}
    assert client.docs["jobs/article_crawl"]["lastState"] == "succeeded"
    # The finish went last: nothing after it put "running" back.
    assert client.commits[-1][0][2]["state"] == "succeeded"
