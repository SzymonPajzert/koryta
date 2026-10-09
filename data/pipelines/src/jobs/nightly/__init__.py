"""The whole night on the koryta-nightly VM, one step after another.

    koryta_nightly                    # what data/nightly/night.sh runs at 04:30
    koryta_nightly --dry-run          # every step's command; runs nothing
    koryta_nightly --only people      # one step; repeatable
    koryta_nightly --skip krs_odpis   # all but this one; repeatable
    koryta_nightly --max-uploads 300  # more people, once the first nights look right
    koryta_nightly --paid-max-calls 0 # buy nothing from rejestr.io tonight
    koryta_nightly --register-backlog 2000
                                      # the register's backlog too, not only
                                      # the day's new registrations

The steps, in order (`STEPS`):

    compress    the compressed mirror of rejestr.io and api-krs.ms.gov.pl
    export      wait for tonight's 04:00 Firestore export to finish; the people
                are compared with it, so it has to be tonight's
    krs_free    koryta_scrape_krs_free: the bulletin, then api-krs
    krs_register
                koryta_krs_register_owners --new-registrations: api-krs's odpis
                of every company the bulletin says was registered since the
                register's log began, for who owns it - so that one a gmina or
                a powiat sets up reaches the crawl - and --register-backlog
                reads of the rest (none until decide-register-sweep-pace)
    krs_odpis   koryta_krs_odpis for the companies the bulletin named since
                yesterday
    krs_paid    koryta_scrape_krs_paid --scope fallback: rejestr.io for what the
                free sources cannot give - the people somebody marked
                interesting, and the companies whose odpis did not come - at
                most --paid-max-calls a day; before the reprocess, so what it
                buys reaches tonight's people, who send those pages first
    reprocess   every pipeline rebuilt, as the CI nightly does, less the ones
                whose sources change with a dump or an election rather than
                overnight; each output backed up to the shared cache under
                USERNAME, which on the VM is `main`
    tests       the pipeline tests over those outputs (src/tests/pipelines)
    outputs     the outputs against their baseline (src/tests/e2e)
    invariants  the database invariants over tonight's export
    people      koryta_people_import --scope priority --max-uploads 100: new
                hires first, then the pages of the people rejestr.io was paid
                for this week, then published pages, then the rest
    scores      koryta_score_import: every scoring model rebuilt over the
                day's newest export and the pages the people step has just
                created, and its votes reconciled with the site's
    tidy        old export shards and day-named outputs off the disk

Every step but `export` and `tidy` is a process of its own - the jobs and the
pipelines exactly as they run by hand - with a time limit, its output in the
night's log, a timestamp on each line. A step that fails does not end the
night; only the steps that depend on it are held:

- `invariants` needs the export, `tests` and `outputs` the reprocess;
- `people` needs all of that: tonight's export, or it would compare the
  payloads with yesterday's site; a reprocess that succeeded; and checks with
  nothing new failing - a test that passed last night and fails tonight, most
  likely after last night's upload, holds the upload until somebody looks. The
  18 invariants failing on 2026-10-03 (budgets drifted past their measured
  values) fail every night and do not hold it.
- `scores` needs the same, and not the people: their outcome only decides
  which new pages there are to rate as well.

`krs_register` holds nothing back, and nothing holds it. A company it finds
the public owns is in the crawl's queue after tonight's reprocess
(`CompaniesPublicByRegister`, the `public_owner` door of `ScrapeRejestrIO`);
the next night's `krs_free` fetches its odpis aktualny, which puts it in
`CompaniesKRS`. The step stops itself `REGISTER_MARGIN` minutes inside its time
limit, so a backlog bigger than a night is left to the next one rather than cut
off mid-read.

`krs_paid` holds nothing back, and nothing holds it: the people go up with or
without what it bought. It needs the rejestr.io key - REJESTR_KEY, else the
Secret Manager secret rejestr-io-key (KORYTA_REJESTR_SECRET names another) -
which the step reads itself and gives the paid job alone, and is skipped
without it.

The night starts at 04:30 Warsaw, after the export and after midnight UTC, so
the compressor - which archives up to yesterday in UTC - takes the whole
previous day even as the first step (`data/compressor`).

The night writes its summary to gs://koryta-pl-sharedcache/jobs/nightly/runs/,
its log to .../jobs/nightly/logs/, and reports on koryta.pl/admin/procesy as
`nightly`; the jobs it runs report as themselves. Exit codes: 0 every step that
ran succeeded, 75 something was held or stopped short, 1 a step failed.
"""

import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import xml.etree.ElementTree as ET
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta

from uuid_extensions import uuid7str  # type: ignore

from stores.config import DOWNLOADED_DIR, PROJECT_ROOT, VERSIONED_DIR
from stores.job_runs import FinalState, JobRun
from stores.storage import CRAWLED_BUCKET, SHARED_BUCKET, Client, warsaw_tz

JOB = "nightly"
UNIT = "kroków"
RUNS_PREFIX = "jobs/nightly/runs/"
LOGS_PREFIX = "jobs/nightly/logs/"

EXIT_TRY_LATER = 75
EXIT_FAILED = 1

#: Out of `--all-pipelines`, as in the CI nightly (.github/workflows/pipelines.yml):
#: the article branch needs the crawl queue's Postgres and its url store, and
#: ProcessWikiNer the ml group's spaCy, which the VM does not install.
#: KorytaDiffer writes nothing - it prints how one export differs from another
#: - and reads every export ever taken to do it: on the VM's first night it
#: spent 65 minutes on the people alone and the kernel killed the run at 16 GB.
#: DomainToRegion is the article branch's own input, copied from a gitignored
#: files/domain_to_region.json the VM does not hold; only ArticlePersonMentions
#: reads it.
EXCLUDED = (
    "KorytaDiffer",
    "DomainToRegion",
    "ProcessWikiNer",
    "ArticleDoneUrls",
    "ArticleParsed",
    "ArticleDomainSelectors",
    "ArticleAnalyzed",
    "ArticlePersonMentions",
    "ArticleExtractedFacts",
    "ArticleFactsVerified",
    "ArticleKoryciarskiScores",
    "PeopleAffairTags",
)

#: Held at what is on disk, or restored from the shared cache when nothing is:
#: their sources change with a Wikipedia dump, an election, a GUS release or a
#: hand-made copy of the CRU database, not overnight. And rebuilt they would
#: cost the night what it has not got - ProcessWiki parses a 3 GB dump for 40
#: minutes, CruDump needs a Postgres or a dump file the VM does not hold.
#: (Teryt is not here: it is never stored, so there is nothing to hold.)
HELD = (
    "ProcessWiki",
    "PeoplePKW",
    "Regions",
    "PostalCodes",
    "NamesCountByRegion",
    "FirstNameFreq",
    "CruDump",
    "CruUmowy",
)

#: Read again by the scores step, whatever the reprocess built from them: the
#: site's people, their votes and facts, and the company scores made of those.
#: They are named by the day, so an export taken by hand later that day - to
#: rate the pages a run by hand created - is read only if they are rebuilt; on
#: a night with one export they read the same again, in about a minute.
SCORES_REFRESH = ("KorytaPeople", "KorytaVotes", "KorytaFacts", "CompanyScores")

#: Minutes the register step leaves itself inside its time limit: it stops
#: asking, writes what it read and reports, rather than be stopped mid-read -
#: a read that keeps failing takes up to three 30 s tries in each register.
REGISTER_MARGIN = 5

#: The secret the paid step reads its rejestr.io key from, unless
#: KORYTA_REJESTR_SECRET names another; an empty one switches the step off.
REJESTR_SECRET = "rejestr-io-key"

COMPRESSED_HOSTS = ("rejestr.io", "api-krs.ms.gov.pl")
COMPRESSED_BUCKET = "koryta-pl-compressed"

EXPORT_PREFIX = "hostname=koryta.pl/"
#: An export folder: `date=` and a UTC timestamp. The site's page captures
#: share the prefix under a bare day (`date=2026-10-03/`), which is not one.
EXPORT_FOLDER = re.compile(r"date=(\d{4}-\d{2}-\d{2}T[^/]+)/$")
#: Day-named pipeline outputs (`scrapers.koryta.download`): one per day, so
#: the disk keeps every day's unless something takes the old ones away.
DAY_NAMED = re.compile(
    r"^(person_koryta|person_votes|person_facts|company_koryta|koryta_nodes"
    r"|koryta_edges)_(\d{4}-\d{2}-\d{2})$"
)
#: An export shard in the download cache: the blob name with "/" as ".".
CACHED_EXPORT = re.compile(r"^hostname=koryta\.pl\.date=(\d{4}-\d{2}-\d{2})T")

# Step states, as the summary and the log say them.
SUCCEEDED = "succeeded"
PARTIAL = "partial"
FAILED = "failed"
SKIPPED = "skipped"
HELD_BACK = "held"


def warsaw_now() -> datetime:
    return datetime.now(warsaw_tz)


def utc_now() -> datetime:
    return datetime.now(UTC)


@dataclass
class StepResult:
    name: str
    state: str
    reason: str = ""
    started: str = ""
    finished: str = ""
    minutes: float = 0.0
    exit_code: int | None = None


@dataclass
class NightSummary:
    """What one night did, kept in the shared cache."""

    run: str
    started: str
    finished: str = ""
    host: str = ""
    version: str = ""
    #: The export the night compared against, and whether it was tonight's.
    export: str = ""
    export_fresh: bool = False
    steps: list[StepResult] = field(default_factory=list)
    #: Failing test ids, by check - the next night's baseline.
    failures: dict[str, list[str]] = field(default_factory=dict)
    #: Tests failing tonight that passed on the last night that ran them.
    new_failures: list[str] = field(default_factory=list)
    log: str = ""
    exit_code: int | None = None


@dataclass(frozen=True)
class Step:
    name: str
    #: What /admin/procesy shows as the phase, in the page's language.
    phase: str
    #: Minutes the step may take, at most.
    minutes: float
    #: Runs whatever the time, past --stop-by too: it is short, and leaving it
    #: out would cost the next night (`compress`, `tidy`).
    always: bool = False


STEPS = (
    Step("compress", "lustro", 20, always=True),
    Step("export", "kopia bazy", 90),
    Step("krs_free", "KRS", 75),
    # A night's new registrations are 2-3 minutes; the first night after the
    # register's log began, 2,286 of them, about twenty.
    Step("krs_register", "rejestr KRS", 30),
    Step("krs_odpis", "odpisy", 45),
    Step("krs_paid", "rejestr.io", 30),
    Step("reprocess", "potoki", 150),
    Step("tests", "testy", 45),
    Step("outputs", "wyniki", 20),
    Step("invariants", "niezmienniki", 30),
    Step("people", "osoby", 60),
    Step("scores", "oceny", 30),
    Step("tidy", "porządki", 5, always=True),
)
STEP_NAMES = tuple(step.name for step in STEPS)
#: The checks whose failures the night compares with the last one's.
CHECKS = ("tests", "outputs", "invariants")


def bin_path(name: str) -> str:
    """An entry point of this environment, the one this process runs from."""
    return os.path.join(os.path.dirname(sys.executable), name)


def read_secret(name: str) -> tuple[str | None, str]:
    """A Secret Manager secret's latest version, read with the machine's own
    gcloud and account; or None, and why - gcloud's first line, which never
    holds the value."""
    argv = ["gcloud", "secrets", "versions", "access", "latest"]
    try:
        done = subprocess.run(
            [*argv, f"--secret={name}", "--quiet"],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        return None, f"{name}: {type(e).__name__}"
    value = done.stdout.strip()
    if done.returncode == 0 and value:
        return value, ""
    said = (done.stderr or "").strip().splitlines()
    return None, f"{name}: " + (said[0][:200] if said else f"gcloud {done.returncode}")


def rejestr_key() -> tuple[str | None, str]:
    """The key the paid step buys with - REJESTR_KEY, else the secret - or
    None, and why.

    Read here, by the step, not by night.sh with the other secrets. night.sh
    runs from a copy of the version checked out before the night fetched its
    code, so a key it had just learned to read would come a night late. And
    this way no other step is given it.
    """
    key = os.environ.get("REJESTR_KEY")
    if key:
        return key, ""
    secret = os.environ.get("KORYTA_REJESTR_SECRET", REJESTR_SECRET)
    if not secret:
        return None, "KORYTA_REJESTR_SECRET is empty"
    return read_secret(secret)


def reprocess_argv() -> list[str]:
    argv = [bin_path("koryta"), "--all-pipelines"]
    for name in EXCLUDED:
        argv += ["--exclude", name]
    argv += ["--refresh", "all"]
    for name in HELD:
        argv += ["--refresh", f":{name}"]
    # --keep-going builds every pipeline it can and names the broken ones at
    # the end - the step still fails, so nothing is sent - rather than stop at
    # the first: the first night found them one 1.5-hour run at a time.
    # --assume-yes answers ProcessWiki's "runs long?" should it be missing
    # everywhere; --all is Extract's, which refuses to run without a scope.
    return [*argv, "--keep-going", "--assume-yes", "--all"]


def pytest_argv(*args: str, report: str) -> list[str]:
    return [
        sys.executable,
        "-m",
        "pytest",
        *args,
        "-q",
        "-p",
        "no:cacheprovider",
        f"--junitxml={report}",
    ]


def failed_tests(report: str) -> list[str] | None:
    """The ids of the tests a junit report says failed or errored; None when
    there is no report to read - the run never got as far as writing one."""
    try:
        root = ET.parse(report).getroot()
    except (OSError, ET.ParseError):
        return None
    failed = []
    for case in root.iter("testcase"):
        if case.find("failure") is not None or case.find("error") is not None:
            failed.append(f"{case.get('classname')}::{case.get('name')}")
    return sorted(failed)


def stream(
    argv: Sequence[str],
    env: dict[str, str],
    timeout: float,
    log: Callable[[str], None],
    on_start: Callable[[subprocess.Popen], None] = lambda proc: None,
) -> tuple[int | None, bool]:
    """Run a command with its output going to `log` line by line; its exit
    code, and whether it ran out of time (then it was stopped: SIGTERM to its
    process group, a minute's grace, SIGKILL)."""
    proc = subprocess.Popen(
        list(argv),
        cwd=PROJECT_ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        errors="replace",
        start_new_session=True,
    )
    on_start(proc)

    def pump():
        assert proc.stdout is not None
        for line in proc.stdout:
            log(line.rstrip("\n"))

    reader = threading.Thread(target=pump, daemon=True)
    reader.start()
    timed_out = False
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        log(f"Out of time after {timeout / 60:.0f} min; stopping it")
        stop(proc)
    reader.join(timeout=10)
    return proc.returncode, timed_out


def stop(proc: subprocess.Popen, grace: float = 60) -> None:
    """SIGTERM to the process and its children, then SIGKILL after `grace`."""
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(proc.pid, sig)
        except ProcessLookupError:
            return
        try:
            proc.wait(timeout=grace)
            return
        except subprocess.TimeoutExpired:
            continue


def minutes_until(stop_by: str, now: datetime) -> float:
    """Minutes from `now` to the next `stop_by` (HH:MM, `now`'s zone) - or
    since it, negative, when it passed less than twelve hours ago."""
    hour, minute = (int(part) for part in stop_by.split(":"))
    stop_at = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if stop_at < now - timedelta(hours=12):
        stop_at += timedelta(days=1)
    return (stop_at - now).total_seconds() / 60


def newest_export(client: Client, lookback: int = 5) -> str | None:
    """The newest export that has finished writing: its timestamp, or None.

    Lists the folders under the export prefix, one level deep, and asks each of
    the newest few for the marker Firestore writes last (`snapshot.is_complete`
    asks the same thing through a pipeline context).
    """
    bucket = client.storage_client.bucket(CRAWLED_BUCKET)
    listing = bucket.list_blobs(prefix=EXPORT_PREFIX, delimiter="/")
    for _ in listing:  # The prefixes are filled in as the pages are read.
        pass
    stamps = sorted(
        match.group(1)
        for prefix in listing.prefixes
        if (match := EXPORT_FOLDER.search(prefix.removeprefix(EXPORT_PREFIX)))
    )
    for stamp in reversed(stamps[-lookback:]):
        marker = f"{EXPORT_PREFIX}date={stamp}/date={stamp}.overall_export_metadata"
        if bucket.blob(marker).exists():
            return stamp
    return None


def export_time(stamp: str) -> datetime:
    return datetime.fromisoformat(stamp.replace("Z", "+00:00"))


def last_failures(client: Client, before: str) -> dict[str, list[str]] | None:
    """The failures recorded by the newest night that ran the checks, before
    the run `before`; None when no night has."""
    bucket = client.storage_client.bucket(SHARED_BUCKET)
    names = sorted(
        blob.name
        for blob in bucket.list_blobs(
            prefix=RUNS_PREFIX, fields="items(name),nextPageToken"
        )
        if not blob.name.endswith(f"/{before}.json")
    )
    for name in reversed(names):
        summary = json.loads(bucket.blob(name).download_as_bytes())
        failures = summary.get("failures") or {}
        if failures:
            return failures
    return None


def new_failures(
    tonight: dict[str, list[str]], last: dict[str, list[str]] | None
) -> list[str]:
    """Tests failing tonight that did not fail on the last night that ran
    their check. None before: every failure is the first night's baseline."""
    if last is None:
        return []
    found = []
    for check, failed in tonight.items():
        if check not in last:
            continue
        found += sorted(set(failed) - set(last[check]))
    return found


def tidy(keep_days: int, today: str) -> tuple[int, int]:
    """Take old export shards out of the download cache and old day-named
    outputs out of versioned/; how many of each went."""
    cutoff = (
        (datetime.fromisoformat(today) - timedelta(days=keep_days)).date().isoformat()
    )
    shards = outputs = 0
    for name in os.listdir(DOWNLOADED_DIR):
        match = CACHED_EXPORT.match(name)
        if match and match.group(1) < cutoff:
            os.remove(os.path.join(DOWNLOADED_DIR, name))
            shards += 1
    for name in os.listdir(VERSIONED_DIR):
        match = DAY_NAMED.match(name)
        if match and match.group(2) < cutoff:
            shutil.rmtree(os.path.join(VERSIONED_DIR, name))
            outputs += 1
    return shards, outputs


class Night:
    """One night: the steps, what each did, and where it all goes."""

    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.started_at = utc_now()
        self.summary = NightSummary(
            run=uuid7str(),
            started=warsaw_now().isoformat(timespec="seconds"),
            host=os.uname().nodename,
            version=os.environ.get("KORYTA_VERSION", ""),
        )
        self.status = JobRun(JOB, run_id=self.summary.run, unit=UNIT)
        self.results: dict[str, StepResult] = {}
        self.selected_names: set[str] = set()
        self.signalled = False
        self.child: subprocess.Popen | None = None
        self._client: Client | None = None
        logs = os.environ.get("KORYTA_NIGHTLY_LOGS") or os.path.join(
            PROJECT_ROOT, "nightly-logs"
        )
        os.makedirs(logs, exist_ok=True)
        day = self.summary.started[:10]
        self.log_path = os.path.join(logs, f"{day}-{self.summary.run}.log")
        self.reports = os.path.join(logs, f"{day}-{self.summary.run}")
        self._log = open(self.log_path, "a", encoding="utf-8")

    # -- the log ----------------------------------------------------------

    def log(self, line: str, step: str = "nightly") -> None:
        stamped = f"{warsaw_now():%H:%M:%S} [{step}] {line}"
        print(stamped, flush=True)
        self._log.write(stamped + "\n")
        self._log.flush()

    def client(self) -> Client:
        if self._client is None:
            self._client = Client()
        return self._client

    # -- the steps --------------------------------------------------------

    def selected(self) -> list[Step]:
        only, skip = set(self.args.only or ()), set(self.args.skip or ())
        return [
            step
            for step in STEPS
            if (not only or step.name in only) and step.name not in skip
        ]

    def run(self) -> int:
        steps = self.selected()
        self.selected_names = {step.name for step in steps}
        if self.args.dry_run:
            return self.dry_run(steps)
        self.status.start(phase=steps[0].phase if steps else None)
        previous = signal.signal(signal.SIGTERM, self.on_sigterm)
        try:
            for done, step in enumerate(steps):
                self.status.progress(
                    done, total=len(steps), phase=step.phase, force=True
                )
                self.results[step.name] = self.run_step(step)
        finally:
            signal.signal(signal.SIGTERM, previous)
            code = self.end()
            self._log.close()
        return code

    def on_sigterm(self, signum, frame):
        self.signalled = True
        self.log("SIGTERM: stopping the step in hand, then the night")
        if self.child is not None and self.child.poll() is None:
            try:
                os.killpg(self.child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass

    def run_step(self, step: Step) -> StepResult:
        started = warsaw_now()
        result = StepResult(
            step.name, SKIPPED, started=started.isoformat(timespec="seconds")
        )
        reason = self.why_not(step)
        if reason:
            result.state = HELD_BACK if reason.startswith("wstrzymane") else SKIPPED
            result.reason = reason
            self.log(f"{result.state}: {reason}", step.name)
            return result
        self.log(f"start (at most {self.minutes_for(step):.0f} min)", step.name)
        try:
            handler = getattr(self, f"step_{step.name}")
            state, reason, code = handler(step)
        except Exception as e:
            state, reason, code = FAILED, f"wyjątek {type(e).__name__}: {e}"[:300], None
        finished = warsaw_now()
        result.state, result.reason, result.exit_code = state, reason, code
        result.finished = finished.isoformat(timespec="seconds")
        result.minutes = round((finished - started).total_seconds() / 60, 1)
        self.log(
            f"{state} in {result.minutes} min" + (f": {reason}" if reason else ""),
            step.name,
        )
        return result

    def why_not(self, step: Step) -> str:
        """Why a step will not run tonight, or "" when it will."""
        if self.signalled:
            return "SIGTERM"
        if not step.always and self.minutes_left() <= 0:
            return f"koniec nocy ({self.args.stop_by})"
        if (
            step.name == "invariants"
            and self.needs("export")
            and not self.summary.export
        ):
            return "wstrzymane: brak kopii bazy"
        if step.name in ("tests", "outputs") and not self.came_through("reprocess"):
            return "wstrzymane: potoki się nie przeliczyły"
        if step.name in ("people", "scores"):
            return self.why_not_upload()
        return ""

    def needs(self, name: str) -> bool:
        """Whether this run includes step `name`. One left out by --only or
        --skip is somebody's choice for a hand run, and holds nothing back."""
        return name in self.selected_names

    def came_through(self, name: str) -> bool:
        """Whether a step this run includes succeeded; true for one left out."""
        return not self.needs(name) or self.succeeded(name)

    def why_not_upload(self) -> str:
        """Why nothing goes up to the site tonight, or "" when it may."""
        if self.needs("export") and not self.summary.export_fresh:
            return "wstrzymane: nie ma dzisiejszej kopii bazy"
        if not self.came_through("reprocess"):
            return "wstrzymane: potoki się nie przeliczyły"
        for check in CHECKS:
            result = self.results.get(check)
            if result is not None and result.state not in (SUCCEEDED, PARTIAL):
                return f"wstrzymane: sprawdzenie {check} nie dało wyniku"
        self.compare_failures()
        if self.summary.new_failures:
            shown = ", ".join(self.summary.new_failures[:5])
            more = len(self.summary.new_failures) - 5
            return f"wstrzymane: nowe błędy testów: {shown}" + (
                f" i {more} innych" if more > 0 else ""
            )
        return ""

    def succeeded(self, name: str) -> bool:
        result = self.results.get(name)
        return result is not None and result.state == SUCCEEDED

    def minutes_left(self) -> float:
        if self.args.stop_by is None:
            return float("inf")
        return minutes_until(self.args.stop_by, warsaw_now())

    def minutes_for(self, step: Step) -> float:
        if step.always:
            return step.minutes
        return max(0.0, min(step.minutes, self.minutes_left()))

    def process(
        self, step: Step, argv: Sequence[str], env: dict[str, str] | None = None
    ) -> tuple[int | None, bool]:
        full_env = {**os.environ, "PYTHONUNBUFFERED": "1", **(env or {})}
        self.log("$ " + " ".join(argv), step.name)

        def started(proc):
            self.child = proc

        try:
            return stream(
                argv,
                full_env,
                self.minutes_for(step) * 60,
                lambda line: self.log(line, step.name),
                started,
            )
        finally:
            self.child = None

    @staticmethod
    def judge_job(code: int | None, timed_out: bool) -> tuple[str, str, int | None]:
        """A job's ending: 0 succeeded, 75 partial (it leaves the rest to the
        next run), anything else failed."""
        if timed_out:
            return FAILED, "przekroczony czas", code
        if code == 0:
            return SUCCEEDED, "", code
        if code == EXIT_TRY_LATER:
            return PARTIAL, "zostało na następny raz", code
        return FAILED, f"kod wyjścia {code}", code

    # -- each step --------------------------------------------------------

    def step_export(self, step: Step) -> tuple[str, str, int | None]:
        """Wait for tonight's export: the newest finished one, taken within
        --export-max-age hours of the night's start."""
        oldest = self.started_at - timedelta(hours=self.args.export_max_age)
        # One look a minute for as long as the step may take.
        looks = max(1, int(self.minutes_for(step)))
        stamp = None
        for look in range(looks):
            stamp = newest_export(self.client())
            if stamp is not None:
                self.summary.export = stamp
                if export_time(stamp) >= oldest:
                    self.summary.export_fresh = True
                    return SUCCEEDED, stamp, None
            if self.signalled or look == looks - 1:
                break
            self.log(f"no export since {oldest:%H:%M} UTC yet; waiting", step.name)
            time.sleep(60)
        found = f"najnowsza z {stamp}" if stamp else "żadnej"
        return PARTIAL, f"brak dzisiejszej kopii bazy ({found})", None

    def step_krs_free(self, step: Step) -> tuple[str, str, int | None]:
        argv = [
            bin_path("koryta_scrape_krs_free"),
            "--max-minutes",
            str(self.args.krs_minutes),
        ]
        return self.judge_job(*self.process(step, argv))

    def register_argv(self, minutes: float) -> list[str]:
        return [
            bin_path("koryta_krs_register_owners"),
            "--new-registrations",
            "--reads",
            str(self.args.register_backlog),
            "--max-minutes",
            f"{max(1.0, minutes - REGISTER_MARGIN):.0f}",
        ]

    def step_krs_register(self, step: Step) -> tuple[str, str, int | None]:
        argv = self.register_argv(self.minutes_for(step))
        return self.judge_job(*self.process(step, argv))

    def step_krs_odpis(self, step: Step) -> tuple[str, str, int | None]:
        yesterday = (warsaw_now() - timedelta(days=1)).date().isoformat()
        argv = [
            bin_path("koryta_krs_odpis"),
            "--graph",
            "--changed-since",
            yesterday,
            "--max",
            str(self.args.odpis_max),
        ]
        return self.judge_job(*self.process(step, argv))

    def step_krs_paid(self, step: Step) -> tuple[str, str, int | None]:
        if not self.args.paid_max_calls:
            return SKIPPED, "limit zapytań 0", None
        key, why = rejestr_key()
        if not key:
            self.log(f"No rejestr.io key: {why}", step.name)
            return SKIPPED, "brak klucza rejestr.io", None
        argv = [
            bin_path("koryta_scrape_krs_paid"),
            "--scope",
            "fallback",
            "--max-calls",
            str(self.args.paid_max_calls),
        ]
        # In the job's environment, never on its command line, which the
        # night's log prints.
        return self.judge_job(*self.process(step, argv, {"REJESTR_KEY": key}))

    def step_reprocess(self, step: Step) -> tuple[str, str, int | None]:
        code, timed_out = self.process(step, reprocess_argv())
        state, reason, code = self.judge_job(code, timed_out)
        # `koryta` has no "the rest is the next run's": anything but 0 is a
        # failure, and outputs it left half-built are not to be sent from.
        return (FAILED, reason, code) if state == PARTIAL else (state, reason, code)

    def run_check(
        self, step: Step, args: Sequence[str], env: dict[str, str]
    ) -> tuple[str, str, int | None]:
        report = f"{self.reports}-{step.name}.xml"
        code, timed_out = self.process(
            step,
            pytest_argv(*args, report=report),
            # Tests never write to the shared cache, whatever they rebuild.
            {"DISABLE_BACKUP": "1", "KORYTA_JOB_STATUS": "0", **env},
        )
        failed = failed_tests(report)
        if timed_out or failed is None or code not in (0, 1):
            # pytest 2-5: interrupted, an internal or usage error, nothing
            # collected. No verdict to compare.
            return FAILED, f"bez wyniku (kod {code})", code
        self.summary.failures[step.name] = failed
        if not failed:
            return SUCCEEDED, "", code
        return PARTIAL, f"{len(failed)} nie przechodzi", code

    def compare_failures(self) -> None:
        last = self.last_failures()
        self.summary.new_failures = new_failures(self.summary.failures, last)

    _last: dict[str, list[str]] | None = None
    _last_read = False

    def last_failures(self) -> dict[str, list[str]] | None:
        if not self._last_read:
            try:
                self._last = last_failures(self.client(), self.summary.run)
            except Exception as e:
                # No baseline reads as the first night: nothing is new.
                self.log(f"Could not read the last night's failures: {e}")
                self._last = None
            self._last_read = True
        return self._last

    def step_tests(self, step: Step) -> tuple[str, str, int | None]:
        return self.run_check(
            step,
            [
                "src/tests/pipelines",
                "--ignore=src/tests/pipelines/test_scrape_rejestr_io.py",
            ],
            {},
        )

    def step_outputs(self, step: Step) -> tuple[str, str, int | None]:
        return self.run_check(
            step,
            ["-m", "e2e", "src/tests/e2e"],
            {"KORYTA_E2E_TIER": "full", "KORYTA_E2E_STRICT": "1"},
        )

    def step_invariants(self, step: Step) -> tuple[str, str, int | None]:
        # The rejestr.io coverage check walks the whole crawl prefix twice:
        # an hour and a half, by hand only (pipelines.yml says the same).
        return self.run_check(
            step,
            [
                "-m",
                "e2e",
                "src/tests/pipelines",
                "--ignore=src/tests/pipelines/test_rejestrio_coverage.py",
            ],
            {"KORYTA_EXPORT": self.summary.export},
        )

    def step_people(self, step: Step) -> tuple[str, str, int | None]:
        argv = [
            bin_path("koryta_people_import"),
            "--scope",
            "priority",
            "--max-uploads",
            str(self.args.max_uploads),
            "--recent-days",
            str(self.args.recent_days),
            "--max-minutes",
            f"{self.minutes_for(step):.0f}",
            # The reprocess has just rebuilt every pipeline the payloads read.
            "--refresh",
            "none",
        ]
        if self.args.people_dry_run:
            argv.append("--dry-run")
        return self.judge_job(*self.process(step, argv))

    def step_scores(self, step: Step) -> tuple[str, str, int | None]:
        # The models are rebuilt over the newest export of the day; the rest
        # of what they read is the reprocess's, on disk, and the pages the
        # people step created are read from its record.
        argv = [
            bin_path("koryta_score_import"),
            "--max-minutes",
            f"{self.minutes_for(step):.0f}",
        ]
        for name in SCORES_REFRESH:
            argv += ["--refresh", name]
        return self.judge_job(*self.process(step, argv))

    def step_compress(self, step: Step) -> tuple[str, str, int | None]:
        compressor = os.environ.get("KORYTA_COMPRESSOR")
        if not compressor:
            return SKIPPED, "brak KORYTA_COMPRESSOR (night.sh go buduje)", None
        failed = []
        for host in COMPRESSED_HOSTS:
            argv = [
                compressor,
                "-in-bucket",
                CRAWLED_BUCKET,
                "-out-bucket",
                COMPRESSED_BUCKET,
                "-incremental",
                "-hostname",
                host,
            ]
            code, timed_out = self.process(step, argv)
            if timed_out or code != 0:
                failed.append(f"{host} (kod {code})")
        if failed:
            return FAILED, "nie spakowano: " + ", ".join(failed), None
        return SUCCEEDED, "", 0

    def step_tidy(self, step: Step) -> tuple[str, str, int | None]:
        shards, outputs = tidy(self.args.keep_days, self.summary.started[:10])
        return SUCCEEDED, f"usunięto {shards} plików kopii i {outputs} wyników", None

    # -- the end ----------------------------------------------------------

    def dry_run(self, steps: list[Step]) -> int:
        print(f"The night, as it would run now ({len(steps)} steps):")
        for step in steps:
            limit = f"at most {step.minutes:.0f} min"
            print(f"  {step.name:<12} {limit}: {self.describe(step)}")
        return 0

    def describe(self, step: Step) -> str:
        commands = {
            "export": "wait for tonight's export (its .overall_export_metadata)",
            "krs_free": f"koryta_scrape_krs_free --max-minutes {self.args.krs_minutes}",
            "krs_register": "koryta_krs_register_owners "
            + " ".join(self.register_argv(step.minutes)[1:]),
            "krs_odpis": "koryta_krs_odpis --graph --changed-since <yesterday> "
            f"--max {self.args.odpis_max}",
            "krs_paid": "koryta_scrape_krs_paid --scope fallback --max-calls "
            f"{self.args.paid_max_calls} (the key from {REJESTR_SECRET})",
            "reprocess": "koryta " + " ".join(reprocess_argv()[1:]),
            "tests": "pytest src/tests/pipelines",
            "outputs": "pytest -m e2e src/tests/e2e",
            "invariants": "pytest -m e2e src/tests/pipelines (tonight's export)",
            "people": "koryta_people_import --scope priority --max-uploads "
            f"{self.args.max_uploads}"
            + (" --dry-run" if self.args.people_dry_run else ""),
            "scores": "koryta_score_import: every scoring model, tonight's new "
            "pages included",
            "compress": "compressor -incremental -hostname "
            + " / ".join(COMPRESSED_HOSTS),
            "tidy": f"remove export shards and day-named outputs older than "
            f"{self.args.keep_days} days",
        }
        return commands[step.name]

    def end(self) -> int:
        results = list(self.results.values())
        summary = self.summary
        summary.steps = results
        summary.finished = warsaw_now().isoformat(timespec="seconds")
        if (
            self.results.get("tests")
            or self.results.get("outputs")
            or self.results.get("invariants")
        ):
            self.compare_failures()
        states = {result.state for result in results}
        # A partial step - the scrape's backlog, the upload's cap - is how the
        # jobs carry on the next night, not something wrong with this one.
        if FAILED in states:
            state: FinalState = "failed"
            code = EXIT_FAILED
        elif HELD_BACK in states or self.signalled:
            state, code = "partial", EXIT_TRY_LATER
        else:
            state, code = "succeeded", 0
        summary.exit_code = code

        def said(result: StepResult) -> str:
            return f"{result.name}: {result.state}" + (
                f" - {result.reason}" if result.reason else ""
            )

        # One line per step that did not simply succeed, in step order;
        # /admin/procesy finds the held ones among them by this shape.
        problems = [
            said(result)
            for result in results
            if result.state in (FAILED, PARTIAL, HELD_BACK)
        ]
        # The reason given is what decided the state, as above. The partial
        # steps any night may have - the scrape's backlog, the checks' known
        # failures - come earlier in step order, and named first they read
        # as the cause of an upload they held.
        decisive = (
            [said(result) for result in results if result.state == FAILED]
            or [said(result) for result in results if result.state == HELD_BACK]
            or (["SIGTERM"] if self.signalled else [])
            or problems
        )
        self.log(f"night over: {state}; " + ("; ".join(problems) or "all well"))
        summary.log = self.write_log()
        path = self.write_summary()
        self.status.finish(
            state,
            stop_reason=decisive[0][:200] if decisive else None,
            errors=problems,
            exit_code=code,
            counters={
                "kroki": len(results),
                "udane": sum(r.state == SUCCEEDED for r in results),
                "nieudane": sum(r.state == FAILED for r in results),
                "nowe_bledy_testow": len(summary.new_failures),
            },
            done=len(results),
            summary_path=path or None,
        )
        return code

    def write_log(self) -> str:
        self._log.flush()
        name = f"{LOGS_PREFIX}date={self.summary.started[:10]}/{self.summary.run}.log"
        try:
            with open(self.log_path, "rb") as f:
                data = f.read()
            return self.client().create_object(SHARED_BUCKET, name, data, "text/plain")
        except Exception as e:
            self.log(f"Could not upload the log {name}: {e}")
            return ""

    def write_summary(self) -> str:
        summary = self.summary
        name = f"{RUNS_PREFIX}date={summary.started[:10]}/{summary.run}.json"
        data = json.dumps(asdict(summary), ensure_ascii=False, indent=1)
        try:
            url = self.client().create_object(
                SHARED_BUCKET, name, data.encode("utf-8"), "application/json"
            )
        except Exception as e:
            self.log(f"Could not write the summary {name}: {e}")
            return ""
        self.log(f"Summary: {url}")
        return url


def positive_int(text: str) -> int:
    value = int(text)
    if value < 0:
        raise ValueError(text)
    return value


def clock(text: str) -> str:
    hour, minute = text.split(":")
    if not (0 <= int(hour) < 24 and 0 <= int(minute) < 60):
        raise ValueError(text)
    return f"{int(hour):02d}:{int(minute):02d}"


def parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="koryta_nightly",
        description=(__doc__ or "").split("\n")[0],
        allow_abbrev=False,
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Print the plan; run nothing."
    )
    parser.add_argument(
        "--only",
        action="append",
        choices=STEP_NAMES,
        help="Run this step alone; repeatable.",
    )
    parser.add_argument(
        "--skip",
        action="append",
        choices=STEP_NAMES,
        help="Leave this step out; repeatable.",
    )
    parser.add_argument(
        "--max-uploads",
        type=positive_int,
        default=100,
        help="People the night sends at most. Default: %(default)s.",
    )
    parser.add_argument(
        "--people-dry-run",
        action="store_true",
        help="Build and count tonight's people, send none.",
    )
    parser.add_argument(
        "--recent-days",
        type=positive_int,
        default=30,
        help="A new hire's public post began within this many days. "
        "Default: %(default)s.",
    )
    parser.add_argument(
        "--krs-minutes",
        type=positive_int,
        default=60,
        help="The free KRS scrape stops asking after this many minutes. "
        "Default: %(default)s.",
    )
    parser.add_argument(
        "--register-backlog",
        type=positive_int,
        default=0,
        help="Register entries read a night besides the day's new "
        "registrations: failed reads, entries the register has moved on from, "
        "then the ~700k never read, oldest number first. About 2,500 reads, "
        "the new ones included, fit the step's time; what does not is the "
        "next night's. How many is task decide-register-sweep-pace. "
        "Default: %(default)s.",
    )
    parser.add_argument(
        "--odpis-max",
        type=positive_int,
        default=300,
        help="Odpisy pełne asked for at most. Default: %(default)s.",
    )
    parser.add_argument(
        "--paid-max-calls",
        type=positive_int,
        default=50,
        help="rejestr.io calls bought at most a day, at 0.05 PLN each; 0 buys "
        "nothing. Default: %(default)s.",
    )
    parser.add_argument(
        "--export-max-age",
        type=float,
        default=6,
        help="Hours before the night's start an export may be and still be "
        "tonight's. Default: %(default)s.",
    )
    parser.add_argument(
        "--stop-by",
        type=clock,
        help="Warsaw time (HH:MM) after which no step but compress and tidy "
        "starts, and a running one is stopped. night.sh gives the scheduled "
        "night 08:30, as the instance schedule stops the VM at 09:00; a hand "
        "run has no deadline unless given one.",
    )
    parser.add_argument(
        "--keep-days",
        type=positive_int,
        default=7,
        help="Days of export shards and day-named outputs kept on disk. "
        "Default: %(default)s.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    # The steps get their own flags; nothing of the night's reaches them.
    sys.argv = sys.argv[:1]
    return Night(args).run()
