import argparse
import json
import typing
from functools import cached_property

from attr import dataclass

from analysis.interesting import Companies
from analysis.people import PeopleMerged
from entities.person import RejestrIOKey
from scrapers.koryta.download import KorytaPeople, KorytaVotes
from scrapers.krs.data import CompaniesHardcoded, PeopleRejestrIOHardcoded
from scrapers.krs.graph import CompanyGraph
from scrapers.krs.list import KRS, CompaniesKRS, PeopleKRS
from scrapers.stores import CloudStorage, Context, Pipeline, iterate_pipeline_dict


@dataclass
class RejestrIOQuery:
    krs: KRS | None = None
    person: RejestrIOKey | None = None
    api_krs_odpis_aktualny_p: bool = False
    api_krs_odpis_aktualny_s: bool = False
    api_rejestrio_org: bool = False
    api_rejestrio_org_krs_powiazania_aktualne: bool = False
    api_rejestrio_org_krs_powiazania_historyczne: bool = False
    api_rejestrio_osoby_krs_powiazania_aktualne: bool = False
    api_rejestrio_osoby_krs_powiazania_historyczne: bool = False

    def __post_init__(self):
        if self.krs is None and self.person is None:
            raise ValueError("Either krs or person must be provided")
        # TODO add a check that if you list KRS connections, you need to provide a KRS

    def cost(self) -> float:
        """Calculate the cost of this query based on which APIs it will call."""
        calls = [
            self.api_rejestrio_org,
            self.api_rejestrio_org_krs_powiazania_aktualne,
            self.api_rejestrio_org_krs_powiazania_historyczne,
            self.api_rejestrio_osoby_krs_powiazania_aktualne,
            self.api_rejestrio_osoby_krs_powiazania_historyczne,
        ]
        return sum(calls) * 0.05

    def urls(self) -> typing.Iterable[str]:
        if self.api_krs_odpis_aktualny_p:
            assert self.krs is not None
            yield f"https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/{self.krs}?rejestr=P&format=json"
        if self.api_krs_odpis_aktualny_s:
            assert self.krs is not None
            yield f"https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/{self.krs}?rejestr=S&format=json"
        if self.api_rejestrio_org:
            assert self.krs is not None
            yield f"https://rejestr.io/api/v2/org/{self.krs}"
        if self.api_rejestrio_org_krs_powiazania_aktualne:
            assert self.krs is not None
            yield f"https://rejestr.io/api/v2/org/{self.krs}/krs-powiazania?aktualnosc=aktualne"
        if self.api_rejestrio_org_krs_powiazania_historyczne:
            assert self.krs is not None
            yield f"https://rejestr.io/api/v2/org/{self.krs}/krs-powiazania?aktualnosc=historyczne"
        if self.api_rejestrio_osoby_krs_powiazania_aktualne:
            assert self.person is not None
            yield f"https://rejestr.io/api/v2/osoby/{self.person.id}/krs-powiazania?aktualnosc=aktualne"
        if self.api_rejestrio_osoby_krs_powiazania_historyczne:
            assert self.person is not None
            yield f"https://rejestr.io/api/v2/osoby/{self.person.id}/krs-powiazania?aktualnosc=historyczne"


def save_org_connections(
    connections: typing.Iterable[KRS],
    names: typing.Iterable[KRS],
    people: typing.Iterable[RejestrIOKey],
) -> typing.Iterable[RejestrIOQuery]:
    connections = list(connections)
    names = list(names)
    people = list(people)

    print(f"len(connections): {len(connections)}")
    print(f"len(names): {len(names)}")
    print(f"len(people): {len(people)}")
    for krs in connections:
        yield RejestrIOQuery(
            krs=krs,
            api_rejestrio_org_krs_powiazania_aktualne=True,
            api_rejestrio_org_krs_powiazania_historyczne=True,
        )

    for krs in names:
        yield RejestrIOQuery(
            krs=krs,
            api_krs_odpis_aktualny_p=True,
            api_krs_odpis_aktualny_s=True,
            api_rejestrio_org=True,
        )

    for person in people:
        yield RejestrIOQuery(
            person=person,
            api_rejestrio_osoby_krs_powiazania_aktualne=True,
            api_rejestrio_osoby_krs_powiazania_historyczne=True,
        )


class ScrapeRejestrIO(Pipeline):
    filename = "scrape_rejestr_io"

    hardcoded_companies: CompaniesHardcoded
    companies: CompaniesKRS
    companies_all: Companies
    hardcoded_people: PeopleRejestrIOHardcoded
    people: PeopleKRS
    people_all: PeopleMerged
    koryta_votes: KorytaVotes
    koryta_people: KorytaPeople

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

    def series_to_set(self, series) -> set[KRS]:
        return set(KRS(krs) for krs in series.tolist())

    def already_scraped_companies(self, ctx: Context) -> set[KRS]:
        scraped_companies = self.companies.read_or_process(ctx)
        return set(
            KRS(id=str(krs).zfill(10)) for krs in scraped_companies["krs"].tolist()
        )

    def companies_to_scrape(self, ctx: Context) -> set[KRS]:
        self.hardcoded_companies.process(ctx)
        already_scraped = self.already_scraped_companies(ctx)

        starters = set(self.hardcoded_companies.all_companies_krs.values())

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
            children = set(
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

    def companies_without_names(self, ctx: Context) -> set[KRS]:
        encountered_companies = self.series_to_set(
            self.people.read_or_process(ctx)["employed_krs"]
        )
        results = set()
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
            connections=self.companies_to_scrape(ctx),
            names=self.companies_without_names(ctx),
            people=self.people_to_scrape(ctx),
        ):
            ctx.io.output_entity(url)


def get_head(s: typing.Iterable[KRS | RejestrIOKey], n: int):
    return sorted(list(s), key=lambda x: x.id)[:n]
