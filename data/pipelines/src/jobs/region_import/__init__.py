"""Keep the site's regions in step with TERYT and the urzędy table, a portion a night.

`RegionPayloads` lists the regions the site should have - every województwo,
powiat, gmina and Warsaw dzielnica - and `LocalGovernmentOffices` the urząd
that runs each. This sends both to `/api/ingest/region`, as

    cat regions.jsonl offices.jsonl |
        koryta_uploader --type region --submit --max-new 100

does by hand, but from the outputs on disk, unattended:

    koryta_region_import                  # the night's step `regions`
    koryta_region_import --max-new 300    # more regions created this run
    koryta_region_import --dry-run        # read and count them; send nothing

The site creates at most `--max-new` of the regions it lacks, parents first
and then by code, and says how many still wait; the next run goes on from
there. That is how the 1,500 or so gminy with no node on 2026-11-22 reach the
site: a portion a night rather than at once (decision on 2026-11-22), each one
a page, an `owns` edge and the recounts the edge sets off. Renames, and the
urzędy of the regions already there, are not capped. Once no region is missing,
a run writes only what TERYT or the urzędy table changes: on most nights,
nothing.

The two outputs are read as they are on disk - on the VM the night's reprocess
built them minutes before - restored from the shared cache when missing, and
never rebuilt here.

It reports as `region_import` on /admin/procesy. Exit codes: 0 when no region
is left to create, 75 when some wait for the next run, 1 when the outputs
could not be read or the site refused the upload.
"""

import argparse
import sys
import typing
from collections.abc import Sequence

import pandas as pd
from uuid_extensions import uuid7str  # type: ignore

from analysis.payloads.region import RegionPayloads
from conductor import setup_context
from jobs.people_import import (
    DEFAULT_ENDPOINT,
    EXIT_FAILED,
    EXIT_TRY_LATER,
    STOP_DRY_RUN,
    sign_in,
)
from scrapers.map.offices import LocalGovernmentOffices
from scrapers.stores import Pipeline
from stores.job_runs import JobRun
from stores.koryta_login import TokenSource
from uploader import REGION_ANSWER_LISTS, Args, RegionUploader, one_line, region_rows

JOB = "region_import"
UNIT = "regionów"
PHASE_READ = "odczyt"
PHASE_SEND = "wysyłanie"
#: How a run that left regions for the next one says so on its card.
STOP_WAITING = "reszta regionów na następną noc"
#: How many of the regions the site lacks one run creates, unless told
#: otherwise; the night passes its own (`--max-new-regions`).
DEFAULT_MAX_NEW = 100
#: The answer's lists that are something to look at, though the run went on.
WARNED = {
    "regions": ("orphaned", "taken"),
    "offices": ("refused", "unnamed"),
}


def records(frame: pd.DataFrame) -> list[dict]:
    """An output's rows as the pipe carries them to the uploader: a missing
    value is None, as `null` in a line of JSON reads, never pandas' NaN, which
    no JSON parser on the site would take."""
    return frame.astype(object).where(frame.notna(), None).to_dict(orient="records")


def read_tables() -> list[dict]:
    """The rows `RegionPayloads` and `LocalGovernmentOffices` last wrote,
    regions first. `read` takes what is on disk, else the shared cache's copy,
    and never runs a pipeline."""
    ctx, _ = setup_context()
    rows: list[dict] = []
    for kind in (RegionPayloads, LocalGovernmentOffices):
        rows += records(Pipeline.create(kind).read(ctx))
    return rows


def make_uploader(
    endpoint: str, tokens: TokenSource | None, max_new: int
) -> RegionUploader:
    """The uploader `koryta_uploader --type region --submit --max-new` would be."""
    args = argparse.Namespace(
        endpoint=endpoint,
        type="region",
        submit=True,
        database="koryta-pl",
        limit=None,
        offset=0,
        model=None,
        max_new=max_new,
    )
    return RegionUploader(typing.cast(Args, args), tokens=tokens)


def count(listed: object) -> int:
    """How many a list in the site's answer (`{count, named}`) holds."""
    if isinstance(listed, dict) and isinstance(listed.get("count"), int):
        return listed["count"]
    return 0


def warnings_in(answer: dict) -> list[str]:
    """A line for each list in the answer worth a look, as the uploader prints
    it: regions created without their edge, ids taken by something else, rows
    refused for a check digit, names the „Urząd” chip would not know."""
    lines: list[str] = []
    for part, lists in REGION_ANSWER_LISTS.items():
        for key, what in lists:
            listed = (answer.get(part) or {}).get(key)
            if key not in WARNED[part] or not isinstance(listed, dict):
                continue
            if not count(listed):
                continue
            names = ", ".join(str(name) for name in listed.get("named") or [])
            lines.append(f"{listed['count']} {what}: {names}")
    return lines


def run(args: argparse.Namespace) -> int:
    status = JobRun(JOB, run_id=uuid7str(), unit=UNIT)
    status.start(phase=PHASE_READ)
    try:
        tokens = None if args.dry_run else sign_in(args.endpoint)
        rows = read_tables()
    except Exception as error:
        print(f"Could not start: {one_line(error)}", file=sys.stderr)
        status.finish("failed", errors=[one_line(error)], exit_code=EXIT_FAILED)
        return EXIT_FAILED

    regions, offices, _ = region_rows(rows)
    print(
        f"{len(regions)} regions and {len(offices)} urzędy read; the site creates "
        f"at most {args.max_new} of the regions it lacks.",
        file=sys.stderr,
    )
    if args.dry_run:
        status.finish(
            "succeeded",
            stop_reason=STOP_DRY_RUN,
            counters={"planned": len(regions)},
            exit_code=0,
        )
        return 0

    status.progress(0, total=len(regions), phase=PHASE_SEND, force=True)
    uploader = make_uploader(args.endpoint, tokens, args.max_new)
    try:
        uploader.submit_results(rows)
    except Exception as error:
        status.finish("failed", errors=[one_line(error)], exit_code=EXIT_FAILED)
        return EXIT_FAILED

    answer = uploader.answer or {}
    placed = answer.get("regions") or {}
    urzedy = answer.get("offices") or {}
    waiting = count(placed.get("waiting"))
    counters = {
        "created": count(placed.get("created")),
        "renamed": count(placed.get("renamed")),
        "waiting": waiting,
        "updated": urzedy.get("updated", 0),
        "unchanged": placed.get("unchanged", 0),
    }
    code = EXIT_TRY_LATER if waiting else 0
    status.finish(
        "partial" if waiting else "succeeded",
        stop_reason=STOP_WAITING if waiting else None,
        warnings=warnings_in(answer),
        counters=counters,
        done=len(regions),
        exit_code=code,
    )
    return code


def parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="koryta_region_import",
        description="Send the regions and the urzędy table to the site, "
        "creating at most --max-new of the regions it lacks.",
    )
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument(
        "--max-new",
        type=int,
        default=DEFAULT_MAX_NEW,
        help="Create at most N of the regions the site lacks; the rest wait for "
        "the next run. Default: %(default)s.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Read the outputs and count them; send nothing.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if args.max_new < 0:
        parser().error("--max-new cannot be negative")
    # The pipelines read sys.argv themselves; the job's flags are not theirs.
    sys.argv = sys.argv[:1]
    return run(args)
