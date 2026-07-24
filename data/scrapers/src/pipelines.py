from analysis.extract import Extract
from analysis.graph import CommitteeParties, PeopleParties
from analysis.interesting import Companies
from analysis.payloads import CompaniesPayloads, PeoplePayloads, RegionPayloads
from analysis.people import PeopleEnriched, PeopleMerged
from analysis.scores import CompanyScores, PeopleScores
from analysis.stats import Statistics
from scrapers.article.pipelines import (
    ArticleAnalyzed,
    ArticleDomainSelectors,
    ArticleDoneUrls,
    ArticleExtractedFacts,
    ArticleKoryciarskiScores,
    ArticleParsed,
)
from scrapers.kmgp.companies import CompaniesKMGP
from scrapers.kmgp.people import PeopleKMGP
from scrapers.koryta.differ import KorytaDiffer
from scrapers.koryta.download import KorytaCompanies, KorytaPeople, KorytaVotes
from scrapers.krs.censored import KRSCensoredPeople
from scrapers.krs.list import CompaniesKRS, PeopleKRS
from scrapers.krs.scrape import KRSAlreadyScraped, KRSNeedsRefresh, ScrapeRejestrIO
from scrapers.krs.updates import KRSUpdates
from scrapers.map.postal_codes import PostalCodes
from scrapers.map.teryt import Regions
from scrapers.pkw.process import PeoplePKW
from scrapers.wiki.process_articles import ProcessWiki
from scrapers.wiki.process_articles_ner import ProcessWikiNer

PIPELINES = [
    CommitteeParties,
    ArticleDoneUrls,
    ArticleDomainSelectors,
    ArticleParsed,
    ArticleKoryciarskiScores,
    ArticleExtractedFacts,
    ArticleAnalyzed,
    CompaniesKRS,
    Companies,
    CompaniesKMGP,
    CompaniesPayloads,
    CompanyScores,
    PeopleScores,
    Extract,
    KRSAlreadyScraped,
    KRSCensoredPeople,
    KRSNeedsRefresh,
    KRSUpdates,
    KorytaCompanies,
    KorytaDiffer,
    KorytaPeople,
    KorytaVotes,
    PeopleEnriched,
    PeopleKRS,
    PeopleMerged,
    PeopleParties,
    PeoplePayloads,
    PeoplePKW,
    PeopleKMGP,
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
