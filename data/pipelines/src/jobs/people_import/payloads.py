"""The people's payloads, built in this process as `koryta PeoplePayloads` prints them.

The import used to be a pipe, `koryta PeoplePayloads ... | koryta_uploader`, and
what crossed it is what the site received. The job keeps that contract rather
than inventing its own: the same flags reach the pipelines, and each row goes
through JSON and back the way it went through the pipe.
"""

import json
import sys

import pandas as pd

from analysis.payloads.person import PeoplePayloads
from conductor import setup_context
from scrapers.stores import (
    Context,
    Pipeline,
    ProcessPolicy,
    iterate_pipeline_dict,
    required_resources,
)

#: Which half of `--all` a run sends - see `PeoplePayloads.args`.
SCOPES = ("on-koryta", "not-on-koryta")


def pipeline_argv(scope: str, koryta_date: str | None) -> list[str]:
    """The flags `koryta PeoplePayloads` would be given for this run.

    `--only-changed` always: a person the export already shows as the payload
    has them is a request that writes nothing, and most of `--all` is that.
    """
    argv = ["--all", f"--{scope}", "--only-changed"]
    if koryta_date:
        argv += ["--koryta-date", koryta_date]
    return argv


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
    return [
        json.loads(json.dumps(row, default=str, ensure_ascii=False))
        for row in iterate_pipeline_dict(df)
    ]


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
