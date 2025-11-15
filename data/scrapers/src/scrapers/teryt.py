import pandas as pd

from scrapers.stores import DownloadableFile as FileSource
from scrapers.stores import Context

teryt_data = FileSource(
    "https://eteryt.stat.gov.pl/eTeryt/rejestr_teryt/udostepnianie_danych/baza_teryt/uzytkownicy_indywidualni/pobieranie/pliki_pelne.aspx",
    "teryt_codes.zip",
    "download_teryt",
)


# TODO injectable @singleton
# Or should it just be a store, available through dep injection?
class Teryt:
    def __init__(self, ctx: Context):
        ctx.conductor.check_input(teryt_data)

        # TODO the date is hardcoded now, how to get it updated
        # disposition dead code in download_teryt seems a good way
        raw_bytes = ctx.zip_reader.open(
            teryt_data.downloaded_path, "r", subfile="TERC_Urzedowy_2025-11-15.csv"
        )
        data = pd.read_csv(
            raw_bytes, sep=";", dtype={"WOJ": str, "POW": str, "GMI": str, "RODZ": str}
        )

        wojewodztwa_df = data[data["POW"].isna() & data["GMI"].isna()]
        self.wojewodztwa = {
            row[1] + "00": row[5] for row in wojewodztwa_df.itertuples()
        }

        powiaty_df = data[data["GMI"].isna() & ~data["POW"].isna()]
        self.powiaty = {row[1] + row[2]: row[5] for row in powiaty_df.itertuples()}

        self.TERYT = {
            **self.wojewodztwa,
            **self.powiaty,
        }

        # TODO extend it as well
        self.cities_to_teryt = {
            city: teryt for teryt, city in self.TERYT.items() if city[0].isupper()
        }
        self.cities_to_teryt["Sieradz"] = "1014"
        self.cities_to_teryt["Chrzanów"] = "1203"
        self.cities_to_teryt["Piła"] = "3019"
        self.cities_to_teryt["Ciechanów"] = "1402"

        self.voj_lower_to_teryt = {
            voj.lower(): teryt[:2]
            for teryt, voj in self.TERYT.items()
            if teryt[2:] == "00"
        }

    def parse_teryt(self, voj: str, pow: str, gmin: str, city: str):
        voj = voj.lower()
        return self.voj_lower_to_teryt[voj]
