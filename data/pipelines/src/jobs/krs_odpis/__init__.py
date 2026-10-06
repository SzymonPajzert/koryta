"""Fetch odpisy pełne from the ministry's public KRS search service.

    koryta_krs_odpis                       # the companies ScrapeRejestrIO lists
    koryta_krs_odpis --krs-file todo.tsv   # KRS numbers, one a line, TAB P|S optional
    koryta_krs_odpis --graph --changed-since 2026-09-25
                                           # every company the pipelines know that
                                           # the bulletin names since that day
    python -m jobs.krs_odpis --dry-run     # report the plan, ask nothing

The free half of what `koryta_scrape_krs_paid` buys about a company. An odpis
pełny names everybody who has sat on its organs, owned it or held its prokura,
with the register entries that began and ended each seat, and
`scrapers.krs.odpis_history` reads that into dated seats.

- `search` is the signed client for the service behind the register's search
  page, which serves the odpis unmasked;
- `store` files each document in the crawl bucket before anything parses it;
- `plan` decides which companies are asked, and in which register first;
- `crawl` asks, politely, and stops when the service tires;
- `log` keeps the run record in the shared cache.

What a run asks about: by default, every company `ScrapeRejestrIO` lists,
rebuilt first as the other KRS jobs do, with the person feeds left to the paid
job; or the KRS numbers in a file; or, with ``--graph``, every company in
`CompaniesKRS` -- the companies whose people `PeopleKRSCombined` takes from an
odpis. ``--changed-since`` keeps only those the bulletin names on or after a
day, which is the weekly refresh: the register's entries are in the odpis the
day they are made, where rejestr.io's lag them. An odpis already on file is
asked for again only when the bulletin names the entry since. At most
``--max`` companies a run.

Stopping is free at any point: Ctrl+C or SIGTERM ends the run after the
document in hand, and a document is in the bucket before it is counted. One
crawler per IP -- the service's limits are per address -- so a second run
refuses to start while one holds the lock.

Exit codes: 0 when everything asked was answered (fetched, or in neither
register); 75 when the service stopped answering, or some companies were left
without an answer -- try again later; 130 when interrupted; 1 for anything else.
Afterwards ``koryta PeopleKRSCombined --refresh KrsOdpisSeats --refresh
KrsOdpisEntries`` parses what arrived, and `ScrapeRejestrIO` stops buying the
connections of every company whose people now come from a current odpis. One
command, not two: `koryta` builds its refresh tree for the first pipeline it
reads, so a second one named beside it is read from disk, stale.
"""

import argparse
import contextlib
import fcntl
import os
import signal
import sys
import typing
from collections import Counter
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from functools import partial
from pathlib import Path

import requests
from uuid_extensions import uuid7str  # type: ignore

from conductor import setup_context
from jobs.krs_common import PINNED, REFRESH_PIPELINES
from jobs.krs_odpis import crawl, search, store
from jobs.krs_odpis.log import FLUSH_EVERY, RunLog
from jobs.krs_odpis.plan import (
    Candidate,
    Plan,
    changed_since,
    from_graph,
    from_queries,
    read_krs_file,
    register_hints,
    report,
    select,
)
from scrapers.krs import odpis_files
from scrapers.krs.list import CompaniesKRS
from scrapers.krs.odpis_attempts import RUN_BUCKET, RUN_LOG, STATUSES
from scrapers.krs.scrape import KRSAlreadyScraped, ScrapeRejestrIO, settled_registers
from scrapers.krs.updates import KRSUpdates, latest_changes
from scrapers.stores import Context, ProcessPolicy
from stores.job_runs import ERRORS_KEPT, FinalState, JobRun
from stores.storage import CRAWLED_BUCKET, Client, warsaw_tz

#: Held for the length of a crawl. The CRU crawl's scripts predate it and do
#: not take it; do not run them beside this job.
LOCK = Path.home() / ".cache/koryta/locks/wyszukiwarka-krs-api.lock"

#: How many companies a run asks about at most. A clean session of the service
#: served ~1,000-2,900 documents before 2026-09-24; past that the stop rule,
#: not this cap, is what usually ends a run.
DEFAULT_MAX = 1000

EXIT_INTERRUPTED = 130


class CrawlerRunning(RuntimeError):
    """Another crawl of the service holds the lock."""


@contextlib.contextmanager
def one_crawler(path: Path = LOCK) -> Iterator[None]:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a+", encoding="utf-8") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise CrawlerRunning(
                f"another crawl of {odpis_files.HOST} holds {path}: one crawler "
                f"per IP, since the service's limits are per address"
            ) from None
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def warsaw_day() -> str:
    return datetime.now(warsaw_tz).date().isoformat()


def iso_day(text: str) -> str:
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError:
        raise argparse.ArgumentTypeError(f"not a day: {text!r} (YYYY-MM-DD)") from None


def parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="koryta_krs_odpis", description=(__doc__ or "").split("\n")[0]
    )
    source = parser.add_mutually_exclusive_group()
    source.add_argument(
        "--krs-file",
        help="KRS numbers to ask about, one a line, optionally TAB and P or S "
        "(the krs_todo.tsv shape). Default: the companies ScrapeRejestrIO lists.",
    )
    source.add_argument(
        "--graph",
        action="store_true",
        help="Ask about the companies CompaniesKRS knows, the public ones first.",
    )
    parser.add_argument(
        "--changed-since",
        type=iso_day,
        help="Only the companies the KRS bulletin names on or after this day.",
    )
    parser.add_argument(
        "--max",
        type=int,
        default=DEFAULT_MAX,
        help=f"Companies to ask about at most this run (default {DEFAULT_MAX}).",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=search.REQUEST_INTERVAL,
        help="Seconds between requests. A government service that asks for no "
        "key; keep it polite.",
    )
    parser.add_argument(
        "--flush-every",
        type=int,
        default=FLUSH_EVERY,
        help="Attempts per part of the run record - the most a hard kill loses.",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Report the plan; ask nothing."
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Neither restore pipeline outputs from the shared cache nor upload "
        "them there, as `koryta --no-backup`. The PDFs and the run record are "
        "written either way.",
    )
    return parser


@dataclass
class Sources:
    """The two pipelines a plan reads besides its candidates.

    The queue's own when it built its tree, which rebuilt both and holds them
    in memory. Built afresh they read their outputs from disk again: the
    bulletin alone is 143 MB and took 26 s on 2026-10-02.
    """

    updates: KRSUpdates = field(default_factory=KRSUpdates)
    scraped: KRSAlreadyScraped = field(default_factory=KRSAlreadyScraped)


def queue_candidates(ctx: Context, sources: Sources) -> list[Candidate]:
    queue = ScrapeRejestrIO()
    candidates = from_queries(queue.read_or_process_list(ctx))
    sources.updates, sources.scraped = queue.updates, queue.already_scraped
    return candidates


def graph_candidates(ctx: Context) -> list[Candidate]:
    return from_graph(CompaniesKRS().read_or_process(ctx))


def bulletin_changes(ctx: Context, sources: Sources) -> dict[str, str]:
    return latest_changes(sources.updates.read_or_process(ctx))


def make_plan(
    ctx: Context,
    candidates: Sequence[Candidate],
    changes: dict[str, str],
    today: str,
    limit: int,
    sources: Sources,
) -> Plan:
    stored = odpis_files.stored_odpisy(ctx)
    settled = settled_registers(sources.scraped.read_or_process(ctx))
    return select(candidates, stored, changes, register_hints(settled), today, limit)


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if args.no_backup:
        os.environ["DISABLE_BACKUP"] = "1"
    # Pipelines read sys.argv themselves - PeoplePKW takes --limit, and anything
    # argparse abbreviates to it - so the job's own flags must not reach them.
    sys.argv = sys.argv[:1]

    # The bulletin is what says an odpis on file is out of date, so every route
    # rebuilds it. The queue's tree reaches it through KRSNeedsRefresh, with the
    # rest of REFRESH_PIPELINES, as the other KRS jobs have it. The policy
    # builds its tree for the first pipeline a run reads and for no other, so
    # on the other routes the bulletin is read before anything else.
    queue = not (args.krs_file or args.graph)
    refresh = set(REFRESH_PIPELINES) if queue else {"KRSUpdates"}
    # The queue's people half is the paid job's, so its merge is held: rebuilt
    # under this job it was 42 s and most of a 10 GB peak on 2026-10-02.
    ctx, _ = setup_context(policy=ProcessPolicy(refresh, exclude_refresh=set(PINNED)))
    sources = Sources()
    if queue:
        candidates, source = queue_candidates(ctx, sources), "ScrapeRejestrIO"
    changes = bulletin_changes(ctx, sources)
    if args.krs_file:
        candidates, source = read_krs_file(Path(args.krs_file)), args.krs_file
    elif args.graph:
        candidates, source = graph_candidates(ctx), "CompaniesKRS"
    if args.changed_since:
        candidates = changed_since(candidates, changes, args.changed_since)
        source += f" the bulletin names since {args.changed_since}"
    plan = make_plan(ctx, candidates, changes, warsaw_day(), args.max, sources)
    print(report(plan, candidates, source))
    if args.dry_run or not plan.asks:
        return 0
    with one_crawler():
        return run(plan, args.interval, args.flush_every)


def run_state(result: crawl.Result) -> FinalState:
    """How a run ended, for /admin/procesy. Twenty attempts in a row with no
    answer is the service refusing; stopping because it slowed down, or
    leaving companies the gateway ate for the next run, is how this job is
    meant to end on a busy day."""
    if result.stopped.endswith(crawl.REFUSING):
        return "failed"
    return "partial" if result.code else "succeeded"


def run(
    plan: Plan,
    interval: float,
    flush_every: int,
    client: typing.Any | None = None,
    session: typing.Any | None = None,
    status: JobRun | None = None,
) -> int:
    """Ask about every company in the plan, keeping each document and each attempt."""
    client = client or Client()
    session = session or requests.Session()
    record_id = uuid7str()
    # The page at /admin/procesy shows the run under the run record's own id,
    # so the one can be found from the other.
    status = status or JobRun(
        "krs_odpis", run_id=record_id, unit="firm", total=len(plan.asks)
    )
    attempts: Counter[str] = Counter(dict.fromkeys(STATUSES, 0))
    asked: set[str] = set()

    def record(outcome: crawl.Outcome) -> None:
        log.add(outcome)
        attempts[outcome.status] += 1
        asked.add(outcome.krs)
        status.progress(len(asked), counters=attempts)

    log = RunLog(
        partial(client.create_object, RUN_BUCKET, content_type="application/gzip"),
        record_id,
        flush_every,
    )
    put = partial(client.create_object, CRAWLED_BUCKET, content_type="application/pdf")

    def fetch(ask):
        return store.fetch_and_store(
            ask.krs, ask.registers, put, warsaw_day(), session=session
        )

    stop = False

    def on_sigterm(signum, frame):
        nonlocal stop
        stop = True

    # Everything from the start on is inside the handlers, the last flush of
    # the run record included: a part failing to write once the crawl had
    # returned used to skip every `finish`, and left the run "running" until
    # the page called it stalled. `finish` keeps its first call, so a crawl
    # interrupted and then recorded is still the partial run it was.
    status.start()
    try:
        previous = signal.signal(signal.SIGTERM, on_sigterm)
        try:
            result = crawl.crawl(
                plan.asks, fetch, record, interval, should_stop=lambda: stop
            )
        finally:
            log.flush()
            signal.signal(signal.SIGTERM, previous)
    except KeyboardInterrupt:
        print("Interrupted; what was fetched is in the bucket")
        status.finish(
            "partial",
            stop_reason="przerwany",
            exit_code=EXIT_INTERRUPTED,
            done=len(asked),
        )
        return EXIT_INTERRUPTED
    except BaseException as problem:
        status.finish(
            "failed",
            stop_reason=f"raised {type(problem).__name__}",
            errors=[repr(problem)],
            done=len(asked),
        )
        raise

    final = Counter(o.status for o in result.final().values())
    errors = [f"{o.krs}: {o.error}" for o in result.final().values() if o.error]
    status.finish(
        run_state(result),
        stop_reason=result.stopped or None,
        errors=errors[:ERRORS_KEPT],
        exit_code=result.code,
        counters={**dict.fromkeys(STATUSES, 0), **final},
        done=len(result.final()),
    )
    print(
        f"Asked about {len(result.final()):,} companies: {dict(final)}"
        + (f"; stopped: {result.stopped}" if result.stopped else "")
    )
    print(
        f"{log.attempts_written:,} attempts recorded in {len(log.written)} parts "
        f"under gs://{RUN_BUCKET}/{RUN_LOG.prefix}"
    )
    if final.get("fetched"):
        print(
            "Parse them: koryta PeopleKRSCombined "
            "--refresh KrsOdpisSeats --refresh KrsOdpisEntries"
        )
    return result.code
