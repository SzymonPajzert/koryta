import itertools
from dataclasses import dataclass
import regex as re
from regex import findall, search
from collections import Counter
from memoized_property import memoized_property

import xml.etree.ElementTree as ET
from tqdm import tqdm

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
    person_related: bool

    def __init__(self, inf_type, fields) -> None:
        self.inf_type = inf_type
        self.fields = fields
        infobox_types[inf_type] += 1
        for field in fields:
            infobox_stats[field] += 1
        self.person_related = "imię i nazwisko" in fields

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
    def parse(wikitext):
        all_infoboxes = findall("{{([^{{]+) infobox(.*)}}+", wikitext, re.DOTALL)
        if len(all_infoboxes) == 0:
            return None
        result = []
        for inf_type, infobox in all_infoboxes:
            fields_list = infobox.strip().split("|")
            fields = {}
            for field_str in fields_list:
                if "=" in field_str:
                    key, value = field_str.split("=", 1)
                    fields[key.strip()] = value.strip()
            result.append(
                Infobox(
                    inf_type,
                    fields,
                )
            )

        if len(result) == 0:
            return Infobox("unknown", {})

        if len(result) > 1:
            print(result)

        return result[0]


def safe_middle_name_pattern(title):
    for escapable in ["(", ")", "?", "*", "[", "]", "+"]:
        title = title.replace(escapable, f"\\{escapable}")
    return f"'''({title.replace(' ', f'[ {UPPER}{LOWER}]*')})'''"


class WikiArticle:
    title: str
    categories: list[str]
    links: list[str]
    infobox: Infobox

    def __init__(self, title, categories, links, infobox):
        self.title = title
        self.categories = categories
        self.links = links
        self.infobox = infobox

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

        infobox = Infobox.parse(wikitext)
        if infobox is not None:
            pattern = safe_middle_name_pattern(title)
            try:
                full_name = search(pattern, wikitext)
                if full_name is not None and full_name.group(1) != title:
                    # print(f"Changing title from {title} to {full_name.group(1)}")
                    title = full_name.group(1)
            except Exception as e:
                print(pattern, title, "exception while processing")
                raise e

        return WikiArticle(
            title=title,
            categories=findall("\\[\\[Kategoria:[^\\]]+\\]\\]", wikitext),
            links=findall("\\[\\[[^\\]]+\\]\\]", wikitext),
            infobox=infobox if infobox is not None else Infobox("unknown", {}),
        )

    @memoized_property
    def normalized_links(self):
        def generate():
            for entry in itertools.chain(self.categories, self.links):
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

        if score > 0:
            global interesting_count
            interesting_count += 1
            for cat in self.normalized_links:
                if cat in WIKI_POLITICAL_LINKS:
                    continue
                category_stats[cat] += 1 + self.content_score

        return score

    @memoized_property
    def about_person(self):
        if self.infobox is None:
            return False
        if self.infobox.person_related:
            year = self.infobox.birth_year
            if year and year < 1930:
                return False
            return True
        return False

    @memoized_property
    def about_company(self):
        if self.infobox is None:
            return False
        if self.infobox.company_related:
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
            party=article.infobox.fields.get("partia", ""),
            birth_iso8601=article.infobox.birth_iso,
            birth_year=article.infobox.birth_year,
            infobox=article.infobox.inf_type,
            content_score=article.content_score,
            links=[],
        )
    elif company:
        return Company(
            name=article.title,
            krs=article.infobox.fields.get("numer rejestru", ""),
            content_score=article.content_score,
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
