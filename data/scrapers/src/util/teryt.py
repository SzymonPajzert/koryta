import pandas as pd
from zipfile import ZipFile

from util.download import download_teryt, FileSource

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
powiaty_df = data[data["GMI"].isna() & ~data["POW"].isna()]
powiaty = {row[1] + row[2]: row[5] for row in powiaty_df.itertuples()}
print(powiaty_df)
print(powiaty["0261"])


TERYT = {
    **powiaty,
    "0261": "Jelenia Góra",
    "0262": "Legnica",
    "0264": "Wrocław",
    "0265": "Wałbrzych",
    "0265": "Wałbrzych",
    "0461": "Bydgoszcz",
    "0462": "Grudziądz",
    "0463": "Toruń",
    "0464": "Włocławek",
    "0600": "lubelskie",
    "0601": "powiat bialski",
    "0602": "powiat biłgorajski",
    "0603": "powiat chełmski",
    "0604": "powiat hrubieszowski",
    "0605": "powiat janowski",
    "0606": "powiat krasnostawski",
    "0607": "powiat kraśnicki",
    "0608": "powiat lubartowski",
    "0609": "powiat lubelski",
    "0610": "powiat łęczyński",
    "0611": "powiat łukowski",
    "0612": "powiat opolski",
    "0613": "powiat parczewski",
    "0614": "powiat puławski",
    "0615": "powiat radzyński",
    "0616": "powiat rycki",
    "0617": "powiat świdnicki",
    "0618": "powiat tomaszowski",
    "0619": "powiat włodawski",
    "0620": "powiat zamojski",
    "0661": "Biała Podlaska",
    "0662": "Chełm",
    "0663": "Lublin",
    "0664": "Zamość",
    "0861": "Gorzów Wielkopolski",
    "0862": "Zielona Góra",
    "1000": "łódzkie",
    "1001": "powiat bełchatowski",
    "1002": "powiat kutnowski",
    "1003": "powiat łaski",
    "1004": "powiat łęczycki",
    "1005": "powiat łowicki",
    "1006": "powiat łódzki wschodni",
    "1007": "powiat opoczyński",
    "1008": "powiat pabianicki",
    "1009": "powiat pajęczański",
    "1010": "powiat piotrkowski",
    "1011": "powiat poddębicki",
    "1012": "powiat radomszczański",
    "1013": "powiat rawski",
    "1014": "powiat sieradzki",
    "1015": "powiat skierniewicki",
    "1016": "powiat tomaszowski",
    "1017": "powiat wieluński",
    "1018": "powiat wieruszowski",
    "1019": "powiat zduńskowolski",
    "1020": "powiat zgierski",
    "1021": "powiat brzeziński",
    "1061": "Łódź",
    "1062": "Piotrków Trybunalski",
    "1063": "Skierniewice",
    "1200": "małopolskie",
    "1201": "powiat bocheński",
    "1202": "powiat brzeski",
    "1203": "powiat chrzanowski",
    "1204": "powiat dąbrowski",
    "1205": "powiat gorlicki",
    "1206": "powiat krakowski",
    "1207": "powiat limanowski",
    "1208": "powiat miechowski",
    "1209": "powiat myślenicki",
    "1210": "powiat nowosądecki",
    "1211": "powiat nowotarski",
    "1212": "powiat olkuski",
    "1213": "powiat oświęcimski",
    "1214": "powiat proszowicki",
    "1215": "powiat suski",
    "1216": "powiat tarnowski",
    "1217": "powiat tatrzański",
    "1218": "powiat wadowicki",
    "1219": "powiat wielicki",
    "1261": "Kraków",
    "1261": "Kraków",
    "1262": "Nowy Sącz",
    "1262": "Nowy Sącz",
    "1263": "Tarnów",
    "1263": "Tarnów",
    "1461": "Ostrołęka",
    "1462": "Płock",
    "1463": "Radom",
    "1464": "Siedlce",
    "1465": "Warszawa",
    "1661": "Opole",
    "1861": "Krosno",
    "1862": "Przemyśl",
    "1863": "Rzeszów",
    "1864": "Tarnobrzeg",
    "2061": "Białystok",
    "2062": "Łomża",
    "2063": "Suwałki",
    "2261": "Gdańsk",
    "2262": "Gdynia",
    "2263": "Słupsk",
    "2264": "Sopot",
    "2461": "Bielsko-Biała",
    "2462": "Bytom",
    "2463": "Chorzów",
    "2464": "Częstochowa",
    "2465": "Dąbrowa Górnicza",
    "2466": "Gliwice",
    "2467": "Jastrzębie-Zdrój",
    "2468": "Jaworzno",
    "2469": "Katowice",
    "2470": "Mysłowice",
    "2471": "Piekary Śląskie",
    "2472": "Ruda Śląska",
    "2473": "Rybnik",
    "2474": "Siemianowice Śląskie",
    "2475": "Sosnowiec",
    "2476": "Świętochłowice",
    "2477": "Tychy",
    "2478": "Zabrze",
    "2479": "Żory",
    "2661": "Kielce",
    "2861": "Elbląg",
    "2862": "Olsztyn",
    "3061": "Kalisz",
    "3062": "Konin",
    "3063": "Leszno",
    "3064": "Poznań",
    "3261": "Koszalin",
    "3262": "Szczecin",
    "3263": "Świnoujście",
}

# TODO extend it as well
cities_to_teryt = {city: teryt for teryt, city in TERYT.items() if city[0].isupper()}
cities_to_teryt["Sieradz"] = "1014"
cities_to_teryt["Chrzanów"] = "1203"
cities_to_teryt["Piła"] = "3019"
cities_to_teryt["Ciechanów"] = "1402"


voj_lower_to_teryt = {
    voj.lower(): teryt[:2] for teryt, voj in TERYT.items() if teryt[2:] == ["00"]
}


def parse_teryt(voj: str, pow: str, gmin: str, city: str):
    voj = voj.lower()
    return voj_lower_to_teryt[voj]
