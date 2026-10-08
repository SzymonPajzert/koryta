"""The people's payloads, built in this process as `koryta PeoplePayloads` prints them.

The import used to be a pipe, `koryta PeoplePayloads ... | koryta_uploader`, and
what crossed it is what the site received. The job keeps that contract rather
than inventing its own: the same flags reach the pipelines, and each row goes
through JSON and back the way it went through the pipe.
"""

import json
import sys
from collections.abc import Container
from dataclasses import asdict, dataclass
from datetime import date

import pandas as pd

from analysis.payloads.person import PeoplePayloads
from analysis.payloads.target import PageTarget, Targeted
from conductor import setup_context
from scrapers.stores import (
    Context,
    Pipeline,
    ProcessPolicy,
    iterate_pipeline_dict,
    required_resources,
)

#: Which half of `--all` a run sends - see `PeoplePayloads.args` - or, for
#: `priority`, both, ordered for a capped run (`analysis.payloads.priority`).
PRIORITY = "priority"
SCOPES = ("on-koryta", "not-on-koryta", PRIORITY)
#: A run somebody asked for on a page (`--request`): that page's people alone.
REQUEST = "request"


@dataclass(frozen=True)
class Candidate:
    """A payload a priority run may send, its tier and the day it dates from."""

    payload: dict
    tier: str
    since: str | None


def pipeline_argv(scope: str, koryta_date: str | None) -> list[str]:
    """The flags `koryta PeoplePayloads` would be given for this run.

    `--only-changed` always: a person the export already shows as the payload
    has them is a request that writes nothing, and most of `--all` is that. A
    priority run passes neither scope: `PeoplePayloads.prioritised` splits the
    halves, and leaves out what would change nothing, itself.
    """
    argv = ["--all"] if scope == PRIORITY else ["--all", f"--{scope}", "--only-changed"]
    if koryta_date:
        argv += ["--koryta-date", koryta_date]
    return argv


def as_sent(row: dict) -> dict:
    """A row as the pipe carried it - see `build_payloads`."""
    return json.loads(json.dumps(row, default=str, ensure_ascii=False))


def run_people_payloads(ctx: Context) -> pd.DataFrame:
    return Pipeline.create(PeoplePayloads).read_or_process(ctx)


def build_payloads(
    scope: str, koryta_date: str | None, policy: ProcessPolicy
) -> list[dict]:
    """Every payload the run would send, in the pipeline's order.

    The pipelines read their flags off sys.argv themselves (`Extract` takes
    `--all`, `PeoplePayloads` the scope), so sys.argv holds this run's flags,
    and nothing else, for exactly as long as they run.
    """
    saved = sys.argv
    prog = saved[0] if saved else "koryta_people_import"
    sys.argv = [prog, *pipeline_argv(scope, koryta_date)]
    try:
        ctx, dumper = setup_context(required_resources(PeoplePayloads), policy=policy)
        try:
            df = run_people_payloads(ctx)
        finally:
            dumper.dump_pandas()
    finally:
        sys.argv = saved
    # Through JSON and back, as the pipe did it: `koryta` printed each row with
    # `json.dumps(row, default=str)` and the uploader parsed the line, so a
    # date arrives as its string here as it did there, and a payload written
    # out from this list is byte for byte the line the pipe carried.
    return [as_sent(row) for row in iterate_pipeline_dict(df)]


def build_priority(
    koryta_date: str | None,
    policy: ProcessPolicy,
    today: date,
    recent_days: int,
    bought: Container[str],
) -> list[Candidate]:
    """Every payload a priority run may send, in the order it sends them.

    `bought` are the rejestr.io ids of the people whose feed was bought lately.

    Built as `build_payloads` builds, flags on sys.argv included, then each
    payload made what the pipe would have carried: through a one-row frame and
    `iterate_pipeline_dict`, which turns pandas' NaN into the None the
    uploader drops, and through JSON.
    """
    saved = sys.argv
    prog = saved[0] if saved else "koryta_people_import"
    sys.argv = [prog, *pipeline_argv(PRIORITY, koryta_date)]
    try:
        ctx, dumper = setup_context(required_resources(PeoplePayloads), policy=policy)
        try:
            picks = Pipeline.create(PeoplePayloads).prioritised(
                ctx, today, recent_days, bought
            )
        finally:
            dumper.dump_pandas()
    finally:
        sys.argv = saved
    if not picks:
        return []
    frame = pd.DataFrame.from_records([asdict(pick.person) for pick in picks])
    rows = [as_sent(row) for row in iterate_pipeline_dict(frame)]
    return [
        Candidate(row, pick.tier, pick.since)
        for row, pick in zip(rows, picks, strict=True)
    ]


def target_argv(target: PageTarget, koryta_date: str | None) -> list[str]:
    """Extract's flags for one page's people: the company's, which `--krs`
    reads with its subsidiaries (`analysis.payloads.target` keeps the company's
    own), or the person's register entry. A person page without one is read
    out of everybody, by its id and name."""
    if target.kind == "company":
        argv = ["--krs", str(target.krs)]
    elif target.register:
        argv = ["--rejestrio-id", target.register]
    else:
        argv = ["--all"]
    if koryta_date:
        argv += ["--koryta-date", koryta_date]
    return argv


def build_targeted(
    target: PageTarget, koryta_date: str | None, policy: ProcessPolicy
) -> tuple[list[Candidate], Targeted]:
    """What a run asked for on one page sends, in order, each with its tier
    (`analysis.payloads.target`) and made what the pipe would have carried, as
    `build_priority` makes them; and the whole answer, with what it leaves."""
    saved = sys.argv
    prog = saved[0] if saved else "koryta_people_import"
    sys.argv = [prog, *target_argv(target, koryta_date)]
    try:
        ctx, dumper = setup_context(required_resources(PeoplePayloads), policy=policy)
        try:
            targeted = Pipeline.create(PeoplePayloads).targeted(ctx, target)
        finally:
            dumper.dump_pandas()
    finally:
        sys.argv = saved
    plan = targeted.plan()
    if not plan:
        return [], targeted
    frame = pd.DataFrame.from_records([asdict(person) for person, _ in plan])
    rows = [as_sent(row) for row in iterate_pipeline_dict(frame)]
    candidates = [
        Candidate(row, tier, None) for row, (_, tier) in zip(rows, plan, strict=True)
    ]
    return candidates, targeted


def pipeline_names() -> set[str]:
    """Every pipeline the payloads are built from - what `--refresh` can reach."""
    names: set[str] = set()
    todo: list[Pipeline] = [Pipeline.create(PeoplePayloads)]
    while todo:
        pipeline = todo.pop()
        if pipeline.pipeline_name in names:
            continue
        names.add(pipeline.pipeline_name)
        todo.extend(pipeline.dependencies.values())
    return names
