import itertools
import multiprocessing
import typing
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import asdict, dataclass

import mwparserfromhell
import pandas as pd
from memoized_property import memoized_property  # type: ignore
from regex import findall, search  # TODO remove
from tqdm import tqdm

from entities.company import Wikipedia as Company
from entities.person import Wikipedia as People
from scrapers.stores import Context, DownloadableFile, Pipeline
from scrapers.wiki.util import parse_date
from util.lists import WIKI_POLITICAL_LINKS
from util.polish import LOWER, UPPER

WIKI_DUMP = DownloadableFile(
    "https://dumps.wikimedia.org/plwiki/latest/plwiki-latest-pages-articles-multistream.xml.bz2",
    "plwiki-latest-articles.xml.bz2",
)

DUMP_SIZE = 12314670146

# Heurisic used to ignore some articles without parsing (expensive operation)
REQUIRED_WORDS = [
    "Naukowiec",
    "Duchowny",
    "Artysta",
    "Biogram",
    "Polityk",
    "Koszykarz",
    "Piłkarz",
    "Sportowiec",
    "Filmowiec",
    "Harcerz",
    "Żołnierz",
    "Tenisista",
    "Wrestler",
    "Rugbysta",
    "Architekt",
    "Astronauta",
    "Medalista",
    "Kierowca",
    "Osoba publiczna",
    "Zawodnik",
    "sportowy",
    "Szachista",
    "Brydż",
    "Przedsiębiorstwo",
    "przedsiębiorstwo",
    "Instytucja państwowa",
]


@dataclass
class InfoboxStats:
    count: int
    values: list[str]


class Infobox:
    inf_type: str
    fields: dict[str, str]
    field_links: dict[str, list[str]]
    person_related: bool
    links: list[str]

    def __init__(self, inf_type: str, fields: dict[str, str], field_links: dict[str, list[str]]) -> None:
        self.inf_type = inf_type
        self.fields = fields
        self.field_links = field_links
        self.person_related = "imię i nazwisko" in fields
        self.links = [
            link
            for value in fields.values()
            # TODO replace with parser
            for link in findall("\\[\\[[^\\]]+\\]\\]", value)
        ]

    @memoized_property
    def company_related(self) -> bool:
        return "rejestr" in self.fields

    @memoized_property
    def birth_iso(self):
        return parse_date(self.fields.get("data urodzenia", ""))

    @memoized_property
    def birth_year(self):
        return int(self.birth_iso.split("-")[0]) if self.birth_iso else None

    @staticmethod
    def parse(wikitext: str) -> list["Infobox"]:
        parsed = mwparserfromhell.parse(wikitext)
        all_infoboxes = parsed.filter_templates(matches=lambda t: "infobox" in t.name)

        result = []
        for infobox in all_infoboxes:
            inf_type = infobox.name.split("infobox")[0].strip()
            fields = {}
            field_links = {}
            for param in infobox.params:
                fields[param.name.strip_code().strip()] = param.value.strip_code().strip()
                field_links[param.name.strip_code().strip()] = [str(link.title) for link in param.value.filter_wikilinks()]
            result.append(
                Infobox(
                    inf_type,
                    fields,
                    field_links,
                )
            )

        return result


def get_links(wikitext, prefix=""):
    # TODO replace this with wikiparser
    return findall("\\[\\[" + prefix + "[^\\]]+\\]\\]", wikitext)


def safe_middle_name_pattern(title):
    for escapable in ["(", ")", "?", "*", "[", "]", "+"]:
        title = title.replace(escapable, f"\\{escapable}")
    return f"'''({title.replace(' ', f'[ {UPPER}{LOWER}]*')})'''"


class WikiArticle:
    title: str
    categories: list[str]
    links: list[str]
    infoboxes: list[Infobox]

    def __init__(self, title, categories, links, infoboxes):
        self.title = title
        self.categories = categories
        self.links = links
        self.infoboxes = infoboxes

    @staticmethod
    def extend_name(title, wikitext):
        pattern = safe_middle_name_pattern(title)
        try:
            full_name = search(pattern, wikitext)
            if full_name is not None and full_name.group(1) != title:
                # print(f"Changing title from {title} to {full_name.group(1)}")
                title = full_name.group(1)
        except Exception as e:
            print(pattern, title, "exception while processing")
            raise e
        return title

    @staticmethod
    def parse_text(title, wikitext):
        if not any(word in wikitext for word in REQUIRED_WORDS):
            return None

        infoboxes = Infobox.parse(wikitext)
        # Perform search for second name or a full name of the company
        title = WikiArticle.extend_name(title, wikitext)

        return WikiArticle(
            title=title,
            categories=get_links(wikitext, prefix="Kategoria:"),
            links=get_links(wikitext),
            infoboxes=infoboxes,
        )

    @staticmethod
    def parse(elem: ET.Element):
        title = elem.findtext("{http://www.mediawiki.org/xml/export-0.11/}title")
        revision = elem.find("{http://www.mediawiki.org/xml/export-0.11/}revision")

        if not title:
            print(f"Failed to find title in {elem.tag}")
            return None
        if revision is None:
            print(f"Failed to find revision in {title}")
            return None
        wikitext = revision.findtext("{http://www.mediawiki.org/xml/export-0.11/}text")
        if not wikitext:
            print(f"Failed to find text in {title}")
            return None

        return WikiArticle.parse_text(title, wikitext)

    def get_infobox(self, extractor: typing.Callable[["Infobox"], typing.Any | None]):
        for infobox in self.infoboxes:
            result = extractor(infobox)
            if result is not None:
                return result
        return None

    @memoized_property
    def normalized_links(self):
        def generate():
            for entry in itertools.chain(
                self.categories,
                self.links,
                # Extract links from infobox if they exist
                *[infobox.links for infobox in self.infoboxes],
            ):
                n = entry.rstrip("]").lstrip("[").split("|")[0]
                if n.isdigit():
                    continue
                yield n

        return set(generate())

    @memoized_property
    def content_score(self) -> int:
        """
        When higher than 0, it indicates that this article has political conotations
        """
        score = len(self.normalized_links.intersection(WIKI_POLITICAL_LINKS))

        for infobox in self.infoboxes:
            # TODO extend content score to a better logic
            # https://github.com/SzymonPajzert/koryta/issues/170 #170
            for public_region in ["miasto", "województwo", "gmina"]:
                if public_region in infobox.fields.get("udziałowcy", "").lower():
                    score += 1

        return score

    @memoized_property
    def about_person(self):
        if len(self.infoboxes) == 0:
            return False
        for infobox in self.infoboxes:
            if infobox.person_related:
                year = infobox.birth_year
                if year and year < 1930:
                    return False
                return True
        return False

    @memoized_property
    def about_company(self):
        if len(self.infoboxes) == 0:
            return False
        for infobox in self.infoboxes:
            if infobox.company_related:
                return True
        return False


class Stats:
    interesting_counter = 0
    infobox_types: Counter[str] = Counter()
    infobox_stats: Counter[str] = Counter()
    category_stats: Counter[str] = Counter()

    def ingest_infobox(self, infobox: Infobox):
        self.infobox_types[infobox.inf_type] += 1
        for field in infobox.fields:
            self.infobox_stats[field] += 1

    def ingest_article(self, article: WikiArticle):
        score = article.content_score
        if score > 0:
            self.interesting_counter += 1

            for cat in article.normalized_links:
                if cat in WIKI_POLITICAL_LINKS:
                    continue
                self.category_stats[cat] += 1 + score

            for infobox in article.infoboxes:
                self.ingest_infobox(infobox)


def extract_from_article(article: WikiArticle) -> People | Company | None:
    person = article.about_person
    company = article.about_company

    if person and company:
        # raise ValueError("Conflict of mapping to both person and company")
        return None
    elif person:
        return People(
            source=f"https://pl.wikipedia.org/wiki/{article.title}",
            full_name=article.title,
            party=article.get_infobox(lambda i: i.fields.get("partia", "")),
            birth_iso8601=article.get_infobox(lambda i: i.birth_iso),
            birth_year=article.get_infobox(lambda i: i.birth_year),
            infoboxes=[i.inf_type for i in article.infoboxes],
            content_score=article.content_score,
            links=[],
        )
    elif company:
        name = article.get_infobox(lambda i: i.fields.get("nazwa", None))
        owner_links = article.get_infobox(lambda i: i.field_links.get("udziałowcy", None))
        owner_text = None
        if owner_links is None:
            owner_links = []
        if len(owner_links) == 0:
            owner_text = article.get_infobox(lambda i: i.fields.get("udziałowcy", None))
            if owner_text == "":
                owner_text = None

        return Company(
            name=name if name is not None else article.title,
            krs=article.get_infobox(lambda i: i.fields.get("numer rejestru", None)),
            content_score=article.content_score,
            owner_articles=owner_links,
            owner_text=owner_text,
        )

    return None


def extract(elem: ET.Element) -> People | Company | None:
    article = WikiArticle.parse(elem)
    if article is None:
        return None
    return extract_from_article(article)


def process_article_worker(args):
    title, wikitext = args
    try:
        article = WikiArticle.parse_text(title, wikitext)
        if article is None:
            return None
        return extract_from_article(article), article
    except Exception:
        return None


class ProcessWiki(Pipeline):
    filename = "person_wikipedia"  # TODO support two filenames

    def process(self, ctx: Context):
        scrape_wiki(ctx)
        # TODO #205 - https://github.com/SzymonPajzert/koryta/issues/205 - support multiple output entities
        # Return People entities as the primary result of this pipeline, cached in person_wikipedia.jsonl
        # Companies are also written to versioned/company_wikipedia via ctx.io.output_entity
        return pd.DataFrame([asdict(p) for p in (ctx.io.get_output(People) or [])])


def scrape_wiki(ctx: Context):
    """
    Parses the Wikipedia dump, filters for target categories,
    and uploads individual XML files to GCS.
    """

    # Use bz2 to decompress the file on the fly
    with ctx.io.read_data(WIKI_DUMP).read_zip().read_file() as f:
        # Use iterparse for memory-efficient XML parsing
        # We only care about the 'end' event of a 'page' tag
        print(f"🗂️  Starts processing dump file: {WIKI_DUMP.filename}")

        tq = tqdm(total=DUMP_SIZE, unit_scale=True, smoothing=0.1)
        prev = 0

        def article_generator():
            nonlocal prev
            for event, elem in ET.iterparse(f, events=("end",)):
                current_pos = f.tell()
                tq.update(current_pos - prev)
                prev = current_pos

                if elem.tag.endswith("page"):
                    title = elem.findtext("{http://www.mediawiki.org/xml/export-0.11/}title")
                    revision = elem.find("{http://www.mediawiki.org/xml/export-0.11/}revision")
                    if title and revision:
                        wikitext = revision.findtext("{http://www.mediawiki.org/xml/export-0.11/}text")
                        if wikitext:
                            yield (title, wikitext)
                    elem.clear()

        stats = Stats()

        # Use multiprocessing to speed up parsing
        # We use a pool of workers to process articles in parallel
        # imap_unordered is used to keep memory usage low and process as we go
        with multiprocessing.Pool(processes=8) as pool:
            for pair in pool.imap_unordered(process_article_worker, article_generator(), chunksize=1000):
                if pair:
                    entity, article = pair
                    if entity:
                        ctx.io.output_entity(entity, sort_by=["content_score"])
                        stats.ingest_article(article)

    print("🎉 Processing complete.")
    print(stats)
