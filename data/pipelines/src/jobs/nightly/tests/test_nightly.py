"""The night on the VM: which steps run, in what order, and what holds the upload."""

import json
import os
import shutil
import signal
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest

import jobs.nightly as night
from stores.storage import SHARED_BUCKET, warsaw_tz

#: `test_budget_warnings_reads_what_the_invariants_budgets_record` and
#: `test_budget_slack_reads_what_the_invariants_budgets_record` run the
#: invariants' own budgets through pytest.
pytest_plugins = ["pytester"]

#: Where every budgeted invariant gets `within_budget`, which records what
#: `budget_warnings` and `budget_slack` read.
INVARIANTS_CONFTEST = Path(__file__).parents[3] / "tests/pipelines/conftest.py"

# The 04:00 Warsaw export, in UTC as its folder is named; the night starts at
# 04:30 Warsaw, half an hour later.
FRESH = "2026-10-04T02:00:04.120Z"
STALE = "2026-10-03T02:00:04.120Z"
#: What the processes would answer, by the entry point's name.
GOOD = {
    "koryta_scrape_krs_free": 0,
    "koryta_krs_register_owners": 0,
    "koryta_krs_odpis": 0,
    "koryta_scrape_krs_paid": 0,
    "koryta": 0,
    # The companies step runs the people import too, with one flag more.
    "koryta_people_import --companies-only": 0,
    "koryta_people_import": 0,
    "koryta_score_import": 0,
    "compressor": 0,
    # The held pipelines' rebuilds, as `koryta <Name>`.
    **{f"koryta {name}": 0 for name in night.REBUILT_ON_CHANGE},
}


class RecordingRun:
    """Stands in for `JobRun`, keeping what the night told it."""

    def __init__(self, job_id, **kwargs):
        self.job = job_id
        self.kwargs = kwargs
        self.calls: list[tuple[str, dict]] = []

    def start(self, phase=None):
        self.calls.append(("start", {"phase": phase}))

    def progress(self, done=None, **kwargs):
        self.calls.append(("progress", {"done": done, **kwargs}))

    def finish(self, state, **kwargs):
        self.calls.append(("finish", {"state": state, **kwargs}))

    def ending(self) -> dict:
        [end] = [args for call, args in self.calls if call == "finish"]
        return end


class World:
    """The VM, faked: the processes, the buckets, the clock's export."""

    def __init__(self, tmp_path):
        self.codes = dict(GOOD)
        #: Failing test ids per check, as the junit reports would say.
        self.failures: dict[str, list[str] | None] = {
            "tests": [],
            "outputs": [],
            "invariants": [],
        }
        self.pytest_codes = {"tests": None, "outputs": None, "invariants": None}
        #: Tests past their budget and inside its buffer, per check.
        self.warnings: dict[str, list[night.OverBudget]] = {
            "tests": [],
            "outputs": [],
            "invariants": [],
        }
        #: Tests under their budget, per check.
        self.slack: dict[str, list[night.Slack]] = {
            "tests": [],
            "outputs": [],
            "invariants": [],
        }
        self.last: dict[str, list[str]] | None = {}
        self.export: str | None = FRESH
        self.commands: list[tuple[str, list[str], dict]] = []
        #: The seconds each rebuild was given.
        self.timeouts: dict[str, float] = {}
        self.objects: dict[str, bytes] = {}
        self.runs: list[RecordingRun] = []
        self.tmp = tmp_path
        #: Secret Manager, as the VM's account may read it.
        self.secrets: dict[str, str] = {night.REJESTR_SECRET: "a-key"}
        self.secrets_read: list[str] = []
        #: The hash of each source path in the checked-out commit, and what is
        #: said instead when there is none to read (`source_trees`).
        self.trees: dict[str, str] = {}
        self.unreadable = ""
        self.state = tmp_path / "state"
        self.versioned = tmp_path / "versioned"
        #: Minutes each rebuild takes on the night's clock, when it has one.
        self.rebuild_minutes = 0.0
        self.clock: datetime | None = None

    def of_check(self, found: dict, report: str) -> list:
        """What a check's junit report would say, from `found` by check."""
        for check in night.CHECKS:
            if report.endswith(f"-{check}.xml"):
                return found[check]
        raise AssertionError(report)

    def tree(self, path: str) -> str:
        return self.trees.get(path, "tree-of-" + path)

    def source_trees(self, paths, root=None):
        if self.unreadable:
            return None, self.unreadable
        return {path: self.tree(path) for path in paths}, ""

    def built_from(self) -> dict:
        return json.loads((self.state / night.BUILT_FROM).read_text())

    def record_built(self, *names: str) -> None:
        """Say these were last built here from their sources as they are."""
        record = {
            name: {
                "sources": {
                    path: self.tree(path)
                    for path in night.REBUILT_ON_CHANGE[name].sources
                },
                "built": "2026-10-03T05:00:00+02:00",
                "version": "abc",
            }
            for name in names
        }
        night.write_built_from(str(self.state / night.BUILT_FROM), record)

    def output(self, name: str):
        filename = night.REBUILT_ON_CHANGE[name].filename
        return self.versioned / filename / f"{filename}.jsonl"

    def hold(self, name: str) -> None:
        """A copy of the pipeline's output on disk, as the nights keep it."""
        self.output(name).parent.mkdir(parents=True, exist_ok=True)
        self.output(name).write_text("held\n")

    def rebuild(self, name: str, code: int) -> None:
        """What `koryta <Name> --refresh <Name>` does to its output: writes it
        anew, or half of it before it fails."""
        self.output(name).parent.mkdir(parents=True, exist_ok=True)
        self.output(name).write_text("rebuilt\n" if code == 0 else "half")
        if self.clock is not None:
            self.clock += timedelta(minutes=self.rebuild_minutes)

    def read_secret(self, name: str) -> tuple[str | None, str]:
        self.secrets_read.append(name)
        if name in self.secrets:
            return self.secrets[name], ""
        return None, f"{name}: ERROR: PERMISSION_DENIED"

    def ran(self) -> list[str]:
        return [name for name, _, _ in self.commands]

    def command(self, name: str) -> tuple[list[str], dict]:
        [(argv, env)] = [(a, e) for n, a, e in self.commands if n == name]
        return argv, env

    def summary(self) -> dict:
        [name] = [n for n in self.objects if n.startswith(night.RUNS_PREFIX)]
        return json.loads(self.objects[name])

    def steps(self) -> dict[str, tuple[str, str]]:
        return {s["name"]: (s["state"], s["reason"]) for s in self.summary()["steps"]}


def check_of(argv: list[str]) -> str:
    if "src/tests/e2e" in argv:
        return "outputs"
    return "invariants" if "e2e" in argv else "tests"


@pytest.fixture
def world(monkeypatch, tmp_path) -> World:
    w = World(tmp_path)

    def stream(argv, env, timeout, log, on_start=lambda proc: None):
        name = os.path.basename(argv[0])
        if argv[1:3] == ["-m", "pytest"]:
            check = check_of(argv)
            name = f"pytest {check}"
            failed = w.failures[check]
            code = w.pytest_codes[check]
            if code is None:
                code = 1 if failed else 0
            w.commands.append((name, list(argv), dict(env)))
            return code, False
        if name == "koryta" and argv[1] != "--all-pipelines":
            name = f"koryta {argv[1]}"
            w.commands.append((name, list(argv), dict(env)))
            w.timeouts[name] = timeout
            w.rebuild(argv[1], w.codes[name])
            return w.codes[name], False
        if "--companies-only" in argv:
            name = f"{name} --companies-only"
        w.commands.append((name, list(argv), dict(env)))
        return w.codes[name], False

    def failed_tests(report):
        for check in night.CHECKS:
            if report.endswith(f"-{check}.xml"):
                return w.failures[check]
        raise AssertionError(report)

    class Bucket:
        def create_object(self, bucket, name, data, content_type):
            assert name not in w.objects, f"{name} written twice"
            w.objects[name] = data
            return f"gs://{bucket}/{name}"

    def record(job_id, **kwargs):
        w.runs.append(RecordingRun(job_id, **kwargs))
        return w.runs[-1]

    monkeypatch.setattr(night, "stream", stream)
    monkeypatch.setattr(night, "failed_tests", failed_tests)
    monkeypatch.setattr(
        night, "budget_warnings", lambda report: w.of_check(w.warnings, report)
    )
    monkeypatch.setattr(
        night, "budget_slack", lambda report: w.of_check(w.slack, report)
    )
    monkeypatch.setattr(night, "newest_export", lambda client: w.export)
    monkeypatch.setattr(night, "last_failures", lambda client, before: w.last)
    monkeypatch.setattr(night, "Client", Bucket)
    monkeypatch.setattr(night, "JobRun", record)
    monkeypatch.setattr(night.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(
        night,
        "utc_now",
        lambda: datetime.fromisoformat(FRESH[:19] + "+00:00") + timedelta(minutes=30),
    )
    monkeypatch.setattr(night, "tidy", lambda keep_days, today: (0, 0))
    monkeypatch.setenv("KORYTA_NIGHTLY_LOGS", str(tmp_path / "logs"))
    monkeypatch.setenv("KORYTA_COMPRESSOR", "/var/lib/koryta-nightly/bin/compressor")
    monkeypatch.delenv("REJESTR_KEY", raising=False)
    monkeypatch.delenv("KORYTA_REJESTR_SECRET", raising=False)
    monkeypatch.setattr(night, "read_secret", w.read_secret)
    monkeypatch.setattr(sys, "argv", ["koryta_nightly"])
    monkeypatch.setattr(night, "source_trees", w.source_trees)
    monkeypatch.setattr(night, "VERSIONED_DIR", str(w.versioned))
    monkeypatch.setenv("STATE_DIRECTORY", str(w.state))
    # Every held pipeline built here from its code as it is: nothing to
    # rebuild, unless a test says otherwise.
    w.record_built(*night.REBUILT_ON_CHANGE)
    return w


# ---------------------------------------------------------------------------
# A night that goes as planned


def test_a_good_night_runs_every_step_in_order_and_exits_0(world):
    assert night.main([]) == 0

    assert world.ran() == [
        "compressor",
        "compressor",
        "koryta_scrape_krs_free",
        "koryta_krs_register_owners",
        "koryta_krs_odpis",
        "koryta_scrape_krs_paid",
        "koryta",
        "pytest tests",
        "pytest outputs",
        "pytest invariants",
        "koryta_people_import --companies-only",
        "koryta_people_import",
        "koryta_score_import",
    ]
    assert set(world.steps().values()) == {("succeeded", "")} | {
        ("succeeded", FRESH),
        ("succeeded", "usunięto 0 plików kopii i 0 wyników"),
    }
    run = world.runs[0]
    assert (run.job, run.kwargs["unit"]) == ("nightly", "kroków")
    assert run.ending()["state"] == "succeeded"


def test_the_reprocess_rebuilds_all_but_the_slow_sources_and_the_articles(world):
    night.main([])

    argv, env = world.command("koryta")
    assert argv[1] == "--all-pipelines"
    assert "--refresh" in argv and argv[argv.index("--refresh") + 1] == "all"
    for held in ("ProcessWiki", "PeoplePKW", "CruDump", "FirstNameFreq", "PeopleKMGP"):
        assert f":{held}" in argv
    # KorytaDiffer reads every export ever taken and writes nothing, and
    # PeopleScoreCoverage every export since August for nobody downstream;
    # DomainToRegion copies a gitignored file only the article branch reads;
    # the BIP documents read a crawl queue's Postgres the VM does not run.
    for excluded in (
        "ArticleParsed",
        "ProcessWikiNer",
        "KorytaDiffer",
        "PeopleScoreCoverage",
        "DomainToRegion",
        "BipUrlsClassified",
        "BipDocumentsParsed",
    ):
        assert excluded in argv
    assert argv[-3:] == ["--keep-going", "--assume-yes", "--all"]
    # Backed up as whoever runs it - USERNAME=main on the VM.
    assert "DISABLE_BACKUP" not in env or env["DISABLE_BACKUP"] != "1"


def test_the_checks_write_nothing_and_the_invariants_read_tonights_export(world):
    night.main([])

    for check in night.CHECKS:
        _, env = world.command(f"pytest {check}")
        assert env["DISABLE_BACKUP"] == "1"
    argv, env = world.command("pytest invariants")
    assert env["KORYTA_EXPORT"] == FRESH
    assert "--ignore=src/tests/pipelines/test_rejestrio_coverage.py" in argv
    argv, env = world.command("pytest outputs")
    assert (env["KORYTA_E2E_TIER"], env["KORYTA_E2E_STRICT"]) == ("full", "1")


def test_the_people_go_up_capped_in_priority_order_from_what_is_on_disk(world):
    night.main(["--max-uploads", "50", "--recent-days", "14"])

    argv, _ = world.command("koryta_people_import")
    assert argv[argv.index("--scope") + 1] == "priority"
    assert argv[argv.index("--max-uploads") + 1] == "50"
    assert argv[argv.index("--recent-days") + 1] == "14"
    assert argv[argv.index("--max-odpis-only-current") + 1] == "10"
    assert argv[argv.index("--max-rejestrio-current") + 1] == "50"
    assert argv[argv.index("--max-published") + 1] == "10"
    assert argv[argv.index("--refresh") + 1] == "none"
    assert "--dry-run" not in argv


def test_the_people_compare_with_the_export_the_export_step_took(world, monkeypatch):
    """A night forced at three, the 04:00 export not taken yet: the export
    step takes one taken by hand at eleven, inside its six hours, and the
    people step is told to compare with that one, which its own rule -
    today's, at four or later - would refuse."""
    eleven = "2026-10-03T21:00:12.004Z"
    world.export = eleven
    monkeypatch.setattr(
        night, "utc_now", lambda: datetime.fromisoformat("2026-10-04T01:00:00+00:00")
    )

    assert night.main([]) == 0

    assert world.steps()["export"] == ("succeeded", eleven)
    argv, _ = world.command("koryta_people_import")
    assert argv[argv.index("--export") + 1] == eleven


def test_the_night_makes_ten_pages_for_people_only_an_odpis_names_in_older_posts(
    world,
):
    """Szymon's choice of 2026-10-11; 0 makes none."""
    night.main(["--max-odpis-only-current", "0"])

    argv, _ = world.command("koryta_people_import")
    assert argv[argv.index("--max-odpis-only-current") + 1] == "0"


def test_the_night_makes_fifty_pages_for_people_with_an_entry_in_older_posts(
    world,
):
    """Szymon's choice of 2026-10-16, any post counting; 0 makes none."""
    night.main(["--max-rejestrio-current", "0"])

    argv, _ = world.command("koryta_people_import")
    assert argv[argv.index("--max-rejestrio-current") + 1] == "0"


def test_the_published_pages_a_night_changes_stay_capped_as_it_sends_more(world):
    """Szymon, 2026-10-15: however many people a night sends, it changes no
    more published pages than --max-published, so that the review keeps up."""
    night.main(["--max-uploads", "1000", "--max-published", "50"])

    argv, _ = world.command("koryta_people_import")
    assert argv[argv.index("--max-uploads") + 1] == "1000"
    assert argv[argv.index("--max-published") + 1] == "50"


def test_the_companies_the_people_need_go_up_first_planned_as_the_people_are(world):
    """Szymon, 2026-10-15: the companies tonight's people name that the export
    has no page for, created before them, so that no job of theirs waits for
    the uploader to create its company on the way."""
    night.main(["--max-uploads", "150", "--max-published", "20"])

    ran = world.ran()
    assert ran.index("koryta_people_import --companies-only") == (
        ran.index("koryta_people_import") - 1
    )
    companies, _ = world.command("koryta_people_import --companies-only")
    people, _ = world.command("koryta_people_import")
    assert companies[-1] == "--companies-only"
    # The same plan: every flag the people get, in the step's own time.
    minutes = people.index("--max-minutes") + 1
    assert (companies[minutes], people[minutes]) == ("20", "60")
    assert companies[:minutes] + companies[minutes + 1 : -1] == (
        people[:minutes] + people[minutes + 1 :]
    )
    assert companies[companies.index("--export") + 1] == FRESH
    assert world.steps()["companies"] == ("succeeded", "")


SKARB = "skarb-panstwa:treasury:100:new=50"


def test_the_priority_groups_and_the_fill_reach_both_steps_that_plan_people(world):
    """Szymon, 2026-10-27: groups of companies whose people go first, defined
    in flags. The companies step plans tonight's people as the people step
    does, so both are given them, in order."""
    obrona = "obrona:category=obronnosc:20"
    night.main(
        ["--priority-group", SKARB, "--priority-group", obrona]
        + ["--fill-rejestrio-current"]
    )

    for name in ("koryta_people_import", "koryta_people_import --companies-only"):
        argv, _ = world.command(name)
        groups = [argv[n + 1] for n, a in enumerate(argv) if a == "--priority-group"]
        assert groups == [SKARB, obrona]
        assert "--fill-rejestrio-current" in argv


def test_a_night_given_no_group_plans_as_before(world):
    night.main([])

    argv, _ = world.command("koryta_people_import")
    assert "--priority-group" not in argv
    assert "--fill-rejestrio-current" not in argv


@pytest.mark.parametrize(
    "argv",
    [
        ["--priority-group", "skarb:prokuratoria:100"],
        ["--priority-group", "skarb:treasury:100:new=200"],
        ["--priority-group", SKARB, "--priority-group", "skarb-panstwa:krs=1:5"],
    ],
)
def test_a_group_the_people_step_would_refuse_is_refused_before_the_night(world, argv):
    with pytest.raises(SystemExit):
        night.main(argv)

    assert world.ran() == []


def test_a_held_upload_skips_the_companies_and_reports_the_people_as_held(world):
    world.export = STALE

    assert night.main([]) == night.EXIT_TRY_LATER

    steps = world.steps()
    assert steps["companies"] == (
        "skipped",
        "pominięte - osoby wstrzymane: nie ma dzisiejszej kopii bazy",
    )
    assert steps["people"] == ("held", "wstrzymane: nie ma dzisiejszej kopii bazy")
    assert not [name for name in world.ran() if "people_import" in name]
    ending = world.runs[-1].ending()
    assert ending["stop_reason"] == (
        "people: held - wstrzymane: nie ma dzisiejszej kopii bazy"
    )
    assert not [line for line in ending["errors"] if line.startswith("companies")]


def test_what_the_companies_step_leaves_or_breaks_does_not_hold_the_people(world):
    world.codes["koryta_people_import --companies-only"] = night.EXIT_TRY_LATER

    assert night.main([]) == 0

    assert world.steps()["companies"] == ("partial", "zostało na następny raz")
    assert world.steps()["people"] == ("succeeded", "")

    world.commands.clear()
    world.objects.clear()
    world.codes["koryta_people_import --companies-only"] = 1

    assert night.main([]) == night.EXIT_FAILED

    assert world.steps()["companies"] == ("failed", "kod wyjścia 1")
    assert world.steps()["people"] == ("succeeded", "")


def test_a_people_dry_run_creates_no_company_either(world):
    night.main(["--people-dry-run"])

    argv, _ = world.command("koryta_people_import --companies-only")
    assert argv[-2:] == ["--dry-run", "--companies-only"]


def test_the_scores_go_up_after_the_people_within_the_steps_time(world):
    night.main([])

    argv, env = world.command("koryta_score_import")
    assert argv[argv.index("--max-minutes") + 1] == "30"
    assert "--dry-run" not in argv
    # The site's people read again: an export taken by hand later the same day
    # is otherwise not seen, as their outputs are named by the day.
    refreshed = [argv[i + 1] for i, arg in enumerate(argv) if arg == "--refresh"]
    assert refreshed == ["KorytaPeople", "KorytaVotes", "KorytaFacts", "CompanyScores"]
    # Backed up as whoever runs it, as the reprocess: the models it rebuilds
    # are tonight's newest.
    assert env.get("DISABLE_BACKUP") != "1"


def test_rejestr_io_is_bought_for_what_the_free_sources_failed_under_a_daily_cap(
    world,
):
    night.main([])

    argv, env = world.command("koryta_scrape_krs_paid")
    assert argv[argv.index("--scope") + 1] == "fallback"
    assert argv[argv.index("--max-calls") + 1] == "50"
    # The key goes to the job in its environment, never on its command line,
    # and to no other step.
    assert world.secrets_read == ["rejestr-io-key"]
    assert env["REJESTR_KEY"] == "a-key"
    assert "a-key" not in argv
    for name, _, other in world.commands:
        if name != "koryta_scrape_krs_paid":
            assert "REJESTR_KEY" not in other, name

    world.commands.clear()
    world.objects.clear()
    night.main(["--paid-max-calls", "120"])

    argv, _ = world.command("koryta_scrape_krs_paid")
    assert argv[argv.index("--max-calls") + 1] == "120"


def test_without_the_rejestr_io_key_the_paid_step_is_skipped_and_holds_nothing(
    world,
):
    world.secrets.clear()

    assert night.main([]) == 0

    assert "koryta_scrape_krs_paid" not in world.ran()
    assert world.steps()["krs_paid"] == ("skipped", "brak klucza rejestr.io")
    assert world.steps()["people"] == ("succeeded", "")
    # Why, for whoever reads the log: the secret's name and gcloud's answer.
    [log] = [n for n in world.objects if n.startswith(night.LOGS_PREFIX)]
    assert (
        b"No rejestr.io key: rejestr-io-key: ERROR: PERMISSION_DENIED"
        in (world.objects[log])
    )


def test_the_key_in_the_environment_wins_and_an_empty_secret_name_turns_it_off(
    world, monkeypatch
):
    monkeypatch.setenv("REJESTR_KEY", "a-hand-run-key")

    night.main(["--only", "krs_paid"])

    _, env = world.command("koryta_scrape_krs_paid")
    assert env["REJESTR_KEY"] == "a-hand-run-key"
    assert world.secrets_read == []

    monkeypatch.delenv("REJESTR_KEY")
    monkeypatch.setenv("KORYTA_REJESTR_SECRET", "")
    world.commands.clear()
    world.objects.clear()

    night.main(["--only", "krs_paid"])

    assert world.ran() == [] and world.secrets_read == []
    assert world.steps()["krs_paid"] == ("skipped", "brak klucza rejestr.io")


def test_a_secret_is_read_with_gcloud_and_its_value_never_said(monkeypatch):
    calls = []

    def run(argv, **kwargs):
        calls.append(argv)
        if argv[-2] == "--secret=rejestr-io-key":
            return subprocess.CompletedProcess(argv, 0, "the-key\n", "")
        return subprocess.CompletedProcess(
            argv, 1, "", "ERROR: (gcloud.secrets.versions.access) NOT_FOUND\nmore"
        )

    monkeypatch.setattr(night.subprocess, "run", run)

    assert night.read_secret("rejestr-io-key") == ("the-key", "")
    assert night.read_secret("other") == (
        None,
        "other: ERROR: (gcloud.secrets.versions.access) NOT_FOUND",
    )
    assert calls[0][:5] == ["gcloud", "secrets", "versions", "access", "latest"]


def test_a_cap_of_nothing_buys_nothing(world):
    assert night.main(["--paid-max-calls", "0"]) == 0

    assert "koryta_scrape_krs_paid" not in world.ran()
    assert world.steps()["krs_paid"] == ("skipped", "limit zapytań 0")


def test_what_the_paid_step_leaves_or_breaks_does_not_hold_the_people(world):
    world.codes["koryta_scrape_krs_paid"] = night.EXIT_TRY_LATER

    assert night.main([]) == 0

    assert world.steps()["krs_paid"] == ("partial", "zostało na następny raz")

    world.commands.clear()
    world.objects.clear()
    world.codes["koryta_scrape_krs_paid"] = 1

    assert night.main([]) == night.EXIT_FAILED

    assert world.steps()["krs_paid"] == ("failed", "kod wyjścia 1")
    assert world.steps()["people"] == ("succeeded", "")


def test_the_register_reads_the_days_new_registrations_and_no_backlog(world):
    night.main([])

    argv, _ = world.command("koryta_krs_register_owners")
    assert "--new-registrations" in argv
    # The backlog's pace is decide-register-sweep-pace's: none until then.
    assert argv[argv.index("--reads") + 1] == "0"
    # Inside the step's 30 minutes, so the job stops itself, writes what it
    # read and reports, rather than be stopped mid-read.
    assert argv[argv.index("--max-minutes") + 1] == "25"

    world.commands.clear()
    world.objects.clear()
    night.main(["--register-backlog", "2000"])

    argv, _ = world.command("koryta_krs_register_owners")
    assert argv[argv.index("--reads") + 1] == "2000"


def test_what_the_register_step_leaves_or_breaks_holds_nothing(world):
    world.codes["koryta_krs_register_owners"] = night.EXIT_TRY_LATER

    assert night.main([]) == 0

    assert world.steps()["krs_register"] == ("partial", "zostało na następny raz")
    assert world.steps()["people"] == ("succeeded", "")

    world.commands.clear()
    world.objects.clear()
    world.codes["koryta_krs_register_owners"] = 1

    assert night.main([]) == night.EXIT_FAILED

    assert world.steps()["krs_register"] == ("failed", "kod wyjścia 1")
    for step in ("krs_odpis", "krs_paid", "reprocess", "people", "scores"):
        assert world.steps()[step] == ("succeeded", ""), step


def test_the_odpisy_go_to_the_bulletins_companies_then_public_ones_with_none(
    world, capsys
):
    night.main([])

    argv, _ = world.command("koryta_krs_odpis")
    assert argv[1:3] == ["--graph", "--changed-since"]
    # The gap the bulletin never closes, public only by default, and under
    # the step's one cap: the service tires after ~1,000 documents a run.
    assert argv[argv.index("--missing") + 1] == "public"
    assert argv[argv.index("--max") + 1] == "300"

    for scope, expected in (("all", ["--missing", "all"]), ("none", [])):
        world.commands.clear()
        world.objects.clear()
        night.main(["--odpis-missing", scope, "--only", "krs_odpis"])

        argv, _ = world.command("koryta_krs_odpis")
        assert argv[4:-2] == ["--queue", *expected], scope

    night.main(["--dry-run", "--only", "krs_odpis"])
    assert (
        "koryta_krs_odpis --graph --changed-since <yesterday> --queue "
        "--missing public --max 300" in capsys.readouterr().out
    )


def test_the_odpisy_go_to_the_paid_queues_companies_before_the_gap(world, capsys):
    """krs_paid buys a company only once its free odpis did not come, so the
    odpis step asks for the queue's: one nothing asks for is never bought."""
    night.main(["--only", "krs_odpis"])

    argv, _ = world.command("koryta_krs_odpis")
    assert argv.index("--queue") < argv.index("--missing")

    world.commands.clear()
    world.objects.clear()
    night.main(["--no-odpis-queue", "--only", "krs_odpis"])

    argv, _ = world.command("koryta_krs_odpis")
    assert "--queue" not in argv
    assert argv[argv.index("--missing") + 1] == "public"

    night.main(["--dry-run", "--no-odpis-queue", "--only", "krs_odpis"])
    assert (
        "koryta_krs_odpis --graph --changed-since <yesterday> --missing public "
        "--max 300" in capsys.readouterr().out
    )


def test_the_mirror_is_made_one_host_at_a_time(world):
    night.main([])

    hosts = [
        argv[argv.index("-hostname") + 1]
        for name, argv, _ in world.commands
        if name == "compressor"
    ]
    assert hosts == ["rejestr.io", "api-krs.ms.gov.pl"]


def test_the_summary_and_the_log_land_in_the_shared_cache(world):
    night.main([])

    summary = world.summary()
    assert (summary["export"], summary["export_fresh"]) == (FRESH, True)
    assert summary["failures"] == {"tests": [], "outputs": [], "invariants": []}
    assert summary["warnings"] == {}
    assert summary["slack"] == {}
    assert summary["log"].startswith(f"gs://{SHARED_BUCKET}/{night.LOGS_PREFIX}")
    [log] = [n for n in world.objects if n.startswith(night.LOGS_PREFIX)]
    assert b"[koryta_people_import]" not in world.objects[log]  # faked: no output
    assert b"night over: succeeded" in world.objects[log]


# ---------------------------------------------------------------------------
# The held pipelines, when their code changes


def test_a_held_pipeline_whose_code_changed_is_rebuilt_alone_before_the_reprocess(
    world,
):
    world.trees["data/pipelines/src/scrapers/pkw"] = "a-new-tree"
    world.hold("PeoplePKW")

    assert night.main([]) == 0

    ran = world.ran()
    assert ran.index("koryta PeoplePKW") == ran.index("koryta") - 1
    assert [name for name in ran if name.startswith("koryta ")] == ["koryta PeoplePKW"]
    argv, env = world.command("koryta PeoplePKW")
    assert argv[1:4] == ["PeoplePKW", "--refresh", "PeoplePKW"]
    # Nothing else held is rebuilt along with it.
    for other in ("ProcessWiki", "CruDump", "Regions"):
        assert f":{other}" in argv
    assert ":PeoplePKW" not in argv
    # Backed up as main, as the reprocess's outputs are, for everybody to
    # restore.
    assert env.get("DISABLE_BACKUP") != "1"
    # And the reprocess still holds it, reading what the rebuild wrote.
    argv, _ = world.command("koryta")
    assert ":PeoplePKW" in argv
    assert world.output("PeoplePKW").read_text() == "rebuilt\n"
    assert not os.path.exists(f"{world.output('PeoplePKW')}.held")

    why = "zmiana w data/pipelines/src/scrapers/pkw"
    assert world.steps()["rebuild_held"] == ("succeeded", "przebudowano: PeoplePKW")
    assert world.summary()["rebuilt"] == {"PeoplePKW": why}
    assert world.summary()["not_rebuilt"] == {}
    assert world.runs[-1].ending()["counters"]["przebudowane"] == 1
    built = world.built_from()["PeoplePKW"]
    assert built["sources"]["data/pipelines/src/scrapers/pkw"] == "a-new-tree"
    assert built["sources"]["data/pipelines/src/util/polish.py"] == world.tree(
        "data/pipelines/src/util/polish.py"
    )

    # The next night it is as recorded: nothing to do.
    world.commands.clear()
    world.objects.clear()

    assert night.main([]) == 0

    assert "koryta PeoplePKW" not in world.ran()
    assert world.steps()["rebuild_held"] == ("succeeded", "")
    assert world.runs[-1].ending()["counters"]["przebudowane"] == 0


def test_with_no_record_each_rebuildable_held_pipeline_is_rebuilt_once(world):
    (world.state / night.BUILT_FROM).unlink()

    assert night.main([]) == 0

    rebuilt = [name for name in world.ran() if name.startswith("koryta ")]
    assert rebuilt == [f"koryta {name}" for name in night.REBUILT_ON_CHANGE]
    # Not the wiki's 40 minutes, nor the dump only the CRU database gives.
    assert "koryta ProcessWiki" not in rebuilt and "koryta CruDump" not in rebuilt
    assert set(world.summary()["rebuilt"].values()) == {"pierwsza przebudowa tutaj"}
    assert set(world.built_from()) == set(night.REBUILT_ON_CHANGE)

    world.commands.clear()
    world.objects.clear()

    night.main([])

    assert [name for name in world.ran() if name.startswith("koryta ")] == []


def test_an_entry_edited_into_something_else_is_no_record(world):
    record = world.built_from()
    record["PeoplePKW"] = "rebuild me"
    record["Regions"]["sources"] = None
    night.write_built_from(str(world.state / night.BUILT_FROM), record)

    assert night.main([]) == 0

    # Those two are due once, the rest are as recorded, and the step goes on
    # past both rather than failing on the first.
    assert world.summary()["rebuilt"] == {
        "Regions": "pierwsza przebudowa tutaj",
        "PeoplePKW": "pierwsza przebudowa tutaj",
    }
    assert world.steps()["rebuild_held"][0] == "succeeded"
    assert world.built_from()["PeoplePKW"]["sources"]


def test_a_failed_rebuild_puts_the_held_copy_back_and_holds_nothing(world):
    world.trees["data/pipelines/src/scrapers/pkw"] = "a-new-tree"
    world.trees["data/pipelines/src/scrapers/map/postal_codes.py"] = "a-new-blob"
    world.hold("PeoplePKW")
    world.codes["koryta PeoplePKW"] = 1

    assert night.main([]) == 0

    # The half it wrote is gone, the copy the nights held is back.
    assert world.output("PeoplePKW").read_text() == "held\n"
    assert not os.path.exists(f"{world.output('PeoplePKW')}.held")
    assert world.steps()["rebuild_held"] == (
        "partial",
        "nie przebudowano: PeoplePKW (kod wyjścia 1) - zostają kopie z dysku; "
        "przebudowano: PostalCodes",
    )
    assert world.summary()["not_rebuilt"] == {"PeoplePKW": "kod wyjścia 1"}
    for step in ("reprocess", "people", "scores"):
        assert world.steps()[step] == ("succeeded", ""), step
    ending = world.runs[-1].ending()
    assert ending["state"] == "succeeded"
    assert ending["errors"] == [
        f"rebuild_held: partial - {world.steps()['rebuild_held'][1]}"
    ]
    # Nothing recorded, so the next night tries again.
    built = world.built_from()
    assert built["PeoplePKW"]["sources"]["data/pipelines/src/scrapers/pkw"] != (
        "a-new-tree"
    )
    assert built["PostalCodes"]["sources"] == {
        "data/pipelines/src/scrapers/map/postal_codes.py": "a-new-blob"
    }


def test_a_rebuild_with_no_copy_on_disk_to_keep_leaves_none(world):
    world.trees["data/pipelines/src/scrapers/pkw"] = "a-new-tree"
    world.codes["koryta PeoplePKW"] = 1

    assert night.main([]) == 0

    # The half it wrote is taken away: the reprocess reads whatever file
    # stands there as "up to date", and restores the pipeline, or builds it,
    # only when there is none - as it did before.
    assert not world.output("PeoplePKW").exists()
    assert world.steps()["rebuild_held"][0] == "partial"
    assert world.steps()["reprocess"] == ("succeeded", "")


def test_a_rebuild_that_cannot_be_run_puts_the_held_copy_back(world, monkeypatch):
    world.trees["data/pipelines/src/scrapers/pkw"] = "a-new-tree"
    world.hold("PeoplePKW")
    stream = night.stream

    def no_disk_left(argv, env, timeout, log, on_start=lambda proc: None):
        if argv[1:2] == ["PeoplePKW"]:
            raise OSError(28, "No space left on device")
        return stream(argv, env, timeout, log, on_start)

    monkeypatch.setattr(night, "stream", no_disk_left)

    assert night.main([]) == 0

    # Back where the reprocess, which holds it, reads it - not restored over
    # from the shared cache for want of a file.
    assert world.output("PeoplePKW").read_text() == "held\n"
    assert not os.path.exists(f"{world.output('PeoplePKW')}.held")
    assert world.summary()["not_rebuilt"] == {
        "PeoplePKW": "wyjątek OSError: [Errno 28] No space left on device"
    }
    assert world.steps()["people"] == ("succeeded", "")


def test_the_rebuilds_share_the_steps_time(world, monkeypatch):
    (world.state / night.BUILT_FROM).unlink()
    world.clock = datetime(2026, 10, 4, 5, 30, tzinfo=warsaw_tz)
    world.rebuild_minutes = 15
    monkeypatch.setattr(night, "warsaw_now", lambda: world.clock)

    assert night.main(["--only", "rebuild_held"]) == 0

    # Thirty minutes: all of them for the first, what is left for the next,
    # and none for the rest - which the next night rebuilds.
    assert world.timeouts == {"koryta Regions": 30 * 60, "koryta PostalCodes": 15 * 60}
    names = list(night.REBUILT_ON_CHANGE)
    assert list(world.summary()["rebuilt"]) == names[:2]
    assert world.summary()["not_rebuilt"] == dict.fromkeys(names[2:], "brak czasu")
    assert set(world.built_from()) == set(names[:2])


def test_a_night_stopped_mid_rebuild_puts_the_held_copy_back(world, monkeypatch):
    world.trees["data/pipelines/src/scrapers/map/teryt.py"] = "a-new-blob"
    world.hold("Regions")
    world.hold("PeoplePKW")
    stream = night.stream

    def stopped_in_the_rebuild(argv, env, timeout, log, on_start=lambda proc: None):
        if argv[1:2] == ["Regions"]:
            signal.raise_signal(signal.SIGTERM)
            world.codes["koryta Regions"] = -15
        return stream(argv, env, timeout, log, on_start)

    monkeypatch.setattr(night, "stream", stopped_in_the_rebuild)

    assert night.main([]) == night.EXIT_TRY_LATER

    assert world.output("Regions").read_text() == "held\n"
    assert world.summary()["not_rebuilt"] == {
        "Regions": "kod wyjścia -15",
        "PeoplePKW": "SIGTERM",
    }
    assert "koryta PeoplePKW" not in world.ran()
    assert world.steps()["reprocess"] == ("skipped", "SIGTERM")


def test_a_copy_a_killed_night_moved_aside_is_put_back_first(world):
    out = world.output("PeoplePKW")
    out.parent.mkdir(parents=True)
    out.write_text("half")
    (out.parent / f"{out.name}.held").write_text("held\n")

    night.main(["--only", "rebuild_held"])

    assert out.read_text() == "held\n"
    assert not (out.parent / f"{out.name}.held").exists()


def test_when_git_cannot_say_nothing_is_rebuilt_and_the_step_says_why(world):
    world.unreadable = "fatal: not a git repository"
    (world.state / night.BUILT_FROM).unlink()

    assert night.main([]) == 0

    assert [name for name in world.ran() if name.startswith("koryta ")] == []
    assert world.steps()["rebuild_held"][0] == "partial"
    assert world.summary()["not_rebuilt"]["PeoplePKW"] == (
        "nie odczytano kodu: fatal: not a git repository"
    )
    assert world.steps()["people"] == ("succeeded", "")


def test_the_dry_run_names_the_rebuilds_due_and_records_nothing(world, capsys):
    world.trees["data/pipelines/src/analysis/utils/names.py"] = "a-new-blob"
    before = world.built_from()

    night.main(["--dry-run", "--only", "rebuild_held"])

    out = capsys.readouterr().out
    assert (
        "now NamesCountByRegion (zmiana w data/pipelines/src/analysis/utils/names.py), "
        "FirstNameFreq (zmiana w data/pipelines/src/analysis/utils/names.py)"
    ) in out
    assert world.ran() == [] and world.built_from() == before


def test_source_trees_names_each_path_as_the_checked_out_commit_has_it(tmp_path):
    if shutil.which("git") is None:
        pytest.skip("no git")
    git = ["git", "-c", "user.name=t", "-c", "user.email=t@t"]
    git += ["-c", "commit.gpgsign=false", "-C", str(tmp_path)]
    (tmp_path / "data" / "pkw").mkdir(parents=True)
    (tmp_path / "data" / "pkw" / "process.py").write_text("one\n")
    (tmp_path / "polish.py").write_text("two\n")
    subprocess.run([*git, "init", "-q"], check=True)
    subprocess.run([*git, "add", "."], check=True)
    subprocess.run([*git, "commit", "-q", "-m", "first"], check=True)

    def trees():
        # From a directory below the top, as the night runs from
        # data/pipelines: the paths are still the repository's.
        return night.source_trees(
            ["data/pkw", "polish.py"], root=str(tmp_path / "data")
        )

    first, why = trees()
    assert why == "" and first is not None and set(first) == {"data/pkw", "polish.py"}
    # An edit nobody committed is not the checkout's code: the VM has none.
    (tmp_path / "data" / "pkw" / "process.py").write_text("changed\n")
    assert trees()[0] == first
    subprocess.run([*git, "commit", "-q", "-am", "second"], check=True)
    second, _ = trees()
    assert second is not None
    assert second["data/pkw"] != first["data/pkw"]
    assert second["polish.py"] == first["polish.py"]

    missing, why = night.source_trees(["data/gone"], root=str(tmp_path))
    assert missing is None and "data/gone" in why
    assert (
        night.source_trees(["x"], root=str(tmp_path / "data" / "pkw" / "process.py"))[0]
        is None
    )


def test_every_rebuildable_pipeline_is_held_and_its_sources_exist():
    # Every pipeline's module, which the night itself never imports.
    from pipelines import PIPELINES  # noqa: PLC0415

    by_name = {pipeline.__name__: pipeline for pipeline in PIPELINES}
    top = os.path.dirname(os.path.dirname(night.PROJECT_ROOT))
    for name, spec in night.REBUILT_ON_CHANGE.items():
        assert name in night.HELD, name
        pipeline = by_name[name]
        assert (pipeline.filename, pipeline.format) == (spec.filename, "jsonl"), name
        for path in spec.sources:
            assert os.path.exists(os.path.join(top, path)), path
    assert "ProcessWiki" not in night.REBUILT_ON_CHANGE
    assert "CruDump" not in night.REBUILT_ON_CHANGE


def test_every_held_name_is_a_pipeline():
    # `--refresh :<Name>` takes any name, where --exclude refuses one it does
    # not know: a misspelt one would hold nothing, and the pipeline it meant
    # would be rebuilt every night.
    from pipelines import PIPELINES  # noqa: PLC0415

    names = {pipeline.__name__ for pipeline in PIPELINES}
    assert set(night.HELD) - names == set()


# ---------------------------------------------------------------------------
# What holds the upload


def test_a_stale_export_holds_the_people_but_nothing_else(world):
    world.export = STALE

    assert night.main([]) == night.EXIT_TRY_LATER

    steps = world.steps()
    assert steps["export"][0] == "partial"
    assert steps["people"] == ("held", "wstrzymane: nie ma dzisiejszej kopii bazy")
    assert steps["scores"] == ("held", "wstrzymane: nie ma dzisiejszej kopii bazy")
    assert "koryta_people_import" not in world.ran()
    assert "koryta_score_import" not in world.ran()
    assert world.ran().count("compressor") == 2


def test_a_failed_reprocess_holds_what_reads_its_outputs(world):
    world.codes["koryta"] = 1

    assert night.main([]) == night.EXIT_FAILED

    steps = world.steps()
    assert steps["reprocess"] == ("failed", "kod wyjścia 1")
    for held in ("tests", "outputs", "people", "scores"):
        assert steps[held][0] == "held"
    # The export is checked whatever the pipelines did.
    assert steps["invariants"][0] == "succeeded"


def test_a_test_failing_tonight_that_passed_last_night_holds_the_people(world):
    world.last = {"tests": [], "outputs": [], "invariants": ["a::known"]}
    world.failures["invariants"] = ["a::known", "b::new"]

    assert night.main([]) == night.EXIT_TRY_LATER

    assert world.steps()["people"] == ("held", "wstrzymane: nowe błędy testów: b::new")
    assert world.steps()["scores"] == ("held", "wstrzymane: nowe błędy testów: b::new")
    assert world.summary()["new_failures"] == ["b::new"]


def test_failures_known_from_last_night_do_not_hold_the_people(world):
    world.last = {"tests": [], "outputs": [], "invariants": ["a::known"]}
    world.failures["invariants"] = ["a::known"]

    assert night.main([]) == 0

    assert world.steps()["invariants"] == ("partial", "1 nie przechodzi")
    assert world.steps()["people"] == ("succeeded", "")


def test_a_budget_eaten_into_warns_and_holds_nothing(world):
    grew = "src.tests.pipelines.test_invariants::test_grew"
    world.warnings["invariants"] = [night.OverBudget(grew, 25, 24, 34)]

    assert night.main([]) == 0

    assert world.steps()["invariants"] == ("succeeded", "1 z ostrzeżeniem")
    assert world.steps()["people"] == ("succeeded", "")
    assert world.steps()["scores"] == ("succeeded", "")
    assert world.summary()["warnings"] == {
        "invariants": [{"test": grew, "count": 25, "known": 24, "limit": 34}]
    }
    # The run says so, apart from its errors: the page and the morning
    # check read it there.
    ending = world.runs[-1].ending()
    assert (ending["state"], ending["errors"]) == ("succeeded", [])
    assert ending["warnings"] == [
        "test_invariants::test_grew: 25 przy znanych 24, nie przejdzie powyżej 34"
    ]
    [log] = [n for n in world.objects if n.startswith(night.LOGS_PREFIX)]
    assert (
        "night over: succeeded; warning - test_invariants::test_grew: 25 przy "
        "znanych 24"
    ) in world.objects[log].decode()


def test_a_budget_to_lower_is_listed_and_holds_nothing(world):
    fell = "src.tests.pipelines.test_invariants::test_fell"
    world.slack["invariants"] = [night.Slack(fell, 0, 5)]

    assert night.main([]) == 0

    assert world.steps()["invariants"] == ("succeeded", "")
    assert world.steps()["people"] == ("succeeded", "")
    assert world.steps()["scores"] == ("succeeded", "")
    assert world.summary()["slack"] == {
        "invariants": [{"test": fell, "count": 0, "known": 5}]
    }
    assert world.summary()["warnings"] == {}
    # Not a warning, and nothing wrong: the run says nothing of it.
    ending = world.runs[-1].ending()
    assert (ending["state"], ending["stop_reason"]) == ("succeeded", None)
    assert (ending["errors"], ending["warnings"]) == ([], [])
    [log] = [n for n in world.objects if n.startswith(night.LOGS_PREFIX)]
    said = world.objects[log].decode()
    assert "1 budget to lower: test_invariants::test_fell 0 of 5" in said
    assert "night over: succeeded; all well" in said


def test_the_budgets_to_lower_are_one_line_across_the_checks(world):
    world.slack["tests"] = [night.Slack("src.a::test_x", 1, 3)]
    world.slack["invariants"] = [
        night.Slack("src.b::test_y[one]", 0, 24),
        night.Slack("src.b::test_z", 96, 394),
    ]

    assert night.main([]) == 0

    [log] = [n for n in world.objects if n.startswith(night.LOGS_PREFIX)]
    lines = [
        line for line in world.objects[log].decode().splitlines() if "to lower:" in line
    ]
    assert len(lines) == 1
    assert lines[0].endswith(
        "3 budgets to lower: a::test_x 1 of 3; b::test_y[one] 0 of 24; "
        "b::test_z 96 of 394"
    )


def test_a_check_says_what_fails_and_what_warns(world):
    world.last = {"tests": [], "outputs": [], "invariants": ["a::known"]}
    world.failures["invariants"] = ["a::known"]
    world.warnings["invariants"] = [
        night.OverBudget("a::grew", 25, 24, 34),
        night.OverBudget("b::grew", 3, 2, 12),
    ]

    assert night.main([]) == 0

    assert world.steps()["invariants"] == (
        "partial",
        "1 nie przechodzi, 2 z ostrzeżeniem",
    )
    assert world.steps()["people"] == ("succeeded", "")


def test_on_the_first_night_every_failure_is_the_baseline(world):
    world.last = None
    world.failures["tests"] = ["a::fails"]

    assert night.main([]) == 0

    assert world.summary()["new_failures"] == []
    assert world.steps()["people"][0] == "succeeded"


def test_a_check_that_gives_no_verdict_holds_the_people(world):
    world.failures["outputs"] = None  # no report written
    world.pytest_codes["outputs"] = 4

    assert night.main([]) == night.EXIT_FAILED

    assert world.steps()["outputs"] == ("failed", "bez wyniku (kod 4)")
    assert world.steps()["people"] == (
        "held",
        "wstrzymane: sprawdzenie outputs nie dało wyniku",
    )


def test_the_scores_do_not_wait_on_how_the_people_went(world):
    world.codes["koryta_people_import"] = 1

    assert night.main([]) == night.EXIT_FAILED

    assert world.steps()["people"] == ("failed", "kod wyjścia 1")
    assert world.steps()["scores"] == ("succeeded", "")
    assert world.ran()[-2:] == ["koryta_people_import", "koryta_score_import"]


def test_a_failed_score_upload_fails_the_night(world):
    world.codes["koryta_score_import"] = 1

    assert night.main([]) == night.EXIT_FAILED

    assert world.steps()["scores"] == ("failed", "kod wyjścia 1")
    assert world.steps()["tidy"][0] == "succeeded"


def test_a_job_leaving_work_for_tomorrow_is_not_a_bad_night(world):
    world.codes["koryta_scrape_krs_free"] = night.EXIT_TRY_LATER
    world.codes["koryta_people_import"] = night.EXIT_TRY_LATER

    assert night.main([]) == 0

    assert world.steps()["krs_free"] == ("partial", "zostało na następny raz")
    assert world.runs[0].ending()["state"] == "succeeded"


# ---------------------------------------------------------------------------
# What the night reports


def test_the_reason_reported_is_the_step_that_decided_the_night(world):
    # Ahead of the held upload in step order: the scrape's backlog and the
    # checks' known failure, which any night may have.
    world.codes["koryta_scrape_krs_free"] = night.EXIT_TRY_LATER
    world.last = {"tests": [], "outputs": [], "invariants": ["a::known"]}
    world.failures["invariants"] = ["a::known", "b::new"]

    assert night.main([]) == night.EXIT_TRY_LATER

    ending = world.runs[-1].ending()
    assert ending["stop_reason"] == (
        "people: held - wstrzymane: nowe błędy testów: b::new"
    )
    # Every step that did not simply succeed, in step order and in this
    # shape: /admin/procesy finds the held ones among them.
    assert ending["errors"] == [
        "krs_free: partial - zostało na następny raz",
        "invariants: partial - 2 nie przechodzi",
        "people: held - wstrzymane: nowe błędy testów: b::new",
        "scores: held - wstrzymane: nowe błędy testów: b::new",
    ]

    world.commands.clear()
    world.objects.clear()
    world.failures["invariants"] = ["a::known"]
    world.codes["koryta_score_import"] = 1

    assert night.main([]) == night.EXIT_FAILED

    assert world.runs[-1].ending()["stop_reason"] == "scores: failed - kod wyjścia 1"


def test_a_night_stopped_by_sigterm_says_so(world, monkeypatch):
    stream = night.stream

    def stopped_in_the_scrape(argv, env, timeout, log, on_start=lambda proc: None):
        if os.path.basename(argv[0]) == "koryta_scrape_krs_free":
            # Taken by the night's own handler, as systemd's would be.
            signal.raise_signal(signal.SIGTERM)
        return stream(argv, env, timeout, log, on_start)

    monkeypatch.setattr(night, "stream", stopped_in_the_scrape)
    world.codes["koryta_scrape_krs_free"] = night.EXIT_TRY_LATER

    assert night.main([]) == night.EXIT_TRY_LATER

    assert world.steps()["krs_odpis"] == ("skipped", "SIGTERM")
    ending = world.runs[-1].ending()
    assert (ending["state"], ending["stop_reason"]) == ("partial", "SIGTERM")


# ---------------------------------------------------------------------------
# Hand runs and the clock


def test_a_hand_run_of_one_step_is_not_held_by_the_steps_left_out(world):
    assert night.main(["--only", "people", "--people-dry-run"]) == 0

    assert world.ran() == ["koryta_people_import"]
    argv, _ = world.command("koryta_people_import")
    assert argv[-1] == "--dry-run"
    # No export step, no export to name: the job keeps its own rule.
    assert "--export" not in argv


def test_a_dry_run_runs_nothing_and_prints_the_plan(world, capsys):
    assert night.main(["--dry-run", "--skip", "krs_odpis"]) == 0

    assert world.ran() == [] and world.objects == {}
    out = capsys.readouterr().out
    assert "krs_odpis" not in out
    assert "koryta --all-pipelines" in out
    assert (
        "koryta <Name> --refresh <Name> for each held pipeline whose code changed "
        "since its last build here; now none"
    ) in out
    assert (
        "koryta_people_import --scope priority --max-uploads 100 "
        "--max-odpis-only-current 10 --max-rejestrio-current 50 "
        "--max-published 10" in out
    )
    assert "--export <the export step's>" in out
    assert (
        "--max-published 10 --export <the export step's> --companies-only: the "
        "companies the people step's people name that the export has no page "
        "for, created first" in out
    )
    assert "koryta_score_import" in out
    assert "koryta_scrape_krs_paid --scope fallback --max-calls 50" in out
    assert (
        "koryta_krs_register_owners --new-registrations --reads 0 --max-minutes 25"
        in out
    )


def test_the_plan_names_no_export_for_a_night_without_the_export_step(world, capsys):
    # As the people step runs then: on the job's own rule, no --export.
    assert night.main(["--dry-run", "--only", "people"]) == 0

    out = capsys.readouterr().out
    assert "koryta_people_import --scope priority" in out
    assert "--export" not in out


def test_past_the_stop_by_only_compress_and_tidy_run(world, monkeypatch):
    late = datetime(2026, 10, 4, 8, 45, tzinfo=warsaw_tz)
    monkeypatch.setattr(night, "warsaw_now", lambda: late)

    assert night.main(["--stop-by", "08:30"]) == 0

    assert world.ran() == ["compressor", "compressor"]
    assert world.steps()["reprocess"] == ("skipped", "koniec nocy (08:30)")


def test_stop_by_is_tomorrows_when_the_night_starts_before_midnight():
    args = night.parser().parse_args(["--stop-by", "8:30"])
    at = datetime(2026, 10, 3, 23, 50, tzinfo=warsaw_tz)

    minutes = night.minutes_until(args.stop_by, at)

    assert minutes == pytest.approx(8 * 60 + 40)


# ---------------------------------------------------------------------------
# The parts


def test_new_failures_compare_each_check_with_the_last_night_that_ran_it():
    last = {"tests": ["t::old"], "invariants": ["i::old"]}
    tonight = {
        "tests": ["t::old", "t::new"],
        "outputs": ["o::never-run-before"],
        "invariants": [],
    }

    assert night.new_failures(tonight, last) == ["t::new"]
    assert night.new_failures(tonight, None) == []


def test_failed_tests_reads_a_junit_report(tmp_path):
    report = tmp_path / "r.xml"
    report.write_text(
        '<testsuites><testsuite name="pytest">'
        '<testcase classname="src.a" name="test_ok"/>'
        '<testcase classname="src.a" name="test_bad"><failure message="x"/></testcase>'
        '<testcase classname="src.b" name="test_broken"><error message="y"/></testcase>'
        "</testsuite></testsuites>"
    )

    assert night.failed_tests(str(report)) == ["src.a::test_bad", "src.b::test_broken"]
    assert night.failed_tests(str(tmp_path / "missing.xml")) is None


def test_a_warning_names_its_test_by_module_and_parameters():
    over = night.OverBudget(
        "src.tests.pipelines.test_revisions::test_required_field_present"
        "[employed.name]",
        170,
        169,
        179,
    )

    assert over.said() == (
        "test_revisions::test_required_field_present[employed.name]: 170 przy "
        "znanych 169, nie przejdzie powyżej 179"
    )


def test_budget_warnings_reads_what_the_invariants_budgets_record(pytester):
    pytester.makeconftest(INVARIANTS_CONFTEST.read_text())
    pytester.makepyfile(
        test_budgets="""
        def test_kept(within_budget):
            assert within_budget(24, 24)

        def test_grew(within_budget):
            assert within_budget(25, 24)

        def test_at_the_limit(within_budget):
            assert within_budget(34, 24)

        def test_ran_out(within_budget):
            assert within_budget(35, 24)
        """
    )
    report = pytester.path / "report.xml"

    result = pytester.runpytest(f"--junitxml={report}", "-p", "no:cacheprovider")

    result.assert_outcomes(passed=3, failed=1)
    result.stdout.fnmatch_lines(
        ["*BudgetWarning: 25, up from the 24 known; fails past 34"]
    )
    assert night.failed_tests(str(report)) == ["test_budgets::test_ran_out"]
    assert night.budget_warnings(str(report)) == [
        night.OverBudget("test_budgets::test_at_the_limit", 34, 24, 34),
        night.OverBudget("test_budgets::test_grew", 25, 24, 34),
    ]
    assert night.budget_warnings(str(pytester.path / "missing.xml")) == []


def test_budget_slack_reads_what_the_invariants_budgets_record(pytester):
    pytester.makeconftest(INVARIANTS_CONFTEST.read_text())
    pytester.makepyfile(
        test_budgets="""
        def test_kept(within_budget):
            assert within_budget(24, 24)

        def test_fell(within_budget):
            assert within_budget(20, 24)

        def test_cleared(within_budget):
            assert within_budget(0, 24)

        def test_grew(within_budget):
            assert within_budget(25, 24)

        def test_none_known(within_budget):
            assert within_budget(0, 0)

        def test_lag_allowed(within_budget):
            assert within_budget(0, 5, allowance=True)

        def test_lag_past(within_budget):
            assert within_budget(6, 5, allowance=True)
        """
    )
    report = pytester.path / "report.xml"

    # In a process of its own: the conftest imports duckdb, which cannot be
    # imported a second time into this one once pytester has unloaded it
    # after the run in the test above.
    result = pytester.runpytest_subprocess(
        f"--junitxml={report}", "-p", "no:cacheprovider"
    )

    result.assert_outcomes(passed=7)
    # An allowance under its count is not a budget to lower.
    assert night.budget_slack(str(report)) == [
        night.Slack("test_budgets::test_cleared", 0, 24),
        night.Slack("test_budgets::test_fell", 20, 24),
    ]
    # Under the budget is not over it; an allowance grown past it is.
    assert night.budget_warnings(str(report)) == [
        night.OverBudget("test_budgets::test_grew", 25, 24, 34),
        night.OverBudget("test_budgets::test_lag_past", 6, 5, 15),
    ]
    assert night.budget_slack(str(pytester.path / "missing.xml")) == []


def test_the_newest_finished_export_is_found_past_a_running_one():
    class Blob:
        def __init__(self, exists):
            self._exists = exists

        def exists(self):
            return self._exists

    class Listing(list):
        prefixes = {
            "hostname=koryta.pl/date=2026-10-03T02:00:04.120Z/",
            "hostname=koryta.pl/date=2026-10-04T02:00:04.120Z/",
            "hostname=koryta.pl/date=2026-10-04T05:10:00.000Z/",  # still writing
            "hostname=koryta.pl/date=2026-10-04/",  # page captures
        }

    finished = {"2026-10-03T02:00:04.120Z", "2026-10-04T02:00:04.120Z"}

    class Bucket:
        def list_blobs(self, prefix, delimiter):
            assert (prefix, delimiter) == ("hostname=koryta.pl/", "/")
            return Listing()

        def blob(self, name):
            stamp = name.split("/")[1].removeprefix("date=")
            return Blob(stamp in finished)

    class Storage:
        def bucket(self, name):
            return Bucket()

    class FakeClient:
        storage_client = Storage()

    assert night.newest_export(FakeClient()) == FRESH  # type: ignore[arg-type]


def test_tidy_removes_old_export_shards_and_day_named_outputs(tmp_path, monkeypatch):
    downloaded, versioned = tmp_path / "downloaded", tmp_path / "versioned"
    downloaded.mkdir()
    versioned.mkdir()
    shard = "hostname=koryta.pl.date={}T02:00:04.120Z.all_namespaces.kind_nodes" + (
        ".output-0"
    )
    old, new = shard.format("2026-09-20"), shard.format("2026-10-03")
    other = "hostname=api-krs.ms.gov.pl.api.krs.OdpisAktualny.0000000001"
    for name in (old, new, other):
        (downloaded / name).write_text("x")
    for name in (
        "person_koryta_2026-09-20",
        "person_koryta_2026-10-03",
        "people_merged",
    ):
        (versioned / name).mkdir()
        (versioned / name / f"{name}.jsonl").write_text("{}")
    monkeypatch.setattr(night, "DOWNLOADED_DIR", str(downloaded))
    monkeypatch.setattr(night, "VERSIONED_DIR", str(versioned))

    assert night.tidy(7, "2026-10-04") == (1, 1)

    assert sorted(os.listdir(downloaded)) == sorted([new, other])
    assert sorted(os.listdir(versioned)) == [
        "people_merged",
        "person_koryta_2026-10-03",
    ]


def test_stream_logs_every_line_and_stops_a_command_out_of_time():
    lines: list[str] = []
    code, timed_out = night.stream(
        [sys.executable, "-c", "print('one'); print('two')"],
        dict(os.environ),
        30,
        lines.append,
    )
    assert (code, timed_out, lines) == (0, False, ["one", "two"])

    code, timed_out = night.stream(
        [
            sys.executable,
            "-c",
            "import time; print('start', flush=True); time.sleep(60)",
        ],
        dict(os.environ),
        1,
        lines.append,
    )
    assert timed_out is True
    assert code is not None and code < 0  # killed by a signal


def test_a_dry_run_names_the_priority_groups_and_the_fill(world, capsys):
    argv = ["--dry-run", "--priority-group", SKARB, "--fill-rejestrio-current"]

    assert night.main(argv) == 0

    assert (
        f"--max-published 10 --priority-group {SKARB} --fill-rejestrio-current "
        "--export <the export step's>" in capsys.readouterr().out
    )
