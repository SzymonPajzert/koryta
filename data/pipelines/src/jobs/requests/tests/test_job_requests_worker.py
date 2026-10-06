"""The worker that does what the site's pages ask: once each, never beside a
night, and the VM off when it is done."""

from datetime import UTC, datetime, timedelta

import pytest

import jobs.requests as worker_module
from jobs.requests import Lock, Worker, parser, within

#: 12:00 in Warsaw, nowhere near the night.
NOON = datetime(2026, 10, 6, 10, 0, tzinfo=UTC)


class Queue:
    """The ops database as the worker sees it, through `stores.job_requests`."""

    def __init__(self, *runs: tuple[str, str]):
        self.runs = {
            run_id: {"job": job, "state": "queued", "order": n}
            for n, (run_id, job) in enumerate(runs)
        }
        self.claims: list[str] = []
        self.ended: list[tuple[str, str, str]] = []
        #: Runs somebody else takes just before this worker's claim lands.
        self.taken_by_others: set[str] = set()

    def queued(self, client, limit=50):
        found = [
            (run_id, run)
            for run_id, run in self.runs.items()
            if run["state"] == "queued"
        ]
        return sorted(found, key=lambda pair: pair[1]["order"])[:limit]

    def claim(self, client, run_id, *, host, now):
        run = self.runs[run_id]
        if run_id in self.taken_by_others:
            run["state"] = "running"
            run["host"] = "other@host"
        if run["state"] != "queued":
            return False
        run.update(state="running", host=host)
        self.claims.append(run_id)
        return True

    def end(
        self, client, run_id, *, state="failed", reason, exit_code=None, now, errors=()
    ):
        run = self.runs.get(run_id)
        if run is None or run["state"] not in ("queued", "running"):
            return False
        run["state"] = state
        self.ended.append((run_id, state, reason))
        return True

    def running_on(self, client, host, limit=50):
        return [
            run_id
            for run_id, run in self.runs.items()
            if run["state"] == "running" and run.get("host") == host
        ]


class Jobs:
    """The jobs the worker starts: what each was asked, how each ends."""

    def __init__(self, queue: Queue):
        self.queue = queue
        self.argv: list[list[str]] = []
        #: Per run id: the exit code, and whether the job reported its end.
        self.endings: dict[str, tuple[int | None, bool]] = {}
        self.during: list = []

    def __call__(self, argv, timeout):
        self.argv.append(list(argv))
        run_id = argv[argv.index("--request") + 1]
        for check in self.during:
            check(run_id)
        code, reports = self.endings.get(run_id, (0, True))
        if reports:
            self.queue.runs[run_id]["state"] = "succeeded" if code == 0 else "failed"
        return code


class Clock:
    def __init__(self, at: datetime = NOON):
        self.at = at
        self.seconds = 0.0
        self.sleeps = 0
        self.stop_after: int | None = None
        self.worker: Worker | None = None

    def now(self) -> datetime:
        return self.at + timedelta(seconds=self.seconds)

    def monotonic(self) -> float:
        return self.seconds

    def sleep(self, seconds: float) -> None:
        self.seconds += seconds
        self.sleeps += 1
        if self.stop_after is not None and self.sleeps >= self.stop_after:
            assert self.worker is not None
            self.worker.stopping = True


@pytest.fixture
def queue(monkeypatch) -> Queue:
    q = Queue()
    monkeypatch.setattr(worker_module, "queued_requests", q.queued)
    monkeypatch.setattr(worker_module, "claim", q.claim)
    monkeypatch.setattr(worker_module, "end_open_run", q.end)
    monkeypatch.setattr(worker_module, "running_on", q.running_on)
    monkeypatch.setattr(worker_module, "detect_host", lambda: "koryta@vm")
    return q


def make_worker(
    queue: Queue,
    argv: list[str],
    *,
    jobs: Jobs | None = None,
    clock: Clock | None = None,
    logged_in: bool = False,
) -> tuple[Worker, Jobs, Clock]:
    jobs = jobs or Jobs(queue)
    clock = clock or Clock()
    worker = Worker(
        parser().parse_args(argv),
        client=object(),
        clock=clock.now,
        monotonic=clock.monotonic,
        sleep=clock.sleep,
        run=jobs,
        logged_in=lambda: logged_in,
    )
    clock.worker = worker
    return worker, jobs, clock


def test_the_queue_is_run_oldest_first_each_run_claimed_once(queue):
    queue.runs.update(Queue(("a", "people_request"), ("b", "people_request")).runs)
    worker, jobs, _ = make_worker(queue, ["--once"])

    assert worker.run() == 0

    assert queue.claims == ["a", "b"]
    assert [argv[1:3] for argv in jobs.argv] == [["--request", "a"], ["--request", "b"]]
    assert jobs.argv[0][0].endswith("/koryta_people_import")
    assert jobs.argv[0][3:] == [
        "--refresh",
        "none",
        "--max-minutes",
        "60",
        "--max-uploads",
        "1000",
    ]
    # Each job reported its own end, so the worker ended nothing.
    assert queue.ended == []


def test_a_run_somebody_else_took_is_not_run_again(queue):
    queue.runs.update(Queue(("a", "people_request")).runs)
    queue.taken_by_others.add("a")
    worker, jobs, _ = make_worker(queue, ["--once"])

    worker.run()

    assert jobs.argv == [] and queue.claims == []


@pytest.mark.parametrize(
    ("code", "state", "reason"),
    [
        (1, "failed", "kod wyjścia 1"),
        (None, "failed", "przekroczony czas (90 min)"),
        (0, "succeeded", "job nie zgłosił końca (kod 0)"),
        (75, "partial", "job nie zgłosił końca (kod 75)"),
    ],
)
def test_a_run_its_job_could_not_end_is_ended_by_its_exit_code(
    queue, code, state, reason
):
    queue.runs.update(Queue(("a", "people_request")).runs)
    jobs = Jobs(queue)
    jobs.endings["a"] = (code, False)
    worker, _, _ = make_worker(queue, ["--once"], jobs=jobs)

    worker.run()

    assert queue.ended == [("a", state, reason)]


def test_a_job_the_worker_does_not_know_fails_its_run(queue):
    queue.runs.update(Queue(("a", "people_teleport")).runs)
    worker, jobs, _ = make_worker(queue, ["--once"])

    worker.run()

    assert jobs.argv == []
    assert queue.ended == [("a", "failed", "nieznany job people_teleport")]


def test_runs_this_host_was_doing_when_it_went_down_are_ended(queue):
    queue.runs.update(
        {
            "mine": {"job": "people_request", "state": "running", "host": "koryta@vm"},
            "theirs": {"job": "people_request", "state": "running", "host": "x@y"},
        }
    )
    worker, _, _ = make_worker(queue, ["--once"])

    worker.run()

    assert [(run_id, state) for run_id, state, _ in queue.ended] == [("mine", "failed")]
    assert queue.runs["theirs"]["state"] == "running"


def test_a_run_waits_for_the_night_and_holds_the_busy_lock(queue, tmp_path):
    night, busy = str(tmp_path / "lock"), str(tmp_path / "requests.busy")
    queue.runs.update(Queue(("a", "people_request")).runs)
    held = Lock(night)
    assert held.try_take()
    clock = Clock()
    jobs = Jobs(queue)
    seen: list[tuple[bool, bool]] = []
    jobs.during.append(
        lambda run_id: seen.append((Lock(busy).free(), Lock(night).free()))
    )
    worker, _, _ = make_worker(
        queue, ["--once", "--lock", night, "--busy", busy], jobs=jobs, clock=clock
    )

    # The night lets go after the worker has looked twice.
    original = clock.sleep

    def night_ends(seconds):
        original(seconds)
        if clock.sleeps == 2:
            held.release()

    clock.sleep = night_ends
    worker.sleep = night_ends
    worker.run()

    assert clock.sleeps == 2
    assert queue.claims == ["a"]
    # While the job ran, both locks were the worker's.
    assert seen == [(False, False)]
    assert Lock(busy).free() and Lock(night).free()


def test_sigterm_while_waiting_for_the_night_claims_nothing(queue, tmp_path):
    night = str(tmp_path / "lock")
    queue.runs.update(Queue(("a", "people_request")).runs)
    held = Lock(night)
    assert held.try_take()
    worker, jobs, clock = make_worker(queue, ["--once", "--lock", night])
    clock.stop_after = 3

    worker.run()

    assert queue.claims == [] and jobs.argv == []
    assert queue.runs["a"]["state"] == "queued"
    held.release()


# ---------------------------------------------------------------------------
# Switching the VM off


def watch(queue, tmp_path, *, at=NOON, logged_in=False, runs=1, night_held=False):
    flag = tmp_path / "poweroff-requested"
    night = str(tmp_path / "lock")
    queue.runs.update(Queue(*[(f"r{n}", "people_request") for n in range(runs)]).runs)
    held = Lock(night)
    if night_held:
        assert held.try_take()
    worker, jobs, clock = make_worker(
        queue,
        [
            "--watch",
            "--lock",
            night,
            "--poweroff-flag",
            str(flag),
            "--idle-minutes",
            "10",
            "--poll-seconds",
            "60",
        ],
        clock=Clock(at),
        logged_in=logged_in,
    )
    # A worker that never switches off is stopped after an hour of looking.
    clock.stop_after = 60
    worker.run()
    held.release()
    return flag, clock


def test_after_its_runs_and_ten_idle_minutes_it_asks_for_the_vm_off(queue, tmp_path):
    flag, clock = watch(queue, tmp_path)

    assert flag.exists()
    assert "koryta_job_requests" in flag.read_text()
    assert clock.sleeps == 10


def test_a_vm_nobodys_request_started_stays_up(queue, tmp_path):
    flag, clock = watch(queue, tmp_path, runs=0)

    assert not flag.exists() and clock.sleeps == 60


def test_the_vm_stays_up_while_somebody_is_logged_in(queue, tmp_path):
    flag, _ = watch(queue, tmp_path, logged_in=True)

    assert not flag.exists()


def test_the_vm_stays_up_for_the_night_about_to_start(queue, tmp_path):
    # Done at 04:00 in Warsaw, after the schedule's 04:15 start had nothing to
    # start: switched off before 04:30, the VM would miss the night.
    flag, clock = watch(queue, tmp_path, at=datetime(2026, 10, 6, 2, 0, tzinfo=UTC))

    assert flag.exists()
    assert clock.now() == datetime(2026, 10, 6, 2, 45, tzinfo=UTC)


def test_the_vm_stays_up_while_a_night_runs(queue, tmp_path, monkeypatch):
    # The run went through before the night took the lock.
    flag = tmp_path / "poweroff-requested"
    night = str(tmp_path / "lock")
    queue.runs.update(Queue(("a", "people_request")).runs)
    worker, _, clock = make_worker(
        queue,
        ["--watch", "--lock", night, "--poweroff-flag", str(flag)],
    )
    held = Lock(night)
    original = clock.sleep

    def night_starts(seconds):
        original(seconds)
        if clock.sleeps == 1:
            assert held.try_take()

    worker.sleep = night_starts
    clock.stop_after = 60
    worker.run()
    held.release()

    assert queue.claims == ["a"] and not flag.exists()


def test_pending_says_whether_anything_is_queued(queue):
    worker, _, _ = make_worker(queue, ["--pending"])
    assert worker.run() == 1

    queue.runs.update(Queue(("a", "people_request")).runs)
    worker, jobs, _ = make_worker(queue, ["--pending"])
    assert worker.run() == 0
    assert jobs.argv == []


@pytest.mark.parametrize(
    ("utc", "window", "inside"),
    [
        ("01:40", "03:45-04:45", False),  # 03:40 in Warsaw (CEST, UTC+2)
        ("02:00", "03:45-04:45", True),  # 04:00
        ("02:46", "03:45-04:45", False),  # 04:46
        ("21:30", "23:00-01:00", True),  # 23:30 Warsaw, a window over midnight
        ("23:30", "23:00-01:00", False),  # 01:30 Warsaw
    ],
)
def test_within_reads_warsaw_time(utc, window, inside):
    hour, minute = (int(part) for part in utc.split(":"))
    at = datetime(2026, 10, 6, hour, minute, tzinfo=UTC)

    assert within(window, at) is inside
