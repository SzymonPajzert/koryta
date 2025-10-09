import os
import itertools
from dataclasses import dataclass
import regex as re
from regex import findall, match, search
from collections import Counter

import bz2
import xml.etree.ElementTree as ET
from google.cloud import storage
from tqdm import tqdm

from util.config import tests
from stores.duckdb import ducktable, dump_dbs
from util.download import FileSource
from util.config import DOWNLOADED_DIR
from util.polish import MONTH_NUMBER, MONTH_NUMBER_GENITIVE
from util.polish import UPPER, LOWER
from util.lists import POLITICAL, TEST_FILES


# URL for the latest Polish Wikipedia articles dump
DUMP_URL = "https://dumps.wikimedia.org/plwiki/latest/plwiki-latest-pages-articles-multistream.xml.bz2"

OUTPUT_FILE = "plwiki-latest-articles.xml.bz2"

if __name__ == "__main__":
    FileSource(DUMP_URL).download()

DUMP_FILENAME = os.path.join(DOWNLOADED_DIR, "plwiki-latest-articles.xml.bz2")
DUMP_SIZE = 12314670146


@ducktable(name="people_wiki")
@dataclass
class People:
    source: str
    full_name: str
    party: str
    birth_iso8601: str | None
    birth_year: int | None
    infobox: str
    content_score: int
    links: list[str]


@ducktable()
@dataclass
class IgnoredDates:
    date: str


def upload_to_gcs(bucket_name, destination_blob_name, data):
    """Uploads data to a GCS bucket."""
    try:
        storage_client = storage.Client()
        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(destination_blob_name)

        blob.upload_from_string(data, content_type="application/xml")
        print(f"✅ Successfully uploaded {destination_blob_name} to {bucket_name}")
    except Exception as e:
        print(f"❌ Failed to upload {destination_blob_name}. Error: {e}")


@dataclass
class InfoboxStats:
    count: int
    values: list[str]


interesting_count = 0
infobox_types = Counter()
polityk_infobox_stats = Counter()
category_stats = Counter()


class PolitykInfobox:
    inf_type: str
    fields: dict[str, str]

    def __init__(self, inf_type, fields) -> None:
        self.inf_type = inf_type
        self.fields = fields
        infobox_types[inf_type] += 1
        for field in fields:
            polityk_infobox_stats[field] += 1

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
            if "imię i nazwisko" in fields:
                result.append(
                    PolitykInfobox(
                        inf_type,
                        fields,
                    )
                )

        if len(result) == 0:
            return None

        if len(result) > 1:
            print(result)

        return result[0]


@dataclass
class WikiArticle:
    title: str
    categories: list[str]
    links: list[str]
    polityk_infobox: PolitykInfobox | None
    osoba_imie: bool

    def __post_init__(self):
        def normalized():
            for entry in itertools.chain(self.categories, self.links):
                n = entry.rstrip("]").lstrip("[").split("|")[0]
                if n.isdigit():
                    continue
                yield n

        self.normalized_links = set(normalized())
        self.content_score = len(self.normalized_links.intersection(POLITICAL))

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

        polityk_infobox = PolitykInfobox.parse(wikitext)
        if polityk_infobox is not None:
            pattern = f"'''({title.replace(' ', f'[ {UPPER}{LOWER}]*')})'''"
            full_name = search(pattern, wikitext)
            if full_name is not None and full_name.group(1) != title:
                # print(f"Changing title from {title} to {full_name.group(1)}")
                title = full_name.group(1)

        return WikiArticle(
            title=title,
            categories=findall("\\[\\[Kategoria:[^\\]]+\\]\\]", wikitext),
            links=findall("\\[\\[[^\\]]+\\]\\]", wikitext),
            polityk_infobox=polityk_infobox,
            osoba_imie="imię i nazwisko" in wikitext,
        )

    def interesting(self):
        if self.polityk_infobox is not None:
            year = self.polityk_infobox.birth_year
            if year and year < 1930:
                return False
        return (self.polityk_infobox is not None) or self.content_score > 0


def process_wikipedia_dump():
    """
    Parses the Wikipedia dump, filters for target categories,
    and uploads individual XML files to GCS.
    """
    if not os.path.exists(DUMP_FILENAME):
        print(
            f"Error: Dump file '{DUMP_FILENAME}' not found. Please run the download script first."
        )
        return

    # Use bz2 to decompress the file on the fly
    with bz2.open(DUMP_FILENAME, "rt", encoding="utf-8") as f:
        # Use iterparse for memory-efficient XML parsing
        # We only care about the 'end' event of a 'page' tag
        print(f"🗂️  Starts processing dump file: {DUMP_FILENAME}")

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
                article = WikiArticle.parse(elem)
                if article is None:
                    continue
                if article.title in TEST_FILES:
                    path = tests.get_path(f"{article.title}.xml")
                    print(f"Saving {article.title} to test file: {path}")
                    with open(path, "w") as test_file:
                        test_file.write(ET.tostring(elem, encoding="unicode").strip())
                if article.interesting():
                    if article.content_score > 0:
                        for cat in article.normalized_links:
                            if cat in POLITICAL:
                                continue
                            category_stats[cat] += 1 + article.content_score
                    if article.polityk_infobox is None:
                        article.polityk_infobox = PolitykInfobox("", {})
                    interesting_count += 1
                    People(
                        source=f"https://pl.wikipedia.org/wiki/{article.title}",
                        full_name=article.title,
                        party=article.polityk_infobox.fields.get("partia", ""),
                        birth_iso8601=article.polityk_infobox.birth_iso,
                        birth_year=article.polityk_infobox.birth_year,
                        infobox=article.polityk_infobox.inf_type,
                        content_score=article.content_score,
                        links=[],  # TODO print links, so we can train an algorithm which page is a political person
                        # links=list(article.normalized_links),
                    ).insert_into()  # pyright: ignore[reportAttributeAccessIssue]
                # Crucial step for memory management: clear the element
                # after processing to free up memory.
                elem.clear()

    print("🎉 Processing complete.")


def main():
    try:
        process_wikipedia_dump()
    except Exception as e:
        print(f"An error occurred: {e}")
        raise
    finally:
        dump_dbs({"people_wiki": ["content_score DESC"]})

        print("\n".join([str(t) for t in category_stats.most_common(500)]))
        # print("\n".join([str(t) for t in infobox_types.most_common(50)]))
        # print("\n".join([str(t) for t in polityk_infobox_stats.most_common(30)]))
