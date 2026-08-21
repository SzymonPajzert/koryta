import argparse
from datetime import date
from functools import cached_property

import pandas as pd

from analysis.people import PeopleEnriched
from analysis.utils import as_sequence, drop_duplicates, empty_list_if_nan
from analysis.utils.elections import candidacy_teryt
from scrapers.article.hardcoded.listawstydupo import hardcoded as listawstydu
from scrapers.article.hardcoded.tlustekotypisu import hardcoded as tlustekoty
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


def iso_date(value: str) -> str:
    """A `YYYY-MM-DD` date, checked, and handed on as the string it came as.

    The dates it is compared against are the register's own `employed_start`
    strings, and the comparison is a string one, so the flag has to stay a
    string - but it has to be a string in that shape. `--employed-after
    01-10-2024` sorts below every ISO date there is, so before this it did not
    narrow the run by a single person and said nothing about it.
    """
    return date.fromisoformat(value).isoformat()


def is_public(flags: pd.Series) -> pd.Series:
    """A column of "is this company publicly owned" as actual booleans.

    `astype(bool)` is not that. A column that came back as text - a frame read
    without `CompaniesKRS`'s pinned dtypes, a hand-made CSV - has `astype(bool)`
    call the string "False" true, and every company in the register would then
    be public, so `--public-employer` would filter nothing while looking like it
    had. Missing reads as false: not knowing who owns a company is not knowing
    that the public does.
    """
    if pd.api.types.is_bool_dtype(flags) or pd.api.types.is_numeric_dtype(flags):
        return flags.fillna(False).astype(bool)
    # Anything else is read as text, which on this pandas is the dtype a column
    # of Python strings gets - `object` is not the only way text arrives.
    return flags.map(
        lambda value: value is True or str(value).strip().lower() in {"true", "1"}
    ).astype(bool)


def krs_ids(ids: pd.Series) -> pd.Series:
    """KRS ids as the zero-padded ten-character strings everything else uses.

    A KRS id is only itself zero-padded and the employment records carry it
    that way. `CompaniesKRS` pins the column to a string so a normal run needs
    none of this, but a frame that arrived another way has had its leading
    zeros inferred away - and as a float, `str()` leaves a ".0" on the end, so
    padding alone turns 120987 into "0120987.0" rather than back into
    "0000120987". An id that matches no employment record reads as "nobody
    works anywhere public", which is a wrong answer rather than an error.
    """
    if pd.api.types.is_float_dtype(ids):
        ids = ids.astype("Int64")
    return ids.astype(str).str.zfill(10)


class Extract(Pipeline):
    filename = None

    people: PeopleEnriched
    companies: CompaniesKRS
    teryt: Teryt
    _relevant_companies: set[str] | None = None
    _public_companies: set[str] | None = None

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
            help="Extract people who were employed after the given date (YYYY-MM-DD)",
            type=iso_date,
            default=None,
            required=False,
        )
        parser.add_argument(
            "--public-employer",
            help="Count only jobs at companies the register puts in public "
            "hands - the state, a voivodeship, a powiat or a gmina, and "
            "whatever they own down the chain. Meant for --employed-after: "
            "somebody who took a job at a private company last year is not "
            "what the site is about. Pair it with --ignore-elections unless "
            "the run should also require a candidacy.",
            default=False,
            required=False,
            action=argparse.BooleanOptionalAction,
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
            "--election-after",
            help="Show people with elections after that year",
            default=None,
            required=False,
        )
        parser.add_argument(
            "--all",
            help="Extract all people",
            default=False,
            required=False,
            action=argparse.BooleanOptionalAction,
        )
        parser.add_argument(
            "--min-score",
            type=int,
            # The bands `analysis.scores.base.SCORE_BANDS` hands out, spelled
            # out rather than imported: the models are built on the payloads,
            # which are built on this, so importing them here is a cycle.
            choices=[1, 2, 3, 4, 5],
            help="Only list people the scoring models rate this highly, on "
            "the same 1-5 scale the site shows. Applied one pipeline later, by "
            "PeoplePayloads - see its `min_score` property.",
            default=None,
            required=False,
        )
        parser.add_argument(
            "--rejestrio-id",
            help="Extract a person with a given RejestrIO id",
            default=None,
            required=False,
        )
        args, _ = parser.parse_known_args()

        # TODO organize how the filtering is supposed to work
        if (
            not args.region
            and not args.krss
            and not args.approved
            and not args.all
            and not args.rejestrio_id
        ):
            raise ValueError(
                "Needed one of following flags to 'koryta' command: --region, --krs, \
--approved, --all, --rejestrio-id. See pipeline Extract for more details."
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
    def rejestrio_id(self) -> str | None:
        return self.args.rejestrio_id

    @property
    def min_score(self) -> int | None:
        """The lowest band a person can be rated and still be listed, if any.

        Defined with the rest of the filters that decide who this run is about,
        and applied by `PeoplePayloads` rather than here, because the models
        that do the rating read a person's employers and candidacies in the
        payload shapes - which is one pipeline further on than this.
        """
        return self.args.min_score

    @property
    def employed_after(self) -> bool:
        return self.args.employed_after

    @property
    def currently_employed(self) -> bool:
        return self.args.currently_employed

    @property
    def public_employer(self) -> bool:
        return self.args.public_employer

    @property
    def ignore_elections(self) -> bool:
        return self.args.ignore_elections

    @property
    def election_after(self) -> bool:
        return self.args.election_after

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

    def public_companies(self, ctx) -> set[str]:
        """KRS ids of the companies the register puts in public hands.

        `is_public` is `CompaniesKRS`'s own answer rather than a guess made
        here: a founding ministry named in the register entry, an owner called
        GMINA/MIASTO/POWIAT/WOJEWODZTWO, one of the hardcoded state-company
        lists, or a company owned by something that is already public - see
        `compute_public_krss` and `propagate_is_public` there.

        False is "the register never said so" rather than "private", and the
        case that costs most is a state-controlled S.A.: KRS names shareholders
        only for a sp. z o.o. or a sole shareholder, so ORLEN and PKP S.A. are
        public here while ENERGA and PKP CARGO, which they control, carry no
        owner at all and are not. Somebody whose only recent job is at one of
        those is left out, which is the trade `--public-employer` makes - the
        register's answer rather than a guess off the company's name.
        """
        if self._public_companies is not None:
            return self._public_companies

        companies = self.companies.read_or_process(ctx)
        if "is_public" not in companies:
            raise ValueError(
                "--public-employer needs the is_public column CompaniesKRS "
                "writes, and the company data read here has none. Rebuild it "
                "with --refresh CompaniesKRS."
            )

        public = companies.loc[is_public(companies["is_public"]), "krs"]
        self._public_companies = set(krs_ids(public))
        print(f"{len(self._public_companies)} of {len(companies)} companies are public")
        return self._public_companies

    def relevant_employment(self, ctx):
        relevant_companies = self.relevant_companies(ctx)
        public_companies = self.public_companies(ctx) if self.public_employer else None

        def works_in_relevant(employment_list) -> int:
            result = 0
            for emp in as_sequence(employment_list):
                krs = emp.get("employed_krs")
                # A job at a company nobody has established the ownership of
                # counts as not public, not as unknown: the flag is there to
                # leave out the private sector, and a company the register was
                # never asked about is a company we cannot say that of.
                if public_companies is not None and krs not in public_companies:
                    continue
                if krs in relevant_companies or self.all:
                    if self.employed_after:
                        start_date = emp.get("employed_start")
                        if start_date is not None and start_date > self.employed_after:
                            result += 1
                    elif self.currently_employed:
                        end_date = emp.get("employed_end")
                        if end_date is None:
                            result += 1
                    else:
                        result += 1

            # TODO run self.all check here if it's the only flag
            return result

        return works_in_relevant

    def relevant_elections(self):
        def check(elections) -> int:
            if self.ignore_elections:
                return 1

            result = 0
            for election in as_sequence(elections):
                election_ok = True
                if self.region:
                    teryt = candidacy_teryt(election) or ""
                    if teryt == "" or not teryt.startswith(self.args.region):
                        election_ok = False

                if self.election_after:
                    year = election.get("election_year")
                    if year is not None and year < self.election_after:
                        election_ok = False

                if election_ok:
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

        # print(f"Relevant companies are: {self.relevant_companies(ctx)}")

        relevant_employment = people["employment"].apply(self.relevant_employment(ctx))
        relevant_elections = people["elections"].apply(self.relevant_elections())
        auto_approved = people.apply(self.auto_approved_func(), axis=1)
        # TODO handle a condition here that --all can be just used as
        # a placeholder but it doesn't disable all the filters
        # Every flag that narrows what counts has to be named here, or --all
        # keeps listing everybody and the narrowing silently does nothing.
        use_all = (
            1
            if (
                self.all
                and not self.employed_after
                and not self.election_after
                and not self.public_employer
                and not self.currently_employed
            )
            else 0
        )

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

        if self.rejestrio_id:

            def check_rejestrio_id(ids_list):
                return self.rejestrio_id in set(map(str, as_sequence(ids_list)))

            relevant = relevant | people["rejestrio_id"].apply(check_rejestrio_id)
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
