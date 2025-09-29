from dataclasses import dataclass, field
import regex as re
from collections import Counter
from stores.duckdb import dump_dbs, ducktable
from util.download import FileSource
import csv
from zipfile import ZipFile
import io
import typing
import pandas
import abc


class Extractor:
    @abc.abstractmethod
    def read(self, file_path):
        raise NotImplementedError()


class ZipExtractor(Extractor):
    inner_filename: str

    def __init__(self, inner_filename) -> None:
        self.inner_filename = inner_filename

    def read(self, file_path):
        with ZipFile(file_path, "r").open(self.inner_filename, "r") as raw_bytes:

            def generator():
                for line in io.TextIOWrapper(raw_bytes, encoding="utf-8"):
                    yield line

            first = True
            for line in csv.reader(generator(), delimiter=";"):
                if first:
                    first = False
                    line = [col.strip('\ufeff"') for col in line]
                yield line


class XlsExtractor(Extractor):
    inner_filename: str
    skip_rows: int  # Row many rows to skip, e.g additional headers

    def __init__(self, inner_filename, skip_rows=0) -> None:
        self.inner_filename = inner_filename
        self.skip_rows = skip_rows

    def read(self, file_path):
        df = pandas.read_excel(file_path)
        count = 0
        for _, row in df.iterrows():
            if count < self.skip_rows:
                count += 1
                continue
            yield row


@dataclass
class SetField:
    name: str
    processor: typing.Callable[[str], str] = lambda x: x


def parse_sex(s: str) -> str:
    match s:
        case "K":
            return "F"
        case "M":
            return "M"
        case "Mężczyzna":
            return "M"
        case "Kobieta":
            return "F"

    raise ValueError(f"Unknown sex: {s}")


CSV_HEADERS_2024 = {
    # Personal
    "Nazwisko i imiona": SetField("pkw_name"),
    "Wiek": SetField("age"),
    "Płeć": SetField("sex", parse_sex),
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

CSV_HEADERS_2006 = {
    "Nazwa": None,
    "Okręg nr": None,
    "lista nr": None,
    "prefix nazwiska": None,
    "Nazwisko": SetField("last_name"),
    "Imona": SetField("first_name"),
    "L.głosów": None,
}

CSV_HEADERS = {
    **CSV_HEADERS_2024,
    **CSV_HEADERS_2006,
}

counters = {k: Counter() for k in CSV_HEADERS.keys()}

# TODO Is there any better way to list upper case characters?
UPPER = "A-ZĘẞÃŻŃŚŠĆČÜÖÓŁŹŽĆĄÁŇŚÑŠÁÉÇŐŰÝŸÄṔÍŢİŞÇİŅ'"


@ducktable(name="people_pkw")
@dataclass
class ExtractedData:
    election_year: str
    age: str
    birth_year: int = field(init=False)
    sex: str
    teryt_candidacy: str
    teryt_living: str | None = None
    candidacy_success: str | None = None
    party: str | None = None
    position: str | None = None
    pkw_name: str | None = None
    first_name: str | None = None
    middle_name: str | None = None
    last_name: str | None = None
    party_member: str | None = None

    def __post_init__(self):
        if self.pkw_name is not None:
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
        else:
            # TODO why I can't use upper here
            self.pkw_name = f"{self.last_name} {self.first_name}"

        if self.first_name is not None and " " in self.first_name:
            names = self.first_name.split(" ", 1)
            self.first_name = names[0]
            self.middle_name = names[1]

        self.birth_year = int(self.election_year) - int(self.age)

    def insert_into(self):
        pass

    # TODO currently it doesn't work well, I could improve it
    def spadochroniarz(self):
        candidacy = self.teryt_candidacy.rstrip("0")
        assert self.teryt_living is not None
        living = self.teryt_living[: len(candidacy)]
        return candidacy != living


def process_csv(reader, election_year, csv_headers):
    header = None

    for row in reader:
        if header is None:
            header = row
            replacements = dict()
            for col in header:
                if csv_headers[col] == "" or csv_headers[col] is None:
                    continue

                if csv_headers[col].name not in replacements:
                    replacements[csv_headers[col].name] = col
                else:
                    raise ValueError(
                        f"Duplicate column name: {col} and {replacements[csv_headers[col].name]} map to {csv_headers[col].name}"
                    )

            continue

        row_dict = dict(zip(header, row))

        for k, v in row_dict.items():
            if csv_headers[k] == "":
                counters[k].update([v])

        mapped = dict()
        for k, v in row_dict.items():
            if csv_headers[k] == "" or csv_headers[k] is None:
                continue
            mapped[csv_headers[k].name] = csv_headers[k].processor(v)

        try:
            yield ExtractedData(election_year=election_year, **mapped)
        except TypeError:
            print(row_dict)
            raise


@dataclass
class InputSource:
    source: FileSource
    extractor: Extractor
    year: int
    position: str | None = None
    province: str | None = None


# These sources are from pkw website
# TODO Add 2023 parliment elections
# TODO Add previous ones
sources = [
    InputSource(
        FileSource(
            "https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/dolnoslaskie.xls"
        ),
        XlsExtractor("dolnoslaskie.xls"),
        2006,
        province="dolnoslaskie",
    ),
    InputSource(
        FileSource(
            "https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/kujawsko_pomorskie.xls"
        ),
        XlsExtractor("kujawsko_pomorskie.xls"),
        2006,
        province="kujawsko-pomorskie",
    ),
    InputSource(
        FileSource("https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/lubelskie.xls"),
        XlsExtractor("lubelskie.xls"),
        2006,
        province="lubelskie",
    ),
    InputSource(
        FileSource("https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/lubuskie.xls"),
        XlsExtractor("lubuskie.xls"),
        2006,
        province="lubuskie",
    ),
    InputSource(
        FileSource("https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/lodzkie.xls"),
        XlsExtractor("lodzkie.xls"),
        2006,
        province="lodzkie",
    ),
    InputSource(
        FileSource("https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/malopolskie.xls"),
        XlsExtractor("malopolskie.xls"),
        2006,
        province="malopolskie",
    ),
    InputSource(
        FileSource("https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/mazowieckie.xls"),
        XlsExtractor("mazowieckie.xls"),
        2006,
        province="mazowieckie",
    ),
    InputSource(
        FileSource("https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/opolskie.xls"),
        XlsExtractor("opolskie.xls"),
        2006,
        province="opolskie",
    ),
    InputSource(
        FileSource(
            "https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/podkarpackie.xls"
        ),
        XlsExtractor("podkarpackie.xls"),
        2006,
        province="podkarpackie",
    ),
    InputSource(
        FileSource("https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/podlaskie.xls"),
        XlsExtractor("podlaskie.xls"),
        2006,
        province="podlaskie",
    ),
    InputSource(
        FileSource("https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/pomorskie.xls"),
        XlsExtractor("pomorskie.xls"),
        2006,
        province="pomorskie",
    ),
    InputSource(
        FileSource("https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/slaskie.xls"),
        XlsExtractor("slaskie.xls"),
        2006,
        province="slaskie",
    ),
    InputSource(
        FileSource(
            "https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/swietokrzyskie.xls"
        ),
        XlsExtractor("swietokrzyskie.xls"),
        2006,
        province="swietokrzyskie",
    ),
    InputSource(
        FileSource(
            "https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/warminsko_mazurskie.xls"
        ),
        XlsExtractor("warminsko_mazurskie.xls"),
        2006,
        province="warminsko-mazurskie",
    ),
    InputSource(
        FileSource(
            "https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/wielkopolskie.xls"
        ),
        XlsExtractor("wielkopolskie.xls"),
        2006,
        province="wielkopolskie",
    ),
    InputSource(
        FileSource(
            "https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/zachodniopomorskie.xls"
        ),
        XlsExtractor("zachodniopomorskie.xls"),
        2006,
        province="zachodniopomorskie",
    ),
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
        reader = config.extractor.read(config.source.downloaded_path)

        # TODO check the year, since it's currently hardcoded for 2024
        for item in process_csv(reader, config.year, CSV_HEADERS):
            item.insert_into()

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
