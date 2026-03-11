from analysis.extract import Extract
from analysis.graph import CommitteeParties, PeopleParties
from analysis.interesting import CompaniesMerged
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
    CompaniesMerged,
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
