import argparse

from analysis.extract import Extract
from analysis.interesting import CompaniesMerged
from analysis.people import PeopleEnriched, PeopleMerged
from analysis.stats import Statistics
from scrapers.koryta.differ import KorytaDiffer
from scrapers.koryta.download import KorytaPeople
from scrapers.krs.list import CompaniesKRS, PeopleKRS
from scrapers.pkw.process import PeoplePKW
from scrapers.stores import Pipeline, ProcessPolicy
from scrapers.teryt import Regions
from scrapers.wiki.process_articles import ProcessWiki
from scrapers.wiki.process_articles_ner import ProcessWikiNer
from stores.conductor import setup_context as _setup_context


PIPELINES = [
    KorytaPeople,
    KorytaDiffer,
    PeoplePKW,
    PeopleKRS,
    CompaniesKRS,
    ProcessWiki,
    ProcessWikiNer,
    PeopleMerged,
    PeopleEnriched,
    CompaniesMerged,
    Statistics,
    Extract,
    Regions,
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--refresh",
        help="Pipeline name to refresh, : to exclude or 'all'",
        action="append",
        default=[],
    )
    parser.add_argument("pipeline", help="Pipeline to be run", default=None, nargs="*")
    args, _ = parser.parse_known_args()

    refresh = []
    exclude_refresh = []
    if args.refresh:
        for r in args.refresh:
            if r.startswith(":"):
                exclude_refresh.append(r[1:])
            else:
                refresh.append(r)

    policy = ProcessPolicy.with_default(refresh, exclude_refresh=exclude_refresh)
    ctx, dumper = _setup_context(False, policy)

    no_pipeline = len(args.pipeline) == 0 or args.pipeline is None
    if no_pipeline:
        print("No pipeline specified, will run all")
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
            if p_type.__name__ in args.pipeline or no_pipeline:
                print(f"Processing {p_type.__name__}")
                p: Pipeline = Pipeline.create(p_type)
                p.read_or_process(ctx)
        print("Finished processing")
    finally:
        print("Dumping...")
        dumper.dump_pandas()
        print("Done")
