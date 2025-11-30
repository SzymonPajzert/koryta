import itertools
from dataclasses import dataclass
import regex as re
import typing
from regex import findall, search
from collections import Counter
from memoized_property import memoized_property

import xml.etree.ElementTree as ET
from tqdm import tqdm
import mwparserfromhell

from scrapers.stores import DownloadableFile
from util.polish import UPPER, LOWER
from util.lists import WIKI_POLITICAL_LINKS
from scrapers.wiki.util import parse_date

from scrapers.stores import Context, Pipeline

from entities.person import Wikipedia as People
from entities.company import Wikipedia as Company

WIKI_DUMP = DownloadableFile(
    "https://dumps.wikimedia.org/plwiki/latest/plwiki-latest-pages-articles-multistream.xml.bz2",
    "plwiki-latest-articles.xml.bz2",
)

DUMP_SIZE = 12314670146


@dataclass
class InfoboxStats:
    count: int
    values: list[str]


interesting_count = 0
infobox_types = Counter()
infobox_stats = Counter()
category_stats = Counter()


class Infobox:
    inf_type: str
    fields: dict[str, str]
    field_links: dict[str, list[str]]
    person_related: bool
    links: list[str]

    def __init__(
        self, inf_type: str, fields: dict[str, str], field_links: dict[str, list[str]]
    ) -> None:
        self.inf_type = inf_type
        self.fields = fields
        self.field_links = field_links
        infobox_types[inf_type] += 1
        for field in fields:
            infobox_stats[field] += 1
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
    def parse(wikitext) -> list["Infobox"]:
        parsed = mwparserfromhell.parse(wikitext)
        all_infoboxes = parsed.filter_templates(matches=lambda t: "infobox" in t.name)

        result = []
        for infobox in all_infoboxes:
            inf_type = infobox.name.split("infobox")[0].strip()
            fields = {}
            field_links = {}
            for param in infobox.params:
                fields[param.name.strip_code().strip()] = (
                    param.value.strip_code().strip()
                )
                field_links[param.name.strip_code().strip()] = [
                    link.title for link in param.value.filter_wikilinks()
                ]
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

        infoboxes = Infobox.parse(wikitext)
        # Perform search for second name or a full name of the company
        title = WikiArticle.extend_name(title, wikitext)

        return WikiArticle(
            title=title,
            categories=get_links(wikitext, prefix="Kategoria:"),
            links=get_links(wikitext),
            infoboxes=infoboxes,
        )

    def get_infobox[T](self, extractor: typing.Callable[[Infobox], T | None]):
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

        if score > 0:
            global interesting_count
            interesting_count += 1
            for cat in self.normalized_links:
                if cat in WIKI_POLITICAL_LINKS:
                    continue
                category_stats[cat] += 1 + score

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


def extract(elem: ET.Element) -> People | Company | None:
    article = WikiArticle.parse(elem)
    if article is None:
        return None

    person = article.about_person
    company = article.about_company

    if person and company:
        raise ValueError("Conflict of mapping to both person and company")
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
        owner_links = article.get_infobox(
            lambda i: i.field_links.get("udziałowcy", None)
        )
        owner_text = None
        if owner_links is None or len(owner_links) == 0:
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


@Pipeline.setup(output_order={"people_wiki": ["content_score DESC"]})
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
        global interesting_count
        for event, elem in ET.iterparse(f, events=("end",)):
            if interesting_count % 10000 == 0:
                print(f"Found {interesting_count} interesting articles")
                print(f"Expecting {interesting_count * DUMP_SIZE / f.tell():.2f}")
                interesting_count += 1
            tq.update(f.tell() - prev)
            prev = f.tell()
            # The XML has a namespace, so we check if the tag name ends with 'page'
            if elem.tag.endswith("page"):
                entity = extract(elem)
                if entity is not None:
                    ctx.io.output_entity(entity)
                # Crucial step for memory management: clear the element
                # after processing to free up memory.
                elem.clear()

    print("Stats:")
    print("\n".join([str(t) for t in category_stats.most_common(30)]))
    print("🎉 Processing complete.")
