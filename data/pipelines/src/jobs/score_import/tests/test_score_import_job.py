"""The nightly score upload: what it builds, what it writes, when it stops."""

import json
import sys
from types import SimpleNamespace

import pandas as pd
import pytest

import jobs.score_import as job
from analysis.scores import PEOPLE_SCORE_MODELS
from entities.composite import PersonScore
from stores.storage import SHARED_BUCKET

NAMES = [model.__name__ for model in PEOPLE_SCORE_MODELS]
TAGS = {model.__name__: model.model_tag for model in PEOPLE_SCORE_MODELS}


def scores(name: str, *node_ids: str) -> pd.DataFrame:
    """A model's output, as `PeopleScoreModel.process` returns it."""
    return pd.DataFrame(
        [
            {"node_id": node, "name": f"Osoba {node}", "score": 3, "model": TAGS[name]}
            for node in node_ids
        ],
        columns=["node_id", "name", "score", "model"],
    ).astype({"score": "int32"})


class RecordingRun:
    """Stands in for `JobRun`, keeping what the job told it."""

    def __init__(self, job_id, **kwargs):
        self.job = job_id
        self.kwargs = kwargs
        self.calls: list[tuple[str, dict]] = []

    def start(self, phase=None):
        self.calls.append(("start", {"phase": phase}))
        return self

    def progress(self, done=None, **kwargs):
        self.calls.append(("progress", {"done": done, **kwargs}))

    def finish(self, state, **kwargs):
        self.calls.append(("finish", {"state": state, **kwargs}))

    def ending(self) -> dict:
        [end] = [args for call, args in self.calls if call == "finish"]
        return end


class Votes:
    """What Firestore holds of the models' votes, faked: each model's answer."""

    def __init__(self, world: "World"):
        self.world = world

    def replace_scores(self, model, rows, retract=True):
        self.world.events.append(f"write {model}")
        self.world.written[model] = list(rows)
        answer = self.world.answers.get(model, (len(rows), 0))
        if isinstance(answer, BaseException):
            raise answer
        return answer


class World:
    """Everything the job touches, faked: the build, the bucket, Firestore."""

    def __init__(self):
        #: Each model's output, or what building it raised.
        self.outputs: dict[str, pd.DataFrame | BaseException] = {
            name: scores(name, f"{name}-1", f"{name}-2") for name in NAMES
        }
        self.new_pages: frozenset[str] = frozenset()
        #: What each model's reconciliation answers - (written, retracted) - or
        #: raises; by default it writes everything and retracts nothing.
        self.answers: dict[str, tuple[int, int] | BaseException] = {}
        self.written: dict[str, list[PersonScore]] = {}
        self.events: list[str] = []
        self.objects: dict[str, bytes] = {}
        self.runs: list[RecordingRun] = []
        self.built: list[list[str]] = []
        self.refreshed: list[list[str]] = []

    def run(self) -> RecordingRun:
        [run] = self.runs
        return run

    def summary(self) -> dict:
        [name] = [name for name in self.objects if name.startswith(job.RUNS_PREFIX)]
        return json.loads(self.objects[name])


@pytest.fixture
def world(monkeypatch) -> World:
    w = World()

    def build_models(names, refresh=()):
        w.events.append("build")
        w.built.append(list(names))
        w.refreshed.append(list(refresh))
        return job.Built({name: w.outputs[name] for name in names}, w.new_pages)

    def sign_in(endpoint):
        w.events.append(f"sign in {endpoint}")
        return "tokens"

    class Bucket:
        def create_object(self, bucket, name, data, content_type):
            assert name not in w.objects, f"{name} written twice"
            w.objects[name] = data
            return f"gs://{bucket}/{name}"

    def record(job_id, **kwargs):
        w.runs.append(RecordingRun(job_id, **kwargs))
        return w.runs[-1]

    monkeypatch.setattr(job, "build_models", build_models)
    monkeypatch.setattr(job, "sign_in", sign_in)
    monkeypatch.setattr(job, "open_votes", lambda endpoint, tokens: Votes(w))
    monkeypatch.setattr(job, "Client", Bucket)
    monkeypatch.setattr(job, "JobRun", record)
    monkeypatch.setattr(sys, "argv", ["koryta_score_import"])
    return w


# ---------------------------------------------------------------------------
# A run that goes as planned


def test_every_model_is_reconciled_in_turn_and_the_run_succeeds(world):
    world.answers = {"pipeline-pagerank": (1, 5)}

    assert job.main([]) == 0

    assert world.events == [
        "sign in https://autopush.koryta.pl",
        "build",
        *(f"write {TAGS[name]}" for name in NAMES),
    ]
    assert world.built == [NAMES]
    assert world.written["pipeline-turnover"] == [
        PersonScore(
            "PeopleScoresTurnover-1",
            "Osoba PeopleScoresTurnover-1",
            3,
            "pipeline-turnover",
        ),
        PersonScore(
            "PeopleScoresTurnover-2",
            "Osoba PeopleScoresTurnover-2",
            3,
            "pipeline-turnover",
        ),
    ]
    run = world.run()
    assert (run.job, run.kwargs["unit"]) == ("score_import", "modeli")
    assert run.calls[0] == ("start", {"phase": "modele"})
    assert run.calls[1][1]["total"] == len(NAMES)
    assert run.calls[1][1]["phase"] == "wysyłanie"
    end = run.ending()
    assert (end["state"], end["exit_code"], end["done"]) == ("succeeded", 0, 7)
    assert end["stop_reason"] is None and end["errors"] == []
    assert end["counters"] == {
        # Two people a model; pagerank wrote one of its two and took back five.
        "written": 2 * 6 + 1,
        "retracted": 5,
        "unchanged": 1,
        "failed": 0,
        "new_pages": 0,
        "new_pages_scored": 0,
    }
    assert end["summary_path"].startswith(f"gs://{SHARED_BUCKET}/{job.RUNS_PREFIX}")


def test_the_summary_says_what_each_model_did_under_the_runs_id(world):
    job.main(["--model", "PeopleScoresTurnover"])

    run_id = world.run().kwargs["run_id"]
    summary = world.summary()
    assert summary["run"] == run_id
    assert [name for name in world.objects] == [
        f"{job.RUNS_PREFIX}date={summary['started'][:10]}/{run_id}.json"
    ]
    assert summary["models"] == [
        {
            "pipeline": "PeopleScoresTurnover",
            "model": "pipeline-turnover",
            "scored": 2,
            "written": 2,
            "retracted": 0,
            "unchanged": 0,
            "new_pages": 0,
            "error": "",
        }
    ]


def test_the_pages_created_tonight_are_counted_and_so_are_those_rated(world):
    world.new_pages = frozenset({"new-1", "new-2", "new-3"})
    world.outputs["PeopleScores"] = scores("PeopleScores", "old", "new-1")
    world.outputs["PeopleScoresTurnover"] = scores("PeopleScoresTurnover", "new-2")
    # Rated, but not written: the page has no score on the site.
    world.outputs["PeopleScoresCapture"] = scores("PeopleScoresCapture", "new-3")
    world.answers["pipeline-capture"] = PermissionError("403")

    job.main([])

    summary = world.summary()
    assert (summary["new_pages"], summary["new_pages_scored"]) == (3, 2)
    by_model = {m["pipeline"]: m["new_pages"] for m in summary["models"]}
    assert (by_model["PeopleScores"], by_model["PeopleScoresTurnover"]) == (1, 1)
    counters = world.run().ending()["counters"]
    assert (counters["new_pages"], counters["new_pages_scored"]) == (3, 2)


# ---------------------------------------------------------------------------
# What fails a model, and what that does to the run


def test_a_model_that_rates_nobody_retracts_nothing_and_fails_the_run(world):
    world.outputs["PeopleScoresFacts"] = scores("PeopleScoresFacts")

    assert job.main([]) == job.EXIT_FAILED

    assert "write pipeline-facts" not in world.events
    assert len(world.written) == 6
    end = world.run().ending()
    assert end["state"] == "failed"
    assert end["stop_reason"] == f"PeopleScoresFacts: {job.NOBODY}"
    assert end["errors"] == [f"PeopleScoresFacts: {job.NOBODY}"]
    assert end["counters"]["failed"] == 1


def test_a_model_that_did_not_build_leaves_the_others_to_go_up(world):
    world.outputs["PeopleScoresPageRank"] = FileNotFoundError("person_votes")

    assert job.main([]) == job.EXIT_FAILED

    assert "write pipeline-pagerank" not in world.events
    assert len(world.written) == 6
    [error] = world.run().ending()["errors"]
    assert error.startswith("PeopleScoresPageRank: nie zbudował się: FileNotFoundError")


def test_a_refused_write_is_that_models_failure(world):
    world.answers["pipeline-together"] = PermissionError("Firestore refused")

    assert job.main([]) == job.EXIT_FAILED

    summary = world.summary()
    [failed] = [m for m in summary["models"] if m["error"]]
    assert failed["pipeline"] == "PeopleScoresCoappointment"
    assert failed["error"] == "nie zapisano: PermissionError: Firestore refused"
    assert summary["state"] == "failed"
    # Everybody after it still went up.
    assert world.events[-1] == "write pipeline-facts"


def test_a_sign_in_that_fails_builds_nothing_and_fails_the_run(world, monkeypatch):
    def refused(endpoint):
        raise RuntimeError("no web key")

    monkeypatch.setattr(job, "sign_in", refused)

    with pytest.raises(RuntimeError):
        job.main([])

    assert "build" not in world.events
    end = world.run().ending()
    assert end["state"] == "failed"
    assert end["errors"] == ["RuntimeError('no web key')"]


# ---------------------------------------------------------------------------
# Stopping short


def test_sigterm_stops_before_the_next_model(world):
    stops = iter(["", "SIGTERM"])
    import_run = job.ScoreImport(job.parse_args([]), lambda: next(stops))

    assert import_run.run() == job.EXIT_TRY_LATER

    assert world.events[2:] == ["write pipeline"]
    end = world.run().ending()
    assert (end["state"], end["stop_reason"], end["done"]) == ("partial", "SIGTERM", 1)


def test_the_deadline_counts_from_the_start(world, monkeypatch):
    clock = iter([0.0, 61.0, 61.0])
    monkeypatch.setattr(job.time, "monotonic", lambda: next(clock))

    assert job.main(["--max-minutes", "1"]) == job.EXIT_TRY_LATER

    assert world.written == {}
    assert world.run().ending()["stop_reason"] == "koniec czasu"


# ---------------------------------------------------------------------------
# By hand


def test_a_dry_run_signs_in_to_nothing_writes_nothing_and_reports_nothing(
    world, capsys
):
    world.new_pages = frozenset({"PeopleScores-1"})

    assert job.main(["--dry-run", "--model", "PeopleScores"]) == 0

    assert world.events == ["build"]
    assert world.objects == {} and world.run().calls == []
    out = capsys.readouterr().out
    assert "PeopleScores (pipeline): 2 people rated, 1 of them on pages" in out
    assert "Pages created since the export: 1" in out


def test_models_are_taken_in_the_registrys_order_whatever_order_they_are_named():
    args = job.parse_args(
        ["--model", "PeopleScoresTurnover", "--model", "PeopleScores"]
    )

    assert args.model == ["PeopleScores", "PeopleScoresTurnover"]
    assert job.parse_args([]).model == NAMES


def test_refresh_is_handed_to_the_build_and_checked_against_the_tree(world):
    job.main(["--refresh", "KorytaPeople", "--refresh", "CompanyScores"])

    assert world.refreshed == [["KorytaPeople", "CompanyScores"]]
    with pytest.raises(SystemExit):
        job.parse_args(["--refresh", "KorytaPeple"])
    # Not under the models it was asked for.
    with pytest.raises(SystemExit):
        job.parse_args(["--model", "PeopleScoresTurnover", "--refresh", "KorytaFacts"])


# ---------------------------------------------------------------------------
# The build


def test_a_refreshed_source_rebuilds_only_what_was_named():
    """Everything on disk, KorytaPeople asked for: without the hold, the export
    reader would take PeopleKorytaMerged, PeopleMerged and PeopleEnriched -
    the whole people chain - with it."""
    models = job.one_tree(NAMES)
    policy = job.refresh_policy(
        NAMES, ["KorytaPeople", "CompanyScores"], job.tree_names(models.values())
    )
    ctx = SimpleNamespace(io=SimpleNamespace(get_mtime=lambda ref: 1000.0))

    for model in models.values():
        policy.decide(model, ctx)

    decided = policy.execution_decisions
    for name in [*NAMES, "KorytaPeople", "CompanyScores"]:
        assert decided[name] == (True, "policy"), name
    for name in ("PeopleKorytaMerged", "PeopleMerged", "PeopleEnriched", "KorytaVotes"):
        assert decided[name] == (False, "up to date"), name
    # Never stored, so read afresh whatever the policy says.
    assert decided["KorytaPeopleCreated"] == (True, "missing output")


def test_the_models_share_one_tree():
    models = job.one_tree(["PeopleScores", "PeopleScoresTurnover"])

    first, second = models["PeopleScores"], models["PeopleScoresTurnover"]
    assert first.people_payloads is second.people_payloads
    assert first.people_koryta is second.people_koryta
    assert first.people_created is second.people_created


def test_the_build_puts_all_on_argv_and_keeps_going_past_a_broken_model(monkeypatch):
    seen: list[list[str]] = []

    class Model:
        dependencies: dict = {}

        def __init__(self, name, output):
            self.pipeline_name = name
            self.output = output

        def read_or_process(self, ctx):
            seen.append(list(sys.argv))
            if isinstance(self.output, BaseException):
                raise self.output
            return self.output

    class Dumper:
        dumped = False

        def dump_pandas(self):
            Dumper.dumped = True

    built_ok = scores("PeopleScores", "a")
    monkeypatch.setattr(
        job,
        "one_tree",
        lambda names: {
            "PeopleScores": Model("PeopleScores", built_ok),
            "PeopleScoresTurnover": Model("PeopleScoresTurnover", ValueError("broken")),
        },
    )
    monkeypatch.setattr(
        job, "setup_context", lambda resources, policy: ("ctx", Dumper())
    )
    monkeypatch.setattr(
        job, "pages_created_since_export", lambda models, ctx: frozenset({"a"})
    )
    monkeypatch.setattr(sys, "argv", ["koryta_score_import"])

    built = job.build_models(["PeopleScores", "PeopleScoresTurnover"])

    assert seen == [["koryta_score_import", "--all"]] * 2
    assert sys.argv == ["koryta_score_import"]
    assert built.outputs["PeopleScores"] is built_ok
    assert isinstance(built.outputs["PeopleScoresTurnover"], ValueError)
    assert built.new_pages == {"a"} and Dumper.dumped


def test_the_pages_created_since_the_export_are_read_off_the_shared_tree():
    class Source:
        def __init__(self, df):
            self.df = df

        def read_or_process(self, ctx):
            return self.df

    class Model:
        people_koryta = Source(pd.DataFrame({"id": ["n1"]}))
        people_created = Source(
            pd.DataFrame(
                {"id": ["n1", "n2"], "full_name": ["A", "B"], "rejestrIo": [None, None]}
            )
        )

    assert job.pages_created_since_export([Model()], None) == {"n2"}  # type: ignore[list-item]


def test_a_models_output_is_read_as_the_votes_it_stands_for():
    rows = job.score_rows(scores("PeopleScoresFacts", "n1"))

    assert rows == [PersonScore("n1", "Osoba n1", 3, "pipeline-facts")]
    assert isinstance(rows[0].score, int)
    assert job.score_rows(pd.DataFrame()) == []
