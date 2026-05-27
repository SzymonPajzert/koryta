import argparse
from datetime import date
from functools import cached_property

import pandas as pd

from analysis.people import PeopleEnriched
from analysis.utils import drop_duplicates, empty_list_if_nan
from scrapers.article.hardcoded.listawstydupo import hardcoded as listawstydu
from scrapers.article.hardcoded.tlustekotypisu import hardcoded as tlustekoty
from scrapers.krs.data import PeopleRejestrIOHardcoded
from scrapers.krs.graph import CompanyGraph
from scrapers.krs.list import CompaniesKRS
from scrapers.map.teryt import Teryt
from scrapers.stores import Context, Pipeline


def check_auto_approved():
    tlustekoty_content = {line[0]: line[1] for line in tlustekoty}
    listawsty_content = {line[0]: line[1] for line in listawstydu}

    def check_row(row) -> tuple[int, list[str], str, list[str]]:
        full_name = row["krs_name"]
        first_name = full_name.split(" ")[0]
        last_name = full_name.split(" ")[-1]
        name = f"{first_name} {last_name}"

        count = 0
        content = ""
        sources = []
        parties = []
        if name in tlustekoty_content:
            count += 1
            content += tlustekoty_content[name]
            sources.append(
                "https://www.psl.pl/mamy-liste-357tlustych-kotow-z-pis-w-spolkach-skarbu-panstwa"
            )
            parties.append("PiS")
        if name in listawsty_content:
            count += 1
            content += listawsty_content[name]
            sources.append(
                "https://www.pb.pl/lista-wstydu-platformy-obywatelskiej-691425"
            )
            parties.append("PO")

        return count, sources, content, parties

    return check_row


RECENT_TRESHOLD = "2023-10-15"


class Extract(Pipeline):
    filename = None

    people: PeopleEnriched
    companies: CompaniesKRS
    teryt: Teryt
    hardcoded_people: PeopleRejestrIOHardcoded
    _relevant_companies: set[str] | None = None

    MATCHED_ODDS = 100000  # 1/odds is the probability the person is an accidental match
    EXPECTED_SCORE = 10.5  # Expected score calculated by analysis.people script
    RECENT_EMPLOYMENT_START = date.fromisoformat("2024-10-01")
    OLD_EMPLOYMENT_END = date.fromisoformat("2020-10-01")

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
            dest="krss",
            help="KRS of the company to export the data for",
            default=None,
            required=False,
            nargs="*",
            action="extend",
        )
        parser.add_argument(
            "--approved",
            help="Extract people already approved",
            default=False,
            required=False,
            action=argparse.BooleanOptionalAction,
        )
        parser.add_argument(
            "--employed-after",
            help="Extract people who were employed after the given date",
            default=None,
            required=False,
        )
        parser.add_argument(
            "--currently-employed",
            help="Extract people who are currently employed",
            default=False,
            required=False,
            action=argparse.BooleanOptionalAction,
        )
        parser.add_argument(
            "--ignore-elections",
            help="Ignore elections information, listing people without them",
            default=False,
            required=False,
            action=argparse.BooleanOptionalAction,
        )
        parser.add_argument(
            "--all",
            help="Extract all people",
            default=False,
            required=False,
            action=argparse.BooleanOptionalAction,
        )
        args, _ = parser.parse_known_args()

        if not args.region and not args.krss and not args.approved and not args.all:
            raise ValueError(
                "[Extract]: Needed one of: --region, --krs, --approved, --all"
            )

        return args

    @property
    def region(self):
        return self.args.region

    @property
    def krss(self) -> list[str]:
        return self.args.krss

    @property
    def approved(self) -> bool:
        return self.args.approved

    @property
    def all(self) -> bool:
        return self.args.all

    @property
    def employed_after(self) -> bool:
        return self.args.employed_after

    @property
    def currently_employed(self) -> bool:
        return self.args.currently_employed

    @property
    def ignore_elections(self) -> bool:
        return self.args.ignore_elections

    def process_graph(self, ctx: Context):
        companies_df = self.companies.read_or_process(ctx)
        rows_num = len(companies_df)
        print(f"Read {rows_num} companies")
        return CompanyGraph.from_dataframe(companies_df)

    def relevant_companies(self, ctx) -> set[str]:
        """Returns KRS IDs of companies that match one of the passed requirements."""
        if self._relevant_companies is not None:
            return self._relevant_companies

        result = set()

        if self.krss:
            for krs in self.krss:
                graph = self.process_graph(ctx)
                result |= set.union(graph.all_descendants([krs]))

        if self.region:
            for company in self.companies.read_or_process(ctx).itertuples():
                assert isinstance(company.teryt_code, str)
                if company.teryt_code.startswith(self.region):
                    result.add(company.krs)

        self._relevant_companies = result
        return result

    def relevant_employment(self, ctx):
        relevant_companies = self.relevant_companies(ctx)

        def works_in_relevant(employment_list) -> int:
            if not isinstance(employment_list, list):
                return 0
            result = 0
            for emp in employment_list:
                if emp.get("employed_krs") in relevant_companies or self.all:
                    if self.employed_after:
                        start_date = emp.get("employed_start")
                        if start_date is not None and start_date > self.employed_after:
                            result += 1
                    elif self.currently_employed:
                        end_date = emp.get("employed_end")
                        if end_date is None or end_date > RECENT_TRESHOLD:
                            result += 1
                    else:
                        result += 1

            # TODO run self.all check here if it's the only flag
            return result

        return works_in_relevant

    def relevant_elections(self):
        def check(elections) -> int:
            if self.ignore_elections or self.all:
                return 1
            if not isinstance(elections, list):
                return 0
            if not self.region or len(self.region) == "":
                return 1 if len(elections) > 0 else 0
            result = 0
            for election in elections:
                teryt = (
                    head_or_none(election["teryt_powiat"])
                    or head_or_none(election["teryt_wojewodztwo"])
                    or ""
                )
                if teryt == "":
                    print(election)
                if teryt.startswith(self.args.region):
                    result += 1
            return result

        return check

    def auto_approved_func(self):
        if not self.approved:
            return lambda row: 0

        func = check_auto_approved()

        def check(row):
            return func(row)[0]

        return check

    def process(self, ctx: Context):
        people = self.people.read_or_process(ctx)
        self.teryt.read_or_process(ctx)

        print(f"Relevant companies are: {self.relevant_companies(ctx)}")

        relevant_employment = people["employment"].apply(self.relevant_employment(ctx))
        relevant_elections = people["elections"].apply(self.relevant_elections())
        auto_approved = people.apply(self.auto_approved_func(), axis=1)
        # TODO handle a condition here that --all can be just used as
        # a placeholder but it doesn't disable all the filters
        use_all = 1 if (self.all and not self.employed_after) else 0

        people["total_elections"] = people["elections"].apply(list_length)
        people["total_employments"] = people["employment"].apply(list_length)

        print(
            f"Found {relevant_employment.gt(0).sum()} people with relevant employment"
        )
        print(f"Found {relevant_elections.gt(0).sum()} people with relevant elections")

        # TODO control if we want to have both of them or one of them satisfied
        relevant = (
            relevant_employment * relevant_elections + auto_approved + use_all
        ) > 0
        people["relevance_ratio"] = (relevant_employment + relevant_elections) / (
            people["total_elections"] + people["total_employments"]
        )
        people_interesting = people[relevant]

        df = drop_duplicates(people_interesting, "krs_name", "pkw_name", "wiki_name")
        print(f"Found {len(df)} people")
        return df


class FormatCSV(Pipeline):
    format = "csv"

    extract: Extract

    def format_output(self, df):
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
        result["total_elections"] = df["total_elections"]
        result["relevance_ratio"] = df["relevance_ratio"]
        return result

    def process(self, ctx: Context):
        df = self.extract.read_or_process(ctx)
        return self.format_output(df)


def head_or_none(ss):
    for s in ss:
        return s
    return None


def list_length(ss):
    return len(empty_list_if_nan(ss))


# TODO add interesting people
# def filter_local_good(
#     matched_all,
#     filter_region: str | None,
#     companies_df=None,
#     teryt: Teryt | None = None,
#     interesting_people: set[str] | None = None,
# ):
#     """
#     :param: filter_region - region in TERYT 10 code, to filter to
#     :param: interesting_people - set of RejestrIOKey ids that
#             should be included regardless of other criteria
#     """
#     def to_dt(series):
#         if pd.api.types.is_numeric_dtype(series):
#             return pd.to_datetime(series, unit="ms")
#         return pd.to_datetime(series)
#     # Get people with high enough scores
#     good_score = matched_all["overall_score"] > EXPECTED_SCORE
#     first_employed_dt = to_dt(matched_all["first_employed"])
#     last_employed_dt = to_dt(matched_all["last_employed"])
#     recent = first_employed_dt > pd.Timestamp(RECENT_EMPLOYMENT_START)
#     not_too_old = last_employed_dt > pd.Timestamp(OLD_EMPLOYMENT_END)
#     interesting = (good_score | recent) & not_too_old
#     # Get people for the given region
#     local_candidacy = matched_all["teryt_wojewodztwo"].apply(check_teryt_wojewodztwo)
#     local_company = matched_all["employment"].apply(check_employed)
#     local = local_candidacy | local_company
#     # Make sure the chance of a random match is low
#     # TODO There's an issue with priobability calculation
#     high_probability = True  # (1 - matched_all["unique_chance"]).lt(1 / MATCHED_ODDS)
#     # Does the person has matching
#     has_wiki = ~matched_all["wiki_name"].isna()
#     accurate = high_probability | has_wikis
#     interesting_person = False
#     if interesting_people is not None:
#         def check_interesting_person(ids_list):
#             if ids_list is None:
#                 return False
#             if isinstance(ids_list, str):
#                 return ids_list in interesting_people
#             # optimized intersection check
#             return not interesting_people.isdisjoint(ids_list)
#         interesting_person = matched_all["rejestrio_id"].apply(
#           check_interesting_person)
#     local_good = matched_all[(interesting | interesting_person) & local & accurate]
