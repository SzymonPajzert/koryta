import argparse
import typing
from pprint import pprint
from time import sleep

from scrapers.krs import data
from scrapers.krs.graph import CompanyGraph
from scrapers.krs.list import KRS
from scrapers.stores import Context


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


def scrape_rejestrio(ctx: Context):
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
    args = parser.parse_args()

    already_scraped = set(KRS.from_blob_name(path.url) for path in ctx.io.list_blobs("rejestr.io"))

    starters = set(KRS(krs) for krs in data.CompaniesHardcoded.all_companies_krs)
    if args.only != "":
        # Narrow down starters to only specified companies
        starters = {KRS(args.only)}

    graph = CompanyGraph()

    if args.children:
        children = graph.all_descendants(set(s.id for s in starters))
    else:
        children = starters
    pprint(children)
    # graph.companies does not exist. Logic is broken.
    # children_companies: set = set()
    # children_companies = set(
    #    company for krs, company in graph.companies.items() if krs in children
    # )
    to_scrape = (starters | children) - already_scraped

    print(f"Already scraped: {already_scraped}")
    print(f"To scrape: {to_scrape}")
    print("To scrape (children):")
    # to_scrape_children = set(filter(lambda x: x.krs in to_scrape, children_companies))
    # pprint(to_scrape_children)
    # parent_count = Counter(map(lambda x: x.parent, to_scrape_children))
    # pprint(parent_count.most_common(30))
    urls = list(save_org_connections(to_scrape, map(KRS, data.CompaniesHardcoded().from_source("NAME_MISSING"))))
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
