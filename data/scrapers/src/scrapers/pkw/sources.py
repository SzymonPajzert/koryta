import abc
from dataclasses import dataclass
from datetime import date
import typing

from util.polish import PkwFormat
from scrapers.stores import DownloadableFile as FileSource, Context, File
from scrapers.pkw.elections import ElectionType


class Extractor(abc.ABC):
    @abc.abstractmethod
    def read(self, ctx: Context, source: FileSource | File) -> typing.Iterable:
        pass

    def read_source(self, ctx: Context, source: FileSource | File) -> File:
        if isinstance(source, FileSource):
            return ctx.io.read_data(source)
        else:
            return source


class CsvExtractor(Extractor):
    def read(self, ctx: Context, source: FileSource | File):
        print("🗂️  Starts processing CSV file:")
        return self.read_source(ctx, source).read_csv(sep=";")


@dataclass
class ZipExtractor(Extractor):
    inner_filename: str
    extractor: Extractor = CsvExtractor()

    def read(self, ctx: Context, source: FileSource | File):
        print("🗂️  Starts processing ZIP file:")
        return self.extractor.read(
            ctx, self.read_source(ctx, source).read_zip(self.inner_filename)
        )


@dataclass
class MultiXlsZipExtractor(Extractor):
    inner_filename_pattern: str
    header_rows: int
    skip_rows: int = 0

    def read(self, ctx: Context, source: FileSource | File):
        raise NotImplementedError()


@dataclass
class XlsExtractor(Extractor):
    inner_filename: str
    header_rows: int
    # Row many rows to skip, e.g additional headers
    skip_rows: int = 0

    def read(self, ctx: Context, source: FileSource | File):
        raise NotImplementedError()


@dataclass
class InputSource:
    source: FileSource
    extractor: Extractor
    year: int
    name_format: PkwFormat
    election_type: ElectionType

    def __str__(self) -> str:
        return f"{self.year} {self.election_type}"


election_date = {
    "2010": date(
        year=2010, month=11, day=21
    ),  # https://pl.wikipedia.org/wiki/Wybory_samorz%C4%85dowe_w_Polsce_w_2010_roku
    "2014": date(year=2014, month=11, day=21),
    "2018": date(year=2018, month=10, day=21),
}

# https://github.com/SzymonPajzert/koryta/issues/123
# TODO add missing 2002_sejmik_kandydaci.zip
# TODO add missing 2002_powiat_kandydaci.xls
# TODO add missing 1998_powiat_kandydaci.zip
# TODO add missing 1998_sejmik_mazowieckie.xls

# These sources are from pkw website
sources: list[InputSource] = []
teryt_codes = [
    "020000",
    "040000",
    "060000",
    "080000",
    "100000",
    "120000",
    "140000",
    "160000",
    "180000",
    "200000",
    "220000",
    "240000",
    "260000",
    "280000",
    "300000",
    "320000",
]
for code in teryt_codes:
    sources.append(
        InputSource(
            FileSource(
                f"https://wybory2010.pkw.gov.pl/geo/pl/{code}/{code}-kandydaci_rady.zip",
                f"2010_rady_{code[:2]}.zip",
            ),
            ZipExtractor(f"{code}-kandydaci_rady.csv"),
            2010,
            PkwFormat.Last_First,
            ElectionType.SAMORZADOWE,
        )
    )
    sources.append(
        InputSource(
            FileSource(
                f"https://wybory2010.pkw.gov.pl/geo/pl/{code}/{code}-kandydaci_urzad.zip",
                f"2010_urzad_{code[:2]}.zip",
            ),
            ZipExtractor(f"{code}-kandydaci_urzad.csv"),
            2010,
            PkwFormat.Last_First,
            ElectionType.SAMORZADOWE,
        )
    )
sources.extend(
    [
        InputSource(
            FileSource(
                "https://wybory2018.pkw.gov.pl/xls/2018-wybbp.zip",
                "2018_wbp_kandydaci.zip",
            ),
            ZipExtractor(
                "2018-kand-wbp.xlsx",
                extractor=XlsExtractor("2018-kand-wbp.xlsx", header_rows=1),
            ),
            2018,
            PkwFormat.UNKNOWN,
            ElectionType.SAMORZADOWE,
        ),
        InputSource(
            FileSource(
                "https://wybory2007.pkw.gov.pl/SJM/pliki/DOKUMENTY/dane_w_arkuszach/kandydaci_SJM.xls",
                "2007_sejm_kandydaci.xls",
            ),
            XlsExtractor("kandydaci_SJM.xls", header_rows=1, skip_rows=1),
            2007,
            PkwFormat.UNKNOWN,
            ElectionType.SEJM,
        ),
        InputSource(
            FileSource(
                "https://wybory2007.pkw.gov.pl/SNT/pliki/DOKUMENTY/dane_w_arkuszach/kandydaci_SNT.xls",
                "2007_senat_kandydaci.xls",
            ),
            XlsExtractor("kandydaci_SNT.xls", header_rows=1, skip_rows=1),
            2007,
            PkwFormat.UNKNOWN,
            ElectionType.SENAT,
        ),
        InputSource(
            FileSource(
                "https://wybory2011.pkw.gov.pl/geo/pl/kandydaci_sejm.zip",
                "2011_sejm_kandydaci.zip",
            ),
            ZipExtractor("kandydaci_sejm.csv"),
            2011,
            PkwFormat.UNKNOWN,
            ElectionType.SEJM,
        ),
        InputSource(
            FileSource(
                "https://wybory2011.pkw.gov.pl/geo/pl/kandydaci_senat.zip",
                "2011_senat_kandydaci.zip",
            ),
            ZipExtractor("kandydaci_senat.csv"),
            2011,
            PkwFormat.UNKNOWN,
            ElectionType.SENAT,
        ),
        InputSource(
            FileSource(
                "https://wybory.gov.pl/sejmsenat2023/data/csv/kandydaci_sejm_csv.zip",
                "2023_sejm_kandydaci.zip",
            ),
            ZipExtractor("kandydaci_sejm_utf8.csv"),
            2023,
            PkwFormat.First_LAST,
            ElectionType.SEJM,
        ),
        InputSource(
            FileSource(
                "https://wybory.gov.pl/sejmsenat2023/data/csv/kandydaci_senat_csv.zip",
                "2023_senat_kandydaci.zip",
            ),
            ZipExtractor("kandydaci_senat_utf8.csv"),
            2023,
            PkwFormat.First_LAST,
            ElectionType.SENAT,
        ),
        InputSource(
            FileSource(
                "https://wybory2018.pkw.gov.pl/xls/2018-wyniki-wybor%C3%B3w-do-rad.zip",
                "2018_rady_kandydaci.zip",
            ),
            ZipExtractor(
                "2018-kand-rady.xlsx",
                extractor=XlsExtractor("2018-kand-rady.xlsx", header_rows=1),
            ),
            2018,
            PkwFormat.UNKNOWN,
            ElectionType.SAMORZADOWE,
        ),
        InputSource(
            FileSource(
                "https://sejmsenat2019.pkw.gov.pl/sejmsenat2019/data/csv/kandydaci_sejm_csv.zip",
                "2019_sejm_kandydaci.zip",
            ),
            ZipExtractor("kandydaci_sejm.csv"),
            2019,
            PkwFormat.UNKNOWN,
            ElectionType.SEJM,
        ),
        InputSource(
            FileSource(
                "https://sejmsenat2019.pkw.gov.pl/sejmsenat2019/data/csv/kandydaci_senat_csv.zip",
                "2019_senat_kandydaci.zip",
            ),
            ZipExtractor("kandydaci_senat.csv"),
            2019,
            PkwFormat.UNKNOWN,
            ElectionType.SENAT,
        ),
        InputSource(
            FileSource(
                "https://pe2019.pkw.gov.pl/pe2019/data/csv/kandydaci_csv.zip",
                "2019_pe_kandydaci.zip",
            ),
            ZipExtractor("kandydaci.csv"),
            2019,
            PkwFormat.UNKNOWN,
            ElectionType.EUROPARLAMENT,
        ),
        InputSource(
            FileSource(
                "https://samorzad2024.pkw.gov.pl/samorzad2024/data/csv/kandydaci_sejmiki_wojewodztw_csv.zip"
            ),
            ZipExtractor("kandydaci_sejmiki_wojewodztw_utf8.csv"),
            2024,
            PkwFormat.LAST_First,
            ElectionType.SAMORZADOWE,
        ),
        InputSource(
            FileSource("https://parlament2015.pkw.gov.pl/kandydaci.zip"),
            ZipExtractor(
                "kandsejm2015-10-19-10-00.xls",
                extractor=XlsExtractor("kandsejm2015-10-19-10-00.xls", header_rows=1),
            ),
            2015,
            PkwFormat.UNKNOWN,
            ElectionType.SEJM,
        ),
        InputSource(
            FileSource("https://parlament2015.pkw.gov.pl/kandydaci.zip"),
            ZipExtractor(
                "kandsen2015-10-19-10-00.xls",
                extractor=XlsExtractor("kandsen2015-10-19-10-00.xls", header_rows=1),
            ),
            2015,
            PkwFormat.UNKNOWN,
            ElectionType.SENAT,
        ),
        InputSource(
            FileSource(
                "https://pkw.gov.pl/uploaded_files/1579520736_samo2014_kandydaci_na_WBP.xls"
            ),
            XlsExtractor("samo2014_kandydaci_na_WBP.xls", header_rows=2),
            2014,
            PkwFormat.UNKNOWN,
            ElectionType.SAMORZADOWE,
        ),
        InputSource(
            FileSource(
                "https://pkw.gov.pl/uploaded_files/1486393038_kandydaci_do_rad_2014xlsx.xlsx"
            ),
            XlsExtractor("1486393038_kandydaci_do_rad_2014xlsx.xlsx", header_rows=1),
            2014,
            PkwFormat.UNKNOWN,
            ElectionType.SAMORZADOWE,
        ),
        InputSource(
            FileSource(
                "https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/wbp-wybrani.xls"
            ),
            XlsExtractor("wbp-wybrani.xls", header_rows=2),
            2006,
            PkwFormat.UNKNOWN,
            ElectionType.SAMORZADOWE,
        ),
    ]
)

for woj in [
    "dolnoslaskie",
    "kujawsko_pomorskie",
    "lubelskie",
    "lubuskie",
    "lodzkie",
    "malopolskie",
    "mazowieckie",
    "opolskie",
    "podkarpackie",
    "podlaskie",
    "pomorskie",
    "slaskie",
    "swietokrzyskie",
    "warminsko_mazurskie",
    "wielkopolskie",
    "zachodniopomorskie",
]:
    sources.append(
        InputSource(
            FileSource(f"https://wybory2006.pkw.gov.pl/kbw/cache/doc/d/ark/{woj}.xls"),
            XlsExtractor(f"{woj}.xls", header_rows=2),
            2006,
            PkwFormat.UNKNOWN,
            ElectionType.SAMORZADOWE,
        )
    )

sources.extend(
    [
        InputSource(
            FileSource(
                "https://samorzad2024.pkw.gov.pl/samorzad2024/data/csv/kandydaci_rady_powiatow_csv.zip"
            ),
            ZipExtractor("kandydaci_rady_powiatow_utf8.csv"),
            2024,
            PkwFormat.LAST_First,
            ElectionType.SAMORZADOWE,
        ),
        InputSource(
            FileSource(
                "https://samorzad2024.pkw.gov.pl/samorzad2024/data/csv/kandydaci_rady_gmin_powyzej_20k_csv.zip"
            ),
            ZipExtractor("kandydaci_rady_gmin_powyzej_20k_utf8.csv"),
            2024,
            PkwFormat.LAST_First,
            ElectionType.SAMORZADOWE,
        ),
        InputSource(
            FileSource(
                "https://samorzad2024.pkw.gov.pl/samorzad2024/data/csv/kandydaci_rady_gmin_do_20k_csv.zip"
            ),
            ZipExtractor("kandydaci_rady_gmin_do_20k_utf8.csv"),
            2024,
            PkwFormat.LAST_First,
            ElectionType.SAMORZADOWE,
        ),
        InputSource(
            FileSource(
                "https://samorzad2024.pkw.gov.pl/samorzad2024/data/csv/kandydaci_rady_dzielnic_csv.zip"
            ),
            ZipExtractor("kandydaci_rady_dzielnic_utf8.csv"),
            2024,
            PkwFormat.LAST_First,
            ElectionType.SAMORZADOWE,
        ),
        InputSource(
            FileSource(
                "https://samorzad2024.pkw.gov.pl/samorzad2024/data/csv/kandydaci_wbp_csv.zip"
            ),
            ZipExtractor("kandydaci_wbp_utf8.csv"),
            2024,
            PkwFormat.LAST_First,
            ElectionType.SAMORZADOWE,
        ),
        InputSource(
            FileSource(
                "https://danewyborcze.kbw.gov.pl/dane/2024/parlament_eu/kandydaci_csv.zip",
                "2024_pe_kandydaci.zip",
            ),
            ZipExtractor("kandydaci_utf8.csv"),
            2024,
            PkwFormat.First_LAST,
            ElectionType.EUROPARLAMENT,
        ),
        InputSource(
            FileSource(
                "https://danewyborcze.kbw.gov.pl/dane/2014/parlament_eu/pe2014kand.xls",
                "2014_pe_kandydaci.xls",
            ),
            XlsExtractor("pe2014kand.xls", header_rows=1),
            2014,
            PkwFormat.UNKNOWN,
            ElectionType.EUROPARLAMENT,
        ),
        InputSource(
            FileSource(
                "https://danewyborcze.kbw.gov.pl/dane/2009/parlament_eu/kandpe2009.xls",
                "2009_pe_kandydaci.xls",
            ),
            XlsExtractor("kandpe2009.xls", header_rows=1),
            2009,
            PkwFormat.UNKNOWN,
            ElectionType.EUROPARLAMENT,
        ),
        InputSource(
            FileSource(
                "https://danewyborcze.kbw.gov.pl/dane/2004/parlament_eu/pe2004-kand.xls",
                "2004_pe_kandydaci.xls",
            ),
            XlsExtractor("pe2004-kand.xls", header_rows=1),
            2004,
            PkwFormat.UNKNOWN,
            ElectionType.EUROPARLAMENT,
        ),
        InputSource(
            FileSource(
                "https://danewyborcze.kbw.gov.pl/dane/1991/sejm/kandsejm1991kom.xls",
                "1991_sejm_kandydaci.xls",
            ),
            XlsExtractor("kandsejm1991kom.xls", header_rows=1),
            1991,
            PkwFormat.UNKNOWN,
            ElectionType.SEJM,
        ),
        InputSource(
            FileSource(
                "https://danewyborcze.kbw.gov.pl/dane/1991/senat/KANSEN1991.xls",
                "1991_senat_kandydaci.xls",
            ),
            XlsExtractor("KANSEN1991.xls", header_rows=1),
            1991,
            PkwFormat.UNKNOWN,
            ElectionType.SENAT,
        ),
        InputSource(
            FileSource(
                "https://danewyborcze.kbw.gov.pl/dane/1993/sejm/kandsejm1993kom.xls",
                "1993_sejm_kandydaci.xls",
            ),
            XlsExtractor("kandsejm1993kom.xls", header_rows=1),
            1993,
            PkwFormat.UNKNOWN,
            ElectionType.SEJM,
        ),
        InputSource(
            FileSource(
                "https://danewyborcze.kbw.gov.pl/dane/1993/senat/KANSEN1993.xls",
                "1993_senat_kandydaci.xls",
            ),
            XlsExtractor("KANSEN1993.xls", header_rows=1),
            1993,
            PkwFormat.UNKNOWN,
            ElectionType.SENAT,
        ),
        InputSource(
            FileSource(
                "https://danewyborcze.kbw.gov.pl/dane/1997/sejm/kandsejm1997kom.xls",
                "1997_sejm_kandydaci.xls",
            ),
            XlsExtractor("kandsejm1997kom.xls", header_rows=1),
            1997,
            PkwFormat.UNKNOWN,
            ElectionType.SEJM,
        ),
        InputSource(
            FileSource(
                "https://danewyborcze.kbw.gov.pl/dane/1997/senat/ksenat1997.xls",
                "1997_senat_kandydaci.xls",
            ),
            XlsExtractor("ksenat1997.xls", header_rows=1),
            1997,
            PkwFormat.UNKNOWN,
            ElectionType.SENAT,
        ),
        InputSource(
            FileSource(
                "https://danewyborcze.kbw.gov.pl/dane/2001/sejm/kandsejm2001kom.xls",
                "2001_sejm_kandydaci.xls",
            ),
            XlsExtractor("kandsejm2001kom.xls", header_rows=1),
            2001,
            PkwFormat.UNKNOWN,
            ElectionType.SEJM,
        ),
        InputSource(
            FileSource(
                "https://danewyborcze.kbw.gov.pl/dane/2001/senat/2001-kan-sen.xls",
                "2001_senat_kandydaci.xls",
            ),
            XlsExtractor("2001-kan-sen.xls", header_rows=1),
            2001,
            PkwFormat.UNKNOWN,
            ElectionType.SENAT,
        ),
        InputSource(
            FileSource(
                "https://danewyborcze.kbw.gov.pl/dane/2005/sejm/kandsejm2005kom.xls",
                "2005_sejm_kandydaci.xls",
            ),
            XlsExtractor("kandsejm2005kom.xls", header_rows=1),
            2005,
            PkwFormat.UNKNOWN,
            ElectionType.SEJM,
        ),
        InputSource(
            FileSource(
                "https://danewyborcze.kbw.gov.pl/dane/2005/senat/kandsen2005.xls",
                "2005_senat_kandydaci.xls",
            ),
            XlsExtractor("kandsen2005.xls", header_rows=1),
            2005,
            PkwFormat.UNKNOWN,
            ElectionType.SENAT,
        ),
        InputSource(
            FileSource(
                "https://danewyborcze.kbw.gov.pl/dane/2002/2002-kand-rady.xlsx",
                "2002_rady_kandydaci.xlsx",
            ),
            XlsExtractor("2002-kand-rady.xlsx", header_rows=1),
            2002,
            PkwFormat.UNKNOWN,
            ElectionType.SAMORZADOWE,
        ),
        InputSource(
            FileSource(
                "https://danewyborcze.kbw.gov.pl/dane/2002/wbp/wbp2002.zip",
                "2002_wbp_kandydaci.zip",
            ),
            ZipExtractor(
                "wojt2002.xls",
                extractor=XlsExtractor("wojt2002.xls", header_rows=1),
            ),
            2002,
            PkwFormat.UNKNOWN,
            ElectionType.SAMORZADOWE,
        ),
        InputSource(
            FileSource(
                "https://danewyborcze.kbw.gov.pl/dane/1998/1998-kand-rady.xlsx",
                "1998_rady_kandydaci.xlsx",
            ),
            XlsExtractor("1998-kand-rady.xlsx", header_rows=1),
            1998,
            PkwFormat.UNKNOWN,
            ElectionType.SAMORZADOWE,
        ),
        InputSource(
            FileSource(
                "https://danewyborcze.kbw.gov.pl/dane/1998/rada_gminy/1998_rady_gmin.zip",
                "1998_rady_gmin.zip",
            ),
            MultiXlsZipExtractor("*.xls", header_rows=1),
            1998,
            PkwFormat.UNKNOWN,
            ElectionType.SAMORZADOWE,
        ),
        InputSource(
            FileSource(
                "https://danewyborcze.kbw.gov.pl/dane/1994/samo1994/samo1994kand.zip",
                "1994_samorzad_kandydaci.zip",
            ),
            MultiXlsZipExtractor("*.xls", header_rows=1),
            1994,
            PkwFormat.UNKNOWN,
            ElectionType.SAMORZADOWE,
        ),
    ]
)
