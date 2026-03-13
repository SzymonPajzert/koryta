import argparse
import json
import sys

import pandas as pd

from conductor import setup_context
from pipelines import PIPELINES
from scrapers.stores import Pipeline, ProcessPolicy, iterate_pipeline


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
            return json.dumps(d, ensure_ascii=False)

    def iterate(self, res):
        if isinstance(res, pd.DataFrame):
            yield from iterate_pipeline(res, None)
        elif isinstance(res, list):
            for item in res:
                yield item


def get_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--refresh",
        help="Pipeline name to refresh, : to exclude or 'all'",
        action="append",
        default=[],
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
    args, _ = parser.parse_known_args()
    return args


def main():
    args = get_args()
    refresh = []
    exclude_refresh = []
    if args.refresh:
        for r in args.refresh:
            if r.startswith(":"):
                exclude_refresh.append(r[1:])
            else:
                refresh.append(r)

    rejestr_io = "ScrapeRejestrIO" in args.pipeline
    policy = ProcessPolicy.with_default(refresh, exclude_refresh=exclude_refresh)
    ctx, dumper = setup_context(rejestr_io, policy)

    no_pipeline = len(args.pipeline) == 0 or args.pipeline is None
    if no_pipeline:
        # TODO this special handling is bad imo
        print("No pipeline specified, will run all except ScrapeRejestrIO")
    pipeline_names = set(pt.__name__ for pt in PIPELINES)
    for p_name in args.pipeline:
        if p_name not in pipeline_names:
            print(f"Error: pipeline {p_name} not found")
            raise ValueError(
                f"Pipeline {p_name} not found. Available: {' '.join(pipeline_names)}"
            )
        print(f"Will run pipeline: {p_name}")

    printer = Printer(args)
    try:
        for p_type in PIPELINES:
            if p_type.__name__ in args.pipeline or (
                no_pipeline and p_type.__name__ != "ScrapeRejestrIO"
            ):
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
