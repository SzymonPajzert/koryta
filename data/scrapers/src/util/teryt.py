import pandas as pd
from zipfile import ZipFile

from stores.download import download_teryt, FileSource

teryt_data = FileSource(
    "https://eteryt.stat.gov.pl/eTeryt/rejestr_teryt/udostepnianie_danych/baza_teryt/uzytkownicy_indywidualni/pobieranie/pliki_pelne.aspx",
    "teryt_codes.zip",
    download_teryt,
)

if not teryt_data.downloaded():
    teryt_data.download()

raw_bytes = ZipFile(teryt_data.downloaded_path, "r").open(
    # TODO the date is hardcoded now, how to get it updated
    # disposition dead code in download_teryt seems a good way
    "TERC_Urzedowy_2025-11-15.csv",
    "r",
)
data = pd.read_csv(
    raw_bytes, sep=";", dtype={"WOJ": str, "POW": str, "GMI": str, "RODZ": str}
)

wojewodztwa_df = data[data["POW"].isna() & data["GMI"].isna()]
wojewodztwa = {row[1] + "00": row[5] for row in wojewodztwa_df.itertuples()}

powiaty_df = data[data["GMI"].isna() & ~data["POW"].isna()]
powiaty = {row[1] + row[2]: row[5] for row in powiaty_df.itertuples()}

TERYT = {
    **wojewodztwa,
    **powiaty,
}

# TODO extend it as well
cities_to_teryt = {city: teryt for teryt, city in TERYT.items() if city[0].isupper()}
cities_to_teryt["Sieradz"] = "1014"
cities_to_teryt["Chrzanów"] = "1203"
cities_to_teryt["Piła"] = "3019"
cities_to_teryt["Ciechanów"] = "1402"


voj_lower_to_teryt = {
    voj.lower(): teryt[:2] for teryt, voj in TERYT.items() if teryt[2:] == "00"
}


def parse_teryt(voj: str, pow: str, gmin: str, city: str):
    voj = voj.lower()
    return voj_lower_to_teryt[voj]
