"""Keep the people on koryta.pl current: build their payloads and upload them, daily.

`PeoplePayloads` works out what the site should say about everybody it already
has a page for, from the newest crawl and the morning's export, and keeps the
people whose page that would change. This sends those to `/api/ingest/person`,
as

    koryta PeoplePayloads --all --on-koryta --only-changed |
        koryta_uploader --type person --submit --endpoint https://autopush.koryta.pl

does - but in one process, unattended, and with guardrails a pipe has not got:

    koryta_people_import                   # daily on Cloud Run, jobs/CLOUD_RUN.md
    koryta_people_import --dry-run         # build and count them; send nothing
    koryta_people_import --scope not-on-koryta --max-new 50
    koryta_people_import --scope priority --max-uploads 100   # the nightly VM
    koryta_people_import --request <run id>   # what a page's button asked for

`--request` is a run the datascience group asked for from a company's or a
person's page on the site (`stores.job_requests`): the company's people, or the
person, built as the other scopes build them and kept to the same guards
(`analysis.payloads.target`). It reports as `people_request`, under the id of
the run the site queued, so the link the site handed out follows it to its end.
A company's run creates pages for the company's people the site lacks, and
only those; a person's run creates none.

`--scope priority` builds both halves at once and sends, up to the cap, the
new hires the site lacks first, then the published pages that would change,
then the rest, newest news first in each (`analysis.payloads.priority`). It
leaves alone a payload it already sent unchanged in the last `--resend-after`
days: an update a reviewer has not yet approved, or a party a human took off a
page, still reads as a change against the export, and sent every night it
would take a slot each night and undo the human each time.

A run builds the payloads (phase "paczki"), writes them to the shared cache as
one write-once part - `jobs/people_import/payloads/date=<day>/<run>.jsonl.gz`,
so that what any day sent can be read back without diffing two exports, which
is what the audit of the 2026-09-12 upload had to do - and then sends them one
by one ("wysyłanie"), at the uploader's pace.

It stops itself as failed on the two things that mean the site is not taking
what it should:

- more pages created than `--max-new` allows, which is none unless asked. A
  person an `--on-koryta` run creates is somebody the identity lookup missed,
  a second page for somebody already there: that is how 105 namesake pages
  appeared on 2026-09-12, and the run stops at the first rather than at the
  hundred and fifth;
- `MAX_REFUSED_IN_A_ROW` requests in a row refused: the site is down, or will
  not take this account.

And as partial - the rest is the next day's, since `--only-changed` still finds
it changed - at `--max-uploads`, at `--max-minutes`, on SIGTERM once the person
in hand is done, and on Ctrl+C.

Exit codes: 0 when everything planned was sent and taken; 75 when something is
left for the next run (a limit, the deadline, SIGTERM, Ctrl+C, a few refused
people); 1 for a crash or a guardrail stop. Each run writes a summary to
gs://koryta-pl-sharedcache/jobs/people_import/runs/ and reports how it is going
to koryta.pl/admin/procesy (`stores.job_runs`) - a dry run too, so that a trial
week shows there what each day would have sent.

It signs in as `stores.koryta_login` decides; in production through
`KORYTA_PIPELINE_UID`, so the revisions it files count as a robot's.
"""

import argparse
import gzip
import hashlib
import json
import os
import signal
import sys
import time
import typing
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta

from tqdm import tqdm
from uuid_extensions import uuid7str  # type: ignore

from analysis.payloads.priority import NEW_HIRE, TIERS
from analysis.payloads.target import NEW, PageTarget
from jobs.people_import.payloads import (
    PRIORITY,
    REQUEST,
    SCOPES,
    Candidate,
    build_payloads,
    build_priority,
    build_targeted,
    pipeline_names,
)
from scrapers.koryta.created import SENT_LOG
from scrapers.stores import ProcessPolicy
from stores.config import pesel_salt
from stores.job_requests import PEOPLE_REQUEST, Request, read_request
from stores.job_runs import ERROR_CHARS, ERRORS_KEPT, FinalState, JobRun
from stores.koryta_login import TokenSource, token_source
from stores.storage import SHARED_BUCKET, Client, warsaw_tz
from uploader import (
    PERSON_COUNTERS,
    Args,
    PersonResult,
    PersonUploader,
    failure_reason,
    one_line,
    run_state,
)

JOB = "people_import"
UNIT = "osób"

PAYLOADS_PREFIX = "jobs/people_import/payloads/"
RUNS_PREFIX = "jobs/people_import/runs/"
#: What each priority run took - person, payload hash, outcome, page - as one
#: write-once part, so the next runs can leave alone what is already sent, and
#: the scoring models can rate the pages a run created before the next export
#: has them (`scrapers.koryta.created`, which owns the name).
SENT_PREFIX = SENT_LOG.prefix

#: Where submit_people.sh uploads for production.
DEFAULT_ENDPOINT = "https://autopush.koryta.pl"

#: Refusals in a row after which the site is taken to be down, or refusing
#: this account, and the run stops rather than counting the rest as failed.
MAX_REFUSED_IN_A_ROW = 20

#: EX_TEMPFAIL: what is left is the next run's.
EXIT_TRY_LATER = 75
EXIT_FAILED = 1

# What /admin/procesy shows, in the page's language.
PHASE_BUILD = "paczki"
PHASE_SEND = "wysyłanie"
STOP_LIMIT = "limit"
STOP_DEADLINE = "koniec czasu"
STOP_SIGTERM = "SIGTERM"
STOP_INTERRUPTED = "przerwany"
STOP_DRY_RUN = "próba - nic nie wysłano"
STOP_NOT_WRITTEN = "nie zapisano paczek"
STOP_UP_TO_DATE = "nic do wysłania - strona ma już te dane"

#: The tiers whose people the run is meant to create pages for. A page
#: created for anybody else is the identity lookup missing somebody.
CREATING = (NEW_HIRE, NEW)

#: Rebuilt on every run, whatever is on disk or in the shared cache, so that
#: the payloads are made from the newest crawl and this morning's export.
#:
#: The sources, each read afresh: `PeopleKRS` (rejestr.io - the newest crawl
#: of every company), `KrsOdpisSeats` and `KrsOdpisEntries` (the odpisy pełne
#: `krs_odpis` fetches), `CompaniesKRS` (api-krs, which the nightly free scrape
#: writes, and rejestr.io's companies) and `KorytaPeople` (who is on the site).
#:
#: And everything between them and the payloads, named rather than left to
#: follow: an output missing on disk is restored from the newest backup in the
#: shared cache without a look at its sources ("missing output" in
#: `ProcessPolicy`), and a Cloud Run execution starts on an empty disk. Naming
#: the roots alone would restore `PeopleEnriched` from whoever uploaded it last
#: and read none of them.
#:
#: `KorytaPeople` is named after the day, which does not make a backup under
#: today's name today's export: a run before the 04:00 export builds it from the
#: one before and uploads it under today's name.
#:
#: Left to be reused: Wikipedia (`ProcessWiki`), PKW (`PeoplePKW`) and the name
#: frequencies, which change with a dump or an election, not overnight. Out of
#: reach: the export `--on-koryta` and `--only-changed` compare against
#: (`KorytaNodes`, `KorytaEdges`) is read outside this tree, so a backup made
#: under today's name before the export is taken as it is - which only a hand
#: run between midnight and four makes.
DEFAULT_REFRESH = (
    "PeopleKRS",
    "KrsOdpisSeats",
    "KrsOdpisEntries",
    "CompaniesKRS",
    "KorytaPeople",
    "PeopleKRSCombined",
    "PeopleKRSMerged",
    "PeopleKorytaMerged",
    "PeopleMerged",
    "PeopleEnriched",
)

#: Fingerprinted with the PESEL key, so only a machine holding it can rebuild
#: them; any other can restore them.
SEATS = "KrsOdpisSeats"

#: The answers that mean the site has the payload, whatever it did with it.
TAKEN = ("created", "updated", "unchanged")

#: `--refresh none`: rebuild nothing, take every output on disk as it is.
REFRESH_NONE = "none"


def now() -> str:
    return datetime.now(warsaw_tz).isoformat(timespec="seconds")


def plural(n: int, one: str, few: str, many: str) -> str:
    """The form of a Polish noun after the number `n`: 1 stronę, 3 strony, 5 stron."""
    if n == 1:
        return one
    if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14):
        return few
    return many


@dataclass
class RunSummary:
    """What one run did, kept in the shared cache next to what it sent."""

    run: str
    started: str
    finished: str = ""
    scope: str = ""
    endpoint: str = ""
    #: Payloads built: the people whose page this run would change.
    planned: int = 0
    counters: dict[str, int] = field(default_factory=dict)
    state: str = ""
    #: Why the run ended before the payloads did, if it did.
    stopped: str = ""
    errors: list[str] = field(default_factory=list)
    exit_code: int | None = None
    #: The gs:// path of what this run sent.
    payloads: str = ""
    #: Pages the run created, as "<name> (<node id>)". An --on-koryta run
    #: should have none, and the first is one too many (`--max-new`).
    created: list[str] = field(default_factory=list)
    #: A priority run: how many of the planned are in each tier.
    tiers: dict[str, int] = field(default_factory=dict)
    #: A priority run: payloads left out as sent unchanged within --resend-after.
    already_sent: int = 0
    #: A priority run: the gs:// path of what it took (`SENT_PREFIX`).
    sent: str = ""
    #: A run asked for on a page: which page, and what of its people it left.
    target: str = ""
    matched: int = 0
    up_to_date: int = 0
    left_out: int = 0


@dataclass
class Ending:
    """Where sending stopped."""

    #: Payloads gone through, skipped ones included.
    done: int = 0
    stopped: str = ""
    #: Stopped by a guardrail, which makes the run a failure whatever else
    #: happened in it.
    guarded: bool = False


def stop_rule(
    deadline: float | None,
    signalled: Callable[[], bool],
    clock: Callable[[], float] | None = None,
) -> Callable[[], str]:
    """Why the run should stop before the next person, or "" to carry on.

    `deadline` is on `clock`, `time.monotonic` unless another is given.
    """
    tick = clock or time.monotonic

    def should_stop() -> str:
        if signalled():
            return STOP_SIGTERM
        if deadline is not None and tick() >= deadline:
            return STOP_DEADLINE
        return ""

    return should_stop


def guardrail(created: int, refused_in_a_row: int, max_new: int) -> str:
    """Why the run has to stop now, as failed, or "" to carry on."""
    if created > max_new:
        pages = plural(created, "stronę", "strony", "stron")
        return f"utworzył {created} {pages}, a wolno {max_new} (--max-new)"
    if refused_in_a_row >= MAX_REFUSED_IN_A_ROW:
        return f"{refused_in_a_row} żądań z rzędu odrzuconych"
    return ""


def judge(ending: Ending, counts: Mapping[str, int]) -> tuple[FinalState, str, int]:
    """The state the page shows, why the run stopped, and the exit code.

    A guardrail fails the run, and so does every person sent being refused.
    Anything else that leaves people unsent is partial: a stop asked for - a
    limit, the deadline, a signal - or a few refusals, which the next run sends
    again.
    """
    if ending.guarded:
        return "failed", ending.stopped, EXIT_FAILED
    attempted = ending.done - counts.get("skipped", 0)
    failed = counts.get("failed", 0)
    refused = failure_reason(attempted, failed) or ""
    if run_state(attempted, failed) == "failed":
        return "failed", refused, EXIT_FAILED
    if ending.stopped:
        return "partial", ending.stopped, EXIT_TRY_LATER
    if failed:
        return "partial", refused, EXIT_TRY_LATER
    return "succeeded", "", 0


def refresh_policy(asked: Sequence[str] | None) -> ProcessPolicy:
    """What the payloads are built under: `DEFAULT_REFRESH`, or the pipelines
    --refresh names in its place, less any `:Name`, which is held as it is.
    `none` rebuilds nothing: what is on disk is taken as it is - the nightly's
    reprocess has rebuilt all of it minutes before."""
    named = {name for name in asked or () if not name.startswith(":")}
    held = {name[1:] for name in asked or () if name.startswith(":")}
    refresh = named or set(DEFAULT_REFRESH)
    if REFRESH_NONE in refresh:
        refresh = set()
    rebuilt = SEATS in refresh or "all" in refresh
    if rebuilt and SEATS not in held and not pesel_salt():
        # Rebuilt without the key, the seats fail and `PeopleKRSCombined` falls
        # back on rejestr.io alone, so every company whose odpis is the newer
        # source would be sent with its older posts. Restored, they are the
        # last keyed machine's, missing only the PDFs fetched since.
        print(
            "No PESEL key (KORYTA_PESEL_SALT): restoring the odpis seats "
            "rather than rebuilding them"
        )
        held.add(SEATS)
    return ProcessPolicy(refresh - held, exclude_refresh=held)


def person_key(payload: Mapping[str, typing.Any]) -> str:
    """Who a payload is about, as steadily as the payload can say: the
    register link, else the page it names, else the name."""
    for key in ("rejestrIo", "korytaId", "name"):
        if payload.get(key):
            return str(payload[key])
    return ""


def payload_hash(payload: Mapping[str, typing.Any]) -> str:
    """The payload's content, so an unchanged one is recognised next time."""
    text = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def sent_recently(client: "Client", since: str) -> set[tuple[str, str]]:
    """(person, payload hash) of everything a priority run took on `since`
    (YYYY-MM-DD) or later, read from its `SENT_PREFIX` parts."""
    bucket = client.storage_client.bucket(SHARED_BUCKET)
    seen: set[tuple[str, str]] = set()
    for blob in bucket.list_blobs(
        prefix=SENT_PREFIX, start_offset=f"{SENT_PREFIX}date={since}"
    ):
        for line in (
            gzip.decompress(blob.download_as_bytes()).decode("utf-8").splitlines()
        ):
            if line.strip():
                row = json.loads(line)
                seen.add((row["person"], row["payload"]))
    return seen


def plan_priority(
    candidates: Sequence[Candidate], already_sent: set[tuple[str, str]], max_new: int
) -> tuple[list[Candidate], int]:
    """What a priority run sends, in order, and how many it left out as sent.

    Out: a payload already taken unchanged (`already_sent`), and the new hires
    past `max_new` - so a night with more of them than it may create still
    gets to the pages after them.
    """
    planned: list[Candidate] = []
    skipped = hires = 0
    for candidate in candidates:
        if (
            person_key(candidate.payload),
            payload_hash(candidate.payload),
        ) in already_sent:
            skipped += 1
            continue
        if candidate.tier == NEW_HIRE:
            if hires >= max_new:
                continue
            hires += 1
        planned.append(candidate)
    return planned, skipped


def sign_in(endpoint: str) -> TokenSource:
    """How the run signs in, tried before anything is built: a key or a grant
    that is missing is better found in a second than after an hour of
    pipelines. A person at the keyboard is asked when the first upload is."""
    tokens = token_source(endpoint)
    print(f"Signing in to {endpoint} as {tokens.who}")
    if not tokens.interactive:
        tokens.token()
    return tokens


def make_uploader(endpoint: str, tokens: TokenSource) -> PersonUploader:
    """The uploader `koryta_uploader --type person --submit` would be."""
    args = argparse.Namespace(
        endpoint=endpoint,
        type="person",
        submit=True,
        database="koryta-pl",
        limit=None,
        offset=0,
        model=None,
    )
    # A company a person names and the site has no page for is looked up in
    # `Companies`, rebuilt from the `CompaniesKRS` this run has just read.
    # Restored instead, a fresh container takes whichever copy was uploaded
    # last, which may predate the very company.
    return PersonUploader(
        typing.cast(Args, args),
        tokens=tokens,
        companies_policy=ProcessPolicy({"Companies"}),
    )


def send_one(uploader: PersonUploader, payload: object) -> PersonResult | None:
    """Upload one payload, counted as `koryta_uploader` counts it; None for
    one it skips too, which is neither an answer nor a refusal."""
    if not isinstance(payload, dict) or not payload.get("name"):
        uploader.counts["skipped"] += 1
        return None
    result = uploader.upload_person(payload)
    uploader.count_person(str(payload["name"]), result)
    return result


class PeopleImport:
    """One run: what it was asked to do, how far it got, and where it says so."""

    def __init__(
        self, args: argparse.Namespace, should_stop: Callable[[], str] = lambda: ""
    ):
        self.args = args
        self.should_stop = should_stop
        asked: str | None = getattr(args, "request", None)
        self.summary = RunSummary(
            run=asked or uuid7str(),
            started=now(),
            scope=args.scope,
            endpoint=args.endpoint,
        )
        # Under the summary's id, so the page's run and what the run left in
        # the shared cache are found from each other. A run asked for on the
        # site goes on in the document the site queued, which holds the
        # request and is the one its link names.
        self.status = (
            JobRun(
                PEOPLE_REQUEST, run_id=asked, trigger="request", adopt=True, unit=UNIT
            )
            if asked
            else JobRun(JOB, run_id=self.summary.run, unit=UNIT)
        )
        self.uploader: PersonUploader | None = None
        self.ending = Ending()
        self._client: Client | None = None
        #: A priority run, or one asked for: each payload's tier, in sending order.
        self.tiers: list[str] | None = None
        #: A priority run, or one asked for: what the site took - payload,
        #: tier, outcome, and the page it filed the person under.
        self.taken: list[tuple[dict, str, str, str | None]] = []
        #: A run asked for on a page: what was asked, once read.
        self.request: Request | None = None
        #: ...and what of the page's people it found and left, for the page.
        self.request_counts: dict[str, int] = {}

    @property
    def dry(self) -> bool:
        """Sends nothing: --dry-run, or a request for a count alone."""
        return bool(self.args.dry_run or (self.request and self.request.dry_run))

    def run(self) -> int:
        self.status.start(phase=PHASE_BUILD)
        try:
            return self.attempt()
        except KeyboardInterrupt:
            # Ctrl+C is someone stopping a hand run, not the job breaking. One
            # while the payloads are sent is caught there, with what was sent.
            print("Interrupted")
            self.summary.stopped = STOP_INTERRUPTED
            return self.end("partial", EXIT_TRY_LATER)
        except Exception as e:
            self.summary.stopped = f"wyjątek {type(e).__name__}"
            self.end("failed", EXIT_FAILED, crash=repr(e)[:ERROR_CHARS])
            raise

    def attempt(self) -> int:
        args = self.args
        if args.request:
            self.request = read_request(args.request)
            self.summary.target = self.request.describe()
            print(f"Asked for on the site: {self.summary.target}")
        tokens = None if self.dry else sign_in(args.endpoint)
        if self.request is not None:
            payloads = self.plan_request(self.request)
        elif args.scope == PRIORITY:
            payloads = self.plan()
        else:
            payloads = build_payloads(
                args.scope, args.koryta_date, refresh_policy(args.refresh)
            )
        self.summary.planned = len(payloads)
        self.status.progress(
            0,
            total=len(payloads),
            counters=(
                {"planned": len(payloads), **self.request_counts}
                if self.dry
                else self.counters()
            ),
            force=True,
        )
        if tokens is None:  # A dry run, which signed in to nothing.
            return self.dry_run(payloads)
        if self.request is not None and not payloads:
            # Nothing the page lacks. Said, rather than left as a success with
            # no reason, which on the page reads as a run that did nothing.
            self.summary.stopped = self.summary.stopped or STOP_UP_TO_DATE
            return self.end("succeeded", 0)
        if payloads:
            try:
                self.summary.payloads = self.write_payloads(payloads)
            except Exception as e:
                # The part is the record of what a day sent. A run that cannot
                # leave one sends nothing, rather than what nobody could audit.
                print(f"Could not write the payloads: {e}")
                self.summary.errors.append(one_line(e))
                self.summary.stopped = STOP_NOT_WRITTEN
                return self.end("failed", EXIT_FAILED)
        self.uploader = make_uploader(args.endpoint, tokens)
        self.status.progress(phase=PHASE_SEND, force=True)
        self.send(payloads, self.uploader)
        self.uploader.report()
        state, self.summary.stopped, code = judge(self.ending, self.uploader.counts)
        print(
            f"Sent {self.ending.done:,} of {len(payloads):,} people: "
            f"{dict(self.uploader.counts)}"
            + (f"; stopped: {self.summary.stopped}" if self.summary.stopped else "")
        )
        return self.end(state, code)

    def plan(self) -> list[dict]:
        """A priority run's payloads, in sending order: built, the already sent
        left out, the new hires cut at --max-new."""
        args = self.args
        today = datetime.now(warsaw_tz).date()
        candidates = build_priority(
            args.koryta_date, refresh_policy(args.refresh), today, args.recent_days
        )
        already: set[tuple[str, str]] = set()
        if args.resend_after:
            since = (today - timedelta(days=args.resend_after)).isoformat()
            already = sent_recently(self.client(), since)
        planned, self.summary.already_sent = plan_priority(
            candidates, already, args.max_new
        )
        self.tiers = [candidate.tier for candidate in planned]
        counts = Counter(self.tiers)
        self.summary.tiers = {tier: counts.get(tier, 0) for tier in TIERS}
        print(
            f"Planned by tier: {self.summary.tiers}; left out as sent unchanged "
            f"in the last {args.resend_after} days: {self.summary.already_sent}"
        )
        return [candidate.payload for candidate in planned]

    def plan_request(self, request: Request) -> list[dict]:
        """A page's people, in sending order: the pages that would change,
        then the people the site lacks - a company's, never a person's."""
        target = PageTarget(
            kind=request.target,
            node_id=request.node_id,
            name=request.name,
            krs=request.krs,
            register=request.register_number,
        )
        candidates, targeted = build_targeted(
            target, self.args.koryta_date, refresh_policy(self.args.refresh)
        )
        self.tiers = [candidate.tier for candidate in candidates]
        # The people it was asked to add are exactly the pages it may create;
        # one more is somebody whose page the export has and the ingest missed.
        self.args.max_new = len(targeted.new)
        summary = self.summary
        summary.matched = targeted.matched
        summary.up_to_date = targeted.up_to_date
        summary.left_out = targeted.left_out
        summary.tiers = dict(Counter(self.tiers))
        self.request_counts = {
            "matched": targeted.matched,
            "to_change": len(targeted.changed),
            "to_create": len(targeted.new),
            "up_to_date": targeted.up_to_date,
            "left_out": targeted.left_out,
        }
        if targeted.reason:
            summary.stopped = targeted.reason
        print(
            f"Planned for {request.describe()}: {len(targeted.changed)} to change, "
            f"{len(targeted.new)} to create; {targeted.up_to_date} up to date, "
            f"{targeted.left_out} left out"
        )
        return [candidate.payload for candidate in candidates]

    def dry_run(self, payloads: list[dict]) -> int:
        names = ", ".join(str(payload.get("name")) for payload in payloads[:3])
        more = ", ..." if len(payloads) > 3 else ""
        print(
            f"Dry run: {len(payloads):,} people would be sent to "
            f"{self.args.endpoint}" + (f": {names}{more}" if payloads else "")
        )
        if self.tiers is not None and self.request is None:
            sent = min(len(payloads), self.args.max_uploads)
            first = Counter(self.tiers[:sent])
            print(
                f"The first {sent} (--max-uploads) by tier: "
                f"{ {tier: first.get(tier, 0) for tier in TIERS} }"
            )
        reason = STOP_DRY_RUN
        if self.request is not None and self.summary.stopped:
            reason = f"{STOP_DRY_RUN}; {self.summary.stopped}"
        self.status.finish(
            "succeeded",
            stop_reason=reason,
            counters={"planned": len(payloads), **self.request_counts},
            exit_code=0,
            done=0,
        )
        return 0

    def send(self, payloads: list[dict], uploader: PersonUploader) -> Ending:
        """Upload each payload in turn, until they run out or something says
        stop. Ctrl+C included: what was sent is counted either way."""
        args, ending = self.args, self.ending
        refused = 0
        try:
            for n, payload in enumerate(tqdm(payloads, disable=None)):
                if reason := self.should_stop():
                    ending.stopped = reason
                    break
                if n >= args.max_uploads:
                    ending.stopped = STOP_LIMIT
                    break
                result = send_one(uploader, payload)
                if result is not None:
                    refused = refused + 1 if result.outcome == "failed" else 0
                    if result.outcome == "created":
                        page = f"{payload['name']} ({result.person_id})"
                        self.summary.created.append(page)
                ending.done = n + 1
                self.status.progress(ending.done, counters=self.counters())
                if result is not None and self.tiers is not None:
                    tier = self.tiers[n]
                    if result.outcome in TAKEN:
                        self.taken.append(
                            (payload, tier, result.outcome, result.person_id)
                        )
                    if result.outcome == "created" and tier not in CREATING:
                        # Planned onto a page the export has, so a page made
                        # for it is the identity lookup missing somebody.
                        reason = (
                            f"utworzył stronę dla osoby, która już ma stronę: "
                            f"{self.summary.created[-1]}"
                        )
                        print(f"Stopping: {reason}")
                        ending.stopped, ending.guarded = reason, True
                        self.summary.errors.append(
                            f"utworzona strona: {self.summary.created[-1]}"
                        )
                        break
                if reason := guardrail(
                    uploader.counts["created"], refused, args.max_new
                ):
                    print(f"Stopping: {reason}")
                    ending.stopped, ending.guarded = reason, True
                    if uploader.counts["created"] > args.max_new:
                        # Named on the page, where the run is looked at first:
                        # each is a page somebody has to merge or keep.
                        self.summary.errors += [
                            f"utworzona strona: {page}" for page in self.summary.created
                        ]
                    break
                time.sleep(args.interval)
        except KeyboardInterrupt:
            print("Interrupted; stopping after what was sent")
            ending.stopped = STOP_INTERRUPTED
        return ending

    def counters(self) -> dict[str, int]:
        sent = (
            dict(self.uploader.counts)
            if self.uploader is not None
            else dict.fromkeys(PERSON_COUNTERS, 0)
        )
        return {"planned": self.summary.planned, **self.request_counts, **sent}

    def end(self, state: FinalState, code: int, crash: str | None = None) -> int:
        """Write the run's summary and tell the page how the run ended."""
        summary = self.summary
        if self.taken and not self.dry:
            summary.sent = self.write_sent()
        summary.state = state
        summary.exit_code = code
        summary.counters = self.counters()
        errors = [*summary.errors, *(self.uploader.errors if self.uploader else [])]
        if crash:
            # First: after twenty refusals the list already holds as many
            # errors as the page keeps, and last it would be cut.
            errors = [crash, *errors]
        summary.errors = errors[:ERRORS_KEPT]
        path = "" if self.dry else self.write_summary()
        self.status.finish(
            state,
            stop_reason=summary.stopped or None,
            errors=summary.errors,
            exit_code=code,
            counters=summary.counters,
            done=self.ending.done,
            # "" when the summary could not be written: no link to nothing.
            summary_path=path or None,
        )
        return code

    def client(self) -> Client:
        if self._client is None:
            self._client = Client()
        return self._client

    def write_payloads(self, payloads: list[dict]) -> str:
        """Write what the run is about to send, once, before it sends any."""
        day, run = self.summary.started[:10], self.summary.run
        name = f"{PAYLOADS_PREFIX}date={day}/{run}.jsonl.gz"
        lines = "".join(json.dumps(p, ensure_ascii=False) + "\n" for p in payloads)
        # mtime=0, so the bytes are the payloads' alone and a retried create is
        # recognised as the write that landed (`Client.create_object`).
        data = gzip.compress(lines.encode("utf-8"), mtime=0)
        url = self.client().create_object(SHARED_BUCKET, name, data, "application/gzip")
        print(f"Payloads: {url}")
        return url

    def write_sent(self) -> str:
        """Write what the site took, once, for later runs to leave alone; a
        failure to is printed and kept among the errors, not raised - those
        people are only sent again, and the pages it created are rated after
        the next export rather than tonight."""
        day, run = self.summary.started[:10], self.summary.run
        name = f"{SENT_PREFIX}date={day}/{run}.jsonl.gz"
        lines = "".join(
            json.dumps(
                {
                    "person": person_key(payload),
                    "payload": payload_hash(payload),
                    "name": payload.get("name"),
                    "tier": tier,
                    "outcome": outcome,
                    "node": node,
                    "rejestrIo": payload.get("rejestrIo"),
                },
                ensure_ascii=False,
            )
            + "\n"
            for payload, tier, outcome, node in self.taken
        )
        data = gzip.compress(lines.encode("utf-8"), mtime=0)
        try:
            url = self.client().create_object(
                SHARED_BUCKET, name, data, "application/gzip"
            )
        except Exception as e:
            print(f"Could not write what was sent {name}: {e}")
            self.summary.errors.append(f"nie zapisano wysłanych: {one_line(e)}")
            return ""
        print(f"Sent: {url}")
        return url

    def write_summary(self) -> str:
        """Write the run's summary once; a failure to is printed, not raised."""
        summary = self.summary
        summary.finished = now()
        name = f"{RUNS_PREFIX}date={summary.started[:10]}/{summary.run}.json"
        data = json.dumps(asdict(summary), ensure_ascii=False, indent=1)
        try:
            url = self.client().create_object(
                SHARED_BUCKET, name, data.encode("utf-8"), "application/json"
            )
        except Exception as e:
            # What the run sent is on the site, and its payloads in the cache.
            print(f"Could not write the run summary {name}: {e}")
            return ""
        print(f"Summary: {url}")
        return url


def non_negative_int(text: str) -> int:
    value = int(text)
    if value < 0:
        raise ValueError(text)
    return value


def non_negative_float(text: str) -> float:
    value = float(text)
    if value < 0:
        raise ValueError(text)
    return value


def iso_day(text: str) -> str:
    return date.fromisoformat(text).isoformat()


def parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="koryta_people_import",
        description=(__doc__ or "").split("\n")[0],
        allow_abbrev=False,
    )
    parser.add_argument(
        "--scope",
        choices=SCOPES,
        default="on-koryta",
        help="on-koryta, the default, refreshes the pages the site has; "
        "not-on-koryta adds the people it has not, and needs --max-new; "
        "priority sends new hires first, then published pages, then the rest "
        "(analysis.payloads.priority).",
    )
    parser.add_argument(
        "--request",
        metavar="RUN_ID",
        help="Do what the site was asked on a page: the company's people, or "
        "the person, of the queued run RUN_ID (koryta_job_requests starts "
        "these). In place of --scope; the run may create pages only for the "
        "company's people the site lacks.",
    )
    parser.add_argument(
        "--recent-days",
        type=non_negative_int,
        default=30,
        help="Priority: a new hire is somebody without a page whose public post "
        "began within this many days and has not ended. Default: %(default)s.",
    )
    parser.add_argument(
        "--resend-after",
        type=non_negative_int,
        default=30,
        help="Priority: leave alone a payload already sent unchanged within this "
        "many days. 0: send it again every run. Default: %(default)s.",
    )
    parser.add_argument(
        "--max-uploads",
        type=non_negative_int,
        default=3000,
        help="Send the first N payloads and leave the rest to the next run "
        "(partial, 'limit'). Default: %(default)s.",
    )
    parser.add_argument(
        "--max-new",
        type=non_negative_int,
        help="Pages the run may create before it stops as failed. Default 0: "
        "an --on-koryta run that creates a page has missed somebody's identity. "
        "With --scope priority: the most new hires a run sends, default "
        "--max-uploads; a page made for anybody else stops it as failed.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build the payloads and report how many; send nothing and write "
        "nothing of the job's own - rebuilt pipelines still go to the shared "
        "cache unless --no-backup.",
    )
    parser.add_argument(
        "--endpoint", default=DEFAULT_ENDPOINT, help="Default: %(default)s."
    )
    parser.add_argument(
        "--koryta-date",
        type=iso_day,
        help="The export (YYYY-MM-DD) --on-koryta and --only-changed compare "
        "against. Default: the latest - in the night, the 04:00 one.",
    )
    parser.add_argument(
        "--refresh",
        action="append",
        metavar="NAME",
        help="A pipeline to rebuild rather than reuse; repeatable, and in place "
        "of the default set (DEFAULT_REFRESH: the newest crawl and export, "
        "and what is built from them). ':NAME' holds one as it is, alone "
        "taking it out of the default set; 'all' rebuilds everything, 'none' "
        "nothing.",
    )
    parser.add_argument(
        "--max-minutes",
        type=non_negative_float,
        default=120,
        help="Stop sending this many minutes after the start, the build "
        "included, and leave the rest to the next run. 0: no limit. "
        "Default: %(default)s.",
    )
    parser.add_argument(
        "--interval",
        type=non_negative_float,
        default=0.3,
        help="Seconds between people - the uploader's pace. Default: %(default)s.",
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Neither restore pipeline outputs from the shared cache nor upload "
        "them there, as `koryta --no-backup`. The payloads and the summary are "
        "written either way.",
    )
    return parser


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parse = parser()
    args = parse.parse_args(argv)
    if args.request:
        # The page decides who: `plan_request` sets --max-new to the people
        # it was asked to add, once it knows them.
        args.scope = REQUEST
    if args.max_new is None:
        args.max_new = args.max_uploads if args.scope == PRIORITY else 0
    if args.scope == "not-on-koryta" and args.max_new <= 0:
        parse.error(
            "--scope not-on-koryta creates a page for everybody it sends; say "
            "how many this run may create with --max-new"
        )
    if args.refresh:
        known = pipeline_names() | {"all", REFRESH_NONE}
        unknown = sorted({name.removeprefix(":") for name in args.refresh} - known)
        if unknown:
            # A misspelt name would refresh nothing, and say nothing about it.
            parse.error(
                f"--refresh {' '.join(unknown)}: not a pipeline the payloads are "
                f"built from. One of: {', '.join(sorted(known))}"
            )
    return args


def main(argv: Sequence[str] | None = None) -> int:
    started = time.monotonic()
    args = parse_args(argv)
    if args.no_backup:
        os.environ["DISABLE_BACKUP"] = "1"
    # Pipelines read sys.argv themselves - PeoplePKW takes --limit, and anything
    # argparse abbreviates to it - so the job's own flags must not reach them.
    # `build_payloads` hands them theirs.
    sys.argv = sys.argv[:1]

    deadline = started + args.max_minutes * 60 if args.max_minutes else None
    signalled = False

    def on_sigterm(signum, frame):
        nonlocal signalled
        signalled = True
        print("SIGTERM: stopping after the person in hand")

    previous = signal.signal(signal.SIGTERM, on_sigterm)
    try:
        return PeopleImport(args, stop_rule(deadline, lambda: signalled)).run()
    finally:
        signal.signal(signal.SIGTERM, previous)
