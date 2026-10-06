"""The paid half of the KRS scrape: rejestr.io, for the queries worth money.

Recomputes `ScrapeRejestrIO` after the free half has written, prints what the
bill is made of and what it comes to, and buys. By hand it waits for Enter
first, and asks again before each call; with a cap it asks nothing:

    koryta_scrape_krs_paid                                   # by hand, the whole queue
    koryta_scrape_krs_paid --scope fallback --max-calls 50   # the night
    koryta_scrape_krs_paid --scope fallback --dry-run        # what the night would buy

`--scope fallback` is what the free sources cannot give (`plan.fallback`): the
person feeds of the people somebody marked interesting, and the connections of
the companies whose odpis pełny `koryta_krs_odpis` asked for and did not get
(`KrsOdpisAttempts`). A company it has not asked about yet is left to it.

`--max-calls` caps the day, not the run. What the crawl bucket already holds
from rejestr.io today counts against it (`plan.bought_today`), so a night run
twice buys no more than once, and a hand run the same morning leaves the night
less. Within the cap the people come first, then the public companies.

In either scope a company's connections are left out where its people already
come from a current odpis pełny (`ScrapeRejestrIO.companies_told_by_the_odpis`),
so by hand the bill is smallest after `koryta_krs_odpis` and a rebuild of the
seats:

    koryta_krs_odpis
    koryta PeopleKRSCombined --refresh KrsOdpisSeats --refresh KrsOdpisEntries
    koryta_scrape_krs_paid

Exit codes: 0 when everything planned was bought; 75 when something is left
for the next run - the cap, a call that failed, SIGTERM; 1 when rejestr.io
refused the account (a key it does not take, no credit left) or anything else
went wrong. A run past the bill writes a summary to
gs://koryta-pl-sharedcache/jobs/krs_scrape_paid/runs/ and reports to
koryta.pl/admin/procesy (`stores.job_runs`).
"""

import argparse
import json
import os
import signal
import sys
import typing
from collections.abc import Callable, Iterable, Sequence
from dataclasses import asdict, dataclass, field
from datetime import datetime
from time import sleep

from uuid_extensions import uuid7str  # type: ignore

from conductor import setup_context
from jobs.krs_common import PINNED, REFRESH_PIPELINES, upload_result
from jobs.krs_scrape_paid import plan
from scrapers.krs.odpis_attempts import KrsOdpisAttempts, failed_odpis
from scrapers.krs.scrape import (
    PLN_PER_CALL,
    RejestrIOQuery,
    ScrapeRejestrIO,
    cost_breakdown,
    public_krs_ids,
)
from scrapers.stores import CloudStorage, Context, ProcessPolicy
from stores.job_runs import ERRORS_KEPT, FinalState, JobRun
from stores.rejestr import Rejestr, RejestrRefused, UnattendedRejestr
from stores.storage import CRAWLED_BUCKET, SHARED_BUCKET, Client, warsaw_tz

JOB = "krs_scrape_paid"
UNIT = "zapytań"
RUNS_PREFIX = "jobs/krs_scrape_paid/runs/"
#: Where the crawl bucket keeps what rejestr.io answered.
REJESTR_IO = "hostname=rejestr.io"

EXIT_FAILED = 1
#: EX_TEMPFAIL: something is left for the next run.
EXIT_TRY_LATER = 75
EXIT_INTERRUPTED = 130

#: Calls failing back to back before the run leaves rejestr.io alone until the
#: next one: it is down, or something between here and it is.
MAX_CONSECUTIVE_FAILURES = 5
#: How that stop reads, as `koryta_scrape_krs_free` words its own.
REFUSING = "calls in a row failed"


def now() -> str:
    return datetime.now(warsaw_tz).isoformat(timespec="seconds")


def today() -> str:
    """The Warsaw day the crawl bucket files an answer under."""
    return datetime.now(warsaw_tz).date().isoformat()


@dataclass
class RunSummary:
    """What one run bought, kept in the shared cache."""

    run: str
    started: str
    finished: str = ""
    scope: str = plan.SCOPE_ALL
    #: The day's cap, None by hand, and what was bought today before this run.
    max_calls: int | None = None
    bought_before: int = 0
    #: Calls this run set out to buy, and those the cap left for the next day.
    planned: int = 0
    deferred: int = 0
    #: Calls bought; not bought - declined at the prompt, or rejestr.io holds
    #: nothing under the id; failed; and bought but not stored, which the
    #: next run buys again.
    bought: int = 0
    skipped: int = 0
    failed: int = 0
    upload_failed: int = 0
    pln: float = 0.0
    #: rejestr.io refused the account: nothing more is bought until somebody
    #: looks.
    refused: bool = False
    #: Why the run ended before its plan did, if it did.
    stopped: str = ""
    errors: list[str] = field(default_factory=list)
    exit_code: int | None = None

    def code(self) -> int:
        if self.refused:
            return EXIT_FAILED
        unfinished = self.stopped or self.deferred or self.failed or self.upload_failed
        return EXIT_TRY_LATER if unfinished else 0

    def state(self) -> FinalState:
        """How the page reads a run that ended without raising. Left for the
        next day by the cap or a deadline is how a capped job carries on; the
        account refused, or rejestr.io not answering, is somebody's to look at."""
        if self.refused or self.stopped.endswith(REFUSING):
            return "failed"
        return "succeeded" if self.code() == 0 else "partial"

    def counters(self) -> dict[str, float]:
        return {
            "bought": self.bought,
            "skipped": self.skipped,
            "failed": self.failed,
            "deferred": self.deferred,
            "pln": self.pln,
            "pln_planned": self.planned * PLN_PER_CALL,
        }

    def line(self) -> str:
        return (
            f"Bought {self.bought} of {self.planned} planned calls "
            f"({self.pln:.2f} PLN): {self.skipped} not bought, {self.failed} "
            f"failed, {self.upload_failed} not stored, {self.deferred} left "
            f"for the next day" + (f"; stopped: {self.stopped}" if self.stopped else "")
        )


def parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="koryta_scrape_krs_paid", description=(__doc__ or "").split("\n")[0]
    )
    parser.add_argument(
        "--scope",
        choices=plan.SCOPES,
        default=plan.SCOPE_ALL,
        help="all: everything the queue owes rejestr.io. fallback: only the "
        "person feeds and the companies the free odpis failed for. "
        "Default: %(default)s.",
    )
    parser.add_argument(
        "--max-calls",
        type=int,
        help="Buy at most this many rejestr.io calls today, counting what the "
        "crawl bucket already holds from today, and ask nothing. Default: no "
        "cap, and a question before the bill and before each call.",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=0.2,
        help="Seconds after each call bought. Default: %(default)s.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Rebuild the queue and print the bill; buy nothing.",
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Neither restore pipeline outputs from the shared cache nor upload "
        "them there, as `koryta --no-backup`. The run summary is written "
        "either way.",
    )
    return parser


def build_queue(
    scope: str, unattended: bool
) -> tuple[Context, list[RejestrIOQuery], set[str]]:
    """The queue rebuilt, cut to `scope`, and the companies the public owns."""
    refresh = set(REFRESH_PIPELINES)
    if scope == plan.SCOPE_FALLBACK:
        # The fold of the odpis job's record: nothing it depends on changes
        # when tonight's attempts are added to it.
        refresh.add("KrsOdpisAttempts")
    # Unattended is the night, which rebuilds PeopleMerged right after this.
    # The copy on disk names the people somebody marked interesting as well,
    # without the ~10 GB a rebuild costs.
    pinned = set(PINNED) if unattended else set()
    ctx, _ = setup_context(policy=ProcessPolicy(refresh, exclude_refresh=pinned))
    pipeline = ScrapeRejestrIO()
    queries = list(pipeline.read_or_process_list(ctx))
    # The register's own public verdicts count too: a company found that way
    # is not in `CompaniesKRS` until its odpis has been crawled.
    public = public_krs_ids(pipeline.companies.read_or_process(ctx)) | {
        krs.id for krs in pipeline.owned_per_the_register(ctx)
    }
    if scope == plan.SCOPE_FALLBACK:
        failed = failed_odpis(KrsOdpisAttempts().read_or_process(ctx))
        print(f"Companies the free odpis failed for: {len(failed)}")
        queries = plan.fallback(queries, failed)
    return ctx, queries, public


def rejestr_names(ctx: Context) -> Iterable[str]:
    """The names of every rejestr.io answer in the crawl bucket. The queue's
    tree has just listed them, and the client keeps the listing."""
    for ref in ctx.io.list_files(CloudStorage(prefix=REJESTR_IO)):
        yield getattr(ref, "url", "").removeprefix(f"gs://{CRAWLED_BUCKET}/")


def note_error(summary: RunSummary, text: str) -> None:
    """Keep an error for the summary - enough of them to tell one cause from
    several."""
    if len(summary.errors) < ERRORS_KEPT:
        summary.errors.append(text[:500])


def buy(
    ctx: Context,
    urls: Sequence[str],
    client: typing.Any,
    summary: RunSummary,
    status: JobRun,
    sleep_time: float,
    should_stop: Callable[[], str] = lambda: "",
    store: Callable[..., bool] | None = None,
) -> None:
    """Ask rejestr.io for each url in turn, counting into `summary`."""
    store = store or upload_result
    in_a_row = 0
    for done, url in enumerate(urls, 1):
        if reason := should_stop():
            summary.stopped = reason
            break
        try:
            result = client.get_rejestr_io(url)
        except RejestrRefused as refused:
            # The account, not this url: every call after would go the same way.
            print(f"Stopping: {refused}")
            summary.refused = True
            summary.stopped = str(refused)[:200]
            note_error(summary, f"{url}: {refused}")
            break
        # One call is not the run: counted, kept, and asked again next time.
        except Exception as problem:  # noqa: BLE001
            print(f"Failed: {url}: {problem!r}")
            summary.failed += 1
            note_error(summary, f"{url}: {problem}")
            in_a_row += 1
        else:
            in_a_row = 0
            # None when rejestr.io did not answer or holds nothing under the
            # id, {} when the per-call prompt was declined: neither was bought.
            if not result:
                print(f"Skipping {url}")
                summary.skipped += 1
            else:
                # Once more if the upload fails: an answer not stored is
                # bought again by the next run.
                if not (store(ctx, url, result) or store(ctx, url, result)):
                    summary.upload_failed += 1
                    note_error(summary, f"{url}: bought, not stored")
                summary.bought += 1
                summary.pln = summary.bought * PLN_PER_CALL
        status.progress(done, counters=summary.counters())
        if in_a_row >= MAX_CONSECUTIVE_FAILURES:
            summary.stopped = f"{in_a_row} {REFUSING}"
            break
        sleep(sleep_time)


def run(
    ctx: Context,
    queries: Sequence[RejestrIOQuery],
    client: typing.Any,
    summary: RunSummary,
    sleep_time: float,
    status: JobRun | None = None,
) -> int:
    """Buy every paid call of `queries`, reporting as it goes."""
    urls = [url for query in queries for url in query.urls() if "rejestr.io" in url]
    # Under the summary's id, so the page's run and the summary in the shared
    # cache are found from each other.
    status = status or JobRun(JOB, run_id=summary.run, unit=UNIT, total=len(urls))
    status.progress(counters=summary.counters())  # Kept for the start to write.
    signalled = False

    def on_sigterm(signum, frame):
        nonlocal signalled
        signalled = True
        print("SIGTERM: stopping after the call in hand")

    previous = signal.signal(signal.SIGTERM, on_sigterm)
    status.start()
    try:
        buy(
            ctx,
            urls,
            client,
            summary,
            status,
            sleep_time,
            lambda: "SIGTERM" if signalled else "",
        )
    except BaseException as problem:
        # Ctrl+C is somebody stopping a hand run, not the job breaking: what is
        # left is bought next time, as after the cap.
        interrupted = isinstance(problem, KeyboardInterrupt)
        summary.stopped = (
            "przerwany" if interrupted else f"raised {type(problem).__name__}"
        )
        summary.exit_code = EXIT_INTERRUPTED if interrupted else EXIT_FAILED
        if not interrupted:
            summary.errors.insert(0, repr(problem)[:500])
        path = write_summary(summary)
        status.finish(
            "partial" if interrupted else "failed",
            stop_reason=summary.stopped,
            errors=summary.errors[:ERRORS_KEPT],
            exit_code=summary.exit_code,
            counters=summary.counters(),
            summary_path=path or None,
        )
        raise
    finally:
        signal.signal(signal.SIGTERM, previous)
    summary.exit_code = summary.code()
    path = write_summary(summary)
    status.finish(
        summary.state(),
        stop_reason=summary.stopped or None,
        errors=summary.errors[:ERRORS_KEPT],
        exit_code=summary.exit_code,
        counters=summary.counters(),
        done=summary.bought + summary.skipped + summary.failed,
        summary_path=path or None,
    )
    print(summary.line())
    return summary.exit_code


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
        # What was bought is in the crawl bucket either way.
        print(f"Could not write the run summary {name}: {e}")
        return ""
    print(f"Summary: {url}")
    return url


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if args.no_backup:
        os.environ["DISABLE_BACKUP"] = "1"
    # Pipelines read sys.argv themselves - PeoplePKW takes --limit, and anything
    # argparse abbreviates to it - so the job's own flags must not reach them.
    sys.argv = sys.argv[:1]
    unattended = args.max_calls is not None
    if unattended and args.max_calls < 0:
        print("--max-calls cannot be negative")
        return EXIT_FAILED

    client: typing.Any = None
    if unattended and not args.dry_run:
        # Before the queue, which takes minutes: a run that cannot buy should
        # say so at once.
        try:
            client = UnattendedRejestr()
        except RuntimeError as missing:
            print(missing)
            return EXIT_FAILED

    ctx, queries, public = build_queue(args.scope, unattended)
    # What the bill is made of, not just what it comes to. Every query carries
    # the reason it exists, and the reasons are not worth the same money: a
    # refresh re-buys a company we already hold, a person feed is one name, and
    # a newly discovered public company is the thing the site is for.
    print(cost_breakdown(queries, public))
    ordered = plan.order(plan.paid(queries), public)
    summary = RunSummary(
        run=uuid7str(), started=now(), scope=args.scope, max_calls=args.max_calls
    )
    if unattended:
        summary.bought_before = plan.bought_today(rejestr_names(ctx), today())
        allowance = max(0, args.max_calls - summary.bought_before)
        chosen, left = plan.within(ordered, allowance)
        print(
            f"Bought from rejestr.io today already: {summary.bought_before} of "
            f"the {args.max_calls}-call cap. This run buys {plan.calls(chosen)} "
            f"calls ({plan.calls(chosen) * PLN_PER_CALL:.2f} PLN) and leaves "
            f"{plan.calls(left)} for the next day."
        )
    else:
        chosen, left = ordered, []
        print(f"Will cost: {plan.calls(chosen) * PLN_PER_CALL:.2f} PLN")
    summary.planned, summary.deferred = plan.calls(chosen), plan.calls(left)
    if args.dry_run:
        return 0
    if not unattended:
        # Past this, a run: a bill declined is not one.
        input("Press enter to continue...")
        client = Rejestr()
    return run(ctx, chosen, client, summary, args.interval)


def scrape_krs_paid(sleep_time: float = 0.2) -> int:
    """The second phase of `koryta_scrape_krs`: the whole queue, by hand."""
    return main(["--interval", str(sleep_time)])
