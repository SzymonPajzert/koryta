import argparse
import json
import os
import sys

import pandas as pd

from conductor import setup_context
from pipelines import PIPELINES
from scrapers.article.pipelines import pipeline_utils as article_args
from scrapers.cru import config as cru_args
from scrapers.stores import (
    ContextResource,
    Pipeline,
    ProcessPolicy,
    iterate_pipeline_dict,
    required_resources,
)
from scrapers.wiki import dump as wiki_dump_args


class Printer:
    def __init__(self, args):
        self.args = args
        self.output = sys.stderr if self.args.output == "stderr" else sys.stdout

    def print_results(self, res):
        if self.args.output in {"stdout", "stderr", "formatted"}:
            for item in self.iterate(res):
                print(self.format_dict(item), file=self.output)
        else:
            print("Finished processing")

    def format_dict(self, d):
        if self.args.output == "formatted":
            return json.dumps(d, default=str, ensure_ascii=False, indent=2)
        else:
            # Returns as sinle elements in a line
            return json.dumps(d, default=str, ensure_ascii=False)

    def iterate(self, res):
        if isinstance(res, pd.DataFrame):
            yield from iterate_pipeline_dict(res)
        elif isinstance(res, list):
            for item in res:
                yield item


def get_args():
    # allow_abbrev=False: argparse would otherwise accept --all as an
    # unambiguous abbreviation of --all-pipelines and swallow the flag that
    # scrapers.analysis.extract reads off the same argv.
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument(
        "--refresh",
        help="Pipeline name to refresh, : to exclude or 'all'",
        action="append",
        default=[],
    )
    parser.add_argument(
        "--read-backup",
        action="append",
        default=[],
        metavar="PIPELINE",
        help="Pipeline allowed to restore its output from the shared GCS "
        "cache. Same grammar as --refresh: a name, 'all', or ':name'/':all' "
        "to forbid it. Pipelines you do not name keep their own default, so "
        "':all' is how you say 'read nothing'.",
    )
    parser.add_argument(
        "--write-backup",
        action="append",
        default=[],
        metavar="PIPELINE",
        help="Pipeline allowed to upload its output to the shared GCS cache. "
        "Same grammar as --read-backup. ':all' uploads nothing, which is what "
        "an unattended run that should not publish wants.",
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Shorthand for --read-backup :all --write-backup :all. Also "
        "settable as DISABLE_BACKUP in the environment or .env.",
    )
    parser.add_argument(
        "--all-pipelines",
        action="store_true",
        help="Run every pipeline except ScrapeRejestrIO, which bills per "
        "query. Not spelled --all: scrapers.analysis.extract owns that one "
        "('extract all people') and reads it off the same argv.",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        help="Pipeline name to skip running. Repeatable, and applies to "
        "--all-pipelines.",
    )
    parser.add_argument(
        "pipeline",
        help="Pipeline to be run - available are "
        + " ".join(pt.__name__ for pt in PIPELINES),
        default=None,
        nargs="*",
    )
    parser.add_argument(
        "--output",
        type=str,
        choices=["file", "stdout", "stderr", "formatted"],
        default="file",
        help="Output channel (file or stdout)",
    )
    # Pipeline-owned flags, registered here so parse_known_args does not mistake
    # a flag's value for a positional pipeline name.
    article_args.add_arguments(parser)
    wiki_dump_args.add_arguments(parser)
    cru_args.add_arguments(parser)
    args, _ = parser.parse_known_args()
    return args


def select_pipelines(args) -> set[str]:
    pipeline_names = set(pt.__name__ for pt in PIPELINES)
    exclude = set(args.exclude)
    unknown = (exclude | set(args.pipeline)) - pipeline_names
    if unknown:
        raise ValueError(
            f"Pipeline(s) not found: {' '.join(sorted(unknown))}. "
            f"Available: {' '.join(sorted(pipeline_names))}"
        )

    if args.all_pipelines:
        if args.pipeline:
            raise ValueError(
                "--all-pipelines runs everything, so it takes no pipeline names"
            )
        # ScrapeRejestrIO bills per query -- never part of a bulk run.
        return pipeline_names - {"ScrapeRejestrIO"} - exclude
    if args.pipeline:
        return set(args.pipeline) - exclude
    raise ValueError(
        "No pipeline specified, use koryta PipelineName or --all-pipelines"
    )


def selected_resources(selected: set[str]) -> set[type[ContextResource]]:
    """The clients the selected pipelines declared, their sources' included."""
    required: set[type[ContextResource]] = set()
    for p_type in PIPELINES:
        if p_type.__name__ in selected:
            required |= required_resources(p_type)
    return required


def main():
    args = get_args()
    read_backup = list(args.read_backup)
    write_backup = list(args.write_backup)
    if args.no_backup:
        # Also in the environment, for the parts that read it there rather than
        # off the policy (stores.config.backup_disabled, and anything a .env
        # would have configured).
        os.environ["DISABLE_BACKUP"] = "1"
        read_backup.append(":all")
        write_backup.append(":all")

    policy = ProcessPolicy.with_default(
        refresh=args.refresh,
        read_backup=read_backup,
        write_backup=write_backup,
    )

    selected = select_pipelines(args)
    required = selected_resources(selected)
    ctx, dumper = setup_context(required, policy=policy)

    for p_name in sorted(selected):
        print(f"Will run pipeline: {p_name}")
    if required:
        print(
            "Setting up context clients: "
            + " ".join(sorted(r.__name__ for r in required))
        )

    printer = Printer(args)
    try:
        for p_type in PIPELINES:
            if p_type.__name__ in selected:
                print(f"Processing {p_type.__name__}")
                p: Pipeline = Pipeline.create(p_type)
                res = p.read_or_process(ctx)
                printer.print_results(res)
    finally:
        print("Dumping...")
        dumper.dump_pandas()
        print("Done")


if __name__ == "__main__":
    main()
