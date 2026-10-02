"""Read the KRS register for who owns what, a bounded number of entries a run.

The job half of `scrapers.krs.register` - see its module doc for why the
register is read at all. Each run rebuilds `KRSRegisterQueue` (the bulletin
against what the log already holds), asks api-krs about the head of it, and
appends every answer to `RESPONSE_LOG` in the shared cache as write-once
parts. Nothing else is written: the ledger is `KRSRegisterEntries`, a fold of
that log, and the companies found public are `CompaniesPublicByRegister`.

    koryta_krs_register_owners --reads 20000
    python -m jobs.krs_register_owners --reads 500 --dry-run

Stopping is free at any point: Ctrl+C or SIGTERM ends the run after the read
in hand, and what was read is flushed first. A rerun recomputes the queue, so
it carries on where the last one stopped.

A run that asks anything reports how far it has got to koryta.pl/admin/procesy
(`stores.job_runs`); a dry run or a report of the queue does not.
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

import requests
from tqdm import tqdm
from uuid_extensions import uuid7str  # type: ignore

from conductor import setup_context
from jobs.krs_register_owners.fetch import ask
from jobs.krs_register_owners.log import FLUSH_EVERY, ResponseLog
from scrapers.krs.register import (
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

#: EX_TEMPFAIL: the upstream would not answer. Anything else that goes wrong
#: raises, and exits 1.
EXIT_UPSTREAM_REFUSING = 75

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
        "queue. 0, the default, only reports the queue.",
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


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if args.no_backup:
        os.environ["DISABLE_BACKUP"] = "1"
    # Pipelines read sys.argv themselves - PeoplePKW takes --limit, and anything
    # argparse abbreviates to it - so the job's own flags must not reach them.
    sys.argv = sys.argv[:1]

    ctx, _ = setup_context(policy=ProcessPolicy(set(REFRESH)))
    queue = KRSRegisterQueue().read_or_process(ctx)
    todo = [str(krs).zfill(10) for krs in queue["krs"]][: max(args.reads, 0)]
    reasons = Counter(queue["reason"][: len(todo)]) if len(queue) else Counter()
    print(
        f"Queue: {len(queue)} KRS numbers owed a read; "
        f"this run asks about {len(todo)} {dict(reasons)}"
    )
    if args.dry_run or not todo:
        return 0

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
        return read_register(todo, log, args.interval, run, status=status)


def read_register(
    todo: Sequence[str],
    log: ResponseLog,
    interval: float,
    run: str,
    session: requests.Session | None = None,
    now: Callable[[], datetime] | None = None,
    status: JobRun | None = None,
) -> int:
    """Ask about every number in `todo`, logging each answer. Returns the exit
    code, and tells `status` how the run went."""
    session = session or requests.Session()
    clock = now or (lambda: datetime.now(warsaw_tz))
    stop = False
    stopped = ""
    errors: list[str] = []

    def on_sigterm(signum, frame):
        nonlocal stop
        stop = True

    previous = signal.signal(signal.SIGTERM, on_sigterm)
    counts: Counter[str] = Counter(dict.fromkeys(STATUSES, 0))
    failures = 0
    code = 0
    if status is not None:
        status.progress(0, total=len(todo), counters=counts)
    try:
        for krs in tqdm(todo, desc="Reading the register"):
            if stop:
                print("SIGTERM: stopping after the last read")
                stopped = "SIGTERM"
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
        # The upstream refusing is the failure; a stop asked for leaves the
        # rest of the queue to the next run, which is what it is for.
        state: FinalState = "failed" if code else "partial" if stopped else "succeeded"
        status.finish(
            state,
            stop_reason=stopped or None,
            errors=errors,
            exit_code=code,
            counters={**counts, "logged": log.reads_written},
            done=sum(counts.values()),
        )
    return code
