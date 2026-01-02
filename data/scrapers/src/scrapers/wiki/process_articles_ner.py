import itertools
import multiprocessing
import typing
import xml.etree.ElementTree as ET

import mwparserfromhell
import pandas as pd
from memoized_property import memoized_property  # type: ignore
from regex import findall, search
from tqdm import tqdm

from scrapers.stores import Context, DownloadableFile, Pipeline
from scrapers.wiki.util import parse_date
from util.lists import WIKI_POLITICAL_LINKS
from util.polish import LOWER, UPPER

WIKI_DUMP = DownloadableFile(
    "https://dumps.wikimedia.org/plwiki/latest/plwiki-latest-pages-articles-multistream.xml.bz2",
    "plwiki-latest-articles.xml.bz2",
)
DUMP_SIZE = 12314670146  # approx size for progress bar

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
                field_links[param.name.strip_code().strip()] = [str(link.title) for link in
                                                                param.value.filter_wikilinks()]
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
        title = WikiArticle.extend_name(title, wikitext)

        return WikiArticle(
            title=title,
            categories=get_links(wikitext, prefix="Kategoria:"),
            links=get_links(wikitext),
            infoboxes=infoboxes,
        )

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
                    *[infobox.links for infobox in self.infoboxes],
            ):
                n = entry.rstrip("]").lstrip("[").split("|")[0]
                if n.isdigit():
                    continue
                yield n

        return set(generate())

    @memoized_property
    def content_score(self) -> int:
        score = len(self.normalized_links.intersection(WIKI_POLITICAL_LINKS))
        for infobox in self.infoboxes:
            for public_region in ["miasto", "województwo", "gmina"]:
                if public_region in infobox.fields.get("udziałowcy", "").lower():
                    score += 1
        return score

    @memoized_property
    def about_person(self):
        if not self.infoboxes:
            return False
        for infobox in self.infoboxes:
            if infobox.person_related:
                year = infobox.birth_year
                if year and year < 1930:
                    return False
                return True
        return False


def _article_generator(f, tq):
    prev = 0
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


def _is_person_article_worker(args):
    title, wikitext = args
    try:
        article = WikiArticle.parse_text(title, wikitext)
        if article and article.about_person:
            return article.title
    except Exception:
        return None
    return None


class ProcessWikiPeopleNames(Pipeline):
    filename = "wiki_people_names"

    def process(self, ctx: Context) -> pd.DataFrame:
        person_titles = []
        with ctx.io.read_data(WIKI_DUMP).read_zip().read_file() as f, tqdm(
                total=DUMP_SIZE, unit_scale=True, smoothing=0.1
        ) as tq:
            article_gen = _article_generator(f, tq)
            with multiprocessing.Pool(processes=multiprocessing.cpu_count()) as pool:
                for title in pool.imap_unordered(_is_person_article_worker, article_gen, chunksize=1000):
                    if title:
                        person_titles.append({"title": title})
        return pd.DataFrame(person_titles)


def _ner_worker(args):
    title, wikitext, people_titles = args
    try:
        article = WikiArticle.parse_text(title, wikitext)
        if not article:
            return None

        text = mwparserfromhell.parse(wikitext).strip_code().strip()
        names = []
        if article.title in people_titles:
            names.append({"name_in_text": article.title, "name_normalize": article.title})

        parsed_wikitext = mwparserfromhell.parse(wikitext)
        for link in parsed_wikitext.filter_wikilinks():
            normalized_name = str(link.title).split("#")[0].strip()
            if not normalized_name or normalized_name.isdigit():
                continue

            if normalized_name in people_titles:
                name_in_text = str(link.text).strip() if link.text else normalized_name
                mention = {"name_in_text": name_in_text, "name_normalize": normalized_name}
                if mention not in names:
                    names.append(mention)

        if not names:
            return None

        return {"text": text, "names": names}
    except Exception:
        return None


class ProcessWikiNer(Pipeline):
    filename = "person_wikipedia_ner"
    people_names: ProcessWikiPeopleNames

    def process(self, ctx: Context) -> pd.DataFrame:
        people_names_df = self.people_names.read_or_process(ctx)
        people_titles = set(people_names_df["title"])

        dataset = []
        with ctx.io.read_data(WIKI_DUMP).read_zip().read_file() as f, tqdm(
                total=DUMP_SIZE, unit_scale=True, smoothing=0.1
        ) as tq:
            worker_args = ((title, wikitext, people_titles) for title, wikitext in _article_generator(f, tq))
            with multiprocessing.Pool(processes=multiprocessing.cpu_count()) as pool:
                for result in pool.imap_unordered(_ner_worker, worker_args, chunksize=100):
                    if result:
                        dataset.append(result)

        return pd.DataFrame(dataset)
