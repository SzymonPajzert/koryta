import argparse
from datetime import date
from functools import cached_property

import pandas as pd
from memoized_property import memoized_property  # type:ignore

from analysis.people import PeopleEnriched
from analysis.utils import drop_duplicates, empty_list_if_nan
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


MATCHED_ODDS = 100000  # 1/odds is the probability the person is an accidental match
EXPECTED_SCORE = 10.5  # Expected score calculated by analysis.people script
RECENT_EMPLOYMENT_START = date.fromisoformat("2024-10-01")
OLD_EMPLOYMENT_END = date.fromisoformat("2020-10-01")


def filter_local_good(
    matched_all,
    filter_region: str | None,
    companies_df=None,
    teryt: Teryt | None = None,
    interesting_people: set[str] | None = None,
):
    """
    :param: filter_region - region in TERYT 10 code, to filter to
    :param: interesting_people - set of RejestrIOKey ids that
            should be included regardless of other criteria
    """

    krs_map = {}
    if companies_df is not None:
        krs_map = {
            c["krs"]: c["city"]
            for c in companies_df.to_dict("records")
            if c.get("city")
        }

    def check_teryt_wojewodztwo(row_regions):
        if filter_region is None:
            return True
        if row_regions is None or isinstance(row_regions, float):
            return False
        # legacy check
        if len(filter_region) == 2 and filter_region in row_regions:
            return True
        if isinstance(row_regions, str):
            return row_regions.startswith(filter_region)

        # Check for more granular regions
        for region in row_regions:
            if region.startswith(filter_region):
                return True
        return False

    def check_employed(employed):
        if filter_region is None:
            return True

        print(employed)

        for emp in empty_list_if_nan(employed):
            krs = emp["employed_krs"]
            # Check hardcoded list for backward compatibility or specific overrides
            if filter_region == "10" and krs in lodzkie_companies:
                return True

            # Dynamic check
            city = krs_map.get(krs)
            if city and teryt:
                city_teryt = teryt.cities_to_teryt.get(city)
                if city_teryt and city_teryt.startswith(filter_region):
                    return True

        return False

    def to_dt(series):
        if pd.api.types.is_numeric_dtype(series):
            return pd.to_datetime(series, unit="ms")
        return pd.to_datetime(series)

    # Get people with high enough scores
    good_score = matched_all["overall_score"] > EXPECTED_SCORE

    first_employed_dt = to_dt(matched_all["first_employed"])
    last_employed_dt = to_dt(matched_all["last_employed"])

    recent = first_employed_dt > pd.Timestamp(RECENT_EMPLOYMENT_START)
    not_too_old = last_employed_dt > pd.Timestamp(OLD_EMPLOYMENT_END)

    interesting = (good_score | recent) & not_too_old

    # Get people for the given region
    local_candidacy = matched_all["teryt_wojewodztwo"].apply(check_teryt_wojewodztwo)
    local_company = matched_all["employment"].apply(check_employed)
    local = local_candidacy | local_company

    # Make sure the chance of a random match is low
    # TODO There's an issue with priobability calculation
    high_probability = True  # (1 - matched_all["unique_chance"]).lt(1 / MATCHED_ODDS)
    # Does the person has matching
    has_wiki = ~matched_all["wiki_name"].isna()
    accurate = high_probability | has_wiki

    interesting_person = False
    if interesting_people is not None:

        def check_interesting_person(ids_list):
            if ids_list is None:
                return False
            if isinstance(ids_list, str):
                return ids_list in interesting_people
            # optimized intersection check
            return not interesting_people.isdisjoint(ids_list)

        interesting_person = matched_all["rejestrio_id"].apply(check_interesting_person)

    local_good = matched_all[(interesting | interesting_person) & local & accurate]

    # Filter out duplicates
    local_good = drop_duplicates(local_good, "krs_name", "pkw_name", "wiki_name")

    return local_good
