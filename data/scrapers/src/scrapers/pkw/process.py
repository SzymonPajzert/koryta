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
import math

# TODO write years to separate files, so it's a bit faster to processles


class Extractor:
    @abc.abstractmethod
    def read(self, file_path):
        raise NotImplementedError()

    @abc.abstractmethod
    def read_bytes(self, raw_bytes):
        raise NotImplementedError()


class CsvExtractor(Extractor):
    def read_bytes(self, raw_bytes):
        def generator():
            for line in io.TextIOWrapper(raw_bytes, encoding="utf-8"):
                yield line

        first = True
        for line in csv.reader(generator(), delimiter=";"):
            if first:
                first = False
                line = [col.strip('\ufeff"') for col in line]
            yield line


class ZipExtractor(Extractor):
    inner_filename: str
    extractor: Extractor

    def __init__(self, inner_filename, extractor: Extractor = CsvExtractor()) -> None:
        self.inner_filename = inner_filename
        self.extractor = extractor

    def read(self, file_path):
        raw_bytes = ZipFile(file_path, "r").open(self.inner_filename, "r")
        return self.extractor.read_bytes(raw_bytes)


class XlsExtractor(Extractor):
    inner_filename: str
    header_rows: int  # Row many rows to skip, e.g additional headers

    def __init__(self, inner_filename, header_rows) -> None:
        self.inner_filename = inner_filename
        self.header_rows = header_rows

    def _read(self, content):
        df = pandas.read_excel(content, header=None)
        count = 0
        header = None
        # We set index and name, to get just plain tuples
        for row in df.itertuples(index=False, name=None):
            if count < self.header_rows:
                count += 1
                current = list(row)
                for idx, _ in enumerate(current):
                    if not isinstance(current[idx], str) and math.isnan(current[idx]):
                        # Nan means that the cell is merged, carry over the value
                        current[idx] = current[idx - 1]

                if header is None:
                    header = current
                else:
                    header = [f"{p} {c}" for p, c in zip(header, current)]
            elif count == self.header_rows:
                # Return aggregated header
                yield header
                count += 1
            else:
                yield row

    def read(self, file_path):
        return self._read(file_path)

    def read_bytes(self, raw_bytes):
        return self._read(raw_bytes)


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
    "Gmina TERYT": SetField("teryt_candidacy"),
    "Rada TERYT": SetField("teryt_candidacy"),
    "Gmina nazwa": None,
    "Gmina powiat": None,
    "Gmina województwo": None,
    "Gmina urząd": SetField("position"),
    "Komitet wyborczy nazwa": None,
    "Komitet wyborczy skrót nazwy": SetField("party"),
    "Dane Nazwisko": SetField("last_name"),
    "Dane  Nazwisko": SetField("last_name"),
    "Dane Imiona": SetField("first_name"),
    "Dane  Imona": SetField("first_name"),
    "Dane Syn": None,
    "Dane  Płeć": SetField("sex"),
    "Dane Płeć": SetField("sex"),
    "Dane Wiek": SetField("age"),
    "Dane  Wiek": SetField("age"),
    "Miejsce zamieszkania Miejscowość": None,
    "Miejsce zamieszkania TERYT": None,
    "Poparcie TERYT": None,
    "Partia polityczna TERYT": None,
    "Wykształcenie TERYT": None,
    "Głosy I tura": None,
    "Głosy II tura": None,
    "Data\nwyboru II tura": None,
    "Rada Rada": None,
    "Rada Nazwa": None,
    "Komitet Nazwa": SetField("party"),
    "nazwa": None,
    "powiat": None,
    "województwo": None,
    "Rada Okręg nr": None,
    "Komitet lista nr": None,
    "Dane  prefix nazwiska": None,
    "Miejscowość": None,  # TODO watch out, for wbp we have double TERYT and we skip Miejscowość for the Miejsce Zamieszkania
    "Syn": None,
    "Dane  L.głosów": None,
}

CSV_HEADERS_2014 = {
    "Id kand Mandat": None,
    "Id kom Mandat": None,
    "TERYT Mandat": SetField("teryt_candidacy"),
    "Gmina Mandat": None,
    "Powiat Mandat": None,
    "Urząd Mandat": None,
    "Imiona Mandat": SetField("first_name"),
    "Nazwisko Mandat": SetField("last_name"),
    "Komitet Mandat": SetField("party"),
    "Typ Mandat": None,
    "Wykształcenie Mandat": None,
    "Wiek Mandat": SetField("age"),
    "Płeć Mandat": SetField("sex"),
    "Miejscowość Mandat": None,
    "Teryt  m. zam. Mandat": SetField("teryt_living"),
    "Członek Mandat": None,
    "Poparcie Mandat": None,
    "I tura Gł. wazne": None,
    "I tura Gł. na\nkand.": None,
    "I tura Gł.\nprzeciw": None,
    "I tura %\ngłosów": None,
    "I tura Mandat": None,
    "II tura Gł. wazne": None,
    "II tura Gł. na\nkand.": None,
    "II tura Gł.\nprzeciw": None,
    "II tura %\ngłosów": None,
    "II tura Mandat": None,
    "Nazwa": None,
    "Szczebel": None,
    "Nr\nokr.": None,
    "Nr\nlisty": None,
    "Komitet": SetField("party"),
    "Sygnatura": None,
    "Typ kom.": None,
    "Poz.": None,
    "Nazwisko": SetField("last_name"),
    "Imiona": SetField("first_name"),
    "Głosy": None,
    "Mandat": None,
    "Miejsce zam.": None,
    "Obywatelstwo": None,
}

CSV_HEADERS_2015 = {
    "Nr okr.": None,
    "Zawód": None,
    "Należy do partii politycznej": None,
}


CSV_HEADERS = {
    **CSV_HEADERS_2024,
    **CSV_HEADERS_2006,
    **CSV_HEADERS_2014,
    **CSV_HEADERS_2015,
}

counters = {k: Counter() for k in CSV_HEADERS.keys()}

# TODO Is there any better way to list upper case characters?
UPPER = "A-ZĘẞÃŻŃŚŠĆČÜÖÓŁŹŽĆĄÁŇŚÑŠÁÉÇŐŰÝŸÄṔÍŢİŞÇİŅ'"


@ducktable(name="people_pkw")
@dataclass
class ExtractedData:
    election_year: str
    sex: str
    birth_year: int | None = None
    age: str | None = None
    teryt_candidacy: str | None = None
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

        if self.age is not None:
            self.birth_year = int(self.election_year) - int(self.age)

    def insert_into(self):
        pass

    # TODO currently it doesn't work well, I could improve it
    def spadochroniarz(self):
        assert self.teryt_candidacy is not None
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
            print(header)
            for idx, col in enumerate(header):
                if col != col or col == float("nan"):
                    # It's NaN
                    header[idx] = ""
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


# These sources are from pkw website
# TODO Add 2023 parliment elections
# TODO Add previous ones
sources = [
    InputSource(
        FileSource("https://parlament2015.pkw.gov.pl/kandydaci.zip"),
        ZipExtractor(
            "kandsejm2015-10-19-10-00.xls",
            extractor=XlsExtractor("kandsejm2015-10-19-10-00.xls", header_rows=1),
        ),
        2015,
    ),
    InputSource(
        FileSource("https://parlament2015.pkw.gov.pl/kandydaci.zip"),
        ZipExtractor(
            "kandsen2015-10-19-10-00.xls",
            extractor=XlsExtractor("kandsen2015-10-19-10-00.xls", header_rows=1),
        ),
        2015,
    ),
    InputSource(
        FileSource(
            "https://pkw.gov.pl/uploaded_files/1579520736_samo2014_kandydaci_na_WBP.xls"
        ),
        XlsExtractor("samo2014_kandydaci_na_WBP.xls", header_rows=2),
        2014,
    ),
    InputSource(
        FileSource(
            "https://pkw.gov.pl/uploaded_files/1486393038_kandydaci_do_rad_2014xlsx.xlsx"
        ),
        XlsExtractor("1486393038_kandydaci_do_rad_2014xlsx.xlsx", header_rows=1),
        2014,
    ),
    #
    InputSource(
        FileSource("https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/wbp-wybrani.xls"),
        XlsExtractor("wbp-wybrani.xls", header_rows=2),
        2006,
    ),
    InputSource(
        FileSource(
            "https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/dolnoslaskie.xls"
        ),
        XlsExtractor("dolnoslaskie.xls", header_rows=2),
        2006,
    ),
    InputSource(
        FileSource(
            "https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/kujawsko_pomorskie.xls"
        ),
        XlsExtractor("kujawsko_pomorskie.xls", header_rows=2),
        2006,
    ),
    InputSource(
        FileSource("https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/lubelskie.xls"),
        XlsExtractor("lubelskie.xls", header_rows=2),
        2006,
    ),
    InputSource(
        FileSource("https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/lubuskie.xls"),
        XlsExtractor("lubuskie.xls", header_rows=2),
        2006,
    ),
    InputSource(
        FileSource("https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/lodzkie.xls"),
        XlsExtractor("lodzkie.xls", header_rows=2),
        2006,
    ),
    InputSource(
        FileSource("https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/malopolskie.xls"),
        XlsExtractor("malopolskie.xls", header_rows=2),
        2006,
    ),
    InputSource(
        FileSource("https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/mazowieckie.xls"),
        XlsExtractor("mazowieckie.xls", header_rows=2),
        2006,
    ),
    InputSource(
        FileSource("https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/opolskie.xls"),
        XlsExtractor("opolskie.xls", header_rows=2),
        2006,
    ),
    InputSource(
        FileSource(
            "https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/podkarpackie.xls"
        ),
        XlsExtractor("podkarpackie.xls", header_rows=2),
        2006,
    ),
    InputSource(
        FileSource("https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/podlaskie.xls"),
        XlsExtractor("podlaskie.xls", header_rows=2),
        2006,
    ),
    InputSource(
        FileSource("https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/pomorskie.xls"),
        XlsExtractor("pomorskie.xls", header_rows=2),
        2006,
    ),
    InputSource(
        FileSource("https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/slaskie.xls"),
        XlsExtractor("slaskie.xls", header_rows=2),
        2006,
    ),
    InputSource(
        FileSource(
            "https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/swietokrzyskie.xls"
        ),
        XlsExtractor("swietokrzyskie.xls", header_rows=2),
        2006,
    ),
    InputSource(
        FileSource(
            "https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/warminsko_mazurskie.xls"
        ),
        XlsExtractor("warminsko_mazurskie.xls", header_rows=2),
        2006,
    ),
    InputSource(
        FileSource(
            "https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/wielkopolskie.xls"
        ),
        XlsExtractor("wielkopolskie.xls", header_rows=2),
        2006,
    ),
    InputSource(
        FileSource(
            "https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/zachodniopomorskie.xls"
        ),
        XlsExtractor("zachodniopomorskie.xls", header_rows=2),
        2006,
    ),
    InputSource(
        FileSource(
            "https://samorzad2024.pkw.gov.pl/samorzad2024/data/csv/kandydaci_sejmiki_wojewodztw_csv.zip"
        ),
        ZipExtractor("kandydaci_sejmiki_wojewodztw_utf8.csv"),
        2024,
    ),
    InputSource(
        FileSource(
            "https://samorzad2024.pkw.gov.pl/samorzad2024/data/csv/kandydaci_rady_powiatow_csv.zip"
        ),
        ZipExtractor("kandydaci_rady_powiatow_utf8.csv"),
        2024,
    ),
    InputSource(
        FileSource(
            "https://samorzad2024.pkw.gov.pl/samorzad2024/data/csv/kandydaci_rady_gmin_powyzej_20k_csv.zip"
        ),
        ZipExtractor("kandydaci_rady_gmin_powyzej_20k_utf8.csv"),
        2024,
    ),
    InputSource(
        FileSource(
            "https://samorzad2024.pkw.gov.pl/samorzad2024/data/csv/kandydaci_rady_gmin_do_20k_csv.zip"
        ),
        ZipExtractor("kandydaci_rady_gmin_do_20k_utf8.csv"),
        2024,
    ),
    InputSource(
        FileSource(
            "https://samorzad2024.pkw.gov.pl/samorzad2024/data/csv/kandydaci_rady_dzielnic_csv.zip"
        ),
        ZipExtractor("kandydaci_rady_dzielnic_utf8.csv"),
        2024,
    ),
    InputSource(
        FileSource(
            "https://samorzad2024.pkw.gov.pl/samorzad2024/data/csv/kandydaci_wbp_csv.zip"
        ),
        ZipExtractor("kandydaci_wbp_utf8.csv"),
        2024,
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
        headers = {**CSV_HEADERS}
        try:
            for item in process_csv(reader, config.year, headers):
                item.insert_into()
        except KeyError as e:
            print(f"Failed processing {config.source.downloaded_path}: {e}")

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
