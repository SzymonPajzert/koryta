"""Read the KRS register for who owns what, a bounded number of entries a run.

The job half of `scrapers.krs.register` - see its module doc for why the
register is read at all. Each run rebuilds `KRSRegisterQueue` (the bulletin
against what the log already holds), asks api-krs about the head of it, and
appends every answer to `RESPONSE_LOG` in the shared cache as write-once
parts. Nothing else is written: the ledger is `KRSRegisterEntries`, a fold of
that log, and the companies found public are `CompaniesPublicByRegister`.

    koryta_krs_register_owners --reads 20000
    koryta_krs_register_owners --new-registrations --reads 0 --max-minutes 25
                                  # the night's step (`jobs.nightly`)
    koryta_krs_register_owners --krs-file companies.txt
                                  # numbers somebody listed, read first
    python -m jobs.krs_register_owners --reads 500 --dry-run

The queue's head is every number registered since the log began that has no
answer yet (`scrapers.krs.register.queue_for_a_read`). `--new-registrations`
reads all of them, however many there are, and `--reads` then counts the
backlog behind them: failed reads, answers the register has moved on from,
and the ~700k numbers never read, oldest first. A working day's bulletin
names 231-307 new registrations (2026-09-29 to 10-08), a weekend's none -
two to three minutes a night at the default pace. How much backlog a night
takes besides is task decide-register-sweep-pace; the night reads none until
it is decided.

`--krs-file` puts a list ahead of all that, read whatever the queue says: the
companies some other source says the public owns and nothing has read, which
in number order the queue would reach months from now. Prokuratoria's
Treasury-list companies nobody crawled were such a list, and so were the
companies the register's own name search finds behind a university's or a
state agency's name (2026-10-28).

Stopping is free at any point: Ctrl+C, SIGTERM or `--max-minutes` ends the run
after the read in hand, and what was read is flushed first. A rerun recomputes
the queue, so it carries on where the last one stopped.

Exit codes: 0 when everything this run set out to read was read, or it was
asked to stop; 75 - try again later - when the register stopped answering, or
the run ran out of `--max-minutes` with numbers left; 1 for anything else.

A run that asks anything reports how far it has got to koryta.pl/admin/procesy
(`stores.job_runs`), and so does a `--new-registrations` run with nothing to
read, so that the night's quiet weekends show as runs; a dry run or a report of
the queue does not.
"""

import argparse
import os
import signal
import sys
import time
from collections import Counter
from collections.abc import Callable, Sequence
from datetime import datetime
from functools import partial

import pandas as pd
import requests
from tqdm import tqdm
from uuid_extensions import uuid7str  # type: ignore

from conductor import setup_context
from jobs.krs_register_owners.fetch import ask
from jobs.krs_register_owners.log import FLUSH_EVERY, ResponseLog
from scrapers.krs.register import (
    REASON_NEW,
    RESPONSE_LOG,
    STATUS_FAILED,
    STATUS_NOT_FOUND,
    STATUS_OK,
    STATUS_STRUCK_OFF,
    KRSRegisterQueue,
)
from scrapers.stores import ProcessPolicy
from stores.job_runs import ERRORS_KEPT, FinalState, JobRun
from stores.storage import Client, warsaw_tz

#: Rebuilt before the queue is read, whatever is on disk: the log has grown
#: since the last run by definition, and the bulletin usually has.
REFRESH = {"KRSUpdates", "KRSRegisterEntries", "KRSRegisterQueue"}

#: Consecutive failures after which a run stops rather than logging the rest
#: of its queue as failed. The server is down or refusing.
MAX_CONSECUTIVE_FAILURES = 20

#: EX_TEMPFAIL: the upstream would not answer, or the run ran out of time with
#: numbers left; the next run carries on. Anything else that goes wrong
#: raises, and exits 1.
EXIT_TRY_LATER = 75
EXIT_UPSTREAM_REFUSING = EXIT_TRY_LATER

#: Why a run that ran out of `--max-minutes` stopped, as the page shows it.
DEADLINE = "deadline"

#: Every status a read can have, so the page shows a zero rather than nothing.
STATUSES = (STATUS_OK, STATUS_STRUCK_OFF, STATUS_NOT_FOUND, STATUS_FAILED)


def parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="koryta_krs_register_owners", description=__doc__.split("\n")[0]
    )
    parser.add_argument(
        "--reads",
        type=int,
        default=0,
        help="How many KRS numbers to ask about this run, from the head of the "
        "queue - or, with --new-registrations, after the new registrations at "
        "its head. 0, the default, only reports the queue.",
    )
    parser.add_argument(
        "--new-registrations",
        action="store_true",
        help="Read every number registered since the log began that has no "
        "answer yet, however many, before the --reads from the rest of the "
        "queue. The night's step.",
    )
    parser.add_argument(
        "--krs-file",
        help="Read the KRS numbers in this file first, before anything the "
        "queue holds: one a line, anything after a # ignored. Counted apart "
        "from --reads.",
    )
    parser.add_argument(
        "--max-minutes",
        type=float,
        help="Stop asking this many minutes after the start, the queue's "
        "rebuild included, and leave the rest to the next run (exit 75). "
        "Default: no limit.",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=0.25,
        help="Seconds between requests. A government API that asks for no key; "
        "keep it polite.",
    )
    parser.add_argument(
        "--flush-every",
        type=int,
        default=FLUSH_EVERY,
        help="Reads per part written to the log - the most a hard kill loses.",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Report the queue; ask nothing."
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Neither restore pipeline outputs from the shared cache nor upload "
        "them there, as `koryta --no-backup`. The log is written either way.",
    )
    return parser


def to_read(queue: pd.DataFrame, reads: int, new_registrations: bool) -> list[str]:
    """The numbers this run asks about, in the queue's order.

    `reads` from the head of the queue; with `new_registrations`, every new
    registration - the run of them at the head - and `reads` more after them.
    """
    numbers = [str(krs).zfill(10) for krs in queue["krs"]]
    new = 0
    if new_registrations:
        for reason in queue["reason"]:
            if reason != REASON_NEW:
                break
            new += 1
    return numbers[: new + max(reads, 0)]


def listed_numbers(path: str) -> list[str]:
    """The KRS numbers a `--krs-file` lists, padded, each once, in its order.

    A line that is anything but a number once its comment is cut off stops the
    run before it asks anything: a list drawn up by hand is where a NIP or a
    name pasted in by mistake would otherwise be asked about, and logged, as a
    KRS number nobody has.
    """
    numbers: dict[str, None] = {}
    with open(path) as f:
        for line_number, line in enumerate(f, 1):
            text = line.split("#", 1)[0].strip()
            if not text:
                continue
            if not text.isdigit() or len(text) > 10:
                raise ValueError(f"{path}:{line_number}: not a KRS number: {text!r}")
            numbers[text.zfill(10)] = None
    return list(numbers)


def plan(
    queue: pd.DataFrame, listed: Sequence[str], queued: Sequence[str]
) -> tuple[list[str], Counter]:
    """What a run reads - `listed` first, then `queued` less what that already
    asks - and how many of each reason, a listed number counting as listed."""
    first = set(listed)
    todo = list(listed) + [krs for krs in queued if krs not in first]
    reason_of = dict(zip((str(krs).zfill(10) for krs in queue["krs"]), queue["reason"]))
    reasons = Counter(
        "listed" if krs in first else reason_of.get(krs, "") for krs in todo
    )
    return todo, reasons


def main(argv: Sequence[str] | None = None) -> int:
    started = time.monotonic()
    args = parser().parse_args(argv)
    if args.no_backup:
        os.environ["DISABLE_BACKUP"] = "1"
    # Pipelines read sys.argv themselves - PeoplePKW takes --limit, and anything
    # argparse abbreviates to it - so the job's own flags must not reach them.
    sys.argv = sys.argv[:1]
    listed = listed_numbers(args.krs_file) if args.krs_file else []

    ctx, _ = setup_context(policy=ProcessPolicy(set(REFRESH)))
    queue = KRSRegisterQueue().read_or_process(ctx)
    todo, reasons = plan(
        queue, listed, to_read(queue, args.reads, args.new_registrations)
    )
    print(
        f"Queue: {len(queue)} KRS numbers owed a read; "
        f"this run asks about {len(todo)} {dict(reasons)}"
    )
    if args.dry_run or not (todo or args.new_registrations):
        return 0
    deadline = started + args.max_minutes * 60 if args.max_minutes else None

    assert RESPONSE_LOG.bucket is not None
    run = uuid7str()
    # Started before the log's client, and as a `with`, so a run that breaks
    # anywhere from here on is reported as failed.
    with JobRun(
        "krs_register_owners", run_id=run, unit="odczytów", total=len(todo)
    ) as status:
        log = ResponseLog(
            partial(
                Client().create_object,
                RESPONSE_LOG.bucket,
                content_type="application/gzip",
            ),
            run,
            args.flush_every,
        )
        return read_register(
            todo, log, args.interval, run, status=status, deadline=deadline
        )


def stop_rule(
    deadline: float | None,
    signalled: Callable[[], bool],
    tick: Callable[[], float] = time.monotonic,
) -> Callable[[], tuple[str, int]]:
    """Why a run should stop before its next read, and the exit code that
    says so; "" to carry on. SIGTERM is somebody's choice, and exits 0; the
    time running out leaves numbers the run set out to read, and exits 75."""

    def stop_now() -> tuple[str, int]:
        if signalled():
            return "SIGTERM", 0
        if deadline is not None and tick() >= deadline:
            return DEADLINE, EXIT_TRY_LATER
        return "", 0

    return stop_now


def read_register(
    todo: Sequence[str],
    log: ResponseLog,
    interval: float,
    run: str,
    session: requests.Session | None = None,
    now: Callable[[], datetime] | None = None,
    status: JobRun | None = None,
    deadline: float | None = None,
    tick: Callable[[], float] = time.monotonic,
) -> int:
    """Ask about every number in `todo`, logging each answer, until `deadline`
    on `tick`'s clock. Returns the exit code, and tells `status` how the run
    went."""
    session = session or requests.Session()
    clock = now or (lambda: datetime.now(warsaw_tz))
    stop = False
    stopped = ""
    errors: list[str] = []

    def on_sigterm(signum, frame):
        nonlocal stop
        stop = True

    stop_now = stop_rule(deadline, lambda: stop, tick)
    previous = signal.signal(signal.SIGTERM, on_sigterm)
    counts: Counter[str] = Counter(dict.fromkeys(STATUSES, 0))
    failures = 0
    code = 0
    if status is not None:
        status.progress(0, total=len(todo), counters=counts)
    try:
        for krs in tqdm(todo, desc="Reading the register"):
            stopped, code = stop_now()
            if stopped:
                print(f"Stopping before the next read: {stopped}")
                break
            read = ask(session, krs, interval, clock, run)
            log.add(read)
            counts[read.status] += 1
            if read.status == STATUS_FAILED and len(errors) < ERRORS_KEPT:
                errors.append(f"{krs}: {read.error}")
            if status is not None:
                status.progress(sum(counts.values()), counters=counts)
            failures = failures + 1 if read.status == STATUS_FAILED else 0
            if failures >= MAX_CONSECUTIVE_FAILURES:
                print(f"{failures} reads in a row failed; stopping here")
                stopped = f"{failures} reads in a row failed"
                code = EXIT_UPSTREAM_REFUSING
                break
            time.sleep(interval)
    except KeyboardInterrupt:
        print("Interrupted; keeping what was read")
        stopped = "przerwany"
    finally:
        log.flush()
        signal.signal(signal.SIGTERM, previous)
    print(
        f"Read {sum(counts.values())} register entries {dict(counts)}; "
        f"{log.reads_written} logged in {len(log.written)} parts under "
        f"gs://{RESPONSE_LOG.bucket}/{RESPONSE_LOG.prefix}"
    )
    if status is not None:
        # The upstream refusing is the failure; a stop asked for, or the time
        # running out, leaves the rest of the queue to the next run, which is
        # what it is for.
        refusing = code and stopped != DEADLINE
        state: FinalState = (
            "failed" if refusing else "partial" if stopped else "succeeded"
        )
        status.finish(
            state,
            stop_reason=stopped or None,
            errors=errors,
            exit_code=code,
            counters={**counts, "logged": log.reads_written},
            done=sum(counts.values()),
        )
    return code
