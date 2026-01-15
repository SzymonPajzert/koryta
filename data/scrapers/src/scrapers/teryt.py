"""
This module provides a utility class for working with TERYT territorial codes.

It fetches, parses, and provides lookup capabilities for Polish administrative
division codes (województwo, powiat, gmina) from the official TERYT database.
"""

import pandas as pd

from scrapers.stores import Context, DownloadableFile, Pipeline

teryt_data = DownloadableFile(
    "https://eteryt.stat.gov.pl/eTeryt/rejestr_teryt/udostepnianie_danych/baza_teryt/uzytkownicy_indywidualni/pobieranie/pliki_pelne.aspx",
    "teryt_codes.zip",
    "download_teryt",
    binary=True,
)


class Teryt(Pipeline):
    filename = None  # Never cache

    """
    A handler for TERYT territorial codes data.

    This class downloads the official TERYT CSV file, processes it, and provides
    dictionaries for mapping between names and codes of administrative divisions.
    """

    def process(self, ctx: Context):
        """
        Initializes the Teryt object by downloading and processing TERYT data.

        Args:
            ctx: The scraper context, used for data I/O.
        """
        print("Creating Teryt object")
        teryt_file = ctx.io.read_data(teryt_data)

        # TODO: The date is hardcoded now; find a way to get it updated.
        # The disposition dead code in download_teryt seems like a good way.
        data = teryt_file.read_zip("TERC_Urzedowy_2025-11-15.csv").read_dataframe(
            "csv", csv_sep=";", dtype={"WOJ": str, "POW": str, "GMI": str, "RODZ": str}
        )

        wojewodztwa_df = data[data["POW"].isna() & data["GMI"].isna()]
        self.wojewodztwa = {
            str(row.WOJ) + "00": row.NAZWA for row in wojewodztwa_df.itertuples()
        }

        powiaty_df = data[~data["POW"].isna() & data["GMI"].isna()]
        self.powiaty = {
            str(row.WOJ) + str(row.POW): row.NAZWA for row in powiaty_df.itertuples()
        }

        self.TERYT = {
            **self.wojewodztwa,
            **self.powiaty,
        }

        print("Setting cities_to_teryt")
        # TODO: Extend this as well.
        self.cities_to_teryt = {
            city: teryt
            for teryt, city in self.TERYT.items()
            if isinstance(city, str) and city and city[0].isupper()
        }
        # Manual additions for specific cases
        self.cities_to_teryt["Sieradz"] = "1014"
        self.cities_to_teryt["Chrzanów"] = "1203"
        self.cities_to_teryt["Piła"] = "3019"
        self.cities_to_teryt["Ciechanów"] = "1402"

        self.voj_lower_to_teryt = {
            str(voj).lower(): teryt[:2]
            for teryt, voj in self.TERYT.items()
            if teryt.endswith("00")
        }

        return pd.DataFrame([{"col": "empty"}])

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


class Regions(Pipeline):
    filename = "regions"

    def process(self, ctx: Context) -> pd.DataFrame:
        teryt_file = ctx.io.read_data(teryt_data)
        data = teryt_file.read_zip("TERC_Urzedowy_2025-11-15.csv").read_dataframe(
            "csv", csv_sep=";", dtype={"WOJ": str, "POW": str, "GMI": str, "RODZ": str}
        )

        rows = []

        # Województwa
        # Filter: POW is NaN, GMI is NaN
        woj_df = data[data["POW"].isna() & data["GMI"].isna()]
        for row in woj_df.itertuples():
            # ID: XX (2 chars)
            node_id = str(row.WOJ)
            rows.append({
                "id": node_id,
                "name": row.NAZWA.lower(),  # Lowercase as preferred or keep original? Keeping original looks better, but user might want lowercase. TERYT usually has lowercase/mixed.
                # Actually NAZWA in TERYT is usually "WOJEWÓDZTWO DOLNOŚLĄSKIE" or just "DOLNOŚLĄSKIE"? Usually "DOLNOŚLĄSKIE".
                "original_name": row.NAZWA,
                "type": "region",
                "level": "wojewodztwo",
                "parent_id": None
            })

        # Powiaty
        # Filter: POW present, GMI NaN
        pow_df = data[~data["POW"].isna() & data["GMI"].isna()]
        for row in pow_df.itertuples():
            # ID: XXYY
            node_id = str(row.WOJ) + str(row.POW)
            parent_id = str(row.WOJ)
            rows.append({
                "id": node_id,
                "name": row.NAZWA, # e.g. "powiat bolesławiecki"
                "original_name": row.NAZWA,
                "type": "region",
                "level": "powiat",
                "parent_id": parent_id
            })

        # Gminy
        # Filter: POW present, GMI present
        gmi_df = data[~data["POW"].isna() & ~data["GMI"].isna()]
        for row in gmi_df.itertuples():
            # ID: XXYYZZ (6 chars) - Ignoring RODZ for parent hierarchy, but maybe ID should plain.
            # Note: Gminas with different RODZ but same GMI code might exist?
            # TERYT: WOJ(2)+POW(2)+GMI(2)+RODZ(1).
            # Unique ID should ideally include RODZ to be safe, but parent is Powiat (XXYY).
            # Let's check uniqueness of XXYYZZ.
            # If duplicates exist, appending RODZ is safer.
            node_id = str(row.WOJ) + str(row.POW) + str(row.GMI) + str(row.RODZ)
            parent_id = str(row.WOJ) + str(row.POW)
            
            rows.append({
                "id": node_id,
                "name": row.NAZWA, # e.g. "Bolesławiec"
                "original_name": row.NAZWA,
                "type": "region",
                "level": "gmina",
                "parent_id": parent_id
            })

        return pd.DataFrame(rows)
