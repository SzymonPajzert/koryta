import argparse
import typing
from functools import cached_property
from time import sleep

from entities.person import RejestrIOKey
from scrapers.krs.data import CompaniesHardcoded, PeopleRejestrIOHardcoded
from scrapers.krs.graph import CompanyGraph
from scrapers.krs.list import KRS, CompaniesKRS
from scrapers.stores import Context, Pipeline


def save_org_connections(
    connections: typing.Iterable[KRS],
    names: typing.Iterable[KRS],
    people: typing.Iterable[RejestrIOKey],
):
    for krs in names:
        yield (
            f"https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/{krs}?rejestr=P&format=json",
            0,
        )
    for krs in connections:
        yield (
            f"https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/{krs}?rejestr=P&format=json",
            0,
        )
        yield (
            f"https://rejestr.io/api/v2/org/{krs}/krs-powiazania?aktualnosc=aktualne",
            0.05,
        )
        yield (
            f"https://rejestr.io/api/v2/org/{krs}/krs-powiazania?aktualnosc=historyczne",
            0.05,
        )
    for person in people:
        yield (
            f"https://rejestr.io/api/v2/osoby/{person.id}/krs-powiazania?aktualnosc=aktualne",
            0.05,
        )
        yield (
            f"https://rejestr.io/api/v2/osoby/{person.id}/krs-powiazania?aktualnosc=historyczne",
            0.05,
        )


class ScrapeRejestrIO(Pipeline):
    # TODO be able to write that this pipeline doesn't return anything new.
    filename = None

    hardcoded_companies: CompaniesHardcoded
    companies: CompaniesKRS
    hardcoded_people: PeopleRejestrIOHardcoded

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

    def companies_to_scrape(self, ctx: Context) -> set[KRS]:
        # TODO currently it doesn't reprocess, it should automatically.
        scraped_companies = self.companies.read_or_process(ctx)
        self.hardcoded_companies.process(ctx)

        # This should be a list actually
        already_scraped = set(KRS(krs) for krs in scraped_companies["krs"].tolist())

        starters = set(
            # TODO remove the hardcode
            KRS(krs)
            for krs in self.hardcoded_companies.from_source("KALISZ")
        )
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

    def people_to_scrape(self, ctx: Context) -> set[RejestrIOKey]:
        scraped_people = set(
            RejestrIOKey(id=person_id)
            for person_id in self.hardcoded_people.read_or_process(ctx)["id"].to_list()
        )
        print(f"People to scrape: {len(scraped_people)} {get_head(scraped_people, 10)}")
        return scraped_people

    def process(self, ctx: Context):
        urls = list(
            save_org_connections(
                connections=self.companies_to_scrape(ctx),
                # TODO calculate here which companies don't have the name
                # instead of hardcoding them.
                # map(KRS, self.hardcoded_companies.from_source("NAME_MISSING")),
                names=[],
                people=self.people_to_scrape(ctx),
            )
        )
        print(f"Will cost: {sum(map(lambda x: x[1], urls))} PLN")
        input("Press enter to continue...")

        for url, _ in urls:
            result = ctx.rejestr_io.get_rejestr_io(url)
            sleep(0.3)

            if result is None:
                print(f"Skipping {url}")
                continue

            # We're discarding query params, so it's a hotfix for this
            url = url.replace("?aktualnosc=", "/aktualnosc_")
            ctx.io.upload(url, result, "application/json")


def get_head(s: typing.Iterable[KRS | RejestrIOKey], n: int):
    return sorted(list(s), key=lambda x: x.id)[:n]
