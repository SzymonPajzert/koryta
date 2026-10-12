"""
This module provides a utility class for working with TERYT territorial codes.

It fetches, parses, and provides lookup capabilities for Polish administrative
division codes (województwo, powiat, gmina) from the official TERYT database.
"""

import re

import pandas as pd

from scrapers.map.jst import JstIndex
from scrapers.stores import Context, Pipeline
from scrapers.stores.file import DownloadableFile

#: How KRS writes a city that is its own powiat, against how TERYT does.
#: The register has "M. OLSZTYN", "M.ST.WARSZAWA" and "MIASTO STOŁECZNE
#: WARSZAWA" for TERYT's "Olsztyn" and "Warszawa". Each alternative ends in a
#: separator on purpose: a bare ``m`` would eat the first letter of "MIECHÓW".
_UNIT_PREFIX = re.compile(r"^(?:m\.|m\s+|miasto\s+)(?:st\.|st\s+|stołeczne\s+)?\s*")


def normalize_unit_name(name: object) -> str:
    """A województwo, powiat or gmina name in the one form both sides agree on.

    TERYT names a city-powiat "Olsztyn" and a land one "olsztyński"; KRS
    uppercases both and prefixes the first with "M.". Lowercasing and dropping
    that prefix is enough to match the two by name, which is the only key they
    share - the register does not carry the code.

    Takes anything and coerces, because neither side promises a string: a TERC
    cell reaches this as whatever pandas inferred, and the register's names
    come out of JSON where the key can be present and null.
    """
    return _UNIT_PREFIX.sub("", " ".join(str(name).lower().split()))


#: TERC's `RODZ` for a whole gmina: 1 miejska, 2 wiejska, 3 miejsko-wiejska,
#: and 8 a dzielnica of Warszawa, which elects a council of its own.
GMINA_KINDS = frozenset({"1", "2", "3", "8"})


teryt_data = DownloadableFile(
    "https://eteryt.stat.gov.pl/eTeryt/rejestr_teryt/udostepnianie_danych/baza_teryt/uzytkownicy_indywidualni/pobieranie/pliki_pelne.aspx",
    "teryt_codes.zip",
    complex_download="download_teryt",
    binary=True,
)


class Teryt(Pipeline):
    filename = None  # Never cache
    volatile = True  # Always reprocess to get the latest data

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

        # Names are only unique inside their parent - "świdnicki" is a powiat of
        # both 02 and 06 - so each lookup is keyed by the code above it.
        self.powiat_by_woj = {
            (str(row.WOJ), normalize_unit_name(row.NAZWA)): str(row.WOJ) + str(row.POW)
            for row in powiaty_df.itertuples()
        }

        gminy_df = data[~data["POW"].isna() & ~data["GMI"].isna()]

        #: What kind of gmina each one is, by the six-digit code PKW's files
        #: carry - which leaves off TERC's seventh digit, the kind. A
        #: miejsko-wiejska gmina is three rows sharing its code (3, and its
        #: town 4 and its rural part 5), so it is the gmina's own row that
        #: answers; 9, a city's delegatura, elects nobody.
        self.gmina_kinds = {
            str(row.WOJ) + str(row.POW) + str(row.GMI): str(row.RODZ)
            for row in gminy_df.itertuples()
            if str(row.RODZ) in GMINA_KINDS
        }

        codes_by_name: dict[tuple[str, str], set[str]] = {}
        for row in gminy_df.itertuples():
            powiat = str(row.WOJ) + str(row.POW)
            # A miejsko-wiejska gmina is three rows - the gmina, its town and
            # its rural part - sharing one GMI, so this set stays a single
            # element and the gmina resolves.
            codes_by_name.setdefault(
                (powiat, normalize_unit_name(row.NAZWA)), set()
            ).add(powiat + str(row.GMI))

        # 143 of the 2,373 gmina names are a town and the rural gmina around it
        # under one name and two codes - Białogard 320101 and 320102. A KRS
        # entry names the gmina and not which of the two, so there is no
        # answer at this level and the powiat above them is as far as the entry
        # goes.
        self.gmina_by_powiat = {
            key: next(iter(codes))
            for key, codes in codes_by_name.items()
            if len(codes) == 1
        }

        return pd.DataFrame([{"col": "empty"}])

    def parse_siedziba(self, wojewodztwo: str, powiat: str, gmina: str) -> str:
        """The TERYT code for the division a KRS entry says it sits in.

        As precise as the three names allow and no more: the gmina if it is
        one of that powiat's, else the powiat, else the województwo, else "".
        Stopping early is the point - a company whose entry names a powiat that
        was dissolved (the old "warszawski") still belongs to its województwo,
        and 4 or 2 digits of a code every consumer reads as a prefix is worth
        more than nothing.
        """
        woj_code = self.voj_lower_to_teryt.get(str(wojewodztwo).lower())
        if not woj_code:
            return ""

        powiat_code = self.powiat_by_woj.get((woj_code, normalize_unit_name(powiat)))
        if not powiat_code:
            return woj_code

        return self.gmina_by_powiat.get(
            (powiat_code, normalize_unit_name(gmina)), powiat_code
        )

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


class Jst(Pipeline):
    """The name-to-TERYT index, for resolving who owns a company.

    Separate from `Teryt` because it needs the gmina rows, which `Teryt` throws
    away: `cities_to_teryt` is built from wojewodztwa and powiaty only and is
    keyed the wrong way round for this. Same source file, read again rather than
    threaded through - the CSV is 4,348 rows.
    """

    filename = None
    volatile = True

    def process(self, ctx: Context):
        teryt_file = ctx.io.read_data(teryt_data)
        data = teryt_file.read_zip("TERC_Urzedowy_2025-11-15.csv").read_dataframe(
            "csv", csv_sep=";", dtype={"WOJ": str, "POW": str, "GMI": str, "RODZ": str}
        )
        self.index = JstIndex.from_terc(data)
        print(f"Built a JST index over {len(self.index.units)} units")
        return pd.DataFrame([{"col": "empty"}])


class Regions(Pipeline):
    filename = "regions"
    # Written zero-padded and only meaningful zero-padded. Without the pin a
    # restore from the shared cache re-infers the column as an integer and the
    # leading zeros are gone -- see scrapers/krs/columns.py for the two read
    # paths and why they disagree.
    dtype = {"id": str, "parent_id": str}

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
            rows.append(
                {
                    "id": node_id,
                    "name": str(row.NAZWA).lower(),
                    "original_name": row.NAZWA,
                    "type": "region",
                    "level": "wojewodztwo",
                    "parent_id": None,
                }
            )

        # Powiaty
        # Filter: POW present, GMI NaN
        pow_df = data[~data["POW"].isna() & data["GMI"].isna()]
        for row in pow_df.itertuples():
            # ID: XXYY
            node_id = str(row.WOJ) + str(row.POW)
            parent_id = str(row.WOJ)
            rows.append(
                {
                    "id": node_id,
                    "name": row.NAZWA,  # e.g. "powiat bolesławiecki"
                    "original_name": row.NAZWA,
                    "type": "region",
                    "level": "powiat",
                    "parent_id": parent_id,
                }
            )

        # Gminy
        # Filter: POW present, GMI present
        gmi_df = data[~data["POW"].isna() & ~data["GMI"].isna()]
        for row in gmi_df.itertuples():
            # TERYT: WOJ(2)+POW(2)+GMI(3)
            # If duplicates exist, appending RODZ is safer.
            node_id = str(row.WOJ) + str(row.POW) + str(row.GMI) + str(row.RODZ)
            parent_id = str(row.WOJ) + str(row.POW)

            rows.append(
                {
                    "id": node_id,
                    "name": row.NAZWA,  # e.g. "Bolesławiec"
                    "original_name": row.NAZWA,
                    "type": "region",
                    "level": "gmina",
                    "parent_id": parent_id,
                }
            )

        return pd.DataFrame(rows)
