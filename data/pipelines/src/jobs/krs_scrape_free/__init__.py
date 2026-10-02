"""The free half of the KRS scrape: the bulletin, then an odpis for every query.

`ScrapeRejestrIO` lists what is worth asking about; this asks api-krs for each
query's free URLs and writes every answer to the crawl bucket - an empty object
where there was none. Nothing here is paid for.

    koryta_scrape_krs_free                    # until the queue is done
    koryta_scrape_krs_free --max-minutes 170  # nightly, see jobs/CLOUD_RUN.md
    koryta_scrape_krs_free --dry-run          # report the queue, ask nothing

Nothing is asked on stdin, so it runs unattended. A request or an upload that
fails is counted and left for the next run, which rebuilds the queue from the
bucket and so carries on where this one stopped: at the deadline, on SIGTERM,
or once `MAX_CONSECUTIVE_FAILURES` requests in a row have failed.

Exit codes, as `koryta_krs_register_owners` has them: 0 when every query was
answered; 75 when some were not - the run stopped early, or a request or an
upload failed - so run again later; 1 for anything else. Each run writes a
summary to gs://koryta-pl-sharedcache/jobs/krs_scrape_free/runs/.
"""

import argparse
import json
import os
import signal
import sys
import time
import typing
from collections.abc import Callable, Iterable, Sequence
from dataclasses import asdict, dataclass, field
from datetime import datetime

import requests
from tqdm import tqdm
from uuid_extensions import uuid7str  # type: ignore

from conductor import setup_context
from jobs.krs_bulletin import scrape_updates_by_dates
from jobs.krs_common import REFRESH_PIPELINES, query_krs_api, upload_result
from scrapers.krs.scrape import RejestrIOQuery, ScrapeRejestrIO
from scrapers.stores import Context, ProcessPolicy
from stores.storage import SHARED_BUCKET, Client, warsaw_tz

#: Requests failing back to back before the run leaves api-krs alone until the
#: next one: it is down, or refusing this address.
MAX_CONSECUTIVE_FAILURES = 20

#: EX_TEMPFAIL: some queries are still unanswered, and the next run asks them.
EXIT_TRY_LATER = 75

RUNS_PREFIX = "jobs/krs_scrape_free/runs/"

#: Error messages a summary keeps - enough to tell one cause from several.
ERRORS_KEPT = 20

#: Seconds between progress lines, which stand in for the progress bar when
#: there is no terminal to draw it on.
PROGRESS_EVERY = 300

#: Held at the version on disk, or restored from the shared cache when there is
#: none. `ScrapeRejestrIO` reads PeopleMerged only for its person queries, which
#: go to rejestr.io and are the paid job's - yet KorytaPeople is named after the
#: day, so unpinned it is rebuilt on the first run of every day, and on a fresh
#: Cloud Run container so is every merge under it.
PINNED = {"PeopleMerged"}


def now() -> str:
    return datetime.now(warsaw_tz).isoformat(timespec="seconds")


@dataclass
class RunSummary:
    """What one run did, kept in the shared cache where a morning check reads it."""

    run: str
    started: str
    finished: str = ""
    #: Companies with something to ask api-krs, and how many this run got to.
    queries: int = 0
    queries_done: int = 0
    #: Requests: answered with a body; answered with none, which is stored as
    #: an empty object; failed, with nothing stored; and answers not uploaded.
    answered: int = 0
    empty: int = 0
    failed: int = 0
    upload_failed: int = 0
    bulletin_fetched: list[str] = field(default_factory=list)
    bulletin_failed: list[str] = field(default_factory=list)
    #: Why the run ended before the queue did, if it did.
    stopped: str = ""
    errors: list[str] = field(default_factory=list)
    exit_code: int | None = None

    def code(self) -> int:
        unfinished = (
            self.stopped
            or self.queries_done < self.queries
            or self.failed
            or self.upload_failed
            or self.bulletin_failed
        )
        return EXIT_TRY_LATER if unfinished else 0

    def line(self) -> str:
        return (
            f"Asked about {self.queries_done:,} of {self.queries:,} companies: "
            f"{self.answered:,} answered, {self.empty:,} empty, "
            f"{self.failed:,} failed, {self.upload_failed:,} not uploaded"
            + (f"; stopped: {self.stopped}" if self.stopped else "")
        )


def free_queries(queries: Iterable[RejestrIOQuery]) -> list[RejestrIOQuery]:
    """The queries with something to ask api-krs; the rest are rejestr.io's."""
    return [
        query
        for query in queries
        if query.krs is not None and next(iter(query.urls(only_free=True)), None)
    ]


def stop_rule(
    deadline: float | None,
    signalled: Callable[[], bool],
    clock: Callable[[], float] = time.monotonic,
) -> Callable[[], str]:
    """Why the run should stop now, or "" to carry on."""

    def should_stop() -> str:
        if signalled():
            return "SIGTERM"
        if deadline is not None and clock() >= deadline:
            return "deadline"
        return ""

    return should_stop


def scrape(
    ctx: Context,
    queries: Sequence[RejestrIOQuery],
    sleep_time: float,
    summary: RunSummary,
    should_stop: Callable[[], str] = lambda: "",
    fetch: Callable[..., str | None] = query_krs_api,
    store: Callable[..., bool] = upload_result,
) -> None:
    """Ask api-krs about each query in turn, counting into `summary`."""
    failures_in_a_row = 0
    last_progress = time.monotonic()
    for query in tqdm(queries, disable=None):
        if reason := should_stop():
            summary.stopped = reason
            break
        for url in query.urls(only_free=True):
            assert "rejestr.io" not in url
            try:
                result = fetch(url, verbose=False)
            except (requests.RequestException, ValueError) as e:
                print(f"Failed: {url}: {e}")
                summary.failed += 1
                if len(summary.errors) < ERRORS_KEPT:
                    summary.errors.append(f"{url}: {e}"[:500])
                failures_in_a_row += 1
                time.sleep(sleep_time)
                continue
            failures_in_a_row = 0
            if result is None:
                summary.empty += 1
                result = ""
            else:
                summary.answered += 1
            if not store(ctx, url, result, verbose=False):
                summary.upload_failed += 1
            time.sleep(sleep_time)
        summary.queries_done += 1
        if failures_in_a_row >= MAX_CONSECUTIVE_FAILURES:
            summary.stopped = f"{failures_in_a_row} requests in a row failed"
            break
        if time.monotonic() - last_progress >= PROGRESS_EVERY:
            last_progress = time.monotonic()
            print(summary.line())


def build_queue() -> tuple[Context, list[RejestrIOQuery]]:
    policy = ProcessPolicy(set(REFRESH_PIPELINES), exclude_refresh=set(PINNED))
    ctx, _ = setup_context(policy=policy)
    queries = free_queries(ScrapeRejestrIO().read_or_process_list(ctx))
    owed = sum(len(list(query.urls(only_free=True))) for query in queries)
    print(f"Queue: {len(queries):,} companies to ask api-krs about, {owed:,} requests")
    return ctx, queries


def scrape_krs_free(
    sleep_time=0.2,
    summary: RunSummary | None = None,
    should_stop: Callable[[], str] = lambda: "",
) -> RunSummary:
    """Phase 1: Scrape bulletin updates and free api-krs queries.

    This updates the bulletin data and api-krs OdpisAktualny snapshots.
    No cost — all queries go to the free api-krs.ms.gov.pl API.
    """
    summary = summary or RunSummary(run=uuid7str(), started=now())
    bulletin = scrape_updates_by_dates(sleep_time)
    summary.bulletin_fetched = bulletin.fetched
    summary.bulletin_failed = bulletin.failed
    ctx, queries = build_queue()
    summary.queries = len(queries)
    scrape(ctx, queries, sleep_time, summary, should_stop)
    print(summary.line())
    return summary


def write_summary(summary: RunSummary, client: typing.Any | None = None) -> str:
    """Write the run's summary once; a failure to is printed, not raised."""
    summary.finished = now()
    name = f"{RUNS_PREFIX}date={summary.started[:10]}/{summary.run}.json"
    data = json.dumps(asdict(summary), ensure_ascii=False, indent=1).encode("utf-8")
    try:
        url = (client or Client()).create_object(
            SHARED_BUCKET, name, data, "application/json"
        )
    except Exception as e:
        # What the run fetched is in the crawl bucket either way.
        print(f"Could not write the run summary {name}: {e}")
        return ""
    print(f"Summary: {url}")
    return url


def parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="koryta_scrape_krs_free", description=(__doc__ or "").split("\n")[0]
    )
    parser.add_argument(
        "--max-minutes",
        type=float,
        help="Stop asking this many minutes after the start and leave the rest "
        "of the queue to the next run. Default: no limit.",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=0.2,
        help="Seconds between requests. A government API that asks for no key; "
        "keep it polite.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Rebuild the queue and report it; fetch nothing, not even the "
        "bulletin. Rebuilt pipelines still go to the shared cache unless "
        "--no-backup.",
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Neither restore pipeline outputs from the shared cache nor upload "
        "them there, as `koryta --no-backup`. The run summary is written "
        "either way.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    started = time.monotonic()
    args = parser().parse_args(argv)
    if args.no_backup:
        os.environ["DISABLE_BACKUP"] = "1"
    # Pipelines read sys.argv themselves - PeoplePKW takes --limit, and anything
    # argparse abbreviates to it - so the job's own flags must not reach them.
    sys.argv = sys.argv[:1]

    if args.dry_run:
        build_queue()
        return 0

    deadline = started + args.max_minutes * 60 if args.max_minutes else None
    signalled = False

    def on_sigterm(signum, frame):
        nonlocal signalled
        signalled = True
        print("SIGTERM: stopping after the company in hand")

    previous = signal.signal(signal.SIGTERM, on_sigterm)
    summary = RunSummary(run=uuid7str(), started=now())
    try:
        scrape_krs_free(args.interval, summary, stop_rule(deadline, lambda: signalled))
    except BaseException as e:
        # Interrupted, or a bug: say so in the summary, then exit as Python
        # would have - 130 for Ctrl+C, 1 for the rest.
        summary.stopped = summary.stopped or f"raised {type(e).__name__}"
        summary.errors.append(repr(e)[:500])
        write_summary(summary)
        raise
    finally:
        signal.signal(signal.SIGTERM, previous)
    summary.exit_code = summary.code()
    write_summary(summary)
    return summary.exit_code
