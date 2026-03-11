import argparse
import json
import sys

import pandas as pd

from analysis.extract import Extract
from analysis.graph import CommitteeParties, PeopleParties
from analysis.interesting import CompaniesMerged
from analysis.payloads import CompanyPayloads, PeoplePayloads, RegionPayloads
from analysis.people import PeopleEnriched, PeopleMerged
from analysis.stats import Statistics
from conductor import _setup_context
from scrapers.koryta.differ import KorytaDiffer
from scrapers.koryta.download import KorytaPeople
from scrapers.krs.list import CompaniesKRS, PeopleKRS
from scrapers.krs.scrape import ScrapeRejestrIO
from scrapers.map.postal_codes import PostalCodes
from scrapers.map.teryt import Regions
from scrapers.pkw.process import PeoplePKW
from scrapers.stores import Pipeline, ProcessPolicy
from scrapers.wiki.process_articles import ProcessWiki
from scrapers.wiki.process_articles_ner import ProcessWikiNer


def print_results(res, args):
    if args.output in {"stdout", "stderr"}:
        output = sys.stdout if args.output == "stdout" else sys.stderr
        if isinstance(res, pd.DataFrame):
            print(
                res.to_json(
                    orient="records", lines=True, date_format="iso", force_ascii=False
                ),
                file=output,
            )
        elif isinstance(res, list):
            for item in res:
                print(
                    json.dumps(item, default=str),
                    file=output,
                )
    else:
        print("Finished processing")


PIPELINES = [
    CommitteeParties,
    CompaniesKRS,
    CompaniesMerged,
    CompanyPayloads,
    Extract,
    KorytaDiffer,
    KorytaPeople,
    PeopleEnriched,
    PeopleKRS,
    PeopleMerged,
    PeopleParties,
    PeoplePayloads,
    PeoplePKW,
    PostalCodes,
    ProcessWiki,
    ProcessWikiNer,
    RegionPayloads,
    Regions,
    ScrapeRejestrIO,
    Statistics,
]


def main():
    # TODO this parsing logic and CLI should be moved to a separate file
    # Then we should have examples how to thoroughly test it.

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
        choices=["file", "stdout", "stderr"],
        default="file",
        help="Output channel (file or stdout)",
    )
    args, _ = parser.parse_known_args()

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
    ctx, dumper = _setup_context(rejestr_io, policy)

    no_pipeline = len(args.pipeline) == 0 or args.pipeline is None
    if no_pipeline:
        # TODO this special handling is bad imo
        print("No pipeline specified, will run all except ScrapeRejestrIO")
    pipeline_names = set(pt.__name__ for pt in PIPELINES)
    for p in args.pipeline:
        if p not in pipeline_names:
            print(f"Error: pipeline {p} not found")
            raise ValueError(
                f"Pipeline {p} not found. Available: {' '.join(pipeline_names)}"
            )
        print(f"Will run pipeline: {p}")

    try:
        for p_type in PIPELINES:
            if p_type.__name__ in args.pipeline or (
                no_pipeline and p_type.__name__ != "ScrapeRejestrIO"
            ):
                print(f"Processing {p_type.__name__}")
                p: Pipeline = Pipeline.create(p_type)
                res = p.read_or_process(ctx)
                print_results(res, args)
    finally:
        print("Dumping...")
        dumper.dump_pandas()
        print("Done")


if __name__ == "__main__":
    main()
