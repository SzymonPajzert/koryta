"""Keep the companies on koryta.pl current: send what new data changes on them, daily.

`CompaniesPayloads` works out what the site should say about every company it
has a page for - its name, the register's fields, its sectors, whether the
public sector owns it, who owns or founded it, where it is seated - and
`SiteSnapshot` which of those payloads would change the page as the morning's
export has it. This sends those to `/api/ingest/company`, as

    koryta CompaniesPayloads --only-changed --output stdout |
        koryta_uploader --type company --submit --endpoint https://autopush.koryta.pl

does by hand, but in one process, unattended, and holding back what the reader
of every hand upload held back:

    koryta_company_import                    # the night's step `company_updates`
    koryta_company_import --dry-run          # build and count them; send nothing
    koryta_company_import --max-uploads 100  # the first 100, the rest the next run's

Szymon, 2026-11-12: "Can we make uploading the companies part of the nightly as
well, similar to the people upload?" Until then a change to a company the site
already had reached its page only through a hand upload - a public founder
found by hand (`PUBLIC_FOUNDERS`), a public owner the register's history names,
a new sector rule: seven of them from 2026-09-26 to 11-12. The night created
the companies its people named (`koryta_people_import --companies-only`) and
left the rest as they were. On the 2026-11-11 export 663 of the site's 10,674
companies would have changed: the register's legal form and supervisory organ
on about 370, PKD codes on 223, an owner link on 219, sectors on 28, and 9
turned public.

The ingest writes a company's page itself, with no reviewer
(`company.post.ts`), so what goes up at night is what readers see in the
morning. Each hand upload was read first, and held something back; this holds
back the same, and names it on its run for somebody to send by hand:

- a payload that would make a public company private. The register cannot see
  who owns a spółka akcyjna, and a company the pipelines stop recognising as
  public - an odpis that stops answering, a rule that changes - reads as sold.
  `CompaniesPayloads` sends `false` only over an odpis it read
  (`add_is_public`), and on 2026-11-11 none was waiting, so one is worth a
  look; Mazowiecki Regionalny Fundusz Pożyczkowy went private that way on
  2026-10-06, before that guard.
- the companies in `HAND_ONLY`, which every hand upload has left out pending
  the task named beside each.
- a payload for a company the site has no page for under its KRS number - one
  stored without the leading zeros, say. The ingest would create a second page
  for it; `--companies-only` creates the companies that are missing.

And it keeps the name the site shows, sending the rest of the payload, unless
`--max-renames` lets the register's in: of the 3 renames waiting on
2026-11-11, 2 were the pipelines' own slips - "(Łoszczowa)" for Włoszczowa,
and a trade union's name cut at its second quotation mark - and on a published
page a rename is the change readers notice first. A payload that would change
nothing but the name is not sent.

The companies that turn public go first: that is what most of the hand uploads
were for, and a cap (`--max-uploads`) or a deadline that cuts the run short
cuts the rest.

It compares with the export as the people import does, and refuses an export
that is not today's, or not the one the night's export step took (`--export`);
the frames of it on disk not built from it are rebuilt (`stale_frames`).
`Companies` is read as it is, never rebuilt unless `--refresh` names it: on the
VM the reprocess built it minutes before, and elsewhere a missing one is
restored from the newest backup.

It writes what it is about to send to the shared cache first, as one
write-once part - `jobs/company_import/payloads/date=<day>/<run>.jsonl.gz` -
then sends the companies one by one, at the uploader's pace, and writes a
summary of the run beside the night's company creations
(`jobs/company_import/runs/`): each company sent, what it would write and what
the site did with it, each held back and why, each name kept. It reports as
`company_import`, the job `koryta_uploader --type company` reports as, so the
hand uploads and the night's read as one history on /admin/procesy; what it
held back is the run's warnings there.

It stops itself as failed (exit 1) when the site creates a page - a company
the export had and the site no longer finds - and after `MAX_REFUSED_IN_A_ROW`
refusals in a row; as partial (exit 75), leaving the rest to the next run, at
`--max-uploads`, at `--max-minutes`, on SIGTERM once the company in hand is
done, on Ctrl+C, and when the site refused some. 0 when everything planned was
taken.
"""

import argparse
import gzip
import json
import os
import signal
import sys
import time
import typing
from collections import Counter
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass, field

from uuid_extensions import uuid7str  # type: ignore

from analysis.payloads.company import CompaniesPayloads
from analysis.payloads.site import NEW_COMPANY, SiteSnapshot
from conductor import setup_context
from jobs.nightly import export_refusal, latest_export
from jobs.people_import import (
    COMPANIES_PREFIX,
    COMPANY_JOB,
    COMPANY_UNIT,
    DEFAULT_ENDPOINT,
    EXIT_FAILED,
    EXIT_TRY_LATER,
    MAX_REFUSED_IN_A_ROW,
    PHASE_BUILD,
    PHASE_SEND,
    STOP_DRY_RUN,
    STOP_INTERRUPTED,
    STOP_LIMIT,
    STOP_NOT_WRITTEN,
    STOP_UP_TO_DATE,
    Ending,
    export_stamp,
    iso_day,
    judge,
    non_negative_float,
    non_negative_int,
    now,
    sign_in,
    stale_frames,
    stop_rule,
    warsaw_now,
)
from jobs.people_import.payloads import as_sent
from scrapers.koryta.download import KorytaCompanies, KorytaEdges, KorytaNodes
from scrapers.stores import Pipeline, ProcessPolicy, required_resources
from stores.job_runs import ERROR_CHARS, ERRORS_KEPT, FinalState, JobRun
from stores.koryta_login import TokenSource
from stores.storage import SHARED_BUCKET, Client
from uploader import (
    Args,
    CompanyResult,
    CompanyUploader,
    company_answer,
    one_line,
)

JOB = COMPANY_JOB
UNIT = COMPANY_UNIT
RUNS_PREFIX = COMPANIES_PREFIX
PAYLOADS_PREFIX = "jobs/company_import/payloads/"

#: Read as it is, never rebuilt unless `--refresh` names it (the module's
#: docstring).
COMPANIES = "Companies"

#: The export the payloads are compared with, frame by frame: who has a page
#: (`KorytaCompanies`, which `CompaniesPayloads` builds a payload for) and what
#: each page holds (`SiteSnapshot`).
FRAMES: tuple[Callable[[str | None], Pipeline], ...] = (
    KorytaNodes,
    KorytaEdges,
    KorytaCompanies,
)

#: Companies the night never sends, by KRS number, with the task that decides
#: them. Every hand upload since 2026-10-15 has left these out.
HAND_ONLY: dict[str, str] = {
    # Public only through the KRS column of data.gov.pl's catalogue, among
    # seven NGOs the task found doubtful on 2026-10-14.
    "0000638522": "check-the-catalogue-krs-rule-s-doubtful-public-flags-osp",
}

#: Why a payload was held back, as its run's warnings say it.
TURNS_PRIVATE = "stałaby się prywatna"
NOT_ON_SITE = "brak strony o tym KRS w kopii bazy"

#: What the run counts, each shown on the page even at zero.
COUNTERS = (
    "planned",
    "updated",
    "unchanged",
    "created",
    "failed",
    "held",
    "renames_held",
)


@dataclass(frozen=True)
class Planned:
    """A payload the run sends, and what it would write."""

    payload: dict
    #: As `SiteSnapshot.company_changes` says them.
    reasons: tuple[str, ...]
    #: Makes a private company public.
    turns_public: bool = False


@dataclass
class Plan:
    """What a run sends, in order, and what it holds back."""

    send: list[Planned] = field(default_factory=list)
    #: Each company not sent: its KRS number, name and why.
    held: list[dict] = field(default_factory=list)
    #: Each rename not sent: the KRS number, the site's name, the register's.
    #: Its payload went with the site's name, if it changed anything else.
    names_kept: list[dict] = field(default_factory=list)


def plan_uploads(
    payloads: Iterable[Mapping[str, typing.Any]],
    snapshot: SiteSnapshot,
    max_renames: int = 0,
) -> Plan:
    """What of `payloads` the run sends, in sending order, and what it holds
    back (the module's docstring): the companies that turn public first, the
    rest as they came. Of the renames, the first `max_renames` go as the
    register spells them; the rest go with the site's name, or not at all when
    the name was all they would change."""
    plan = Plan()
    renames = 0
    for given in payloads:
        payload = dict(given)
        reasons = snapshot.company_changes(payload)
        if not reasons:
            continue
        krs = str(payload.get("krs") or "")
        held = {"krs": krs, "name": payload.get("name")}
        if NEW_COMPANY in reasons:
            plan.held.append({**held, "why": NOT_ON_SITE})
            continue
        if krs in HAND_ONLY:
            plan.held.append({**held, "why": f"tylko ręcznie, {HAND_ONLY[krs]}"})
            continue
        turns = snapshot.company_is_public_change(payload)
        if turns is False:
            plan.held.append({**held, "why": TURNS_PRIVATE})
            continue
        rename = snapshot.company_rename(payload)
        if rename is not None:
            if renames < max_renames:
                renames += 1
            else:
                site, register = rename
                plan.names_kept.append({"krs": krs, "site": site, "register": register})
                payload["name"] = site
                reasons = snapshot.company_changes(payload)
                if not reasons:
                    continue
        plan.send.append(Planned(payload, tuple(reasons), turns is True))
    # Stable: the order the payloads came in, within each half.
    plan.send.sort(key=lambda planned: not planned.turns_public)
    return plan


def held_line(held: Mapping[str, typing.Any]) -> str:
    """A company held back, as the run's warnings name it."""
    return f"{held['krs']} {held.get('name') or ''}: {held['why']}"


def kept_line(kept: Mapping[str, typing.Any]) -> str:
    """A rename not sent, as the run's warnings name it."""
    return (
        f"{kept['krs']}: nazwa „{kept['site']}” zostaje, rejestr: „{kept['register']}”"
    )


def build_policy(asked: Sequence[str] | None, rebuild: Iterable[str]) -> ProcessPolicy:
    """What the payloads are built under: nothing rebuilt but the frames of the
    export not built from it (`rebuild`) and the pipelines `--refresh` names,
    and `Companies` held as it is unless named."""
    refresh = set(asked or ()) | set(rebuild)
    return ProcessPolicy(refresh, exclude_refresh={COMPANIES} - refresh)


def build_payloads(
    koryta_date: str, policy: ProcessPolicy
) -> tuple[list[dict], SiteSnapshot]:
    """A payload for every company the site has a page for
    (`CompaniesPayloads.build`), each as the pipe would have carried it
    (`as_sent`), and the export they are compared with.

    `CompaniesPayloads` reads its flags off sys.argv, so sys.argv holds this
    run's, and nothing else, for as long as it runs."""
    saved = sys.argv
    prog = saved[0] if saved else "koryta_company_import"
    sys.argv = [prog, "--koryta-date", koryta_date]
    try:
        ctx, dumper = setup_context(
            required_resources(CompaniesPayloads), policy=policy
        )
        try:
            payloads = Pipeline.create(CompaniesPayloads).build(ctx)
            snapshot = SiteSnapshot.read(ctx, koryta_date)
        finally:
            dumper.dump_pandas()
    finally:
        sys.argv = saved
    return [as_sent(payload) for payload in payloads], snapshot


def pipeline_names() -> set[str]:
    """Every pipeline the payloads are built from - what `--refresh` can reach."""
    names: set[str] = set()
    todo: list[Pipeline] = [Pipeline.create(CompaniesPayloads)]
    todo += [frame(None) for frame in FRAMES]
    while todo:
        pipeline = todo.pop()
        if pipeline.pipeline_name in names:
            continue
        names.add(pipeline.pipeline_name)
        todo.extend(pipeline.dependencies.values())
    return names


def make_uploader(endpoint: str, tokens: TokenSource) -> CompanyUploader:
    """The uploader `koryta_uploader --type company --submit` would be."""
    args = argparse.Namespace(
        endpoint=endpoint,
        type="company",
        submit=True,
        database="koryta-pl",
        limit=None,
        offset=0,
        model=None,
    )
    return CompanyUploader(typing.cast(Args, args), tokens=tokens)


def send_company(
    uploader: CompanyUploader, payload: Mapping[str, typing.Any]
) -> CompanyResult:
    """Upload one company and say what the site did with it; nothing raises.

    A copy goes, since the uploader fills fields in on the way."""
    krs = str(payload["krs"])
    try:
        resp = uploader.submit_company(krs, dict(payload), fail=False)
    except Exception as error:
        return CompanyResult(krs, "failed", error=f"firma {krs}: {one_line(error)}")
    return company_answer(krs, resp, "updated")


@dataclass
class RunSummary:
    """What one run did, kept in the shared cache next to what it sent."""

    run: str
    started: str
    finished: str = ""
    endpoint: str = ""
    #: The export the payloads were compared with, as its folder is stamped.
    export: str = ""
    #: Companies the run would send, before --max-uploads.
    planned: int = 0
    counters: dict[str, int] = field(default_factory=dict)
    state: str = ""
    #: Why the run ended before the payloads did, if it did.
    stopped: str = ""
    errors: list[str] = field(default_factory=list)
    exit_code: int | None = None
    #: The gs:// path of what this run sent.
    payloads: str = ""
    #: What the planned payloads would write, by `SiteSnapshot`'s reasons.
    reasons: dict[str, int] = field(default_factory=dict)
    #: Each company sent: its KRS number and name, what it would write, what
    #: the site did with it, and why it failed.
    companies: list[dict] = field(default_factory=list)
    #: Each company held back for a hand upload (`Plan.held`).
    held: list[dict] = field(default_factory=list)
    #: Each rename not sent (`Plan.names_kept`).
    names_kept: list[dict] = field(default_factory=list)


class CompanyImport:
    """One run: what it was asked to do, how far it got, and where it says so."""

    def __init__(
        self, args: argparse.Namespace, should_stop: Callable[[], str] = lambda: ""
    ):
        self.args = args
        self.should_stop = should_stop
        self.summary = RunSummary(run=uuid7str(), started=now(), endpoint=args.endpoint)
        self.status = JobRun(JOB, run_id=self.summary.run, unit=UNIT)
        self.ending = Ending()
        #: What the site did with the companies sent, by outcome.
        self.outcomes: Counter[str] = Counter()
        self.plan = Plan()
        #: The frames of the export to rebuild before they are compared with.
        self.rebuild: list[str] = []
        self._client: Client | None = None

    @property
    def day(self) -> str:
        """The day the export's frames are named after: --koryta-date, else
        today."""
        return KorytaNodes(self.args.koryta_date).date

    def run(self) -> int:
        self.status.start(phase=PHASE_BUILD)
        try:
            return self.attempt()
        except KeyboardInterrupt:
            print("Interrupted")
            self.summary.stopped = STOP_INTERRUPTED
            return self.end("partial", EXIT_TRY_LATER)
        except Exception as e:
            self.summary.stopped = f"wyjątek {type(e).__name__}"
            self.end("failed", EXIT_FAILED, crash=repr(e)[:ERROR_CHARS])
            raise

    def attempt(self) -> int:
        args = self.args
        tokens = None if args.dry_run else sign_in(args.endpoint)
        if refusal := self.check_export():
            print(f"Stopping: {refusal}")
            self.summary.stopped = refusal
            return self.end("failed", EXIT_FAILED)
        payloads, snapshot = build_payloads(
            self.day, build_policy(args.refresh, self.rebuild)
        )
        self.plan = plan_uploads(payloads, snapshot, args.max_renames)
        self.summary.planned = len(self.plan.send)
        self.summary.reasons = dict(
            Counter(reason for planned in self.plan.send for reason in planned.reasons)
        )
        self.summary.held = self.plan.held
        self.summary.names_kept = self.plan.names_kept
        print(
            f"{len(self.plan.send)} of {len(payloads)} companies would change on "
            f"the site ({sum(p.turns_public for p in self.plan.send)} turning "
            f"public): {self.summary.reasons}; held back: {len(self.plan.held)}; "
            f"renames not sent: {len(self.plan.names_kept)}"
        )
        for line in self.warnings():
            print(f"  {line}")
        self.status.progress(
            0, total=len(self.plan.send), counters=self.counters(), force=True
        )
        if tokens is None:  # A dry run, which signed in to nothing.
            return self.dry_run()
        if not self.plan.send:
            self.summary.stopped = STOP_UP_TO_DATE
            return self.end("succeeded", 0)
        payloads_sent = [planned.payload for planned in self.plan.send]
        try:
            self.summary.payloads = self.write_payloads(payloads_sent)
        except Exception as e:
            # The part is the record of what a day sent. A run that cannot
            # leave one sends nothing, rather than what nobody could audit.
            print(f"Could not write the payloads: {e}")
            self.summary.errors.append(one_line(e))
            self.summary.stopped = STOP_NOT_WRITTEN
            return self.end("failed", EXIT_FAILED)
        uploader = make_uploader(args.endpoint, tokens)
        self.status.progress(phase=PHASE_SEND, force=True)
        self.send(uploader)
        state, self.summary.stopped, code = judge(self.ending, self.outcomes)
        print(
            f"Sent {self.ending.done:,} of {len(self.plan.send):,} companies: "
            f"{dict(self.outcomes)}"
            + (f"; stopped: {self.summary.stopped}" if self.summary.stopped else "")
        )
        return self.end(state, code)

    def check_export(self) -> str:
        """Why the run may not compare the payloads with the newest export
        (`export_refusal`), or "" - and then which frames of it on disk to
        rebuild first (`stale_frames`), as the people import does."""
        export = latest_export(self.client())
        frames = [frame(self.args.koryta_date) for frame in FRAMES]
        refusal = export_refusal(
            export, self.day, warsaw_now(), accepted=self.args.export
        )
        if export is None or refusal:
            return refusal
        self.summary.export = export.stamp
        self.rebuild = stale_frames(frames, export.finished)
        print(
            f"Comparing with the export of {export.stamp}"
            + (
                f"; rebuilding {', '.join(self.rebuild)}, not built from it"
                if self.rebuild
                else ""
            )
        )
        return ""

    def send(self, uploader: CompanyUploader) -> None:
        """Upload each planned company in turn, until they run out or
        something says stop - Ctrl+C included."""
        args, ending = self.args, self.ending
        refused = 0
        try:
            for n, planned in enumerate(self.plan.send):
                if reason := self.should_stop():
                    ending.stopped = reason
                    break
                if n >= args.max_uploads:
                    ending.stopped = STOP_LIMIT
                    break
                result = send_company(uploader, planned.payload)
                self.outcomes[result.outcome] += 1
                refused = refused + 1 if result.outcome == "failed" else 0
                company: dict[str, typing.Any] = {
                    "krs": result.krs,
                    "name": planned.payload.get("name"),
                    "reasons": list(planned.reasons),
                    "outcome": result.outcome,
                }
                if result.error:
                    company["error"] = result.error
                    self.summary.errors.append(result.error)
                self.summary.companies.append(company)
                ending.done = n + 1
                self.status.progress(ending.done, counters=self.counters())
                if result.outcome == "created":
                    # The export had the company, so a page made for it is a
                    # second one, or one somebody deleted since, made again.
                    ending.stopped = (
                        f"utworzył stronę firmy {result.krs}, "
                        "którą kopia bazy już miała"
                    )
                    ending.guarded = True
                    break
                if refused >= MAX_REFUSED_IN_A_ROW:
                    ending.stopped = f"{refused} żądań z rzędu odrzuconych"
                    ending.guarded = True
                    break
                time.sleep(args.interval)
        except KeyboardInterrupt:
            print("Interrupted; stopping after the companies sent")
            ending.stopped = STOP_INTERRUPTED
        if ending.stopped:
            print(f"Stopping: {ending.stopped}")

    def counters(self) -> dict[str, int]:
        counts = dict.fromkeys(COUNTERS, 0)
        counts.update(
            planned=len(self.plan.send),
            held=len(self.plan.held),
            renames_held=len(self.plan.names_kept),
        )
        for outcome, n in self.outcomes.items():
            counts[outcome] = n
        return counts

    def warnings(self) -> list[str]:
        """What the run held back, for somebody to send by hand: the run's
        warnings on the page, which keeps the first `ERRORS_KEPT`."""
        return [held_line(held) for held in self.plan.held] + [
            kept_line(kept) for kept in self.plan.names_kept
        ]

    def dry_run(self) -> int:
        """Say what a run would send - the first --max-uploads of the plan -
        and end as a trial, writing nothing of its own."""
        planned = self.plan.send
        sent = min(len(planned), self.args.max_uploads)
        capped = (
            f", the first {sent:,} of {len(planned):,} planned (--max-uploads)"
            if sent < len(planned)
            else ""
        )
        print(
            f"Dry run: {sent:,} companies would be sent to {self.args.endpoint}"
            f"{capped}, {sum(p.turns_public for p in planned[:sent])} of them "
            "turning public"
        )
        self.status.finish(
            "succeeded",
            stop_reason=STOP_DRY_RUN,
            warnings=self.warnings(),
            counters=self.counters(),
            exit_code=0,
            done=0,
        )
        return 0

    def end(self, state: FinalState, code: int, crash: str | None = None) -> int:
        """Write the run's summary and tell the page how the run ended."""
        summary = self.summary
        summary.state = state
        summary.exit_code = code
        summary.counters = self.counters()
        errors = summary.errors
        if crash:
            errors = [crash, *errors]
        summary.errors = errors[:ERRORS_KEPT]
        path = "" if self.args.dry_run else self.write_summary()
        self.status.finish(
            state,
            stop_reason=summary.stopped or None,
            errors=summary.errors,
            warnings=self.warnings(),
            exit_code=code,
            counters=summary.counters,
            done=self.ending.done,
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


def parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="koryta_company_import",
        description=(__doc__ or "").split("\n")[0],
        allow_abbrev=False,
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build the payloads and report what would go; send nothing and "
        "write nothing of the job's own - rebuilt pipelines still go to the "
        "shared cache unless --no-backup.",
    )
    parser.add_argument(
        "--max-uploads",
        type=non_negative_int,
        default=3000,
        help="Send the first N companies and leave the rest to the next run "
        "(partial, 'limit'). Default: %(default)s.",
    )
    parser.add_argument(
        "--max-renames",
        type=non_negative_int,
        default=0,
        help="Renames sent at most, as the register spells the name; past it a "
        "payload goes with the name the site shows, and is not sent when the "
        "name was all it would change. Default: %(default)s, every name kept.",
    )
    parser.add_argument(
        "--endpoint", default=DEFAULT_ENDPOINT, help="Default: %(default)s."
    )
    parser.add_argument(
        "--koryta-date",
        type=iso_day,
        help="The day (YYYY-MM-DD) of the export the payloads are compared with. "
        "Default: today. The run is refused unless the newest finished export "
        "is of that day, taken at 04:00 today or later.",
    )
    parser.add_argument(
        "--export",
        type=export_stamp,
        metavar="STAMP",
        help="An export already taken as fresh enough, as its folder is stamped "
        "(2026-10-10T02:00:59.242Z) - the night passes the one its export step "
        "took. The run compares with it, or a newer one, in place of the rule "
        "that the newest is today's, taken at 04:00 or later.",
    )
    parser.add_argument(
        "--refresh",
        action="append",
        metavar="NAME",
        help="A pipeline to rebuild rather than read as it is; repeatable. By "
        "default nothing is rebuilt but the frames of the export that are not "
        "built from it, and Companies is held whatever its sources.",
    )
    parser.add_argument(
        "--max-minutes",
        type=non_negative_float,
        default=60,
        help="Stop sending this many minutes after the start, the build "
        "included, and leave the rest to the next run. 0: no limit. "
        "Default: %(default)s.",
    )
    parser.add_argument(
        "--interval",
        type=non_negative_float,
        default=0.3,
        help="Seconds between companies - the uploader's pace. Default: %(default)s.",
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
    if args.refresh:
        unknown = sorted(set(args.refresh) - pipeline_names())
        if unknown:
            # A misspelt name would refresh nothing, and say nothing about it.
            parse.error(
                f"--refresh {' '.join(unknown)}: not a pipeline the payloads are "
                f"built from. One of: {', '.join(sorted(pipeline_names()))}"
            )
    return args


def main(argv: Sequence[str] | None = None) -> int:
    started = time.monotonic()
    args = parse_args(argv)
    if args.no_backup:
        os.environ["DISABLE_BACKUP"] = "1"
    # The pipelines read sys.argv themselves, so the job's own flags must not
    # reach them; `build_payloads` hands them theirs.
    sys.argv = sys.argv[:1]

    deadline = started + args.max_minutes * 60 if args.max_minutes else None
    signalled = False

    def on_sigterm(signum, frame):
        nonlocal signalled
        signalled = True
        print("SIGTERM: stopping after the company in hand")

    previous = signal.signal(signal.SIGTERM, on_sigterm)
    try:
        return CompanyImport(args, stop_rule(deadline, lambda: signalled)).run()
    finally:
        signal.signal(signal.SIGTERM, previous)
