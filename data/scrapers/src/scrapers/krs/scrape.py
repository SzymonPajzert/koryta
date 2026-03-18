import argparse
import json
import typing
from functools import cached_property
from time import sleep

import requests

from analysis.interesting import Companies
from analysis.people import PeopleMerged
from entities.company import ManualKRS
from entities.person import RejestrIOKey
from scrapers.krs.data import CompaniesHardcoded, PeopleRejestrIOHardcoded
from scrapers.krs.graph import CompanyGraph
from scrapers.krs.list import KRS, CompaniesKRS, PeopleKRS
from scrapers.stores import Context, Pipeline, iterate_pipeline_dict


def save_org_connections(
    connections: typing.Iterable[KRS],
    names: typing.Iterable[KRS],
    people: typing.Iterable[RejestrIOKey],
):
    connections = list(connections)
    names = list(names)
    people = list(people)

    print(f"len(connections): {len(connections)}")
    print(f"len(names): {len(names)}")
    print(f"len(people): {len(people)}")
    for krs in names:
        yield (
            f"https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/{krs}?rejestr=P&format=json",
            0,
            0,
        )
        yield (
            f"https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/{krs}?rejestr=S&format=json",
            0,
            0,
        )
        yield (f"https://rejestr.io/api/v2/org/{krs}", 0.05, 0)
    for krs in connections:
        yield (
            f"https://rejestr.io/api/v2/org/{krs}/krs-powiazania?aktualnosc=aktualne",
            0.05,
            1,
        )
        yield (
            f"https://rejestr.io/api/v2/org/{krs}/krs-powiazania?aktualnosc=historyczne",
            0.05,
            0,
        )
    for person in people:
        yield (
            f"https://rejestr.io/api/v2/osoby/{person.id}/krs-powiazania?aktualnosc=aktualne",
            0.05,
            1,
        )
        yield (
            f"https://rejestr.io/api/v2/osoby/{person.id}/krs-powiazania?aktualnosc=historyczne",
            0.05,
            0,
        )


class ScrapeRejestrIO(Pipeline):
    # TODO be able to write that this pipeline doesn't return anything new.
    filename = None

    hardcoded_companies: CompaniesHardcoded
    companies: CompaniesKRS
    companies_all: Companies
    hardcoded_people: PeopleRejestrIOHardcoded
    people: PeopleKRS
    people_all: PeopleMerged

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
        return self.series_to_set(scraped_companies["krs"])

    def companies_to_scrape(self, ctx: Context) -> set[KRS]:
        self.hardcoded_companies.process(ctx)
        already_scraped = self.already_scraped_companies(ctx)

        starters = set(self.hardcoded_companies.all_companies_krs.values())
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
        print(f"People to scrape: {len(scraped_people)} {get_head(scraped_people, 10)}")
        return scraped_people

    def process(self, ctx: Context):
        urls = list(
            save_org_connections(
                connections=self.companies_to_scrape(ctx),
                names=self.companies_without_names(ctx),
                people=self.people_to_scrape(ctx),
            )
        )
        print(f"Will cost: {sum(map(lambda x: x[1], urls))} PLN")
        input("Press enter to continue...")

        skip = 0
        for url, _, skip_on_fail in urls:
            if skip > 0:
                print(f"Skipping {url} (skipping {skip} more)")
                skip -= 1
                continue
            if "rejestr.io" in url:
                result = ctx.rejestr_io.get_rejestr_io(url)
            else:
                print(f"Requesting: {url}")
                try:
                    response = requests.get(url)
                    result = response.json()
                except requests.exceptions.JSONDecodeError:
                    print(f"Failed to decode JSON from {url}, skipping")
                    print(f"Response: {response.text}")
                    skip = skip_on_fail
                    continue
                if "odpis" not in result:
                    print(f"Unexpected response for {url}: {result}, skipping")
                    skip = skip_on_fail
                    continue
                dzial1 = result["odpis"]["dane"]["dzial1"]
                dane = dzial1["danePodmiotu"]
                miasto = dzial1["siedzibaIAdres"]["adres"]["miejscowosc"]
                print(f"{dane.get('nazwa', dane)} - {miasto}")
                result = json.dumps(result)
            sleep(0.3)

            if result is None:
                print(f"Skipping {url}")
                continue

            # We're discarding query params, so it's a hotfix for this
            url = url.replace("?aktualnosc=", "/aktualnosc_")
            url = url.replace("?rejestr=P&format=json", "")
            ctx.io.upload(url, result, "application/json")


def get_head(s: typing.Iterable[KRS | RejestrIOKey], n: int):
    return sorted(list(s), key=lambda x: x.id)[:n]
