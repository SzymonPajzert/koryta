import argparse
import typing
from functools import cached_property
from pprint import pprint
from time import sleep

from scrapers.krs.data import CompaniesHardcoded
from scrapers.krs.graph import CompanyGraph
from scrapers.krs.list import KRS
from scrapers.stores import CloudStorage, Context, DownloadableFile, Pipeline


def save_org_connections(
    connections: typing.Iterable[KRS],
    names: typing.Iterable[KRS],
):
    for krs in names:
        yield (
            f"https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/{krs}?rejestr=P&format=json",
            0,
        )
        # yield (f"https://rejestr.io/api/v2/org/{krs}", 0.05)
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


class ScrapeRejestrIO(Pipeline):
    filename = None

    hardcoded_companies: CompaniesHardcoded

    @cached_property
    def args(self):
        parser = argparse.ArgumentParser(description="I'll add docs here")
        parser.add_argument(
            "--only",
            dest="only",
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

    def to_scrape(self, ctx: Context):
        # This should be a list actually
        already_scraped = set(
            KRS.from_blob_name(blob.url)
            for blob in ctx.io.list_files(CloudStorage("hostname=rejestr.io"))
            if isinstance(blob, DownloadableFile)
        )

        starters = set(KRS(krs) for krs in self.hardcoded_companies.all_companies_krs)
        if self.args.only != "":
            # Narrow down starters to only specified companies
            starters = {KRS(self.args.only)}

        graph = CompanyGraph()

        if self.args.children:
            children = set(
                KRS(krs) for krs in graph.all_descendants(set(s.id for s in starters))
            )
        else:
            children = starters

        to_scrape = (starters | children) - already_scraped
        print(f"Already scraped: {already_scraped}")
        print(f"To scrape: {to_scrape}")
        print("To scrape (children):")
        return to_scrape

    def process(self, ctx: Context):
        urls = list(
            save_org_connections(
                self.to_scrape(ctx),
                # TODO calculate here which companies don't have the name
                # instead of hardcoding them.
                map(KRS, self.hardcoded_companies.from_source("NAME_MISSING")),
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
