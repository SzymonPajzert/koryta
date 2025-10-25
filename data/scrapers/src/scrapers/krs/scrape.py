import typing
import itertools
from time import sleep
from dataclasses import dataclass
from pprint import pprint
from collections import Counter
import argparse
import json

from scrapers.krs import data
from scrapers.krs.process import iterate_blobs, KRS
from util.rejestr import Rejestr
from stores.storage import upload_to_gcs, list_blobs


@dataclass(frozen=True)
class Company:
    krs: KRS
    name: str
    parent: KRS


def save_org_connections(
    connections: typing.Iterable[KRS],
    names: typing.Iterable[KRS],
):
    for krs in names:
        yield f"https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/{krs}?rejestr=P&format=json"
        # yield f"https://rejestr.io/api/v2/org/{krs}"
    for krs in connections:
        yield f"https://rejestr.io/api/v2/org/{krs}/krs-powiazania?aktualnosc=aktualne"
        yield f"https://rejestr.io/api/v2/org/{krs}/krs-powiazania?aktualnosc=historyczne"


# If relation is passive and one of this type, it's a child.
PARENT_RELATION = {
    "KRS_ONLY_SHAREHOLDER",
    "KRS_SHAREHOLDER",
    "KRS_SUPERVISION",
    "KRS_FOUNDER",
}

# If relation is passive and one of this type, it's not a child.
IGNORED_PARENT = {
    "KRS_BOARD",  # The company itself is the board member
    "KRS_MEMBER",  # The company is a member of a group, not interesting
    "KRS_COMMISSIONER",  # The company is probably liquidated
    "KRS_RECEIVER",  # The company is probably liquidated
    "KRS_GENERAL_PARTNER",  # The company is probably liquidated
    "KRS_RESTRUCTURIZATOR",  # The company is probably liquidated
}


@dataclass(frozen=True)
class QueryRelation:
    relation: str
    direction: str

    @staticmethod
    def from_rejestrio(dict):
        return QueryRelation(
            relation=dict["typ"],
            direction=dict["kierunek"],
        )

    def is_child(self):
        if self.direction == "AKTYWNY":
            return False

        if self.relation in IGNORED_PARENT:
            return False

        if self.relation not in PARENT_RELATION:
            raise ValueError(f"Unknown type: {self.relation} {self.direction}")

        return self.direction == "PASYWNY" and self.relation in PARENT_RELATION


class CompanyGraph:
    def __init__(self):
        self.companies = dict()
        self.children: dict[KRS, list[KRS]] = dict()

        for blob_name, content in iterate_blobs("rejestr.io"):
            if "aktualnosc_" not in blob_name:
                continue
            data = json.loads(content)
            for item in data:
                if item.get("typ") != "organizacja":
                    continue

                krs = KRS(item["numery"]["krs"])
                parent = KRS.from_blob_name(blob_name)
                conn_type = QueryRelation.from_rejestrio(
                    item["krs_powiazania_kwerendowane"][0]
                )

                if not conn_type.is_child():
                    continue

                self.companies[krs] = Company(
                    krs=krs,
                    name=item["nazwy"]["pelna"],
                    parent=parent,
                )
                self.children[parent] = self.children.get(parent, []) + [krs]

    def all_descendants(self, krss: typing.Iterable[KRS]):
        descendants: set[KRS] = set()
        todo = set(krss)
        while todo:
            krs = todo.pop()
            descendants.add(krs)
            if krs in self.children:
                todo.update(set(self.children[krs]) - descendants)
        return descendants


def child_companies() -> set[Company]:
    result: set[Company] = set()
    for blob_name, content in iterate_blobs("rejestr.io"):
        if "aktualnosc_" not in blob_name:
            continue
        data = json.loads(content)
        try:
            for item in data:
                if item.get("typ") == "organizacja":
                    result.add(
                        Company(
                            krs=KRS(item["numery"]["krs"]),
                            name=item["nazwy"]["pelna"],
                            parent=KRS.from_blob_name(blob_name),
                        )
                    )
        except KeyError as e:
            print(f"  [ERROR] Could not process {blob_name}: {e}")
    return result


def scrape_rejestrio():
    parser = argparse.ArgumentParser(description="I'll add docs here")
    parser.add_argument(
        "--only",
        dest="only",
        default="",
        help="only show children of this KRS",
    )
    args = parser.parse_args()

    already_scraped = set(KRS.from_blob_name(path) for path in list_blobs("rejestr.io"))
    starters = set(
        KRS(krs)
        for krs in itertools.chain(
            # data.MINISTERSTWO_AKTYWOW_PANSTWOWYCH_KRSs,
            # data.SPOLKI_SKARBU_PANSTWA,
            # data.AMW,
            data.WARSZAWA,
            data.MALOPOLSKIE,
            data.LODZKIE,
            data.LUBELSKIE,
        )
    )
    graph = CompanyGraph()
    if args.only != "":
        starters = {KRS(args.only)}

    children = graph.all_descendants(starters)
    pprint(children)
    children_companies = set(
        company for krs, company in graph.companies.items() if krs in children
    )
    to_scrape = (starters | children) - already_scraped

    print(f"Already scraped: {already_scraped}")
    print(f"To scrape: {to_scrape}")
    print("To scrape (children):")
    to_scrape_children = set(filter(lambda x: x.krs in to_scrape, children_companies))
    pprint(to_scrape_children)
    parent_count = Counter(map(lambda x: x.parent, to_scrape_children))
    pprint(parent_count.most_common(30))
    urls = list(save_org_connections(to_scrape, map(KRS, data.NAME_MISSING)))
    pprint(urls)
    print(f"Will cost: {sum(map(lambda x: x[1], urls))} PLN")
    input("Press enter to continue...")
    rejestr = Rejestr()

    for url in urls:
        result = rejestr.get_rejestr_io(url)
        sleep(0.3)

        if result is None:
            print(f"Skipping {url}")
            continue

        # We're discarding query params, so it's a hotfix for this
        url = url.replace("?aktualnosc=", "/aktualnosc_")
        upload_to_gcs(url, result, "application/json")
