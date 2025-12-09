import argparse

import pandas as pd
from memoized_property import memoized_property  # type:ignore

from analysis.people import PeopleMerged
from analysis.utils import filter_local_good
from scrapers.stores import Context, Pipeline


class Extract(Pipeline):
    people: PeopleMerged
    format = "csv"

    @memoized_property
    def region(self):
        parser = argparse.ArgumentParser()
        parser.add_argument("--region", help="TERYT of the region to export the data for", default=None, required=True)
        args, _ = parser.parse_known_args()
        return args.region

    @memoized_property
    def filename(self):
        return f"people_extracted_{self.region}"

    def process(self, ctx: Context):
        df = self.people.read_or_process(ctx)
        df = filter_local_good(df, self.region)
        print(f"Found {len(df)} people")
        result = pd.DataFrame()
        result["name"] = df["krs_name"]
        result["history"] = df["history"]
        return result
