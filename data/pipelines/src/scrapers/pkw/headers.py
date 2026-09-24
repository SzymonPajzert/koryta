import typing
from dataclasses import dataclass
from typing import Any, Never

from scrapers.map.teryt import Teryt
from scrapers.pkw.elections import ElectionType
from scrapers.pkw.okregi import voting_district_to_city


@dataclass
class SetField:
    name: str
    processor: typing.Callable[[str, Any], str] = lambda x, _: x
    skippable: bool = False

    def set_teryt(self, teryt: Teryt):
        self.teryt = teryt
        return self

    def from_teryt(self, func) -> "SetField":
        self.processor = lambda x, y: func(self.teryt, x, y)
        return self


@dataclass
class ElectionContext:
    year: int
    election_type: ElectionType


def const_processor(value: str) -> typing.Callable[[str, Any], str]:
    return lambda _0, _1: value


def parse_sex(s: str, _: Never) -> str:
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


def parse_yes_no(s: str, _: Never) -> str:
    if s != s:
        return "FALSE"

    match s:
        case "Tak":
            return "TRUE"
        case "Nie":
            return "FALSE"
        case "N":
            return "FALSE"
        case "T":
            return "TRUE"
        case "2":
            return "FALSE"
        case "nan":
            return "FALSE"
        case "2 tura":
            return "FALSE"

    raise ValueError(f"Unknown bool: {s}")


def parse_mandate(s: str, _: Never) -> str:
    """
    Read the `Mandat` column of a candidate list.

    It is not a yes/no: PKW writes a letter naming *how* the seat was taken
    and leaves everyone else either blank or `N`. Measured over every source
    that carries the column, the whole vocabulary is
    `T`/`W`/`G`/`B`/`L`/`P`/`O`/`K`/`N`, and each letter but the last is a
    seat:

    - `T` tak, `W` wybrany, `G` wybrany w głosowaniu -- the ordinary win;
    - `B` bez głosowania, where a district fielded no more candidates than it
      had seats, so nobody voted. These rows carry no vote count at all;
    - `L` w losowaniu, a tie broken by drawing lots;
    - `P` pierwszeństwo, a tie settled before it came to lots - "wybrany w
      drodze pierwszeństwa do uzyskania mandatu przy remisie", as PKW's page
      for the 1998 workbook defines it. All 109 `P` rows there are level on
      votes with a candidate in the same district marked `N`;
    - `O`/`K` z listy okręgowej / z listy krajowej, how the pre-2001 Sejm
      files distinguish the two halves of the chamber.

    `2` is not a letter but it is not a seat either: the 2006 wójt file gives
    every candidate one row per round, and writes `2` into the first-round row
    of anybody who went through to the second. Their result is on their
    second-round row. The 2002 file writes `N` in the same place, so the
    first-round row reads as not elected there too.

    A blank means a loss, not an unknown. In 2018 `T` (43,683) plus `B`
    (3,062) is exactly the 46,745 rows of `2018-radni.xlsx`, the separate
    list of who was elected, and every blank row is absent from it. The
    letter counts line up the same way elsewhere: `O` + `K` is 391 + 69 = 460
    Sejm seats in 1991, 1993 and 1997, `T` is 100 senators, and `T` is 54/50/51
    MEPs in 2004/2009/2014.
    """
    if s is None or s != s:  # None, or a pandas NaN
        return "FALSE"

    match str(s).strip():
        case "T" | "W" | "G" | "B" | "L" | "P" | "O" | "K":
            return "TRUE"
        case "N" | "" | "nan" | "2":
            return "FALSE"

    raise ValueError(f"Unknown mandate: {s!r}")


def lookup_teryt_from_city(teryt, city: str, _: None) -> str:
    # Remove trailing roman numerals, e.g. Warszawa II
    city = city.rstrip("I").rstrip()
    try:
        return teryt.cities_to_teryt[city][:2]
    except KeyError:
        raise ValueError(f"Unknown voting district: {city}")


def lookup_teryt(teryt: Teryt, s: str, context: ElectionContext) -> str:
    if context.election_type in [ElectionType.SAMORZADOWE, ElectionType.EUROPARLAMENT]:
        return ""  # We don't support looking up for samorządowe
    year = context.year
    if year < 2000:
        return ""  # Bigger than wojs
    if year in [2001, 2005]:
        # https://pl.wikipedia.org/wiki/Okr%C4%99g_wyborczy_nr_1_do_Sejmu_Rzeczypospolitej_Polskiej
        year = 2007
    try:
        mapping = voting_district_to_city[year, context.election_type]
    except KeyError:
        raise ValueError(f"Unknown election: {context.year} {context.election_type}")
    return lookup_teryt_from_city(teryt, str(mapping[int(s)]), None)


CSV_HEADERS: dict[str, SetField | None] = {
    'Głosy\n"przeciw"': None,
    'Głosy\n"za"': None,
    'Głosy\n"za"\'': None,
    'Zero "x"': None,
    "% gł. odd. na listę": None,
    "% gł. w okręgu": None,
    "% głosów na listę": None,
    "% głosów w okręgu": None,
    "% głosów": None,
    "% głosów\nna listę": None,
    "% głosów\nw okręgu": None,
    "%": None,
    "1. imie": SetField("first_name"),
    "1. Imie": SetField("first_name"),
    "1. imię": SetField("first_name"),
    "1. Imię": SetField("first_name"),
    "2. imie": SetField("middle_name"),
    "2. Imie": SetField("middle_name"),
    "2. imię": SetField("middle_name"),
    "2. Imię": SetField("middle_name"),
    "Adres": None,
    "Afiliacja": SetField("party_member"),
    "Członek Mandat": None,
    "Członek": None,
    "Członek\npartii": SetField("party_member"),
    "Czy przyznano mandat": SetField("candidacy_success", parse_yes_no),
    "Czy uzyskał mandat": SetField("candidacy_success", parse_yes_no),
    "Czy uzyskał prawo kandydowania w drugiej turze": None,
    "Dane  Imona": SetField("first_name"),
    "Dane  L.głosów": None,
    "Dane  Nazwisko": SetField("last_name"),
    "Dane  Płeć": SetField("sex"),
    "Dane  prefix nazwiska": None,
    "Dane  Wiek": SetField("age"),
    "Dane Imiona": SetField("first_name"),
    "Dane Nazwisko": SetField("last_name"),
    "Dane Płeć": SetField("sex"),
    "Dane Syn": None,
    "Dane Wiek": SetField("age"),
    "Data\nwyboru II tura": None,
    "Drugie imię": SetField("middle_name"),
    "Dzielnica": SetField("position", const_processor("Rada dzielnicy")),
    "Frekw.": None,
    "Frekwencja": None,
    "Glosy": None,
    "Gł. bez wyb.": None,
    "Gł. kand.": None,
    "Gł. na kand.": None,
    "Gł. na listę": None,
    "Gł. w okr.": None,
    "Gł. ważn.": None,
    "Gł. ważne": None,
    "Gł. ważne\nw okręgu": None,
    "Gł.": None,
    "Gł.\nna listę": None,
    "Gł.\nw okręgu": None,
    "Głos w okr.": None,
    "Głosy I tura": None,
    "Głosy II tura": None,
    "Głosy na listę": None,
    "Głosy w okręgu": None,
    "Głosy": None,
    "Gm. zam.": None,
    "Gmina m. z.": None,
    "Gmina m. zam.": None,
    "Gmina m.z.": None,
    "Gmina Mandat": None,
    "Gmina miejsca zamieszkania": None,
    "Gmina nazwa": None,
    "Gmina powiat": None,
    "Gmina TERYT": SetField("teryt_candidacy"),
    "Gmina urząd": SetField("position"),
    "Gmina województwo": None,
    "Gmina zam.": None,
    "Gmina": None,
    "Gmina\nzam.": None,
    "I tura %\ngłosów": None,
    "I tura Gł. na\nkand.": None,
    "I tura Gł. wazne": None,
    "I tura Gł.\nprzeciw": None,
    "I tura Mandat": None,
    "Id kand Mandat": None,
    "ID kand.": None,
    "Id kom Mandat": None,
    "Id listy": None,
    "Id okr.": None,
    "Id partii": SetField("party_member"),
    "II tura %\ngłosów": None,
    "II tura Gł. na\nkand.": None,
    "II tura Gł. wazne": None,
    "II tura Gł.\nprzeciw": None,
    "II tura Mandat": None,
    "Imię (imiona)": SetField("first_name"),
    "Imię": SetField("first_name"),
    "Imiona Mandat": SetField("first_name"),
    "Imiona": SetField("first_name"),
    "Jednostka": None,
    "Kandydat": None,
    "Kod gminy": SetField("teryt_candidacy"),
    "Kod TERYT": SetField("teryt_candidacy"),
    "Komitet  wyborczy": SetField("party"),
    "Komitet lista nr": None,
    "Komitet Mandat": SetField("party"),
    "Komitet Nazwa": SetField("party"),
    "Komitet wyborczy nazwa": None,
    "Komitet wyborczy skrót nazwy": SetField("party"),
    "Komitet wyborczy": SetField("party"),
    "Komitet": SetField("party"),
    "L. gł.": None,
    "L. głosów": None,
    "L. kand._1": None,
    "L. kand.": None,
    "L. mand._1": None,
    "L. mand.": None,
    "Liczba głosów ważnych na wszystkich kandydatów": None,
    "Liczba głosów ważnych oddanych na listę": None,
    "Liczba głosów ważnych oddanych w okręgu": None,
    "Liczba głosów": None,
    "Liczba\ngłosów": None,
    "Lista": None,
    "Lp": None,
    # The same column abbreviated, as the 1998 council workbook heads it.
    "Mand.": SetField("candidacy_success", parse_mandate),
    # Every candidate list that carries this column is a result file: the
    # winners are marked, everyone else is blank or `N`. See parse_mandate.
    "Mandat": SetField("candidacy_success", parse_mandate),
    "Miejce zam.": None,
    "Miejce\n zam.": None,
    "Miejsce zam.": None,
    "Miejsce zamieszkania Miejscowość": None,
    "Miejsce zamieszkania TERYT": None,
    "Miejsce zamieszkania": None,
    "Miejsce\nzam.": None,
    "Miejsce\nzamieszkania": None,
    "miejscowość \nzamieszkania": None,
    "Miejscowość \nzamieszkania": None,
    "Miejscowość Mandat": None,
    "Miejscowość zamieszkania": None,
    "Miejscowość": None,
    "Mieszka": None,
    "Należy do partii politycznej": None,
    "Nawisko": SetField("last_name"),
    "Nazwa \nkomitetu": SetField("party"),
    "Nazwa komitetu": SetField("party"),
    "Nazwa partii.organizacji popierającej kandydata": SetField("party_member"),
    "Nazwa partii/organizacji popierającej kandydata": SetField("party_member"),
    "nazwa": None,
    "Nazwa": None,
    "Nazwisko i imiona": SetField("pkw_name"),
    "Nazwisko Mandat": SetField("last_name"),
    "Nazwisko": SetField("last_name"),
    "Nieważne": None,
    "Nr \nokregu": None,
    "Nr kandydata na liście": None,
    "Nr listy (po nadaniu)": None,
    "Nr listy": None,
    "Nr na liście\noglnp.": None,
    "Nr okr.": SetField("teryt_candidacy", skippable=True).from_teryt(lookup_teryt),
    "Nr okręgu": SetField("teryt_candidacy", skippable=True).from_teryt(lookup_teryt),
    "Nr poz.": None,
    "Nr pozycji": None,
    "Nr woj.": None,
    "Nr": None,
    "Nr\nkand.": None,
    "Nr\nlisty": None,
    "Nr\nna liście": None,
    "Nr\nna liście\noglnp.": None,
    "Nr\nokr.": None,
    "Nr\nokregu": None,
    "Nr\nwoj.": None,
    "Numer \nlisty": None,
    "Numer \nna liscie": None,
    "Numer listy": None,
    "Numer na karcie do głosowania": None,
    "Numer na liście": None,
    "Numer okręgu": None,
    "Numer_na_karcie": None,
    "Ob.": None,
    "Obszar": None,
    "Obwód": None,
    "Obywatelstwo": None,
    "Odd.": None,
    "Oddane": None,
    "Okręg": SetField("teryt_candidacy", skippable=True).from_teryt(lookup_teryt),
    "Opis": None,
    "Oświadczenie": None,
    "Oznaczenie": None,
    "Partia polityczna TERYT": None,
    "Partia polityczna": SetField("party_member"),
    "Partia": SetField("party_member"),
    "Plec": SetField("sex", parse_sex),
    "Płec": None,
    "Płeć Mandat": SetField("sex"),
    "Płeć": SetField("sex", parse_sex),
    "Poparcie Mandat": None,
    "Poparcie TERYT": None,
    "Poparcie": None,
    "Powiat Mandat": None,
    "powiat": None,
    "Powiat": None,
    "Poz.": None,
    "Pozycja na liście": None,
    "Pozycja": None,
    "Procent głosów oddanych na listę": None,
    "Procent głosów oddanych w okręgu": None,
    "Procent głosów": None,
    "Przynależność do partii": SetField("party_member"),
    "Rada Nazwa": None,
    "Rada Okręg nr": None,
    "Rada Rada": None,
    "Rada TERYT": SetField("teryt_candidacy"),
    "Rada": None,
    "Rodzaj\ngminy": None,
    "Sejmik": SetField("position", const_processor("Rada sejmiku")),
    # We're skipping Siedziba, because for some of them, TERYT is set instead
    "Siedziba \nOKW": SetField("teryt_candidacy", skippable=True).from_teryt(
        lookup_teryt_from_city
    ),
    "Siedziba OKW": SetField("teryt_candidacy", skippable=True).from_teryt(
        lookup_teryt_from_city
    ),
    "Siedziba": SetField("teryt_candidacy", skippable=True).from_teryt(
        lookup_teryt_from_city
    ),
    "Siedziba\nOKW": SetField("teryt_candidacy", skippable=True).from_teryt(
        lookup_teryt_from_city
    ),
    "Skrót nazwy komitetu": SetField("party", skippable=True),
    "Sygnatura": None,
    "Syn": None,
    "Szczebel": None,
    "Teryt  m. zam. Mandat": SetField("teryt_living"),
    "TERYT Dzielnicy": SetField("teryt_candidacy"),
    "TERYT Gminy": SetField("teryt_candidacy"),
    "Teryt m. z.": SetField("teryt_living"),
    "Teryt m.z.": SetField("teryt_living"),
    "TERYT m. z.": SetField("teryt_living"),
    "TERYT Mandat": SetField("teryt_candidacy"),
    "TERYT Powiatu": SetField("teryt_candidacy"),
    "TERYT Województwa": SetField("teryt_candidacy"),
    "TERYT": SetField("teryt_candidacy"),
    "TERYT\nm. zam.": SetField("teryt_living"),
    "Treść oświadczenia lustracyjnego": None,
    "Tura": None,
    "Typ kom.": None,
    "Typ komitetu": None,
    "Typ Mandat": None,
    "Typ_1": None,
    "Typ": None,
    "Umiona": SetField("first_name"),
    "Upr.": None,
    "Urząd Mandat": None,
    "Urząd": SetField("position"),
    "Wazne w okr.": None,
    "Ważne": None,
    "Wiek Mandat": SetField("age"),
    "Wiek_1": None,
    "Wiek.1": None,
    "Wiek": SetField("age"),
    "województwo": None,
    "Województwo": None,
    "Wybrany": SetField("candidacy_success", parse_yes_no),
    "Wykształcenie Mandat": None,
    "Wykształcenie TERYT": None,
    "Wykształcenie": None,
    "Zawod": None,
    "Zawód": None,
}
