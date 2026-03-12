from analysis.extract import Extract
from analysis.graph import CommitteeParties, PeopleParties
from analysis.interesting import Companies
from analysis.payloads import CompanyPayloads, PeoplePayloads, RegionPayloads
from analysis.people import PeopleEnriched, PeopleMerged
from analysis.stats import Statistics
from scrapers.koryta.differ import KorytaDiffer
from scrapers.koryta.download import KorytaPeople
from scrapers.krs.list import CompaniesKRS, PeopleKRS
from scrapers.krs.scrape import ScrapeRejestrIO
from scrapers.map.postal_codes import PostalCodes
from scrapers.map.teryt import Regions
from scrapers.pkw.process import PeoplePKW
from scrapers.wiki.process_articles import ProcessWiki
from scrapers.wiki.process_articles_ner import ProcessWikiNer

PIPELINES = [
    CommitteeParties,
    CompaniesKRS,
    Companies,
    CompanyPayloads,
    Extract,
    KorytaDiffer,
    KorytaPeople,
    PeopleEnriched,
    PeopleKRS,
    PeopleMerged,
    PeopleParties,
    PeoplePayloads,
    PeoplePKW,
    PostalCodes,
    ProcessWiki,
    ProcessWikiNer,
    RegionPayloads,
    Regions,
    ScrapeRejestrIO,
    Statistics,
]


def edges():
    edges = []

    pipelines = {p.__name__: p for p in PIPELINES}
    todo = list(pipelines.keys())

    for p_name in todo:
        p = pipelines[p_name]
        for _, d in p().list_sources():
            if d.__name__ not in pipelines:
                pipelines[d.__name__] = d
                todo.append(d.__name__)
            edges.append((d.__name__, p.__name__))

    return edges


def nodes():
    result = set()
    for k, v in edges():
        result.add(k)
        result.add(v)
    return result


def graphviz() -> str:
    return "\n".join(f"{k} -> {v}" for k, v in edges())


def flowchart() -> str:
    ns = "\n".join(k for k in nodes())
    es = "\n".join(f"({k})\n  ({v})" for k, v in edges())
    return ns + "\n" + es


def main():
    print(graphviz())
    print(flowchart())
