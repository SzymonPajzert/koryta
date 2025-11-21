from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from scrapers.stores import Context

# Which wiki files should be saved locally for easier testing
# You can run scrape_wiki and it will save them locally.
TEST_FILES = {
    # People
    "Józef Śliwa",
    "Marcin Chludziński",
    "Paweł Gruza",
    "Grzegorz Pastuszko",
    "Grzegorz Michał Pastuszko",
    # Companies
    "Agata (przedsiębiorstwo)",
    "Agencja Mienia Wojskowego",
    "Biuro Maklerskie PKO Banku Polskiego",
    "Grupa kapitałowa PWN",
    "Kopalnia Węgla Kamiennego „Śląsk”",
    "Miejski Zakład Komunikacji w Koninie",
    "Miejskie Przedsiębiorstwo Komunikacyjne we Wrocławiu",
    "Orange Polska",
    "PERN",
    "Pesa Mińsk Mazowiecki",
    "PGE Polska Grupa Energetyczna",
    "Pojazdy Szynowe Pesa Bydgoszcz",
    "Polbus-PKS",
    "Polfa Warszawa",
    "Polski Holding Obronny",
    "Port lotniczy Warszawa-Modlin",
    "Stadion Narodowy im. Kazimierza Górskiego w Warszawie",
    "Telewizja Polska",
    "Totalizator Sportowy",
    "Warel",
    "ZE PAK",
}

# TODO match upper/lower case automatically?
WIKI_PUBLIC_COMPANY_LINKS = {
    "jednoosobowa spółka Skarbu Państwa",
    "Jednoosobowa spółka Skarbu Państwa",
    "Skarb państwa",
    "Agencja wykonawcza",
    "Ministerstwo Aktywów Państwowych",
    "Spółka Restrukturyzacji Kopalń",
    "Polski Fundusz Rozwoju",
}

# Which categories/links are marking a wiki page as political
WIKI_POLITICAL_LINKS = {
    "Fundacja Republikańska",
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

# TODO get a counter of how often we have blockers
blockers = {
    "krs scrape": True,
    "crawler": True,
    "wiki extracting people": True,
}

# Whenever we encounter an interesting person, we have a space to put notes about them
# and exclude them from our failing tests.
# The goal is to get to zero test failures, either through
#  - solving the problems
#  - idenfitying issues with them and putthing them here
# Open logseq in data/leads to see the content of these files


# TODO reenable it
# def ignore_failures(ctx: Context) -> set[str]:
#     result = set()

#     # TODO fail the test if it's ingored but it's actually passing

#     def get_blockers(content):
#         for line in content.split("\n"):
#             if "blocked" in line:
#                 yield line.split(":: ")

#     # TODO implement the functionality
#     # path_format = os.path.join(os.path.dirname(PROJECT_ROOT), "leads/pages/*.md")
#     # for file in glob.glob(path_format):
#     for file in ctx.conductor.list_files("~/leads/pages/*.md"):
#         person = file.split("/")[-1].replace(".md", "")
#         with open(file, "r") as f:
#             content = f.read()
#             print(content)
#             for f in get_blockers(content):
#                 if blockers[f[1]]:
#                     result.add(person)

#     return result
