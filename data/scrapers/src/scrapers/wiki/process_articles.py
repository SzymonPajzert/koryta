import itertools
from dataclasses import dataclass
import regex as re
from regex import findall, match, search
from collections import Counter

import xml.etree.ElementTree as ET
from tqdm import tqdm

from scrapers.stores import DownloadableFile as FileSource
from util.polish import MONTH_NUMBER, MONTH_NUMBER_GENITIVE
from util.polish import UPPER, LOWER
from util.lists import WIKI_POLITICAL_LINKS, TEST_FILES

from scrapers.stores import Context, LocalFile
from scrapers.stores import insert_into, dump_dbs, get_context

from entities.person import Wikipedia as People
from entities.company import KRS as Company
from entities.util import IgnoredDates

ctx = get_context()

WIKI_DUMP = FileSource(
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
    company_related: bool

    def __init__(self, inf_type, fields) -> None:
        self.inf_type = inf_type
        self.fields = fields
        infobox_types[inf_type] += 1
        for field in fields:
            infobox_stats[field] += 1
        self.person_related = "imię i nazwisko" in fields
        self.company_related = False

    @property
    def birth_iso(self):
        v = getattr(self, "_birth_iso", None)
        if v is not None:
            return v

        human_readable = self.fields.get("data urodzenia", "")

        def get():
            human_readable = self.fields.get("data urodzenia", "")
            human_readable = human_readable.replace("[", "")
            human_readable = human_readable.replace("]", "")
            human_readable = human_readable.replace("{{data|", "")
            human_readable = human_readable.replace("}}", "")
            human_readable = human_readable.split("<ref")[0]
            human_readable = human_readable.split(" r.")[0]
            if human_readable == "":
                return None

            for ignorable in [
                "n.e",
                "(",
                "ok.",
                "lub",
                "/",
                "przed",
                "ochrz.",
                "między",
            ]:
                if ignorable in human_readable:
                    return None

            m = match("^\\d{4}-\\d{2}-\\d{2}$", human_readable)
            if m is not None:
                return human_readable

            try:
                m = match("^(\\d+) (\\w+) (\\d{4})$", human_readable)
                if m is not None:
                    days = int(m.group(1))
                    month = MONTH_NUMBER_GENITIVE[m.group(2)]
                    return f"{m.group(3)}-{month:02d}-{days:02d}"

                m = match("^(\\w+) (\\d{4})$", human_readable)
                if m is not None:
                    month = MONTH_NUMBER[m.group(1)]
                    return f"{m.group(2)}-{month:02d}-00"
            except KeyError:
                return None

            m = match("^(\\d+)$", human_readable)
            if m is not None:
                return f"{m.group(1)}-00-00"

        self._birth_iso = get()
        if self._birth_iso is None and human_readable != "":
            IgnoredDates(
                date=human_readable
            ).insert_into()  # pyright: ignore[reportAttributeAccessIssue]
        return self._birth_iso

    @property
    def birth_year(self):
        ba = self.birth_iso
        if ba is not None:
            return int(ba.split("-")[0])

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


@dataclass
class WikiArticle:
    title: str
    categories: list[str]
    links: list[str]
    infobox: Infobox
    osoba_imie: bool

    def __post_init__(self):
        def normalized():
            for entry in itertools.chain(self.categories, self.links):
                n = entry.rstrip("]").lstrip("[").split("|")[0]
                if n.isdigit():
                    continue
                yield n

        self.normalized_links = set(normalized())
        self.content_score = len(
            self.normalized_links.intersection(WIKI_POLITICAL_LINKS)
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

        infobox = Infobox.parse(wikitext)
        if infobox is not None:
            pattern = safe_middle_name_pattern(title)
            try:
                full_name = search(pattern, wikitext)
                if full_name is not None and full_name.group(1) != title:
                    # print(f"Changing title from {title} to {full_name.group(1)}")
                    title = full_name.group(1)
            except Exception as e:
                print(pattern, title, "writing to tests")
                WikiArticle(
                    title=title,
                    categories=[],
                    links=[],
                    infobox=infobox,
                    osoba_imie=False,
                ).write_to_test(elem, force=True)
                # TODO raise e

        return WikiArticle(
            title=title,
            categories=findall("\\[\\[Kategoria:[^\\]]+\\]\\]", wikitext),
            links=findall("\\[\\[[^\\]]+\\]\\]", wikitext),
            infobox=infobox if infobox is not None else Infobox("unknown", {}),
            osoba_imie="imię i nazwisko" in wikitext,
        )

    def write_to_test(self, elem: ET.Element, force=False):
        if self.title in TEST_FILES or force:
            path = ctx.conductor.get_path(LocalFile(f"{self.title}.xml"))
            print(f"Saving {self.title} to test file: {path}")
            with open(path, "w") as test_file:
                test_file.write(ET.tostring(elem, encoding="unicode").strip())

    def about_person(self):
        def check():
            if self.content_score > 0:
                return True
            if self.infobox is None:
                return False
            if self.infobox.person_related:
                year = self.infobox.birth_year
                if year and year < 1930:
                    return False
                return True
            return False

        about_person = check() and self.content_score > 0
        # TODO move into another function
        if about_person:
            for cat in self.normalized_links:
                if cat in WIKI_POLITICAL_LINKS:
                    continue
                category_stats[cat] += 1 + self.content_score
        return about_person

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

    article.write_to_test(elem)
    global interesting_count

    if article.about_person():
        interesting_count += 1
        return People(
            source=f"https://pl.wikipedia.org/wiki/{article.title}",
            full_name=article.title,
            party=article.infobox.fields.get("partia", ""),
            birth_iso8601=article.infobox.birth_iso,
            birth_year=article.infobox.birth_year,
            infobox=article.infobox.inf_type,
            content_score=article.content_score,
            links=[],  # TODO print links, so we can train an algorithm which page is a political person
            # links=list(article.normalized_links),
        )

    if article.about_company():
        return Company(
            name=article.title,
            krs=article.infobox.fields.get("krs", ""),
        )

    return None


def process_wikipedia_dump(ctx: Context):
    """
    Parses the Wikipedia dump, filters for target categories,
    and uploads individual XML files to GCS.
    """
    ctx.conductor.check_input(WIKI_DUMP)

    # TODO move to implementation
    # if not os.path.exists(DUMP_FILENAME):
    #     print(
    #         f"Error: Dump file '{DUMP_FILENAME}' not found. Please run the download script first."
    #     )
    #     return

    # Use bz2 to decompress the file on the fly
    with ctx.conductor.read_file(WIKI_DUMP).read_zip() as f:
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
                    insert_into(entity)
                # Crucial step for memory management: clear the element
                # after processing to free up memory.
                elem.clear()

    print("🎉 Processing complete.")


# TODO remove this method and move to a cleaner one
def main(ctx: Context):
    try:
        process_wikipedia_dump(ctx)
    except Exception as e:
        print(f"An error occurred: {e}")
        raise
    finally:
        dump_dbs({"people_wiki": ["content_score DESC"]})

        print("\n".join([str(t) for t in category_stats.most_common(500)]))
        # print("\n".join([str(t) for t in infobox_types.most_common(50)]))
        # print("\n".join([str(t) for t in infobox_stats.most_common(30)]))
