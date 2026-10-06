"""Run what the datascience group asked for on koryta.pl's pages, one at a time.

A button on a company's or a person's page queues a run in the ops database
(`stores.job_requests`): /admin/procesy shows it "w kolejce" at once. This takes
the queued runs, oldest first, claims each - so that no run is ever done twice -
and starts the job it names as a process of its own, which reports on that
same document from then on:

    koryta_job_requests --once                   # everything queued now, then exit
    koryta_job_requests --watch                  # and whatever comes, until stopped
    koryta_job_requests --pending                # exit 0 when something is queued

On the koryta-nightly VM it is `koryta-requests.service`, started at every boot
(data/nightly/requests.sh): the site starts the VM when somebody asks for a run
(frontend/server/utils/jobRunner.ts), the worker does what is queued and, once
it has run something and nothing more comes for `--idle-minutes`, leaves a note
for `poweroff.sh` and exits, which switches the VM off - unless somebody is
logged in, a night is running, or one is about to start.

Each run takes `--lock` (the night's lock) while it goes, so it never runs
alongside a night: the pipelines' outputs on disk are the night's, rebuilt
under it. And `--busy` while it has a run in hand, which tells the night's own
`poweroff.sh` to leave the switching off to this.

A run whose job ended without saying so - it crashed first, or could not reach
the ops database - is ended here, by the job's exit code; one this host was
doing when it went down - a VM switched off mid-run - is ended as failed when
the worker next starts.
"""

from __future__ import annotations

import argparse
import fcntl
import os
import signal
import subprocess
import sys
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime

from stores.job_requests import (
    PEOPLE_REQUEST,
    claim,
    end_open_run,
    queued_requests,
    running_on,
)
from stores.job_runs import FinalState, detect_host, make_client
from stores.storage import warsaw_tz

#: How long one run may take before it is stopped (SIGTERM, then SIGKILL): the
#: job's own `--max-minutes` stops it cleanly well before this.
RUN_TIMEOUT_MINUTES = 90

#: The jobs the site can ask for, and the command that does one run of each.
#: `--refresh none`: the outputs on disk are the night's, rebuilt hours ago -
#: rebuilding the people's chain for one company would take the night's hour.
JOB_COMMANDS: dict[str, Callable[[str, argparse.Namespace], list[str]]] = {
    PEOPLE_REQUEST: lambda run_id, args: [
        bin_path("koryta_people_import"),
        "--request",
        run_id,
        "--refresh",
        args.refresh,
        "--max-minutes",
        f"{args.max_minutes:g}",
        "--max-uploads",
        str(args.max_uploads),
    ],
}


def bin_path(name: str) -> str:
    """An entry point of this environment, the one this process runs from."""
    return os.path.join(os.path.dirname(sys.executable), name)


def utc_now() -> datetime:
    return datetime.now(UTC)


@dataclass
class Outcome:
    """What became of one queued run."""

    run_id: str
    job: str
    exit_code: int | None = None
    #: Ended here because its job did not: the reason.
    failed: str = ""


@dataclass
class Tally:
    runs: list[Outcome] = field(default_factory=list)

    @property
    def count(self) -> int:
        return len(self.runs)


class Lock:
    """An flock on a path, taken and let go around each run. None of the
    callers' files hold it themselves: the lock is whoever has it open."""

    def __init__(self, path: str | None):
        self.path = path
        self._fd: int | None = None

    def try_take(self) -> bool:
        if not self.path:
            return True
        # Read-only: an flock needs no more, and poweroff.sh, as root, may
        # have made the file - which koryta can then open only to read.
        fd = os.open(self.path, os.O_CREAT | os.O_RDONLY, 0o644)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(fd)
            return False
        self._fd = fd
        return True

    def free(self) -> bool:
        """Whether nobody holds it - taken and let go at once."""
        if not self.try_take():
            return False
        self.release()
        return True

    def release(self) -> None:
        if self._fd is not None:
            fcntl.flock(self._fd, fcntl.LOCK_UN)
            os.close(self._fd)
            self._fd = None


def run_command(argv: Sequence[str], timeout: float) -> int | None:
    """Run a job with its output on ours (the journal); its exit code, None
    when it had to be stopped."""
    print("$ " + " ".join(argv), flush=True)
    proc = subprocess.Popen(list(argv), start_new_session=True)
    try:
        return proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        print(f"Out of time after {timeout / 60:.0f} min; stopping it", flush=True)
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(proc.pid, sig)
            except ProcessLookupError:
                break
            try:
                proc.wait(timeout=60)
                break
            except subprocess.TimeoutExpired:
                continue
        return None


def someone_logged_in() -> bool:
    """Whether anybody has a session on this machine - who reads utmp."""
    try:
        out = subprocess.run(
            ["who"], capture_output=True, text=True, timeout=10, check=False
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return False
    return bool(out.strip())


def within(window: str, at: datetime) -> bool:
    """Whether `at` (Warsaw) falls in `HH:MM-HH:MM`, which may wrap midnight."""
    start, end = (
        datetime.strptime(part, "%H:%M").time() for part in window.split("-", 1)
    )
    now = at.astimezone(warsaw_tz).time()
    if start <= end:
        return start <= now < end
    return now >= start or now < end


class Worker:
    def __init__(
        self,
        args: argparse.Namespace,
        *,
        client=None,
        clock: Callable[[], datetime] = utc_now,
        monotonic: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        run: Callable[[Sequence[str], float], int | None] = run_command,
        logged_in: Callable[[], bool] = someone_logged_in,
    ):
        self.args = args
        self._client = client
        self.clock = clock
        self.monotonic = monotonic
        self.sleep = sleep
        self.run_job = run
        self.logged_in = logged_in
        self.host = detect_host()
        self.lock = Lock(args.lock)
        self.busy = Lock(args.busy)
        self.tally = Tally()
        self.stopping = False

    def client(self):
        if self._client is None:
            self._client = make_client()
        return self._client

    # -- the loop ----------------------------------------------------------

    def run(self) -> int:
        if self.args.pending:
            return 0 if queued_requests(self.client(), limit=1) else 1
        self.recover()
        idle_since = self.monotonic()
        while not self.stopping:
            if self.drain():
                idle_since = self.monotonic()
            if not self.args.watch or self.stopping:
                break
            if self.should_power_off(self.monotonic() - idle_since):
                self.request_power_off()
                break
            self.sleep(self.args.poll_seconds)
        failed = sum(1 for outcome in self.tally.runs if outcome.failed)
        print(f"Ran {self.tally.count} asked-for runs; {failed} ended here as failed")
        return 0

    def drain(self) -> int:
        """Every queued run, oldest first, until none is left; how many ran."""
        ran = 0
        while not self.stopping:
            try:
                queued = queued_requests(self.client())
            except Exception as e:
                print(f"Could not read the queue: {e}", flush=True)
                return ran
            if not queued:
                return ran
            run_id, data = queued[0]
            if not self.do(run_id, str(data.get("job"))):
                # Somebody else took it, or it could not be taken: the queue
                # is read again, and a run that stays stuck is the page's to show.
                return ran
            ran += 1
        return ran

    def do(self, run_id: str, job: str) -> bool:
        """One queued run: wait for the night, claim it, run its job, and end
        it if the job could not. False when it was not ours to run."""
        if not self.busy.try_take():
            print("Another worker holds the busy lock; leaving the queue to it")
            return False
        try:
            if not self.wait_for(self.lock):
                return False
            try:
                if not claim(self.client(), run_id, host=self.host, now=self.clock()):
                    print(f"{run_id}: taken by somebody else")
                    return False
                self.tally.runs.append(self.execute(run_id, job))
                return True
            finally:
                self.lock.release()
        finally:
            self.busy.release()

    def wait_for(self, lock: Lock) -> bool:
        """Take the lock, waiting while somebody - a night - has it."""
        said = False
        while not lock.try_take():
            if self.stopping:
                return False
            if not said:
                print(f"{lock.path} is held - a night is running; waiting", flush=True)
                said = True
            self.sleep(self.args.poll_seconds)
        return True

    def execute(self, run_id: str, job: str) -> Outcome:
        outcome = Outcome(run_id, job)
        command = JOB_COMMANDS.get(job)
        state: FinalState
        if command is None:
            state, reason = "failed", f"nieznany job {job}"
        else:
            print(f"{run_id}: {job}", flush=True)
            outcome.exit_code = self.run_job(
                command(run_id, self.args), RUN_TIMEOUT_MINUTES * 60
            )
            state, reason = self.judge(outcome.exit_code)
        # A job that reported its own ending is left with it: this touches a
        # run only while it still says it is going - a job that crashed before
        # it could say so, or could not reach the ops database at all.
        try:
            ended_here = end_open_run(
                self.client(),
                run_id,
                state=state,
                reason=reason,
                exit_code=outcome.exit_code,
                now=self.clock(),
            )
        except Exception as e:
            print(f"{run_id}: could not end it: {e}", flush=True)
            ended_here = False
        if ended_here:
            outcome.failed = reason if state == "failed" else ""
            print(f"{run_id}: ended here as {state} - {reason}", flush=True)
        return outcome

    @staticmethod
    def judge(exit_code: int | None) -> tuple[FinalState, str]:
        """How a run whose job never said so ended, from the job's exit code."""
        if exit_code is None:
            return "failed", f"przekroczony czas ({RUN_TIMEOUT_MINUTES} min)"
        if exit_code == 0:
            return "succeeded", "job nie zgłosił końca (kod 0)"
        if exit_code == 75:
            return "partial", "job nie zgłosił końca (kod 75)"
        return "failed", f"kod wyjścia {exit_code}"

    def recover(self) -> None:
        """End the runs this host was doing when it last went down. The busy
        lock says no other worker here has one in hand."""
        if not self.busy.try_take():
            return
        try:
            for run_id in running_on(self.client(), self.host):
                end_open_run(
                    self.client(),
                    run_id,
                    reason="przerwany - maszyna wyłączona albo proces zabity",
                    now=self.clock(),
                )
                print(f"{run_id}: left running by a worker that died; ended")
        except Exception as e:
            print(f"Could not check for abandoned runs: {e}", flush=True)
        finally:
            self.busy.release()

    # -- switching the VM off ----------------------------------------------

    def should_power_off(self, idle_seconds: float) -> bool:
        """Once it has done what it was started for. Never for a VM nobody's
        request started - somebody booted it to look at it - nor while a
        night runs, while one is about to, or while anybody is logged in."""
        args = self.args
        if not args.poweroff_flag or not self.tally.count:
            return False
        if idle_seconds < args.idle_minutes * 60:
            return False
        if within(args.keep_up, self.clock()):
            return False
        if not self.lock.free():
            return False
        return not self.logged_in()

    def request_power_off(self) -> None:
        with open(self.args.poweroff_flag, "w") as f:
            f.write(f"koryta_job_requests {self.clock().isoformat()}\n")
        print(f"Idle; asked for the VM to be switched off ({self.args.poweroff_flag})")

    def on_sigterm(self, signum, frame) -> None:
        self.stopping = True
        print("SIGTERM: stopping after the run in hand", flush=True)


def window(text: str) -> str:
    start, end = text.split("-", 1)
    for part in (start, end):
        datetime.strptime(part, "%H:%M")
    return text


def parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="koryta_job_requests",
        description=(__doc__ or "").split("\n")[0],
        allow_abbrev=False,
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--once", action="store_true", help="Run what is queued now, then exit."
    )
    mode.add_argument(
        "--watch",
        action="store_true",
        help="Run what is queued, then look again every --poll-seconds.",
    )
    mode.add_argument(
        "--pending",
        action="store_true",
        help="Exit 0 when a run is queued, 1 when none is; run nothing.",
    )
    parser.add_argument("--poll-seconds", type=float, default=20)
    parser.add_argument(
        "--lock",
        help="Taken for each run, as night.sh takes it for a night "
        "(/var/lib/koryta-nightly/lock on the VM).",
    )
    parser.add_argument(
        "--busy",
        help="Held while a run is in hand, so that poweroff.sh leaves the VM up.",
    )
    parser.add_argument(
        "--poweroff-flag",
        help="--watch: once idle after a run, write this file and exit - "
        "poweroff.sh switches the VM off when it finds it.",
    )
    parser.add_argument("--idle-minutes", type=float, default=10)
    parser.add_argument(
        "--keep-up",
        type=window,
        default="03:45-04:45",
        help="Warsaw HH:MM-HH:MM in which the VM is never switched off: the "
        "schedule boots it at 04:15 for the 04:30 night. Default: %(default)s.",
    )
    parser.add_argument("--refresh", default="none")
    parser.add_argument("--max-minutes", type=float, default=60)
    parser.add_argument("--max-uploads", type=int, default=1000)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    sys.argv = sys.argv[:1]
    worker = Worker(args)
    previous = signal.signal(signal.SIGTERM, worker.on_sigterm)
    try:
        return worker.run()
    finally:
        signal.signal(signal.SIGTERM, previous)
