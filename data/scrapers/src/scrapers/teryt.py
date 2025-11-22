"""
This module provides a utility class for working with TERYT territorial codes.

It fetches, parses, and provides lookup capabilities for Polish administrative
division codes (województwo, powiat, gmina) from the official TERYT database.
"""

import pandas as pd
from io import StringIO

from scrapers.stores import DownloadableFile as FileSource
from scrapers.stores import Context

teryt_data = FileSource(
    "https://eteryt.stat.gov.pl/eTeryt/rejestr_teryt/udostepnianie_danych/baza_teryt/uzytkownicy_indywidualni/pobieranie/pliki_pelne.aspx",
    "teryt_codes.zip",
    "download_teryt",
)


class Teryt:
    """
    A handler for TERYT (The National Official Register of the Territorial Division of the Country) data.

    This class downloads the official TERYT CSV file, processes it, and provides
    dictionaries for mapping between names and codes of administrative divisions.
    """

    def __init__(self, ctx: Context):
        """
        Initializes the Teryt object by downloading and processing TERYT data.

        Args:
            ctx: The scraper context, used for data I/O.
        """
        print("Creating Teryt object")
        teryt_file = ctx.io.read_data(teryt_data)

        # TODO: The date is hardcoded now; find a way to get it updated.
        # The disposition dead code in download_teryt seems like a good way.
        raw_bytes = StringIO(
            teryt_file.read_zip("TERC_Urzedowy_2025-11-15.csv")
            .read_file()
            .read()
            .decode("utf-8")
        )
        data = pd.read_csv(
            raw_bytes, sep=";", dtype={"WOJ": str, "POW": str, "GMI": str, "RODZ": str}
        )

        wojewodztwa_df = data[data["POW"].isna() & data["GMI"].isna()]
        self.wojewodztwa = {
            row.WOJ + "00": row.NAZWA for row in wojewodztwa_df.itertuples()
        }

        powiaty_df = data[~data["POW"].isna() & data["GMI"].isna()]
        self.powiaty = {row.WOJ + row.POW: row.NAZWA for row in powiaty_df.itertuples()}

        self.TERYT = {
            **self.wojewodztwa,
            **self.powiaty,
        }

        # TODO: Extend this as well.
        self.cities_to_teryt = {
            city: teryt
            for teryt, city in self.TERYT.items()
            if city and city[0].isupper()
        }
        # Manual additions for specific cases
        self.cities_to_teryt["Sieradz"] = "1014"
        self.cities_to_teryt["Chrzanów"] = "1203"
        self.cities_to_teryt["Piła"] = "3019"
        self.cities_to_teryt["Ciechanów"] = "1402"

        self.voj_lower_to_teryt = {
            voj.lower(): teryt[:2]
            for teryt, voj in self.TERYT.items()
            if teryt.endswith("00")
        }

    def parse_teryt(self, voj: str, pow: str, gmin: str, city: str) -> str:
        """
        Parses a voivodeship name to its corresponding 2-digit TERYT code.

        Args:
            voj: The name of the voivodeship (case-insensitive).
            pow: The name of the powiat (currently unused).
            gmin: The name of the gmina (currently unused).
            city: The name of the city (currently unused).

        Returns:
            The 2-digit TERYT code for the voivodeship.
        """
        voj = voj.lower()
        return self.voj_lower_to_teryt[voj]
