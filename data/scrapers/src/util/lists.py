import regex as re
from itertools import chain

# Which wiki files should be saved locally for easier testing
TEST_FILES = {
    "Józef Śliwa",
    "PERN",
    "Telewizja Polska",
}

# TODO match upper/lower case automatically?
WIKI_PUBLIC_COMPANY_LINKS = {
    "jednoosobowa spółka Skarbu Państwa",
    "Jednoosobowa spółka Skarbu Państwa",
    "Skarb państwa",
}

# Which categories/links are marking a wiki page as political
WIKI_POLITICAL_LINKS = {
    "Kancelaria Prezesa Rady Ministrów",
    "Sejm Rzeczypospolitej Polskiej",
    "Ministerstwo Skarbu Państwa",
    "wojewoda",
    "polityk",
    "gmina wiejska",
    "marszałek województwa",
    "Wybory parlamentarne w Polsce w 2007 roku",
    "Prawo i Sprawiedliwość",
    "Posłowie na Sejm Rzeczypospolitej Polskiej V kadencji (2005–2007)",
    "Polska Rzeczpospolita Ludowa",
    "Senat Rzeczypospolitej Polskiej",
    "Wybory parlamentarne w Polsce w 2005 roku",
    "Platforma Obywatelska",
    "Parlament Europejski",
    "Polska Zjednoczona Partia Robotnicza",
    "Posłowie na Sejm Rzeczypospolitej Polskiej IV kadencji (2001–2005)",
    "Wybory parlamentarne w Polsce w 2011 roku",
    "Sojusz Lewicy Demokratycznej",
    "Posłowie na Sejm Rzeczypospolitej Polskiej VI kadencji",
    "Niezależny Samorządny Związek Zawodowy „Solidarność”",
    "Wybory parlamentarne w Polsce w 2001 roku",
    "Wybory parlamentarne w Polsce w 2015 roku",
    "Kategoria:Posłowie na Sejm Rzeczypospolitej Polskiej VI kadencji",
    "Posłowie na Sejm Rzeczypospolitej Polskiej VII kadencji",
    "Prezydent Rzeczypospolitej Polskiej",
    "Polskie Stronnictwo Ludowe",
    "Akcja Wyborcza Solidarność",
    "Posłowie na Sejm Rzeczypospolitej Polskiej III kadencji (1997–2001)",
    "Kategoria:Politycy Prawa i Sprawiedliwości",
    "Wybory parlamentarne w Polsce w 2023 roku",
    "Kategoria:Posłowie na Sejm Rzeczypospolitej Polskiej VII kadencji",
    "Kategoria:Politycy Akcji Wyborczej Solidarność",
    "Posłowie na Sejm Rzeczypospolitej Polskiej II kadencji (1993–1997)",
    "Posłowie na Sejm Rzeczypospolitej Polskiej VIII kadencji",
    "Kategoria:Polscy politycy",
    "Kategoria:Prezydenci Polski",
    "Kategoria:Premierzy Polski",
    "Kategoria:Posłowie na Sejm",
    "Kategoria:Polscy senatorowie",
    "gromada (podział administracyjny)",
    "Gromada (podział administracyjny)",
    "Kategoria:Politycy Platformy Obywatelskiej",
    "Wybory parlamentarne w Polsce w 2019 roku",
    "Koalicja Obywatelska",
    "poseł do Parlamentu Europejskiego",
    "Posłowie na Sejm Rzeczypospolitej Polskiej IX kadencji",
    "wybory parlamentarne w Polsce w 2019 roku",
    "Posłowie na Sejm Rzeczypospolitej Polskiej X kadencji",
    "Kategoria:Posłowie na Sejm Rzeczypospolitej Polskiej VIII kadencji",
    "Kategoria:Politycy SdRP i SLD",
    "Kategoria:Polscy radni rad gmin",
    "samorząd terytorialny",
    "Kategoria:Posłowie na Sejm Rzeczypospolitej Polskiej IX kadencji",
    "Unia Wolności",
    "Andrzej Duda",
    "Wybory parlamentarne w Polsce w 1997 roku",
    "Lech Kaczyński",
    "Kategoria:Posłowie na Sejm Rzeczypospolitej Polskiej X kadencji",
    "Kategoria:Polscy radni rad powiatów",
    "poseł",
    "Samoobrona Rzeczpospolitej Polskiej",
    "Wybory parlamentarne w Polsce w 1993 roku",
    "Bronisław Komorowski",
    "Liga Polskich Rodzin",
    "Wybory samorządowe w Polsce w 2018 roku",
    "Kategoria:Politycy Polskiego Stronnictwa Ludowego",
    "Wybory samorządowe w Polsce w 2010 roku",
    "Posłowie na Sejm Rzeczypospolitej Polskiej I kadencji (1991–1993)",
    "Sejm PRL",
    "wybory parlamentarne w Polsce w 2011 roku",
    "Lewica i Demokraci",
    "Wybory samorządowe w Polsce w 2014 roku",
    "Sojusz Lewicy Demokratycznej – Unia Pracy",
    "Wybory do Parlamentu Europejskiego w Polsce w 2014 roku",
    "Kategoria:Działacze PZPR",
    "Wybory samorządowe w Polsce w 2006 roku",
    "Jarosław Kaczyński",
    "Kategoria:Posłowie na Sejm III Rzeczypospolitej Polskiej",
    "Zjednoczone Stronnictwo Ludowe",
    "Kategoria:Posłowie na Sejm Rzeczypospolitej Polskiej II kadencji (1993–1997)",
    "Lech Wałęsa",
    "Donald Tusk",
    "Aleksander Kwaśniewski",
    "Kategoria:Politycy Unii Wolności",
    "Wybory samorządowe w Polsce w 1998 roku",
    "Wybory do Parlamentu Europejskiego w Polsce w 2024 roku",
    "Wybory samorządowe w Polsce w 2002 roku",
    "Kategoria:Posłowie na Sejm Rzeczypospolitej Polskiej I kadencji (1991–1993)",
    "Trzecia Droga (Polska)",
    "wybory parlamentarne w Polsce w 2015 roku",
    "Wybory parlamentarne w Polsce w 1989 roku",
    "Poseł",
    "Wybory samorządowe w Polsce w 2024 roku",
    "Unia Pracy",
    "prezydent miasta",
    "Wybory parlamentarne w Polsce w 1991 roku",
    "Posłowie na Sejm Polskiej Rzeczypospolitej Ludowej X kadencji",
    "Unia Demokratyczna",
    "Sekretarz stanu (Polska)",
    "Porozumienie Centrum",
    "Kategoria:Polscy posłowie do Parlamentu Europejskiego",
    "burmistrz",
    "Wybory do Parlamentu Europejskiego w Polsce w 2019 roku",
    "Nowa Lewica",
    "Stronnictwo Demokratyczne",
    "Ruch Społeczny (partia polityczna)",
    "Wybory do Parlamentu Europejskiego w Polsce w 2009 roku",
    "senator",
    "Prezydent miasta",
    "Socjaldemokracja Rzeczypospolitej Polskiej",
    "Ministerstwo Spraw Zagranicznych (Polska)",
    "Zjednoczenie Chrześcijańsko-Narodowe",
    "rada gminy",
    "Prezes Rady Ministrów",
    "Kategoria:Posłowie na Sejm kontraktowy",
    "Kategoria:Działacze Zjednoczonego Stronnictwa Ludowego",
    "Stronnictwo Konserwatywno-Ludowe",
    "wybory samorządowe w Polsce w 2006 roku",
    "Kategoria:Polscy urzędnicy samorządowi",
    "Poseł do Parlamentu Europejskiego",
    "Rada Ministrów w Polsce",
    "Nowoczesna",
    "radny",
    "Mateusz Morawiecki",
    "Niezależne Zrzeszenie Studentów",
    "Ministerstwo Spraw Wewnętrznych i Administracji",
    "Ministerstwo Obrony Narodowej",
    "Katastrofa polskiego Tu-154 w Smoleńsku",
    "Marszałek Sejmu Rzeczypospolitej Polskiej",
    "Ministerstwo Kultury i Dziedzictwa Narodowego",
    "Wybory do Parlamentu Europejskiego w Polsce w 2004 roku",
    "Konfederacja Wolność i Niepodległość",
    "Socjaldemokracja Polska",
    "Polska Partia Socjalistyczna",
    "Posłowie do Parlamentu Europejskiego VIII kadencji",
    "wybory samorządowe w Polsce w 2010 roku",
}

PEOPLE_ANNOTATED = {
    "Robert Ciborowski": "listed in stop pato with vague reasons, need to list komitet honorowy kandydata",
    "Sławomir Zawadzki": "should not be in koryta",
    "Andrzej Osiadacz": "should not be in koryta, is an expert",
    "Paweł Olejnik": [
        "https://pl.wikipedia.org/w/index.php?title=Zak%C5%82ad_Emerytalno-Rentowy_Ministerstwa_Spraw_Wewn%C4%99trznych_i_Administracji&oldid=48854108 - I could go through the wiki entries and historical and extract that he worked there in 2016",
        "He's also present in a few local companies, so it's a good thing we could check as well",
        "https://www.polityka.pl/tygodnikpolityka/kraj/1742066,1,uzbrojenie-polskiej-armii-w-rekach-fana-fantasy.read"
        "He is in KRS",
        "No entries in PKW nor Wiki",
        " W latach 2016-2018 pracował w Ministerstwie Spraw Wewnętrznych i Administracji jako szef Centrum Personalizacji Dokumentów i dyrektor Zakładu Emerytalno-Rentowego MSWiA.",
        "https://radar.rp.pl/przemysl-obronny/art18571951-zmiana-w-skladzie-zarzadu-polskiej-grupy-zbrojeniowej",
        "Found an article - https://tygodnikits.pl/z-miasta-do-miasta/ar/9080494.",
    ],
    "Agata Marciniak-Różak": "BIP Warszawa",
    "Agnelika Rybak Gawkowska": "WKD, żona Gawkowskiego - NEPO_SURNAME",
    "Jacek Pużuk": "mąż, Szpital Grochowski - NEPO_SURNAME",
    "Marek Chmurski": [
        "pełnomocniki prezydenta miasta ds. rozowju struktury kolejowej",
        "To wygląda jak jakieś sztuczne stanowisko żeby mu pensję dołożyć",
    ],
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
}

# TODO Ignore failures could be marked only for some tests
# This is a placeholder, because so many people don't match

IGNORE_FAILURES = {m.strip() for m in PEOPLE_ANNOTATED.keys()}
