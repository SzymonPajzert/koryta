"""Upload what the scoring models make of the people nobody has looked at yet, nightly.

Each model in `analysis.scores.PEOPLE_SCORE_MODELS` rates the people with a
page on koryta.pl that nobody has published or voted on, and its shortlist is
stored as votes under the model's own uid - `pipeline-pagerank`,
`pipeline-turnover` and so on. The site takes the best of them, and that is
what orders the queue on /eksploruj/nowe and lets a person into it at all.
This uploads them, as

    ./submit_scores.sh prod

does, but in one process, unattended:

    koryta_score_import                         # the night's step, after the people
    koryta_score_import --dry-run               # build them and count; write nothing
    koryta_score_import --model PeopleScoresTurnover
    koryta_score_import --refresh KorytaPeople --refresh KorytaVotes \
        --refresh KorytaFacts --refresh CompanyScores   # after an export by hand

The models are rebuilt; everything they read is taken as it is on disk, which
on the VM is what the night's reprocess built minutes before - restored from
the shared cache when missing, and never rebuilt because something under it
is newer, so a run takes the minute or two the models take. `--refresh` names
what to rebuild besides. The site's people are read through day-named outputs,
so after a second export the same day name the four above: the models then
rate the people that export has. By hand on a machine whose outputs are
older, rebuild them first, as submit_scores.sh does (`koryta PeopleEnriched
--refresh :ProcessWiki --refresh all`), or run the night's step on the VM:
`night.sh --force --only scores`.

The people they rate are the site's as the 04:00 export has them, and the pages
the people import has created since (`scrapers.koryta.created`). The night
creates its new hires' pages after the export, and a page left to the next
export would wait a day for its score - which is what puts it in the queue.

Each model is reconciled with what it wrote last time
(`util.firestore.Firestore.replace_scores`): a changed score is written, a
person it no longer rates loses the vote, and the rest is left alone. A model
that rates nobody is not uploaded - reconciled, it would retract every vote it
has ever cast - and counts as failed, as does one that does not build.

Exit codes: 0 every model uploaded; 75 stopped before the last, on SIGTERM or at
`--max-minutes`, leaving the rest to the next night; 1 a model failed, or the
run did. Each run writes a summary to
gs://koryta-pl-sharedcache/jobs/score_import/runs/ and reports to
koryta.pl/admin/procesy as `score_import`, as `koryta_uploader --type score`
does. It signs in as `stores.koryta_login` decides - on the VM as
`KORYTA_PIPELINE_UID`, whose token carries the `datascience` claim
`firestore.rules` ask of whoever writes a model's votes.
"""

import argparse
import json
import os
import signal
import sys
import time
import typing
from collections import Counter
from collections.abc import Callable, Iterable, Sequence
from dataclasses import asdict, dataclass, field
from datetime import datetime

import pandas as pd
from uuid_extensions import uuid7str  # type: ignore

from analysis.scores import PEOPLE_SCORE_MODELS, PeopleScoreModel
from conductor import setup_context
from entities.composite import PersonScore
from jobs.people_import import sign_in, stop_rule
from scrapers.stores import (
    Pipeline,
    ProcessPolicy,
    iterate_pipeline_dict,
    required_resources,
)
from stores.job_runs import ERROR_CHARS, ERRORS_KEPT, FinalState, JobRun
from stores.koryta_login import TokenSource
from stores.storage import SHARED_BUCKET, Client, warsaw_tz
from uploader import one_line
from util.firestore import Firestore

JOB = "score_import"
UNIT = "modeli"
RUNS_PREFIX = "jobs/score_import/runs/"

#: Where the people import uploads too. Scores go to Firestore rather than
#: through it; the endpoint says which project, and where to sign in.
DEFAULT_ENDPOINT = "https://autopush.koryta.pl"

EXIT_TRY_LATER = 75
EXIT_FAILED = 1

# What /admin/procesy shows, in the page's language.
PHASE_BUILD = "modele"
PHASE_SEND = "wysyłanie"
STOP_INTERRUPTED = "przerwany"
NOBODY = "nikogo nie ocenił - nic nie wysłano ani nie wycofano"

#: The models by name, in the order a run builds them: the first reads the
#: sources every other shares.
MODELS: dict[str, type[PeopleScoreModel]] = {
    model.__name__: model for model in PEOPLE_SCORE_MODELS
}

#: Shown on the page even at zero.
COUNTERS = (
    "written",
    "retracted",
    "unchanged",
    "failed",
    "new_pages",
    "new_pages_scored",
)


def now() -> str:
    return datetime.now(warsaw_tz).isoformat(timespec="seconds")


@dataclass
class ModelResult:
    """What one model came to."""

    pipeline: str
    #: The uid its votes are stored under.
    model: str
    #: People it rated.
    scored: int = 0
    written: int = 0
    retracted: int = 0
    unchanged: int = 0
    #: Of the pages created since the export, how many it rated.
    new_pages: int = 0
    error: str = ""


@dataclass
class RunSummary:
    """What one run did, kept in the shared cache."""

    run: str
    started: str
    finished: str = ""
    endpoint: str = ""
    models: list[ModelResult] = field(default_factory=list)
    #: Pages the people import created today that the export does not have:
    #: the models saw them on top of it.
    new_pages: int = 0
    #: Of those, how many at least one model rated.
    new_pages_scored: int = 0
    counters: dict[str, int] = field(default_factory=dict)
    state: str = ""
    stopped: str = ""
    errors: list[str] = field(default_factory=list)
    exit_code: int | None = None


@dataclass
class Built:
    """What building the models came to: each one's scores, or why it has none,
    and the pages created since the export that they could see."""

    outputs: dict[str, pd.DataFrame | BaseException]
    new_pages: frozenset[str] = frozenset()


def one_tree(names: Sequence[str]) -> dict[str, PeopleScoreModel]:
    """The models, built as one tree.

    `scrapers.stores` builds a tree for each pipeline it is asked for, so seven
    models built one by one would read the payloads seven times - three
    quarters of a minute each, the volatile `PeoplePayloads` being rebuilt for
    every one. Named as the sources of one root, they share them: the payloads,
    the export and the created pages read once. The root is never run.
    """

    def never(self, ctx):
        raise NotImplementedError("only built, to share one tree")

    root_type = type(
        "ScoreModels",
        (Pipeline,),
        {"__annotations__": {name: MODELS[name] for name in names}, "process": never},
    )
    root = Pipeline.create(root_type)
    return {
        name: typing.cast(PeopleScoreModel, root.dependencies[name]) for name in names
    }


def tree_names(models: Iterable[Pipeline]) -> set[str]:
    """Every pipeline under these, themselves included."""
    names: set[str] = set()
    todo = list(models)
    while todo:
        pipeline = todo.pop()
        if pipeline.pipeline_name in names:
            continue
        names.add(pipeline.pipeline_name)
        todo.extend(pipeline.dependencies.values())
    return names


def refresh_policy(
    names: Sequence[str], refresh: Sequence[str], tree: set[str]
) -> ProcessPolicy:
    """The models and what `--refresh` names are rebuilt; the rest of the tree
    is held - read from disk, restored when missing - so that one source
    rebuilt does not rebuild everything above it: `KorytaPeople` would take
    `PeopleKorytaMerged`, `PeopleMerged` and `PeopleEnriched` with it."""
    rebuilt = set(names) | set(refresh)
    return ProcessPolicy(rebuilt, exclude_refresh=tree - rebuilt)


def build_models(names: Sequence[str], refresh: Sequence[str] = ()) -> Built:
    """Each model's scores, rebuilt over what is on disk.

    The models, and what `refresh` names, are rebuilt and nothing else is,
    unless it is missing (`refresh_policy`). `--all` is on sys.argv while they
    build, as `koryta <Model> --all` would have it: `Extract`, under the
    payloads, refuses to run without a scope.
    """
    saved = sys.argv
    prog = saved[0] if saved else "koryta_score_import"
    sys.argv = [prog, "--all"]
    outputs: dict[str, pd.DataFrame | BaseException] = {}
    try:
        models = one_tree(names)
        policy = refresh_policy(names, refresh, tree_names(models.values()))
        resources = set().union(*(required_resources(MODELS[n]) for n in names))
        ctx, dumper = setup_context(resources, policy=policy)
        try:
            for name, model in models.items():
                try:
                    outputs[name] = model.read_or_process(ctx)
                except Exception as e:
                    print(f"{name} did not build: {e!r}")
                    outputs[name] = e
            new_pages = pages_created_since_export(models.values(), ctx)
        finally:
            dumper.dump_pandas()
    finally:
        sys.argv = saved
    return Built(outputs, new_pages)


def pages_created_since_export(
    models: Iterable[PeopleScoreModel], ctx
) -> frozenset[str]:
    """The node ids of the pages the people import created since the export,
    read off the tree the models shared; none when it could not be built."""
    for model in models:
        try:
            koryta = model.people_koryta.read_or_process(ctx)
            created = model.people_created.read_or_process(ctx)
        except Exception as e:
            print(f"Could not read the pages created since the export: {e!r}")
            return frozenset()
        new = PeopleScoreModel.created_since(koryta, created)
        return frozenset(new["id"].astype(str))
    return frozenset()


def score_rows(output: pd.DataFrame) -> list[PersonScore]:
    """A model's output as the votes it stands for."""
    if output is None or output.empty:
        return []
    return [
        PersonScore(
            node_id=str(row["node_id"]),
            name=str(row["name"]),
            score=int(row["score"]),
            model=str(row["model"]),
        )
        for row in iterate_pipeline_dict(output)
    ]


def open_votes(endpoint: str, tokens: TokenSource) -> Firestore:
    """Where one model's votes are reconciled, signed in with a token good for
    the next requests - asked for afresh for each model, so a run that outlasts
    an hour's token renews it rather than being refused."""
    args = argparse.Namespace(endpoint=endpoint, database="koryta-pl")
    return Firestore(args, login=tokens.token)


class ScoreImport:
    """One run: what it was asked to do, what each model came to, and where it
    says so."""

    def __init__(
        self, args: argparse.Namespace, should_stop: Callable[[], str] = lambda: ""
    ):
        self.args = args
        self.should_stop = should_stop
        self.summary = RunSummary(run=uuid7str(), started=now(), endpoint=args.endpoint)
        # Under the summary's id, so the page's run and what the run left in
        # the shared cache are found from each other.
        self.status = JobRun(JOB, run_id=self.summary.run, unit=UNIT)
        self.counts: Counter[str] = Counter(dict.fromkeys(COUNTERS, 0))
        self.done = 0
        #: The pages created since the export that an uploaded model rated.
        self.new_pages_scored: set[str] = set()
        self._client: Client | None = None

    def run(self) -> int:
        if self.args.dry_run:
            return self.dry_run()
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
        # Before the build: a key or a grant that is missing is better found
        # in a second than after the models.
        tokens = sign_in(self.args.endpoint)
        built = build_models(self.args.model, self.args.refresh)
        self.summary.new_pages = len(built.new_pages)
        self.counts["new_pages"] = len(built.new_pages)
        self.status.progress(
            0,
            total=len(built.outputs),
            phase=PHASE_SEND,
            counters=dict(self.counts),
            force=True,
        )
        for name, output in built.outputs.items():
            if reason := self.should_stop():
                print(f"Stopping before {name}: {reason}")
                self.summary.stopped = reason
                break
            result = self.upload(name, output, built.new_pages, tokens)
            self.summary.models.append(result)
            self.done += 1
            self.status.progress(self.done, counters=dict(self.counts))
        failed = [m for m in self.summary.models if m.error]
        if failed:
            first = failed[0]
            self.summary.stopped = f"{first.pipeline}: {first.error}"[:ERROR_CHARS]
            return self.end("failed", EXIT_FAILED)
        if self.summary.stopped:
            return self.end("partial", EXIT_TRY_LATER)
        return self.end("succeeded", 0)

    def upload(
        self,
        name: str,
        output: pd.DataFrame | BaseException,
        new_pages: frozenset[str],
        tokens: TokenSource,
    ) -> ModelResult:
        """Reconcile one model's votes with its scores, and count what came of it."""
        model = MODELS[name]
        result = ModelResult(pipeline=name, model=model.model_tag)
        if isinstance(output, BaseException):
            result.error = f"nie zbudował się: {one_line(output)}"
        else:
            rows = score_rows(output)
            rated_new = new_pages & {row.node_id for row in rows}
            result.scored, result.new_pages = len(rows), len(rated_new)
            if not rows:
                result.error = NOBODY
            else:
                try:
                    votes = open_votes(self.args.endpoint, tokens)
                    written, retracted = votes.replace_scores(model.model_tag, rows)
                except Exception as e:
                    result.error = f"nie zapisano: {one_line(e)}"
                else:
                    result.written, result.retracted = written, retracted
                    result.unchanged = len(rows) - written
                    self.new_pages_scored |= rated_new
        if result.error:
            print(f"{name}: {result.error}")
            self.counts["failed"] += 1
        self.counts["written"] += result.written
        self.counts["retracted"] += result.retracted
        self.counts["unchanged"] += result.unchanged
        self.counts["new_pages_scored"] = len(self.new_pages_scored)
        self.summary.new_pages_scored = len(self.new_pages_scored)
        return result

    def dry_run(self) -> int:
        """Build the models and say what each would upload; sign in to nothing,
        write nothing, report nothing."""
        built = build_models(self.args.model, self.args.refresh)
        for name, output in built.outputs.items():
            if isinstance(output, BaseException):
                print(f"{name}: did not build: {one_line(output)}")
                continue
            rows = score_rows(output)
            new = len(built.new_pages & {row.node_id for row in rows})
            print(
                f"{name} ({MODELS[name].model_tag}): {len(rows)} people rated, "
                f"{new} of them on pages created since the export"
            )
        print(f"Pages created since the export: {len(built.new_pages)}")
        failed = [o for o in built.outputs.values() if isinstance(o, BaseException)]
        return EXIT_FAILED if failed else 0

    def end(self, state: FinalState, code: int, crash: str | None = None) -> int:
        """Write the run's summary and tell the page how the run ended."""
        summary = self.summary
        summary.state = state
        summary.exit_code = code
        summary.counters = dict(self.counts)
        errors = [f"{m.pipeline}: {m.error}" for m in summary.models if m.error]
        if crash:
            errors = [crash, *errors]
        summary.errors = errors[:ERRORS_KEPT]
        path = self.write_summary()
        self.status.finish(
            state,
            stop_reason=summary.stopped or None,
            errors=summary.errors,
            exit_code=code,
            counters=summary.counters,
            done=self.done,
            # "" when the summary could not be written: no link to nothing.
            summary_path=path or None,
        )
        return code

    def client(self) -> Client:
        if self._client is None:
            self._client = Client()
        return self._client

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
            # What the run wrote is on the site either way.
            print(f"Could not write the run summary {name}: {e}")
            return ""
        print(f"Summary: {url}")
        return url


def non_negative_float(text: str) -> float:
    value = float(text)
    if value < 0:
        raise ValueError(text)
    return value


def parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="koryta_score_import",
        description=(__doc__ or "").split("\n")[0],
        allow_abbrev=False,
    )
    parser.add_argument(
        "--model",
        action="append",
        choices=list(MODELS),
        help="Upload this model alone; repeatable. Default: all of them.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build the models and say how many people each rates; sign in to "
        "nothing and write nothing - the rebuilt models still go to the shared "
        "cache unless --no-backup.",
    )
    parser.add_argument(
        "--endpoint", default=DEFAULT_ENDPOINT, help="Default: %(default)s."
    )
    parser.add_argument(
        "--max-minutes",
        type=non_negative_float,
        default=60,
        help="Upload no model after this many minutes from the start, the "
        "build included; the rest is the next run's. 0: no limit. "
        "Default: %(default)s.",
    )
    parser.add_argument(
        "--refresh",
        action="append",
        default=[],
        metavar="NAME",
        help="Rebuild this pipeline as well as the models; repeatable. "
        "Everything else they read is taken as it is on disk. After an export "
        "taken by hand: KorytaPeople, KorytaVotes, KorytaFacts, CompanyScores.",
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Neither restore pipeline outputs from the shared cache nor upload "
        "them there, as `koryta --no-backup`. The summary is written either way.",
    )
    return parser


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parse = parser()
    args = parse.parse_args(argv)
    # In the order the models are listed, whatever order they were named in.
    asked = set(args.model or MODELS)
    args.model = [name for name in MODELS if name in asked]
    known = tree_names(one_tree(args.model).values())
    unknown = sorted(set(args.refresh) - known)
    if unknown:
        # A misspelt name would rebuild nothing, and say nothing about it.
        parse.error(
            f"--refresh {' '.join(unknown)}: not a pipeline the models read. "
            f"One of: {', '.join(sorted(known))}"
        )
    return args


def main(argv: Sequence[str] | None = None) -> int:
    started = time.monotonic()
    args = parse_args(argv)
    if args.no_backup:
        os.environ["DISABLE_BACKUP"] = "1"
    # Pipelines read sys.argv themselves - PeoplePKW takes --limit, and anything
    # argparse abbreviates to it - so the job's own flags must not reach them.
    # `build_models` hands them theirs.
    sys.argv = sys.argv[:1]

    deadline = started + args.max_minutes * 60 if args.max_minutes else None
    signalled = False

    def on_sigterm(signum, frame):
        nonlocal signalled
        signalled = True
        print("SIGTERM: stopping after the model in hand")

    previous = signal.signal(signal.SIGTERM, on_sigterm)
    try:
        return ScoreImport(args, stop_rule(deadline, lambda: signalled)).run()
    finally:
        signal.signal(signal.SIGTERM, previous)
