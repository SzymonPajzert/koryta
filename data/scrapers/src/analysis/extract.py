import argparse
from functools import cached_property

import pandas as pd
from memoized_property import memoized_property  # type:ignore

from analysis.people import PeopleEnriched
from analysis.utils import filter_local_good
from scrapers.krs.data import PeopleRejestrIOHardcoded
from scrapers.krs.graph import CompanyGraph
from scrapers.krs.list import CompaniesKRS
from scrapers.map.teryt import Teryt
from scrapers.stores import Context, Pipeline


class Extract(Pipeline):
    people: PeopleEnriched
    companies: CompaniesKRS
    teryt: Teryt
    hardcoded_people: PeopleRejestrIOHardcoded
    format = "csv"

    @cached_property
    def args(self):
        parser = argparse.ArgumentParser()
        parser.add_argument(
            "--region",
            help="TERYT of the region to export the data for",
            default=None,
            required=False,
        )
        parser.add_argument(
            "--krs",
            help="KRS of the company to export the data for",
            default=None,
            required=False,
        )
        args, _ = parser.parse_known_args()

        if not args.region and not args.krs:
            raise ValueError("Either region or krs must be provided")

        return args

    @property
    def region(self):
        return self.args.region

    @property
    def krs(self):
        return self.args.krs

    @memoized_property
    def filename(self):
        if self.krs:
            return f"people_extracted_krs_{self.krs}"
        return f"people_extracted_{self.region}"

    def process_graph(self, ctx: Context):
        companies_df = self.companies.read_or_process(ctx)
        rows_num = len(companies_df)
        print(f"Read {rows_num} companies")
        return CompanyGraph.from_dataframe(companies_df)

    def process(self, ctx: Context):
        df = self.people.read_or_process(ctx)

        if self.krs:
            graph = self.process_graph(ctx)
            relevant_companies = graph.all_descendants([self.krs])

            def works_in_relevant(employment_list):
                if not isinstance(employment_list, list):
                    return False
                for emp in employment_list:
                    if emp.get("employed_krs") in relevant_companies:
                        return True
                return False

            df = df[df["employment"].apply(works_in_relevant)]

        companies_df = self.companies.read_or_process(ctx)
        self.teryt.read_or_process(ctx)

        interesting_people_rejestr_ids = set(
            self.hardcoded_people.read_or_process(ctx)["id"].tolist()
        )

        df = filter_local_good(
            df,
            self.region,
            companies_df,
            self.teryt,
            interesting_people=interesting_people_rejestr_ids,
        )

        print(f"Found {len(df)} people")
        print("\n".join(df.columns))

        result = pd.DataFrame()
        result["name"] = df["krs_name"]
        result["history"] = df["history"]
        result["has_wikipedia"] = df["wiki_name"].notna()
        result["birth_date"] = df["birth_date"]
        result["total_employed_years"] = pd.to_timedelta(
            df["employed_total"], unit="ms"
        ).apply(lambda r: r.days / 365)
        result["first_employed"] = pd.to_datetime(df["first_employed"], unit="ms")
        result["last_employed"] = df["last_employed"]
        return result
