import pytest

from scrapers.krs.process import KRS, iterate_blobs
from analysis.people import find_all_matches, con
from util.config import versioned


# TODO return to 11, so we can better tune the wiki algorithm
SCORE_CUTOFF = 11


df_all = find_all_matches(con)
df = df_all[df_all["overall_score"] >= SCORE_CUTOFF]


scraped_krs = set(KRS.from_blob_name(blob) for blob, _ in iterate_blobs())


class Person:
    krs_name: str
    pkw_name: str
    any: str = ""

    def __init__(self, krs_name: str = "", pkw_name: str = "", any: str = ""):
        self.krs_name = krs_name
        self.pkw_name = pkw_name
        self.any = any


def find_column_match(column, name):
    name = name.replace(" ", " .*")
    return len(df[df[column].str.match(name, na=False)]) > 0


def exists_in_output(person: Person):
    if person.any != "":
        krs_match = find_column_match("krs_name", person.any)
        pkw_match = find_column_match("pkw_name", person.any)
        wiki_match = find_column_match("wiki_name", person.any)
        return krs_match or pkw_match or wiki_match

    krs_match = df.loc[df["krs_name"] == person.krs_name]
    pkw_match = df.loc[df["pkw_name"] == person.pkw_name]
    return len(krs_match) > 0 and len(pkw_match) > 0


def test_included_matches():
    assert exists_in_output(Person(any="Wojciech Bartelski"))
    assert exists_in_output(Person(any="Tomasz Mencina"))
    # is a lawyer in wiki, but also connected to PiS
    assert exists_in_output(Person(any="Grzegorz Pastuszko"))


def test_excluded_people():
    assert not exists_in_output(
        Person(krs_name="Magdalena Stanilewicz", pkw_name="STANKIEWICZ Magdalena Anna")
    )
    assert not exists_in_output(
        Person(krs_name="Dariusz Jerzy Kowalczyk", pkw_name="KOWALCZYK Dariusz Anatol")
    )


def test_bip_warszawa():
    assert exists_in_output(Person(any="Agata Marciniak-Różak"))
    # We should scrape people from bip somehow, but they work in smaller places and they're not even in krs
    assert False  # Does it work?


def test_not_duplicated():
    df.groupby("krs_name")
    df.groupby("pkw_name")
    assert False  # If someone has multiple lines (many years in PKW, join them)


def test_ignore_false_positives():
    assert False
    # TODO Watch out to also not scrape https://pl.wikipedia.org/wiki/%C5%81ukasz_Krawiec
    # Check for death, usually it's safe to not add them.
    # TODO This is also a fake - https://pl.wikipedia.org/wiki/Jerzy_Skrzypek


def test_missing_kaminska():
    assert False  # 1200071 - rejestr.io - Agnieszka Kamińska - jest na stronie i w rejestrze krs


def test_second_names_match():
    # TODO wiki_people Marek Tomasz Pawłowski wrong first/last name split
    assert False


def test_nepotism_by_surname():
    pass
    # TODO Agnelika Rybak Gawkowska - WKD, żona Gawkowskiego
    # TODO Jacek Pużuk - mąż, Szpital Grochowski


def test_warszawa_bip():
    pass
    # TODO Marek Chmurski jest pełnomocnikiem prezydenta miasta ds. rozowju struktury kolejowej. To wygląda jak jakieś sztuczne stanowisko żeby mu pensję dołożyć


def test_lawyers():
    pass
    # TODO Check that people have interesting mentions on their pages, e.g. Pastuszko
    # Another interesting is Krzysztof Czeszejko-Sochacki
    # https://pl.wikipedia.org/wiki/Krzysztof_Czeszejko-Sochacki
    # TODO Find another lawyer and ignore them if they have a specialty


def file_lines(filename):
    with open(versioned.get_path(filename)) as people_list:
        for line in people_list:
            yield line.strip()


@pytest.mark.parametrize("person", file_lines("psl_lista.txt"))
def test_list_psl(person):
    person = Person(any=person)
    assert exists_in_output(person)


@pytest.mark.parametrize("person", file_lines("stop_pato_lista.txt"))
def test_list_stop_pato(person):
    person = Person(any=person)
    assert exists_in_output(person)


@pytest.mark.parametrize(
    "krs",
    [
        "23302",
        "140528",
        "489456",
        "0000512140",
        "271591",
        "0000028860",
        "0000025667",
        "0000204527",
    ],
)
def test_krs_present(krs):
    krs = KRS(krs)
    assert krs in scraped_krs


people = {
    "Paweł Olejnik": [
        "https://pl.wikipedia.org/w/index.php?title=Zak%C5%82ad_Emerytalno-Rentowy_Ministerstwa_Spraw_Wewn%C4%99trznych_i_Administracji&oldid=48854108 - I could go through the wiki entries and historical and extract that he worked there in 2016",
        "He's also present in a few local companies, so it's a good thing we could check as well",
        "https://www.polityka.pl/tygodnikpolityka/kraj/1742066,1,uzbrojenie-polskiej-armii-w-rekach-fana-fantasy.read"
        "He is in KRS",
        "No entries in PKW nor Wiki",
        " W latach 2016-2018 pracował w Ministerstwie Spraw Wewnętrznych i Administracji jako szef Centrum Personalizacji Dokumentów i dyrektor Zakładu Emerytalno-Rentowego MSWiA.",
        "https://radar.rp.pl/przemysl-obronny/art18571951-zmiana-w-skladzie-zarzadu-polskiej-grupy-zbrojeniowej",
        "Found an article - https://tygodnikits.pl/z-miasta-do-miasta/ar/9080494.",
    ]
}

# Kazimierz Chroma https://www.dziennikwschodni.pl/lublin/nowi-szefowie-w-agencjach-dwaj-dyrektorzy-z-pis,n,1000175691.html
# Piotr Breś https://www.dziennikwschodni.pl/polityka/nasze-tluste-koty,n,1000292595.html - dyrektor totalizator sportowy
# Jan Szewczak https://www.dziennikwschodni.pl/polityka/nasze-tluste-koty,n,1000292595.html
# Renata Stefaniuk https://www.dziennikwschodni.pl/polityka/nasze-tluste-koty,n,1000292595.html
# Leszek Daniewski https://www.dziennikwschodni.pl/lubelskie/zmiany-w-agencjach-rolniczych-w-lubelskiem-kto-moze-zostac-dyrektorem,n,1000172597.html
# Krzysztof Figat - Chyba znalazłem nowego przypadkiem - https://tygodniksiedlecki.com/artykul/antoni-jozwowicz-prezesem-n1424927
# Zofia Paryła - Has wiki page with mentions - https://pl.wikipedia.org/wiki/Zofia_Pary%C5%82a#cite_ref-Krewni_2-1,  https://krakow.wyborcza.pl/krakow/7,44425,26834696,szkola-kariery-daniela-obajtka-bliscy-i-znajomi-prezesa-orlenu.html#s=S.embed_link-K.C-B.1-L.4.zw, friend of Obajtek, mentioned on the wiki
# Parse refs from people's page's, e.g Zofia's so you can feed them to the crawler.
# Mateusz Siepielski, wiceburmistrz Śródmieścia 2015
# Joanna Gepfert - https://pl.wikipedia.org/wiki/Instytut_De_Republica
# Energa was missing - https://pl.wikipedia.org/wiki/Energa, even though it's owned by Orlen
# Grzegorz Janik - Elections 2002, Parlimentary from 2005. Bonus points - CBA investigation - https://pl.wikipedia.org/wiki/Grzegorz_Janik.
# Małgorzata Zarychta-Surówka - Elections 2006, probably 2018.
# Janusz Smoliło - Elections in 2014 and 2018.
# Anna Adamczyk - 140528 needs to be scraped from krs
# Marcin Chludziński - not in wiki, but there are articles about him that he's somehow connected. Actually, it mentions Fundacja Republikańska
# Andrzej Kisielewicz - EU parliment elections are missing
# https://pl.wikipedia.org/wiki/Pawe%C5%82_Gruza, 2002 election, present in wiki non politician but it mentions the page.
