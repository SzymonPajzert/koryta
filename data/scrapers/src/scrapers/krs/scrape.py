import argparse
import json
import typing
from dataclasses import asdict, dataclass, field
from enum import Enum
from functools import cached_property

import pandas as pd
from tqdm import tqdm

from analysis.interesting import Companies
from analysis.people import PeopleMerged
from entities.company import KRS
from entities.person import RejestrIOKey
from scrapers.koryta.download import KorytaPeople, KorytaVotes
from scrapers.krs.data import CompaniesHardcoded, PeopleRejestrIOHardcoded
from scrapers.krs.graph import CompanyGraph
from scrapers.krs.list import CompaniesKRS, PeopleKRS
from scrapers.krs.updates import KRSUpdates
from scrapers.stores import (
    CloudStorage,
    Context,
    DownloadableFile,
    Pipeline,
    iterate_pipeline_dict,
)


class QueryType(Enum):
    API_KRS_ODPIS_AKTUALNY_P = "api_krs_odpis_aktualny_p"
    API_KRS_ODPIS_AKTUALNY_S = "api_krs_odpis_aktualny_s"
    REJESTRIO_ORG = "rejestrio_org"
    REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE = "rejestrio_org_krs_powiazania_aktualne"
    REJESTRIO_ORG_KRS_POWIAZANIA_HISTORYCZNE = (
        "rejestrio_org_krs_powiazania_historyczne"
    )
    REJESTRIO_OSOBY_KRS_POWIAZANIA_AKTUALNE = "rejestrio_osoby_krs_powiazania_aktualne"
    REJESTRIO_OSOBY_KRS_POWIAZANIA_HISTORYCZNE = (
        "rejestrio_osoby_krs_powiazania_historyczne"
    )


@dataclass
class RejestrIOQuery:
    krs: KRS | None = None
    person: RejestrIOKey | None = None
    queries: list[QueryType] = field(default_factory=lambda: [])

    def __post_init__(self):
        if self.krs is None and self.person is None:
            raise ValueError("Either krs or person must be provided")
        # TODO add a check that if you list KRS connections, you need to provide a KRS

    def cost(self) -> float:
        """Calculate the cost of this query based on which APIs it will call."""
        calls = [q for q in self.queries if q.value.startswith("rejestrio")]
        return len(calls) * 0.05

    def urls(self, only_free=False) -> typing.Iterable[str]:
        if QueryType.API_KRS_ODPIS_AKTUALNY_P in self.queries:
            assert self.krs is not None
            yield f"https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/{self.krs}?rejestr=P&format=json"
        if QueryType.API_KRS_ODPIS_AKTUALNY_S in self.queries:
            assert self.krs is not None
            yield f"https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/{self.krs}?rejestr=S&format=json"
        if QueryType.REJESTRIO_ORG in self.queries and not only_free:
            assert self.krs is not None
            yield f"https://rejestr.io/api/v2/org/{self.krs}"

        if not only_free:
            if QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE in self.queries:
                assert self.krs is not None
                yield f"https://rejestr.io/api/v2/org/{self.krs}/krs-powiazania?aktualnosc=aktualne"
            if QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_HISTORYCZNE in self.queries:
                assert self.krs is not None
                yield f"https://rejestr.io/api/v2/org/{self.krs}/krs-powiazania?aktualnosc=historyczne"
            if QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_AKTUALNE in self.queries:
                assert self.person is not None
                yield f"https://rejestr.io/api/v2/osoby/{self.person.id}/krs-powiazania?aktualnosc=aktualne"
            if QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_HISTORYCZNE in self.queries:
                assert self.person is not None
                yield f"https://rejestr.io/api/v2/osoby/{self.person.id}/krs-powiazania?aktualnosc=historyczne"


class KRSSet:
    """
    Represents a set of KRS entries, merging and handling duplicates.
    """

    def __init__(self, initial_entries: typing.Optional[typing.Iterable[KRS]] = None):
        self.entries: dict[str, KRS] = {}
        if initial_entries:
            for krs in initial_entries:
                self.add(krs)

    def add(self, krs: KRS):
        """Adds a KRS entry to the set or merges if the same ID already exists."""
        if krs.id in self.entries:
            self.entries[krs.id] = self.entries[krs.id].merge(krs)
        else:
            self.entries[krs.id] = krs

    def __or__(self, other: "KRSSet") -> "KRSSet":
        """Returns a new KRSSet containing the union of both sets."""
        result = KRSSet(self.entries.values())
        for entry in other.entries.values():
            result.add(entry)
        return result

    def __sub__(self, other: "KRSSet") -> "KRSSet":
        """Returns a new KRSSet containing differences between the sets."""
        result = KRSSet()
        for id, entry in self.entries.items():
            if id not in other.entries:
                result.add(entry)
        return result

    def __iter__(self):
        return iter(self.entries.values())

    def __len__(self):
        return len(self.entries)

    def __getitem__(self, key: str):
        return self.entries[key]

    def __contains__(self, key: str):
        return key in self.entries


@dataclass
class KRSScraped:
    krs: str
    method: QueryType
    date: str

    @staticmethod
    def parse(url: str) -> typing.Optional["KRSScraped"]:
        date = url.split("/date=", 1)[1].split("/", 1)[0]

        if "rejestr.io" in url and "org/" in url:
            krs = url.split("org/", 1)[1].split("/", 1)[0]
            if "aktualnosc_aktualne" in url:
                return KRSScraped(
                    krs, QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE, date
                )
            elif "aktualnosc_historyczne" in url:
                return KRSScraped(
                    krs, QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_HISTORYCZNE, date
                )
            else:
                return KRSScraped(krs, QueryType.REJESTRIO_ORG, date)
        elif "api-krs.ms.gov.pl" in url:
            if "Biuletyn" in url:
                return None
            krs = url.split("OdpisAktualny/", 1)[1].split("/", 1)[0]
            return KRSScraped(krs, QueryType.API_KRS_ODPIS_AKTUALNY_P, date)
        else:
            return None


class KRSAlreadyScraped(Pipeline):
    filename = "krs_already_scraped"

    def process(self, ctx: Context):
        output = []
        success, fail = 0, 0
        """lists krs numbers along with the method and the date it was ran on."""
        for blob_name in tqdm(
            ctx.io.list_files(CloudStorage(prefix="hostname=rejestr.io"))
        ):
            assert isinstance(blob_name, DownloadableFile)
            r = KRSScraped.parse(blob_name.url)
            if r:
                success += 1
                output.append(r)
            else:
                fail += 1

        print(f"Success: {success}, Fail: {fail}")

        for blob_name in tqdm(
            ctx.io.list_files(CloudStorage(prefix="hostname=api-krs.ms.gov.pl"))
        ):
            assert isinstance(blob_name, DownloadableFile)
            r = KRSScraped.parse(blob_name.url)
            if r:
                success += 1
                output.append(r)
            else:
                fail += 1

        print(f"Success: {success}, Fail: {fail}")

        print(len(output))
        return pd.DataFrame.from_records([asdict(r) for r in output])

    def latest_scrapes(self, ctx: Context):
        """Groups by krs and lists methods already used"""
        df = self.read_or_process(ctx)
        max_dates = df.groupby(["krs", "method"]).aggregate("max").reset_index()
        return max_dates


class KRSNeedsRefresh(Pipeline):
    filename = "krs_needs_refresh"

    already_scraped: KRSAlreadyScraped
    updates: KRSUpdates

    def process(self, ctx):
        """Lists updates for a KRS and checks if there were any more recent updates"""

        latest_scrapes = self.already_scraped.latest_scrapes(ctx)

        updates_df = self.updates.read_or_process(ctx)
        if updates_df.empty:
            return pd.DataFrame(columns=["krs", "method", "date", "update_date"])

        updates_df["krs"] = updates_df["krs"].astype(str).str.zfill(10)
        latest_updates = updates_df.groupby(["krs"]).aggregate("max").reset_index()
        latest_updates = latest_updates.rename(columns={"date": "update_date"})

        merged = pd.merge(latest_scrapes, latest_updates, on="krs", how="inner")
        needs_refresh = merged[
            (merged["update_date"] > merged["date"])
            # | (merged["update_date"] > "2026-05-01")
        ]

        return needs_refresh.sort_values(by=["update_date"], ascending=False)


def get_osoby_scraped(ctx: Context) -> dict[str, list[str]]:
    osoby_scraped: dict[str, list[str]] = {}
    for blob_name in ctx.io.list_files(CloudStorage(prefix="hostname=rejestr.io")):
        assert isinstance(blob_name, DownloadableFile)
        split = blob_name.url.split("osoby/", 1)
        if len(split) < 2:
            continue

        person_id = split[1].split("/", 1)[0]
        if "aktualnosc_aktualne" in blob_name.url:
            osoby_scraped[person_id] = osoby_scraped.get(person_id, []) + [
                "aktualnosc_aktualne"
            ]
        elif "aktualnosc_historyczne" in blob_name.url:
            osoby_scraped[person_id] = osoby_scraped.get(person_id, []) + [
                "aktualnosc_historyczne"
            ]
        else:
            osoby_scraped[person_id] = osoby_scraped.get(person_id, []) + ["main"]

    return osoby_scraped


def series_to_list(s: pd.Series) -> list[str]:
    return s.tolist()


def save_org_connections(
    already_scraped_krs: pd.DataFrame,
    needs_refresh_krs: pd.DataFrame,
    already_scraped_people: dict[str, list[str]],
    connections: typing.Iterable[KRS],
    names: typing.Iterable[KRS],
    people: typing.Iterable[RejestrIOKey],
) -> typing.Iterable[RejestrIOQuery]:
    con_list = list(connections)
    con_refresh = needs_refresh_krs["krs"].unique().tolist()
    # Join KRS ids with the ones that needs a refresh.
    connections = set(con_list) | set(KRS(krs) for krs in con_refresh)

    names = list(names)
    people = list(people)

    print(
        f"len(connections): {len(con_list)} + {len(con_refresh)} = {len(connections)}"
    )
    print(f"len(names): {len(names)}")
    print(f"len(people): {len(people)}")

    print(f"\n\nalready_scraped_krs ({len(already_scraped_krs)}):")
    print(already_scraped_krs.head())

    print(f"\n\nneeds_refresh_krs ({len(needs_refresh_krs)}):")
    print(needs_refresh_krs.head())

    # Remove needs refresh from already_scraped_krs, since we need to update them.
    already_scraped = (
        pd.merge(
            already_scraped_krs[["krs", "method"]],
            needs_refresh_krs[["krs", "method"]],
            on=["krs", "method"],
            how="outer",
            indicator=True,
        )
        .query("_merge != 'both'")
        .drop("_merge", axis=1)
        .reset_index(drop=True)
        .groupby("krs")
        .aggregate(series_to_list)
    )

    print(f"\n\nalready_scraped ({len(already_scraped)}):")
    print(already_scraped.head())

    for krs in connections:
        connections_methods: list[QueryType] = [
            QueryType(q) for q in already_scraped["method"].get(krs.id, [])
        ]
        query = RejestrIOQuery(
            krs=krs,
            queries=[
                q
                for q in [
                    QueryType.API_KRS_ODPIS_AKTUALNY_P,
                    QueryType.API_KRS_ODPIS_AKTUALNY_S,
                    QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE,
                    QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_HISTORYCZNE,
                ]
                if q not in connections_methods
            ],
        )
        if len(list(query.urls())) > 0:
            # If there's nothing to query, don't send it
            yield query

    for krs in names:
        yield RejestrIOQuery(
            krs=krs,
            queries=[
                QueryType.API_KRS_ODPIS_AKTUALNY_P,
                QueryType.API_KRS_ODPIS_AKTUALNY_S,
            ],
        )

    for person in people:
        people_methods: list[QueryType] = [
            QueryType(q) for q in already_scraped_people.get(person.id, [])
        ]
        query = RejestrIOQuery(
            person=person,
            queries=[
                q
                for q in [
                    QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_AKTUALNE,
                    QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_HISTORYCZNE,
                ]
                if q not in people_methods
            ],
        )
        if len(list(query.urls())) > 0:
            yield query


class ScrapeRejestrIO(Pipeline[RejestrIOQuery]):
    filename = "scrape_rejestr_io"

    hardcoded_companies: CompaniesHardcoded
    companies: CompaniesKRS
    already_scraped: KRSAlreadyScraped
    companies_all: Companies
    hardcoded_people: PeopleRejestrIOHardcoded
    people: PeopleKRS
    people_all: PeopleMerged
    koryta_votes: KorytaVotes
    koryta_people: KorytaPeople

    @property
    def output_class(self):
        return RejestrIOQuery

    @cached_property
    def args(self):
        parser = argparse.ArgumentParser(description="I'll add docs here")
        parser.add_argument(
            "--only_krs",
            dest="only_krs",
            default="",
            help="only show children of this KRS",
        )
        parser.add_argument(
            "--children",
            dest="children",
            default=True,
            help="If False, don't scrape children of the companies",
        )
        args, _ = parser.parse_known_args()

        return args

    def series_to_set(self, series) -> KRSSet:
        return KRSSet(KRS(krs) for krs in series.tolist())

    def already_scraped_companies(self, ctx: Context) -> KRSSet:
        scraped = self.already_scraped.read_or_process(ctx)
        if scraped is None or scraped.empty:
            return KRSSet()
        return KRSSet(KRS(id=str(krs).zfill(10)) for krs in scraped["krs"].unique())

    def companies_to_scrape(self, ctx: Context) -> KRSSet:
        self.hardcoded_companies.process(ctx)
        already_scraped = self.already_scraped_companies(ctx)

        starters = KRSSet(self.hardcoded_companies.all_companies_krs.values())

        for blob_ref in ctx.io.list_files(CloudStorage(prefix="hostname=rejestr.io")):
            blob_name = getattr(blob_ref, "url", str(blob_ref))
            if "osoby" in blob_name and "krs-powiazania" in blob_name:
                blob = ctx.io.read_data(blob_ref)
                try:
                    data = json.loads(blob.read_string())
                    for item in data:
                        if isinstance(item, dict) and item.get("typ") == "organizacja":
                            krs_num = item.get("numery", {}).get("krs")
                            if krs_num:
                                starters.add(KRS(id=str(krs_num).zfill(10)))
                except Exception as e:
                    print(f"Error parsing {blob_name}: {e}")

        print("Starters: ", starters)

        graph = CompanyGraph()

        if self.args.children:
            children = KRSSet(
                KRS(krs) for krs in graph.all_descendants(set(s.id for s in starters))
            )
        else:
            children = starters

        to_scrape = (starters | children) - already_scraped
        print(f"Starters: {len(starters)} {get_head(starters, 10)}")
        print(
            f"Already scraped: {len(already_scraped)} {get_head(already_scraped, 10)}"
        )
        print(f"To scrape: {len(to_scrape)} {get_head(to_scrape, 10)}")

        return to_scrape

    def companies_without_names(self, ctx: Context) -> KRSSet:
        encountered_companies = self.series_to_set(
            self.people.read_or_process(ctx)["employed_krs"]
        )
        results = KRSSet()
        companies = {
            c["krs"]: c
            for c in iterate_pipeline_dict(self.companies_all.read_or_process(ctx))
        }
        for c in encountered_companies:
            company = companies.get(c.id, None)
            if company is None:
                results.add(c)
                continue
            if company["name"] is None:
                results.add(c)

        return results

    def people_to_scrape(self, ctx: Context) -> set[RejestrIOKey]:
        scraped_people = set(
            RejestrIOKey(id=person_id)
            for person_id in self.hardcoded_people.read_or_process(ctx)["id"].to_list()
        )

        koryta_votes_df = self.koryta_votes.read_or_process(ctx)
        koryta_people_df = self.koryta_people.read_or_process(ctx)

        koryta_id_to_name = dict(
            zip(koryta_people_df["id"], koryta_people_df["full_name"])
        )

        # TODO this matching rejestr.io to names logic is duplicated
        # We should merge it in one of the pipelines
        interesting_names = set()
        for _, row in koryta_votes_df.iterrows():
            person_koryta_id = row.get("person_koryta_id")
            if not person_koryta_id or person_koryta_id == "":
                continue
            interesting = row.get("interesting", 0)
            if interesting > 0:
                name = koryta_id_to_name.get(str(person_koryta_id))
                if name:
                    interesting_names.add(name)

        people_merged_df = self.people_all.read_or_process(ctx)
        for _, row in people_merged_df.iterrows():
            koryta_name = row.get("koryta_name")
            if koryta_name in interesting_names:
                rejestr_ids = row.get("rejestrio_id", [])
                if len(rejestr_ids) > 0:
                    scraped_people.add(RejestrIOKey(id=str(rejestr_ids[0])))

        people_krs_df = self.people.read_or_process(ctx)
        for _, row in people_krs_df.iterrows():
            full_name = row.get("full_name")
            if full_name in interesting_names:
                rejestrio_id = row.get("id")
                if rejestrio_id:
                    scraped_people.add(RejestrIOKey(id=str(rejestrio_id)))

        print(f"People to scrape: {len(scraped_people)} {get_head(scraped_people, 10)}")
        return scraped_people

    def process(self, ctx: Context):
        for url in save_org_connections(
            already_scraped_krs=KRSAlreadyScraped().latest_scrapes(ctx),
            needs_refresh_krs=KRSNeedsRefresh().read_or_process(ctx),
            already_scraped_people=get_osoby_scraped(ctx),
            connections=self.companies_to_scrape(ctx),
            names=self.companies_without_names(ctx),
            people=self.people_to_scrape(ctx),
        ):
            ctx.io.output_entity(url)


def get_head(s: typing.Iterable[KRS | RejestrIOKey], n: int):
    return sorted(list(s), key=lambda x: x.id)[:n]
