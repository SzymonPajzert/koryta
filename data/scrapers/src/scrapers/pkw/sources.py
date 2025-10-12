import io
import abc
import math
from dataclasses import dataclass
import csv

import pandas
from zipfile import ZipFile

from util.download import FileSource


class Extractor:
    @abc.abstractmethod
    def read(self, file_path):
        raise NotImplementedError()

    @abc.abstractmethod
    def read_bytes(self, raw_bytes):
        raise NotImplementedError()


class CsvExtractor(Extractor):
    def read(self, file_path):
        with open(file_path, "rb") as f:
            content = f.read()
        return self.read_bytes(io.BytesIO(content))

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
class InputSource:
    source: FileSource
    extractor: Extractor
    year: int


# These sources are from pkw website
# TODO Add 2023 parliment elections
# TODO Add previous ones
sources = []
teryt_codes = ["020000", "040000", "060000", "080000", "100000", "120000", "140000", "160000", "180000", "200000", "220000", "240000", "260000", "280000", "300000", "320000"]
for code in teryt_codes:
    sources.append(
        InputSource(
            FileSource(f"https://wybory2010.pkw.gov.pl/geo/pl/{code}/{code}-kandydaci_rady.zip", f"2010_rady_{code[:2]}.zip"),
            ZipExtractor(f"{code}-kandydaci_rady.csv"),
            2010,
        )
    )
    sources.append(
        InputSource(
            FileSource(f"https://wybory2010.pkw.gov.pl/geo/pl/{code}/{code}-kandydaci_urzad.zip", f"2010_urzad_{code[:2]}.zip"),
            ZipExtractor(f"{code}-kandydaci_urzad.csv"),
            2010,
        )
    )
sources.extend([
    InputSource(
        FileSource("https://wybory2007.pkw.gov.pl/SJM/pliki/DOKUMENTY/dane_w_arkuszach/kandydaci_SJM.xls", "2007_sejm_kandydaci.xls"),
        XlsExtractor("kandydaci_SJM.xls", header_rows=1),
        2007,
    ),
    InputSource(
        FileSource("https://wybory2007.pkw.gov.pl/SNT/pliki/DOKUMENTY/dane_w_arkuszach/kandydaci_SNT.xls", "2007_senat_kandydaci.xls"),
        XlsExtractor("kandydaci_SNT.xls", header_rows=1),
        2007,
    ),
    InputSource(
        FileSource("https://wybory2011.pkw.gov.pl/geo/pl/kandydaci_sejm.zip", "2011_sejm_kandydaci.zip"),
        ZipExtractor("kandydaci_sejm.csv"),
        2011,
    ),
    InputSource(
        FileSource("https://wybory2011.pkw.gov.pl/geo/pl/kandydaci_senat.zip", "2011_senat_kandydaci.zip"),
        ZipExtractor("kandydaci_senat.csv"),
        2011,
    ),
    InputSource(
        FileSource("https://wybory.gov.pl/sejmsenat2023/data/csv/kandydaci_sejm_csv.zip", "2023_sejm_kandydaci.zip"),
        ZipExtractor("kandydaci_sejm_utf8.csv"),
        2023,
    ),
    InputSource(
        FileSource("https://wybory.gov.pl/sejmsenat2023/data/csv/kandydaci_senat_csv.zip", "2023_senat_kandydaci.zip"),
        ZipExtractor("kandydaci_senat_utf8.csv"),
        2023,
    ),
    InputSource(
        FileSource("https://wybory2018.pkw.gov.pl/xls/2018-wyniki-wybor%C3%B3w-do-rad.zip", "2018_rady_kandydaci.zip"),
        ZipExtractor(
            "2018-kand-rady.xlsx",
            extractor=XlsExtractor("2018-kand-rady.xlsx", header_rows=1),
        ),
        2018,
    ),
    InputSource(
        FileSource("https://wybory2018.pkw.gov.pl/xls/2018-wybbp.zip", "2018_wbp_kandydaci.zip"),
        ZipExtractor(
            "2018-kand-wbp.xlsx",
            extractor=XlsExtractor("2018-kand-wbp.xlsx", header_rows=1),
        ),
        2018,
    ),
    InputSource(
        FileSource("https://sejmsenat2019.pkw.gov.pl/sejmsenat2019/data/csv/kandydaci_sejm_csv.zip", "2019_sejm_kandydaci.zip"),
        ZipExtractor("kandydaci_sejm.csv"),
        2019,
    ),
    InputSource(
        FileSource("https://sejmsenat2019.pkw.gov.pl/sejmsenat2019/data/csv/kandydaci_senat_csv.zip", "2019_senat_kandydaci.zip"),
        ZipExtractor("kandydaci_senat.csv"),
        2019,
    ),
    InputSource(
        FileSource("https://pe2019.pkw.gov.pl/pe2019/data/csv/kandydaci_csv.zip", "2019_pe_kandydaci.zip"),
        ZipExtractor("kandydaci.csv"),
        2019,
    ),

    InputSource(
        FileSource(
            "https://samorzad2024.pkw.gov.pl/samorzad2024/data/csv/kandydaci_sejmiki_wojewodztw_csv.zip"
        ),
        ZipExtractor("kandydaci_sejmiki_wojewodztw_utf8.csv"),
        2024,
    ),
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
])
