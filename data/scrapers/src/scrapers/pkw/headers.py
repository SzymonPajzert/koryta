from dataclasses import dataclass
import typing


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
    "Gmina": None,
    "Województwo": None,
    "Urząd": SetField("position"),
    "Powiat": None,
    "Rada": None,
    "Sejmik": SetField("position", processor=lambda x: "Rada sejmiku"),
    # Success, position in the party
    # TODO Capture the success
    "Czy uzyskał mandat": SetField(
        "candidacy_success", lambda x: "TRUE" if x == "Tak" else "FALSE"
    ),
    "Czy przyznano mandat": SetField(
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

CSV_HEADERS_2018 = {
    "Jednostka": None,
    "Szczebel": None,
    "Imię": SetField("first_name"),
    "Drugie imię": SetField("middle_name"),
    "Tura": None,
    "Wybrany": SetField(
        "candidacy_success", lambda x: "TRUE" if x == "Tak" else "FALSE"
    ),
    "Członek\npartii": SetField("party_member"),
    "Typ": None,
    "Liczba\ngłosów": None,
    "Rodzaj\ngminy": None,
    "TERYT\nm. zam.": SetField("teryt_living"),
    "Gł. ważne": None,
    "Gmina\nzam.": None,
    "Gm. zam.": None,
    'Głosy\n"za"\'': None,
    'Głosy\n"za"': None,
    'Głosy\n"przeciw"': None,
    "Miejsce\nzam.": None,
    "Miejsce\nzamieszkania": None,
    "%": None,
}

CSV_HEADERS_2011 = {
    "Siedziba OKW": None,
    "Nr kandydata na liście": None,
    "Partia polityczna": SetField("party_member"),
    "Treść oświadczenia lustracyjnego": None,
    "Numer_na_karcie": None,
    "Typ komitetu": None,
    "% głosów w okręgu": None,
    "% głosów na listę": None,
}

CSV_HEADERS_2019 = {
    "Siedziba OKW": None,
    "Nr listy (po nadaniu)": None,
    "Sygnatura": None,
    "Gmina m.z.": None,
    "Numer okręgu": None,
    "Numer listy": None,
    "Nazwa": None,
    "Typ": None,
    "Numer na liście": None,
    "Kod TERYT": SetField("teryt_candidacy"),
    "Gmina miejsca zamieszkania": None,
    "Miejscowość zamieszkania": None,
}

CSV_HEADERS_2010 = {
    "Okręg": None,
    "Pozycja": None,
    "Płeć": SetField("sex", parse_sex),
    "Partia": SetField("party_member"),
    "Teryt m. z.": SetField("teryt_living"),
    "Gmina zam.": None,
    "Oświadczenie": None,
    "Płec": None,
    "Plec": None,
    "L. głosów": None,
    "% gł. w okręgu": None,
    "Lista": None,
    "% głosów": None,
}

CSV_HEADERS_2007 = {
    "Nr\nokregu": None,
    "Siedziba \nOKW": None,
    "Numer \nlisty": None,
    "Nazwa \nkomitetu": None,
    "Numer \nna liscie": None,
    "Imię (imiona)": SetField("first_name"),
    "miejscowość \nzamieszkania": None,
    "Nr \nokregu": None,
    "Siedziba\nOKW": None,
    "Miejscowość \nzamieszkania": None,
}


CSV_HEADERS = {
    **CSV_HEADERS_2024,
    **CSV_HEADERS_2006,
    **CSV_HEADERS_2014,
    **CSV_HEADERS_2015,
    **CSV_HEADERS_2018,
    **CSV_HEADERS_2011,
    **CSV_HEADERS_2019,
    **CSV_HEADERS_2010,
    **CSV_HEADERS_2007,
}
