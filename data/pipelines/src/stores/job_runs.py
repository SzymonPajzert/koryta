"""A job's runs, reported where koryta.pl/admin/procesy reads them.

The jobs used to run on a laptop or on predator, where "is it still going" was
a terminal to look at. On Cloud Run there is no terminal, so each run writes
down how it is doing as it goes: one `jobRuns/{runId}` document per run, and
one `jobs/{jobId}` document per job for what a short history of runs would
lose - when it last ran on its schedule, when it last succeeded. The page and
its health rules are `frontend/shared/jobs.ts`; the field names here are that
file's contract.

Both live in the ops database (`agent-tasks`), not the site's, because IAM can
narrow a writer to one database. It cannot narrow one to a collection: an
account that may write job runs may write - and delete - any document in
`agent-tasks`, the owner's task list (`tasks`) included. That is the reach
ops-writer already has. A database of the job runs' own would take the task
list out of it; none has been made.

    with JobRun("krs_scrape_free", unit="firm") as run:
        for n, company in enumerate(queue, 1):
            ...
            run.progress(n, total=len(queue), counters={"answered": answered})

A run is a report on the job, never part of it: every write is best effort,
the first failure is printed and the rest only counted, and no error here ever
reaches the job. Credentials that cannot give a token switch reporting off
before the first write, and `MAX_FAILED_WRITES` failures in a row switch it off
for the rest of the run: each failed write held the job for up to
`COMMIT_TIMEOUT`, and a job has one thread.

Writes are throttled to one a minute (`HEARTBEAT_EVERY`) - often enough for
the page to tell a run that is working from one that has gone quiet, and few
enough that a crawl reporting from every page costs nothing. There is
deliberately no background heartbeat: a job stuck in one step should look
stuck.

Environment:
- `KORYTA_JOB_STATUS=0` (or off/false/no) writes nothing.
- `KORYTA_JOB_TRIGGER=schedule|manual|event` says how the run started; without
  it a Cloud Run execution is taken for Cloud Scheduler's and anything else
  for a hand run.
- `KORYTA_JOB_STATUS_IMPERSONATE=<service account>` writes as that account
  rather than as the default credentials - predator's dev-workflow account
  impersonates ops-writer, which may write the ops database - all of it, the
  task list too - and nothing else.
- `KORYTA_VERSION` is recorded as the code version; a Cloud Run job is given it
  at deploy time (jobs/CLOUD_RUN.md). Without it a Cloud Run service's
  `K_REVISION` stands in - a Cloud Run job has no revision, so it never has one.
- `FIRESTORE_EMULATOR_HOST` sends everything to the emulator, anonymously, under
  the project `GOOGLE_CLOUD_PROJECT` or `GCLOUD_PROJECT` names, else
  `demo-koryta-pl` - the one the dev stack runs its emulators and server under,
  so the local page reads what was written.

Under pytest nothing is written unless the test hands in a client, so no test
can report a run to production.
"""

from __future__ import annotations

import getpass
import math
import numbers
import os
import socket
import threading
import time
from collections.abc import Callable, Iterable, Mapping
from datetime import UTC, datetime
from types import TracebackType
from typing import Any, Literal, get_args

from uuid_extensions import uuid7str  # type: ignore

OPS_PROJECT = "koryta-pl"
#: The project the dev stack starts the emulators under (`--project` in
#: frontend/package.json), and so the one its server reads.
EMULATOR_PROJECT = "demo-koryta-pl"
#: `OPS_DATABASE` in frontend/shared/tasks.ts.
OPS_DATABASE = "agent-tasks"
JOBS_COLLECTION = "jobs"
JOB_RUNS_COLLECTION = "jobRuns"

#: Seconds between progress writes. The page calls a run stalled after a few
#: missed beats plus its longest step (`heartbeatMinutes` in shared/jobs.ts).
HEARTBEAT_EVERY = 60.0

#: As `RUN_ERRORS_KEPT` and `RUN_ERROR_CHARS` in shared/jobs.ts, which apply
#: them again on read.
ERRORS_KEPT = 20
ERROR_CHARS = 500

#: Seconds one write may take, retries included, before it is given up. A
#: write that hangs would hold up the job; a lost one is repaired by the next.
COMMIT_TIMEOUT = 10.0

#: Writes failing back to back before reporting is off for the rest of the run.
#: The retry cannot tell an outage from credentials that stopped working
#: mid-run - both come back as 503 - and every failure costs the job the whole
#: `COMMIT_TIMEOUT`, on every heartbeat until the run ends.
MAX_FAILED_WRITES = 3

RunState = Literal["queued", "running", "succeeded", "partial", "failed"]
FinalState = Literal["succeeded", "partial", "failed"]
RunTrigger = Literal["schedule", "manual", "event"]
RUN_STATES: tuple[RunState, ...] = get_args(RunState)
FINAL_STATES: tuple[FinalState, ...] = get_args(FinalState)
RUN_TRIGGERS: tuple[RunTrigger, ...] = get_args(RunTrigger)

_OFF = {"0", "off", "false", "no"}
_CLOUD_PLATFORM = "https://www.googleapis.com/auth/cloud-platform"


def _utc_now() -> datetime:
    return datetime.now(UTC)


def detect_trigger() -> RunTrigger:
    """How this run started, when the caller does not say.

    Cloud Scheduler starts a Cloud Run job execution, and so does a hand
    `gcloud run jobs execute` - which is why a hand execution passes
    `KORYTA_JOB_TRIGGER=manual`, or the page takes it for the schedule.
    """
    named = os.environ.get("KORYTA_JOB_TRIGGER", "").strip().lower()
    for trigger in RUN_TRIGGERS:
        if named == trigger:
            return trigger
    return "schedule" if os.environ.get("CLOUD_RUN_EXECUTION") else "manual"


def detect_host() -> str:
    """Where the run is: the Cloud Run execution, or who on which machine."""
    execution = os.environ.get("CLOUD_RUN_EXECUTION")
    if execution:
        return f"cloud-run:{os.environ.get('CLOUD_RUN_JOB', '?')}/{execution}"
    try:
        user = getpass.getuser()
    except Exception:  # No login name in a bare container.
        user = "?"
    return f"{user}@{socket.gethostname()}"


def detect_version() -> str | None:
    """The code version: `KORYTA_VERSION`, which the Cloud Run jobs are given
    at deploy time. `K_REVISION` is only there on a Cloud Run service - a job
    has executions, not revisions - so without `KORYTA_VERSION` a job's runs
    carry no version."""
    return os.environ.get("KORYTA_VERSION") or os.environ.get("K_REVISION") or None


def emulator_project() -> str:
    """The project to write under when `FIRESTORE_EMULATOR_HOST` is set: the
    one the environment names, as firebase-tools sets it, else the dev
    stack's. Under `koryta-pl` a run lands in the emulator where nothing
    reads it."""
    return (
        os.environ.get("GOOGLE_CLOUD_PROJECT")
        or os.environ.get("GCLOUD_PROJECT")
        or EMULATOR_PROJECT
    )


def make_client() -> Any:
    """A Firestore client on the ops database, impersonating if asked to.

    Raises if the credentials cannot give a token, which switches reporting
    off before the first write rather than after it.
    """
    from google.cloud import firestore  # noqa: PLC0415 - only for a real write

    # The emulator takes anonymous credentials, which the client picks itself;
    # impersonating would only add a call to IAM that has nothing to do with it.
    if os.environ.get("FIRESTORE_EMULATOR_HOST"):
        return firestore.Client(project=emulator_project(), database=OPS_DATABASE)

    import google.auth  # noqa: PLC0415
    from google.auth import impersonated_credentials  # noqa: PLC0415
    from google.auth.transport.requests import Request  # noqa: PLC0415

    # Scopes named on both sides: impersonation sends them to IAM, which
    # refuses an empty list (see `_make_gcs_client` in stores.storage).
    credentials, _ = google.auth.default(scopes=[_CLOUD_PLATFORM])
    target = os.environ.get("KORYTA_JOB_STATUS_IMPERSONATE", "").strip()
    if target:
        credentials = impersonated_credentials.Credentials(
            source_credentials=credentials,
            target_principal=target,
            target_scopes=[_CLOUD_PLATFORM],
        )
    # One token now. Left to the first write, revoked ADC or an impersonation
    # IAM refuses comes back as "503 Getting metadata from plugin failed",
    # which the commit's retry takes for an outage and repeats for the whole
    # COMMIT_TIMEOUT - on every heartbeat, holding up the job each time.
    credentials.refresh(Request())
    return firestore.Client(
        project=OPS_PROJECT, database=OPS_DATABASE, credentials=credentials
    )


def _commit_retry() -> Any:
    from google.api_core.retry import Retry  # noqa: PLC0415

    return Retry(timeout=COMMIT_TIMEOUT)


def _number(value: object) -> int | float | None:
    """A Firestore-safe number, or None: numpy ints and Decimals included,
    booleans and NaN not."""
    if isinstance(value, bool) or not isinstance(value, numbers.Number):
        return None
    if isinstance(value, numbers.Integral):
        return int(value)
    try:
        as_float = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return as_float if math.isfinite(as_float) else None


def _one_line(error: BaseException) -> str:
    message = " ".join(str(error).split())[:300]
    return f"{type(error).__name__}: {message}" if message else type(error).__name__


# One write: what to do, to which collection and document, with what data.
_Op = tuple[Literal["set", "merge", "update"], str, str, dict[str, Any]]


class JobRun:
    """One run of a job, and the one writer of its documents.

    Safe to call from several threads. Values given to `progress` between
    writes are kept, so the next write carries the latest of everything.
    """

    def __init__(
        self,
        job: str,
        *,
        run_id: str | None = None,
        trigger: RunTrigger | None = None,
        unit: str = "",
        total: float | None = None,
        client: Any | None = None,
        clock: Callable[[], datetime] = _utc_now,
        monotonic: Callable[[], float] = time.monotonic,
        enabled: bool | None = None,
    ) -> None:
        self.job = job
        self.run_id = run_id or uuid7str()
        self.trigger: RunTrigger = (
            trigger if trigger in RUN_TRIGGERS else detect_trigger()
        )
        self.host = detect_host()
        self.version = detect_version()
        self.unit = unit
        #: None until `start`.
        self.state: RunState | None = None
        #: Writes that did not land, all of them; only the first is printed.
        self.failed_writes = 0
        #: Since the last one that did; `MAX_FAILED_WRITES` of them turn
        #: reporting off.
        self._failed_in_a_row = 0

        self._client = client
        self._clock = clock
        self._monotonic = monotonic
        if enabled is None:
            off = os.environ.get("KORYTA_JOB_STATUS", "").strip().lower() in _OFF
            enabled = not off
        self.enabled = enabled and not self._in_a_test()

        self._done: int | float | None = None
        self._total = _number(total)
        self._phase: str | None = None
        self._counters: dict[str, int | float] = {}
        self._started_at: datetime | None = None
        self._finished_at: datetime | None = None
        self._stop_reason: str | None = None
        self._errors: list[str] = []
        self._exit_code: int | None = None
        self._summary_path: str | None = None

        # Two locks, so that only the thread whose turn it is to write waits
        # for Firestore: `_state` guards the values and is held for
        # microseconds, `_writing` serialises the writes themselves.
        self._state = threading.Lock()
        self._writing = threading.Lock()
        # Each write is numbered when its values are taken, and one older than
        # the last sent is dropped: a heartbeat that lost the race to `finish`
        # must not put "running" back.
        self._taken = 0
        self._sent = 0
        self._last_write: float | None = None
        self._run_written = False

    @property
    def document(self) -> str:
        return f"{OPS_DATABASE}/{JOB_RUNS_COLLECTION}/{self.run_id}"

    @property
    def stop_reason(self) -> str | None:
        return self._stop_reason

    def _in_a_test(self) -> bool:
        return self._client is None and "PYTEST_CURRENT_TEST" in os.environ

    # ------------------------------------------------------------------
    # What the job calls

    def start(self, *, phase: str | None = None) -> JobRun:
        with self._state:
            if self.state is not None:
                return self
            now = self._clock()
            self.state = "running"
            self._started_at = now
            if phase is not None:
                self._phase = phase
            write = self._take(now, finishing=False)
        if self.enabled:
            print(f"job status: {self.document}")
        self._send(*write)
        return self

    def progress(
        self,
        done: float | None = None,
        *,
        total: float | None = None,
        phase: str | None = None,
        counters: Mapping[str, object] | None = None,
        force: bool = False,
    ) -> None:
        """Note how far the run has got; written at most once a minute unless
        `force`. A value left out keeps the last one given; counters are
        merged, so a caller can update one at a time."""
        with self._state:
            if self.state in FINAL_STATES:
                return
            self._note(done, total, phase, counters)
            if self.state is None:
                return  # `start` writes them.
            due = (
                force
                or self._last_write is None
                or self._monotonic() - self._last_write >= HEARTBEAT_EVERY
            )
            if not due:
                return
            write = self._take(self._clock(), finishing=False)
        self._send(*write)

    def finish(
        self,
        state: FinalState,
        *,
        stop_reason: str | None = None,
        errors: Iterable[object] = (),
        exit_code: int | None = None,
        counters: Mapping[str, object] | None = None,
        done: float | None = None,
        summary_path: str | None = None,
    ) -> None:
        """Record how the run ended. Only the first call counts."""
        if state not in FINAL_STATES:
            raise ValueError(f"{state!r} is not one of {FINAL_STATES}")
        with self._state:
            if self.state in FINAL_STATES:
                return
            now = self._clock()
            self._note(done, None, None, counters)
            self.state = state
            self._started_at = self._started_at or now
            self._finished_at = now
            self._stop_reason = stop_reason
            self._errors = [str(error)[:ERROR_CHARS] for error in errors][:ERRORS_KEPT]
            self._exit_code = exit_code
            self._summary_path = summary_path
            write = self._take(now, finishing=True)
        self._send(*write)
        # Not after reporting went off for failing: that line gave the count.
        if self.enabled and self.failed_writes > 1:
            print(f"job status: {self.failed_writes} writes failed in all")

    def __enter__(self) -> JobRun:
        return self.start()

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        # Returns None, so whatever was raised carries on up.
        if exc_type is None:
            self.finish("succeeded")
        elif issubclass(exc_type, KeyboardInterrupt):
            # Ctrl+C is someone stopping a hand run, not the job breaking:
            # what is left is for the next run, as the jobs that catch it
            # themselves report it.
            self.finish("partial", stop_reason="przerwany")
        else:
            self.finish(
                "failed",
                stop_reason=f"raised {exc_type.__name__}",
                errors=[repr(exc)],
            )

    # ------------------------------------------------------------------
    # The documents

    def _note(
        self,
        done: float | None,
        total: float | None,
        phase: str | None,
        counters: Mapping[str, object] | None,
    ) -> None:
        if (number := _number(done)) is not None:
            self._done = number
        if (number := _number(total)) is not None:
            self._total = number
        if phase is not None:
            self._phase = phase
        for name, value in (counters or {}).items():
            if (number := _number(value)) is not None:
                self._counters[str(name)] = number

    def _progress_field(self) -> dict[str, Any] | None:
        if self._done is None and self._total is None:
            return None
        return {"done": self._done or 0, "total": self._total, "unit": self.unit}

    def _run_document(self, now: datetime) -> dict[str, Any]:
        return {
            "job": self.job,
            "state": self.state,
            "trigger": self.trigger,
            "host": self.host,
            "startedAt": self._started_at,
            "heartbeatAt": now,
            "finishedAt": self._finished_at,
            "progress": self._progress_field(),
            "counters": dict(self._counters),
            "phase": self._phase,
            "stopReason": self._stop_reason,
            "errors": list(self._errors),
            "exitCode": self._exit_code,
            "summaryPath": self._summary_path,
            "version": self.version,
        }

    def _start_record(self, now: datetime) -> dict[str, Any]:
        record: dict[str, Any] = {
            "job": self.job,
            "lastRunId": self.run_id,
            "lastStartedAt": self._started_at,
            "lastState": self.state,
            "updatedAt": now,
        }
        # What tells the page the schedule is live: until a run has started
        # on it, a missed night is a plan nobody has switched on yet.
        if self.trigger == "schedule":
            record["lastScheduledAt"] = self._started_at
        return record

    def _take(self, now: datetime, finishing: bool) -> tuple[int, list[_Op], bool]:
        """The next write, from the values as they are now. Called under
        `_state`. Until the run's document is known to exist the whole of it
        is sent, so a first write that failed is repaired by the next one."""
        self._taken += 1
        self._last_write = self._monotonic()
        record: dict[str, Any] = {"lastState": self.state, "updatedAt": now}
        if finishing:
            record["lastFinishedAt"] = now
            if self.state == "succeeded":
                record["lastSucceededAt"] = now
        whole = not self._run_written
        if whole:
            run_op: _Op = (
                "set",
                JOB_RUNS_COLLECTION,
                self.run_id,
                self._run_document(now),
            )
            record = {**self._start_record(now), **record}
        elif finishing:
            run_op = (
                "update",
                JOB_RUNS_COLLECTION,
                self.run_id,
                {
                    "state": self.state,
                    "finishedAt": now,
                    "heartbeatAt": now,
                    "stopReason": self._stop_reason,
                    "errors": list(self._errors),
                    "exitCode": self._exit_code,
                    "summaryPath": self._summary_path,
                    "progress": self._progress_field(),
                    "counters": dict(self._counters),
                },
            )
        else:
            run_op = (
                "update",
                JOB_RUNS_COLLECTION,
                self.run_id,
                {
                    "heartbeatAt": now,
                    "progress": self._progress_field(),
                    "counters": dict(self._counters),
                    "phase": self._phase,
                },
            )
        record_op: _Op = ("merge", JOBS_COLLECTION, self.job, record)
        return self._taken, [run_op, record_op], whole

    def _send(self, number: int, ops: list[_Op], whole: bool) -> None:
        if not self.enabled:
            return
        with self._writing:
            # Asked again: reporting may have gone off while this thread
            # waited for its turn.
            if not self.enabled or number <= self._sent:
                return
            self._sent = number
            client = self._get_client()
            if client is None:
                return
            try:
                batch = client.batch()
                for kind, collection, document, data in ops:
                    ref = client.collection(collection).document(document)
                    if kind == "set":
                        batch.set(ref, data)
                    elif kind == "merge":
                        batch.set(ref, data, merge=True)
                    else:
                        batch.update(ref, data)
                batch.commit(retry=_commit_retry(), timeout=COMMIT_TIMEOUT)
            except Exception as e:
                self.failed_writes += 1
                self._failed_in_a_row += 1
                if self.failed_writes == 1:
                    print(f"job status: writing {self.document} failed: {_one_line(e)}")
                if self._failed_in_a_row >= MAX_FAILED_WRITES:
                    self.enabled = False
                    print(
                        f"job status: off for the rest of the run, "
                        f"{self._failed_in_a_row} writes in a row failed"
                    )
                return
            self._failed_in_a_row = 0
            if whole:
                self._run_written = True

    def _get_client(self) -> Any | None:
        if self._client is not None:
            return self._client
        if self._in_a_test():
            self.enabled = False
            return None
        try:
            self._client = make_client()
        except Exception as e:
            self.enabled = False
            print(f"job status: off, no client for {OPS_DATABASE}: {_one_line(e)}")
            return None
        return self._client
