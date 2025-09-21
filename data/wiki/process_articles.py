import bz2
import os
import xml.etree.ElementTree as ET
from google.cloud import storage
import duckdb
from dataclasses import dataclass
import regex as re
from regex import findall
from tqdm import tqdm
from collections import Counter


DUMP_FILENAME = "versioned/plwiki-latest-articles.xml.bz2"
# Check https://dumps.wikimedia.org/plwiki/20250920/dumpstatus.json
# pages-articles-multistream for the most recent value
DUMP_SIZE = 12314670146

duckdb.execute(
    """CREATE TABLE people AS
    SELECT *
    FROM read_json('./versioned/people.jsonl')"""
)

# Your Google Cloud Storage bucket name
# GCS_BUCKET_NAME = "your-gcs-bucket-name"


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


@dataclass
class InfoboxStats:
    count: int
    values: list[str]


interesting_count = 0
polityk_infobox_stats = Counter()
category_stats = Counter()


class PolitykInfobox:
    full_text: str
    fields: dict[str, str]

    def __init__(self, full_text, fields) -> None:
        self.full_text = full_text
        self.fields = fields
        for field in fields:
            polityk_infobox_stats[field] += 1

    @staticmethod
    def parse(wikitext):
        polityk_infobox = findall("{{Polityk infobox.*}}", wikitext, re.DOTALL)
        if len(polityk_infobox) == 0:
            return None
        polityk_infobox = polityk_infobox[0]
        fields = findall("\\|([^=]+)=(.+)", polityk_infobox)

        return PolitykInfobox(
            polityk_infobox,
            {field[0].strip(): field[1].strip() for field in fields if fields[0] != ""},
        )


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
            duckdb.execute(
                "INSERT INTO people VALUES (?, ?, ?)",
                (
                    article.title,
                    article.polityk_infobox.fields.get("partia", ""),
                    article.polityk_infobox.fields.get("data urodzenia", ""),
                ),
            )

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

        tq = tqdm(total=DUMP_SIZE, unit_scale=True)
        prev = 0
        global interesting_count
        for event, elem in ET.iterparse(f, events=("end",)):
            if interesting_count % 1000 == 0:
                print(f"Found {interesting_count} interesting articles")
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


if __name__ == "__main__":
    try:
        process_wikipedia_dump()
    except Exception as e:
        print(f"An error occurred: {e}")
        raise
    finally:
        duckdb.execute("COPY people TO './versioned/people.jsonl'")

        print("\n".join([str(t) for t in category_stats.most_common(200)]))
        print("\n".join([str(t) for t in polityk_infobox_stats.most_common(30)]))
