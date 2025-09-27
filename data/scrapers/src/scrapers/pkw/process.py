import bz2
import xml.etree.ElementTree as ET
from google.cloud import storage
from dataclasses import dataclass
import regex as re
from tqdm import tqdm
from collections import Counter
from stores.duckdb import dump_dbs
from util.download import FileSource
import csv
from zipfile import ZipFile
import io


class ZipExtractor:
    inner_filename: str

    def __init__(self, inner_filename) -> None:
        self.inner_filename = inner_filename

    def read(self, zip_file_path):
        with ZipFile(zip_file_path, "r").open(self.inner_filename, "r") as raw_bytes:
            for line in io.TextIOWrapper(raw_bytes, encoding="utf-8"):
                yield line


CSV_HEADERS_2024 = {
    # Personal
    "Nazwisko i imiona": "full_name",
    "Wiek": "age_in_2024",
    "Płeć": "sex",
    # Location of living
    "Miejsce zamieszkania": "",
    "Gmina m. z.": "",
    # Location of candidacy
    "TERYT Dzielnicy": "",
    "TERYT Gminy": "",
    "TERYT m. z.": "",
    "TERYT Powiatu": "",
    "TERYT Województwa": "",
    "TERYT": "",
    "Obszar": "",
    # Party
    "Skrót nazwy komitetu": "",
    "Przynależność do partii": "",
    "Nazwa komitetu": "",
    # Office
    "Dzielnica": "",
    "Gmina": "",
    "Województwo": "",
    "Urząd": "",
    "Powiat": "",
    "Rada": "",
    "Sejmik": "",
    # Success, position in the party
    "Czy uzyskał mandat": "",
    "Czy uzyskał prawo kandydowania w drugiej turze": "",
    "Pozycja na liście": "",
    "Poparcie": "",
    "Procent głosów oddanych na listę": "",
    "Procent głosów oddanych w okręgu": "",
    "Procent głosów": "",
}


@dataclass
class InputSource:
    source: FileSource
    extractor: ZipExtractor
    year: int
    position: str


# These sources are from pkw website
# TODO Add 2023 parliment elections
# TODO Add previous ones
sources = [
    InputSource(
        FileSource(
            "https://samorzad2024.pkw.gov.pl/samorzad2024/data/csv/kandydaci_sejmiki_wojewodztw_csv.zip"
        ),
        ZipExtractor("kandydaci_sejmiki_wojewodztw_utf8.csv"),
        2024,
        "sejmik",
    ),
    InputSource(
        FileSource(
            "https://samorzad2024.pkw.gov.pl/samorzad2024/data/csv/kandydaci_rady_powiatow_csv.zip"
        ),
        ZipExtractor("kandydaci_rady_powiatow_utf8.csv"),
        2024,
        "powiat",
    ),
    InputSource(
        FileSource(
            "https://samorzad2024.pkw.gov.pl/samorzad2024/data/csv/kandydaci_rady_gmin_powyzej_20k_csv.zip"
        ),
        ZipExtractor("kandydaci_rady_gmin_powyzej_20k_utf8.csv"),
        2024,
        "gmina",
    ),
    InputSource(
        FileSource(
            "https://samorzad2024.pkw.gov.pl/samorzad2024/data/csv/kandydaci_rady_gmin_do_20k_csv.zip"
        ),
        ZipExtractor("kandydaci_rady_gmin_do_20k_utf8.csv"),
        2024,
        "gmina",
    ),
    InputSource(
        FileSource(
            "https://samorzad2024.pkw.gov.pl/samorzad2024/data/csv/kandydaci_rady_dzielnic_csv.zip"
        ),
        ZipExtractor("kandydaci_rady_dzielnic_utf8.csv"),
        2024,
        "gmina",
    ),
    InputSource(
        FileSource(
            "https://samorzad2024.pkw.gov.pl/samorzad2024/data/csv/kandydaci_wbp_csv.zip"
        ),
        ZipExtractor("kandydaci_wbp_utf8.csv"),
        2024,
        "burmistrz",
    ),
]


def process_pkw():
    print("Downloading files...")
    for config in sources:
        source = config.source
        if not source.downloaded():
            source.download()
        if source.downloaded():
            # Double check that everything is good
            print(f"File {source.filename} is present")
        else:
            raise Exception(f"File {source.filename} is not present")
    print("Files downloaded")

    for config in sources:
        # TODO Correctly open zip file
        print(f"🗂️  Starts processing CSV file: {config.source.filename}")
        reader = csv.reader(
            config.extractor.read(config.source.downloaded_path), delimiter=";"
        )

        count = 0
        for row in reader:
            print(row)
            print(len(row))
            if count > 3:
                break
            count += 1

        print("🎉 Processing complete.")


def main():
    try:
        process_pkw()
    except Exception as e:
        print(f"An error occurred: {e}")
        raise
    finally:
        dump_dbs()
