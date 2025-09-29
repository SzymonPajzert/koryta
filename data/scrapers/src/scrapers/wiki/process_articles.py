import bz2
import os
import xml.etree.ElementTree as ET
from google.cloud import storage
from dataclasses import dataclass
import regex as re
from regex import findall, match
from tqdm import tqdm
from collections import Counter
from stores.duckdb import ducktable, dump_dbs
from util.download import FileSource
from util.config import DOWNLOADED_DIR
from util.polish import MONTH_NUMBER, MONTH_NUMBER_GENITIVE


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


CATEGORY_SCORE = {
    "Kategoria:Polscy politycy": 5,
    "Kategoria:Prezydenci Polski": 3,
    "Kategoria:Premierzy Polski": 3,
    "Kategoria:Posłowie na Sejm": 3,
    "Kategoria:Polscy senatorowie": 5,
}

INFOBOXES = {"Polityk"}


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
            if "imię i nazwisko" in fields or inf_type in INFOBOXES:
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
    polityk_infobox: PolitykInfobox | None
    osoba_imie: bool

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

        article = WikiArticle(
            title=title,
            categories=findall("\\[\\[Kategoria:[^\\]]+\\]\\]", wikitext),
            polityk_infobox=PolitykInfobox.parse(wikitext),
            osoba_imie="imię i nazwisko" in wikitext,
        )

        if article.interesting():
            for cat in article.categories:
                category_stats[cat] += 1
            if article.polityk_infobox is None:
                article.polityk_infobox = PolitykInfobox("", {})
            global interesting_count
            interesting_count += 1
            People(
                source=f"https://pl.wikipedia.org/wiki/{article.title}",
                full_name=article.title,
                party=article.polityk_infobox.fields.get("partia", ""),
                birth_iso8601=article.polityk_infobox.birth_iso,
                birth_year=article.polityk_infobox.birth_year,
                infobox=article.polityk_infobox.inf_type,
            ).insert_into()  # pyright: ignore[reportAttributeAccessIssue]

        # if article.polityk_infobox is not None:
        #     print(article.title)

        return article

    def interesting(self):
        return self.polityk_infobox is not None or any(
            cat in self.categories for cat in CATEGORY_SCORE
        )


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
                # Crucial step for memory management: clear the element
                # after processing to free up memory.
                elem.clear()

        print(f.tell())
        print(f.read(10000))

    print("🎉 Processing complete.")


def main():
    try:
        process_wikipedia_dump()
    except Exception as e:
        print(f"An error occurred: {e}")
        raise
    finally:
        dump_dbs()

        print("\n".join([str(t) for t in category_stats.most_common(200)]))
        print("\n".join([str(t) for t in infobox_types.most_common(50)]))
        print("\n".join([str(t) for t in polityk_infobox_stats.most_common(30)]))
