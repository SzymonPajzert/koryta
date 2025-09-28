from dataclasses import dataclass, field
import regex as re
from collections import Counter
from stores.duckdb import dump_dbs
from util.download import FileSource
import csv
from zipfile import ZipFile
import io
import typing
import abc


class ZipExtractor:
    inner_filename: str

    def __init__(self, inner_filename) -> None:
        self.inner_filename = inner_filename

    def read(self, zip_file_path):
        with ZipFile(zip_file_path, "r").open(self.inner_filename, "r") as raw_bytes:
            for line in io.TextIOWrapper(raw_bytes, encoding="utf-8"):
                yield line


@dataclass
class SetField:
    name: str
    processor: typing.Callable[[str], str] = lambda x: x


CSV_HEADERS_2024 = {
    # Personal
    "Nazwisko i imiona": SetField("pkw_name"),
    "Wiek": SetField("age_in_2024"),
    "Płeć": SetField("sex", processor=lambda x: "M" if x == "Mężczyzna" else ""),
    # Location of living
    "Miejsce zamieszkania": None,
    "Gmina m. z.": None,
    # Location of candidacy
    "TERYT m. z.": SetField("teryt_living"),
    "TERYT Dzielnicy": SetField("teryt_candidacy"),
    "TERYT Gminy": SetField("teryt_candidacy"),
    "TERYT Powiatu": SetField("teryt_candidacy"),
    "TERYT Województwa": SetField("teryt_candidacy"),
    "TERYT": SetField("teryt_candidacy"),
    "Obszar": None,
    # Party
    "Skrót nazwy komitetu": SetField("party"),
    "Przynależność do partii": SetField("party_member"),
    "Poparcie": None,  # TODO check if this field is useful SetField("party_member"),
    "Nazwa komitetu": None,
    # Office
    "Dzielnica": SetField("position", processor=lambda x: "Rada dzielnicy"),
    "Gmina": SetField("position", processor=lambda x: "Rada gminy"),
    "Województwo": None,
    "Urząd": SetField("position"),
    "Powiat": SetField("position", processor=lambda x: "Rada powiatu"),
    "Rada": None,
    "Sejmik": SetField("position", processor=lambda x: "Rada sejmiku"),
    # Success, position in the party
    # TODO Capture the success
    "Czy uzyskał mandat": SetField(
        "candidacy_success", lambda x: "TRUE" if x == "Tak" else "FALSE"
    ),
    "Czy uzyskał prawo kandydowania w drugiej turze": None,  # TODO check if this field is useful
    "Pozycja na liście": None,
    "Procent głosów oddanych na listę": None,
    "Procent głosów oddanych w okręgu": None,
    "Procent głosów": None,
    # Ignored
    "Nr okręgu": None,
    "Nr listy": None,
    "Liczba głosów": None,
    "Liczba głosów ważnych oddanych w okręgu": None,
    "Liczba głosów ważnych oddanych na listę": None,
    "Numer na karcie do głosowania": None,
    "Wykształcenie": None,
    "Liczba głosów ważnych na wszystkich kandydatów": None,
}

counters = {k: Counter() for k in CSV_HEADERS_2024.keys()}

# TODO Is there any better way to list upper case characters?
UPPER = "A-ZĘẞÃŻŃŚŠĆČÜÖÓŁŹŽĆĄÁŇŚÑŠÁÉÇŐŰÝŸÄṔÍŢİŞÇİŅ'"


@dataclass
class ExtractedData:
    pkw_name: str
    last_name: str = field(init=False)
    first_name: str = field(init=False)
    age_in_2024: str
    birth_year: int = field(init=False)
    sex: str
    teryt_living: str
    teryt_candidacy: str
    candidacy_success: str
    party: str
    position: str
    middle_name: str | None = None
    party_member: str | None = None

    def __post_init__(self):
        m = re.match(f"(?:[-{UPPER}]+ )+", self.pkw_name)
        if not m:
            raise ValueError(f"Invalid name: {self.pkw_name}")
        self.last_name = m.group().strip()
        names = self.pkw_name[len(self.last_name) :].strip().split(" ")
        self.first_name = names[0]
        if len(names) == 2:
            self.middle_name = " ".join(names[1:])
        if len(names) > 2:
            print(f"Skipping setting middle name: {self.pkw_name}")

        self.birth_year = 2024 - int(self.age_in_2024)

    def spadochroniarz(self):
        candidacy = self.teryt_candidacy.rstrip("0")
        living = self.teryt_living[: len(candidacy)]
        return candidacy != living


def process_csv(reader, position):
    header = None

    for row in reader:
        if not header:
            header = [col.strip('\ufeff"') for col in row]
            replacements = dict()
            for col in header:
                if CSV_HEADERS_2024[col] == "" or CSV_HEADERS_2024[col] is None:
                    continue

                if CSV_HEADERS_2024[col].name not in replacements:
                    replacements[CSV_HEADERS_2024[col].name] = col
                else:
                    raise ValueError(
                        f"Duplicate column name: {col} and {replacements[CSV_HEADERS_2024[col].name]} map to {CSV_HEADERS_2024[col].name}"
                    )

            continue

        row_dict = dict(zip(header, row))

        for k, v in row_dict.items():
            if CSV_HEADERS_2024[k] == "":
                counters[k].update([v])

        mapped = dict()
        for k, v in row_dict.items():
            if CSV_HEADERS_2024[k] == "" or CSV_HEADERS_2024[k] is None:
                continue
            mapped[CSV_HEADERS_2024[k].name] = CSV_HEADERS_2024[k].processor(v)

        try:
            yield ExtractedData(**mapped)
        except TypeError:
            print(row_dict)
            raise


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

        # TODO check the year, since it's currently hardcoded for 2024
        count = 0
        for item in process_csv(reader, config.position):
            if count < 10:
                print(item)
            count += 1

        print("🎉 Processing complete.")


def main():
    try:
        process_pkw()

        # TODO compare teryt_candidacy and teryt_living and find people who are too far

        print("\n\n")

        for column, counter in counters.items():
            if len(counter) == 0:
                continue
            print(column)
            print(counter.most_common(10))
    except Exception as e:
        print(f"An error occurred: {e}")
        raise
    finally:
        dump_dbs()
