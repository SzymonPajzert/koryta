import regex as re
from enum import Enum
import io
import csv

# TODO Is there any better way to list upper case characters?
UPPER = "A-ZĘẞÃŻŃŚŠĆČÜÖÓŁŹŽĆĄÁŇŚÑŠÁÉÇŐŰÝŸÄṔÍŢİŞÇİŅ'"

LOWER = UPPER.lower()

MONTH_NUMBER = {
    "styczeń": 1,
    "luty": 2,
    "marzec": 3,
    "kwiecień": 4,
    "maj": 5,
    "czerwiec": 6,
    "lipiec": 7,
    "sierpień": 8,
    "wrzesień": 9,
    "październik": 10,
    "listopad": 11,
    "grudzień": 12,
}

MONTH_NUMBER_GENITIVE = {
    "stycznia": 1,
    "lutego": 2,
    "marca": 3,
    "kwietnia": 4,
    "maja": 5,
    "czerwca": 6,
    "lipca": 7,
    "sierpnia": 8,
    "września": 9,
    "października": 10,
    "listopada": 11,
    "grudnia": 12,
}

TERYT = {
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


cities_to_teryt = {city: teryt for teryt, city in TERYT.items() if city[0].isupper()}
cities_to_teryt["Sieradz"] = "1014"
cities_to_teryt["Chrzanów"] = "1203"
cities_to_teryt["Piła"] = "3019"
cities_to_teryt["Ciechanów"] = "1402"


def csv_to_freq_map(url: str, file_path: str):
    def generator():
        f = open(file_path, "r", encoding="utf-8")
        for line in f.readlines():
            yield line

    first = True
    for line in csv.reader(generator()):
        if first:
            first = False
            continue
        woj = line[0]
        name = line[1]
        count = int(line[2])


class PkwFormat(Enum):
    UNKNOWN = 0
    First_Last = 1
    Last_First = 2
    First_LAST = 3
    LAST_First = 4


def parse_name(pkw_name: str, format: PkwFormat):
    words = pkw_name.split(" ")
    first_name, middle_name, last_name = "", "", ""
    match format:
        case PkwFormat.First_Last:
            last_name = words[-1]
            first_name = words[0]
            if len(words) > 2:
                middle_name = " ".join(words[1:-1])
        case PkwFormat.First_LAST:
            m = re.search(f"((?: [-{UPPER}]+)+)$", pkw_name)
            if not m:
                raise ValueError(f"Invalid name: '{pkw_name}'")
            last_name = m.group(1).strip()
            rest = pkw_name[: -len(m.group(0))].strip()
            if rest:
                names = rest.split(" ")
                first_name = names[0]
                if len(names) > 1:
                    middle_name = " ".join(names[1:])
        case PkwFormat.LAST_First:
            m = re.match(f"((?:[-{UPPER}]+ )+)", pkw_name)
            if not m:
                raise ValueError(f"Invalid name: '{pkw_name}'")
            last_name = m.group(1).strip()
            rest = pkw_name[len(m.group(0)) :].strip()
            if rest:
                names = rest.split(" ")
                first_name = names[0]
                if len(names) > 1:
                    middle_name = " ".join(names[1:])
        case _:
            raise ValueError(f"Unsupported format: {pkw_name}")

    return first_name, middle_name, last_name
