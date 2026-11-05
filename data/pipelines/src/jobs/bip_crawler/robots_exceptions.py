"""The BIPs whose robots.txt the people mode passes by, as Szymon decided on
11-02 (decide-bip-robots-txt-exceptions: "A and B").

Asset declarations are public by law; what an office or its platform keeps
from crawlers, any reader can open. (a) Some hosts' robots.txt forbids the
files their open pages link, a platform's default more often than an office's
choice (/api/download/*, /files/, /uploads/): there only file links pass
(`FILES`). (b) Others keep out every crawler but search engines, or every one
(`SITES`): their whole BIP passes. A probe on 11-01 read 20 of the forbidden
files, all filed declarations, and walked powiat koniński on bip2.wokiss.pl:
18 of its 21 candidacies found in five minutes.

The rate stays each host's usual one, and robots.txt still rules every host not
listed. Each host says which unit it serves, what its robots.txt forbids and
how many candidacies that kept out on 11-02.
"""

from __future__ import annotations

from collections.abc import Callable

from scrapers.bip.classify import host_of
from scrapers.bip.people import is_file_link

#: Hosts whose pages are open to the crawler, whose robots.txt forbids the files
#: those pages link: (a).
FILES: dict[str, str] = {
    "bip.lodzkie.pl": "województwo łódzkie: forbids /files/, 62 candidacies",
    "bip.powiat.bielsko.pl": "powiat bielski: forbids /api/download/*, 54 candidacies",
    "bip.powiatminski.pl": "powiat miński: forbids /uploads/, 25 candidacies",
    "dl.umig.busko.pl": "Busko-Zdrój: Disallow: / to all, 22 candidacies",
    "bipum.konin.eu": "Konin: forbids /api/download/*, 22 candidacies",
    "bip.powiatkarkonoski.eu": (
        "powiat karkonoski: forbids /api/download/*, 21 candidacies"
    ),
    "bip.powiatnizanski.pl": "powiat niżański: forbids /download/, 20 candidacies",
    "bip.stolno.com.pl": "Stolno: forbids /*pdf*, 16 candidacies",
    "bip.nowytarg.pl": "Nowy Targ: forbids /api/download/*, 16 candidacies",
    "bip.stargard.eu": "Stargard: forbids /api/download/*, 14 candidacies",
    "bip.bestwina.com.pl": "Bestwina: forbids /api/download/*, 12 candidacies",
    "ksawerow.4bip.pl": "Ksawerów: forbids /UserFiles/, 10 candidacies",
    "bip.resko.pl": "Resko: forbids /pliki/, 9 candidacies",
    "bip.ugjoniec.pl": "Joniec: forbids /pliki/, 7 candidacies",
    "bip.powiat-sanok.pl": "powiat sanocki: forbids /uploads/, 7 candidacies",
    "bip.dabrowa-gornicza.pl": (
        "Dąbrowa Górnicza: forbids /api/download/*, 7 candidacies"
    ),
    "bip.gminaleczyca.pl": "Łęczyca: forbids /files/, 6 candidacies",
    "bip.wyry.pl": "Wyry: forbids its files, 6 candidacies",
    "bip2.tarnowo-podgorne.pl": (
        "Tarnowo Podgórne: forbids /api/download/*, 6 candidacies"
    ),
    "bip.oswiecim.um.gov.pl": "Oświęcim: forbids /api/download/*, 5 candidacies",
    "bip.sienno.pl": "Sienno: forbids /download/, 5 candidacies",
    "bipsypniewo.megabajt.net.pl": "Sypniewo: forbids /images/, 5 candidacies",
    "gminarybno.com": "Rybno: forbids /pliki/, 5 candidacies",
    "bip.jasienica.pl": "Jasienica: forbids /api/download/*, 5 candidacies",
    "bip.kozy.pl": "Kozy: forbids /api/download/*, 5 candidacies",
    "bip.trzebiatow.pl": "Trzebiatów: forbids /api/download/*, 5 candidacies",
    "bip.boleszkowice.pl": "Boleszkowice: forbids /pliki/, 5 candidacies",
    "files.olesnica.pl": "Oleśnica: Disallow: / to all, 4 candidacies",
    "bip.jablonna.pl": "Jabłonna: forbids /files/, 4 candidacies",
    "bip.ugporaj.pl": "Poraj: forbids /download/, 4 candidacies",
    "bip.dalikow.eu": "Dalików: forbids /download/, 3 candidacies",
    "bip.radziechowy-wieprz.pl": "Radziechowy-Wieprz: forbids its files, 3 candidacies",
    "bip.ugrajcza.rekord.com.pl": "Rajcza: forbids /api/, 3 candidacies",
    "bip.opatowek.pl": "Opatówek: forbids /files/, 3 candidacies",
    "bip.osielsko.pl": "Osielsko: forbids /*pdf*, 2 candidacies",
    "bip.lisewo.com": "Lisewo: forbids /*pdf*, 2 candidacies",
    "bip.ires.pl": "Boguchwała: forbids /gfx/, 2 candidacies",
    "bip.studzienice.pl": "Studzienice: forbids /pliki/, 2 candidacies",
    "bip.lyski.pl": "Lyski: forbids its files, 2 candidacies",
    "bip.janowo.pl": "Janowo: forbids /files/, 2 candidacies",
    "bip.lipnowski.powiat.pl": "powiat lipnowski: forbids /*pdf*, 1 candidacy",
    "bip.mniszkow.pl": "Mniszków: forbids /uploads/, 1 candidacy",
    "bip.wola-krzysztoporska.pl": "Wola Krzysztoporska: forbids its files, 1 candidacy",
    "bip.frysztak.pl": "Frysztak: forbids /download/, 1 candidacy",
    "bip.nowiny.com.pl": "Nowiny: forbids its files, 1 candidacy",
}
#: Hosts whose robots.txt keeps out every crawler but search engines, or all: (b).
SITES: dict[str, str] = {
    "rudaslaska.bip.info.pl": "Ruda Śląska: search engines only, 62 candidacies",
    "bip2.wokiss.pl": "Jarocin and 2 more: Disallow: / to all, 53 candidacies",
    "bip.powiat.rzeszowski.pl": (
        "powiat rzeszowski: search engines only, 52 candidacies"
    ),
    "powiat-pabianice.bip.info.pl": (
        "powiat pabianicki: search engines only, 40 candidacies"
    ),
    "bip.powiatbrzozow.pl": "powiat brzozowski: search engines only, 35 candidacies",
    "bip.starostwo.lezajsk.pl": "powiat leżajski: Disallow: / to all, 35 candidacies",
    "bip.chorzow.eu": "Chorzów: Disallow: / to all, 34 candidacies",
    # Its councillors' files are named links, Szymon found by hand on 11-05.
    "bip.stalowawola.pl": "Stalowa Wola: Disallow: / to all, 43 candidacies",
    "umz.zgierz.pl": "Zgierz: forbids /bip/, 32 candidacies",
    "bip.gliwice.eu": "Gliwice: Disallow: / to all, 31 candidacies",
    "bip.powiatprzeworsk.pl": "powiat przeworski: search engines only, 30 candidacies",
    "bip.siedlce.pl": "Siedlce: search engines only, 30 candidacies",
    "bip.zielonagora.pl": "Zielona Góra: Disallow: / to all, 29 candidacies",
    "bip.miejscepiastowe.pl": "Miejsce Piastowe: search engines only, 27 candidacies",
    "bip.powiat.kolbuszowski.pl": (
        "powiat kolbuszowski: search engines only, 26 candidacies"
    ),
    "bedzin.bip.info.pl": "Będzin: search engines only, 25 candidacies",
    "bip.um.starachowice.pl": "Starachowice: search engines only, 25 candidacies",
    "bip.powiatpolkowicki.pl": "powiat polkowicki: search engines only, 24 candidacies",
    "bip.umkrosno.pl": "Krosno: search engines only, 24 candidacies",
    "bip.spropczyce.pl": (
        "powiat ropczycko-sędziszowski: search engines only, 23 candidacies"
    ),
    "powiat-legnicki.bip.info.pl": (
        "powiat legnicki: search engines only, 23 candidacies"
    ),
    "bip.powiat-legionowski.pl": (
        "powiat legionowski: search engines only, 22 candidacies"
    ),
    "bip.minsk-maz.pl": "Mińsk Mazowiecki: search engines only, 22 candidacies",
    "umkutno.bip.e-zeto.eu": "Kutno: search engines only, 21 candidacies",
    "bip.powiatlukowski.pl": "powiat łukowski: search engines only, 20 candidacies",
    "bip.powiatsulecinski.pl": "powiat sulęciński: Disallow: / to all, 20 candidacies",
    "bip.laziska.pl": "Łaziska Górne: search engines only, 20 candidacies",
    "bip.powiatbl.pl": "powiat bieruńsko-lędziński: Disallow: / to all, 20 candidacies",
    "bip.ruja.pl": "Ruja: Disallow: / to all, 17 candidacies",
    "bip.blonie.pl": "Błonie: search engines only, 17 candidacies",
    "spleczna.bip.e-zeto.eu": "powiat łęczyński: search engines only, 16 candidacies",
    "bip.lesko.pl": "Lesko: search engines only, 15 candidacies",
    "bip.brodnica.pl": "Brodnica: search engines only, 15 candidacies",
    "bip.powiat-slupca.pl": "powiat słupecki: Disallow: / to all, 14 candidacies",
    "bip.zabki.pl": "Ząbki: search engines only, 14 candidacies",
    "bip.debowiec.pl": "Dębowiec: Disallow: / to all, 14 candidacies",
    "bip.krotoszyce.pl": "Krotoszyce: Disallow: / to all, 14 candidacies",
    "bip.mecinka.pl": "Męcinka: Disallow: / to all, 13 candidacies",
    "bip.skoczow.pl": "Skoczów: search engines only, 12 candidacies",
    "bip.swiebodzin.eu": "Świebodzin: Disallow: / to all, 11 candidacies",
    "powiatkoscian.pl": "powiat kościański: Disallow: / to all, 11 candidacies",
    "bip.gminalancut.pl": "Łańcut: search engines only, 9 candidacies",
    "bip.spprzemysl.pl": "powiat przemyski: search engines only, 9 candidacies",
    "bip.haczow.pl": "Haczów: search engines only, 9 candidacies",
    "bip.kargowa.pl": "Kargowa: Disallow: / to all, 8 candidacies",
    "spstrzelin.bip.e-zeto.eu": (
        "powiat strzeliński: search engines only, 8 candidacies"
    ),
    "bip.chynow.pl": "Chynów: search engines only, 8 candidacies",
    "bip.chodziez.pl": "Chodzież: Disallow: / to all, 8 candidacies",
    "bip5.wokiss.pl": "Nowe Skalmierzyce: Disallow: / to all, 7 candidacies",
    "bip.stoczek.net.pl": "Stoczek: Disallow: / to all, 7 candidacies",
    "spsuchabeskidzka.bip.info.pl": "powiat suski: search engines only, 7 candidacies",
    "bip.jaworzyna.net": "Jaworzyna Śląska: search engines only, 7 candidacies",
    "bip.gminakoscian.pl": "Kościan: Disallow: / to all, 7 candidacies",
    "bip.kurow.eu": "Kurów: search engines only, 7 candidacies",
    "bip.sulecin.pl": "Sulęcin: Disallow: / to all, 6 candidacies",
    "bip.brojce.pl": "Brójce: search engines only, 6 candidacies",
    "bip.baligrod.pl": "Baligród: search engines only, 6 candidacies",
    "bip.trzebownisko.pl": "Trzebownisko: Disallow: / to all, 6 candidacies",
    "bip.tyrawa.pl": "Tyrawa Wołoska: search engines only, 6 candidacies",
    "bip.gminachodziez.pl": "Chodzież: Disallow: / to all, 6 candidacies",
    "bip.piastow.pl": "Piastów: search engines only, 6 candidacies",
    "bip.wagrowiec.eu": "Wągrowiec: Disallow: / to all, 6 candidacies",
    "stary-dzikow.bip.info.pl": "Stary Dzików: search engines only, 5 candidacies",
    "umstoczeklukowski.bip.e-zeto.eu": (
        "Stoczek Łukowski: search engines only, 5 candidacies"
    ),
    "zlotnikikuj.ires.pl": "Złotniki Kujawskie: Disallow: / to all, 5 candidacies",
    # Its declarations page Szymon found by hand on 11-05.
    "umig-zagorz.ires.pl": "Zagórz: Disallow: / to all, 35 candidacies",
    "chmielnik.ires.pl": "Chmielnik: Disallow: / to all, 7 candidacies",
    # e-zeto.eu's BIPs let in search engines alone (11-05).
    "spswidnica.bip.e-zeto.eu": "powiat świdnicki: search engines only, 70 candidacies",
    "ugsiennicarozana.bip.e-zeto.eu": (
        "Siennica Różana: search engines only, 4 candidacies"
    ),
    "ugtrzcinica.bip.e-zeto.eu": "Trzcinica: search engines only, 1 candidacy",
    "bip.wiazownica.com": "Wiązownica: search engines only, 5 candidacies",
    "bip.strzelce.pl": "Strzelce Krajeńskie: Disallow: / to all, 5 candidacies",
    "bip3.wokiss.pl": "Babiak and 1 more: Disallow: / to all, 5 candidacies",
    "bip.gminaszamocin.pl": "Szamocin: Disallow: / to all, 4 candidacies",
    "ugmiaczyn.bip.e-zeto.eu": "Miączyn: search engines only, 4 candidacies",
    "bip.zukowice.pl": "Żukowice: search engines only, 4 candidacies",
    "bip.oleszyce.pl": "Oleszyce: search engines only, 4 candidacies",
    "bip.krzykosy.pl": "Krzykosy: Disallow: / to all, 4 candidacies",
    "bip.zagorow.pl": "Zagórów: Disallow: / to all, 4 candidacies",
    "bip.kunice.pl": "Kunice: Disallow: / to all, 4 candidacies",
    "ugfajslawice.bip.e-zeto.eu": "Fajsławice: search engines only, 4 candidacies",
    "przykona.pl": "Przykona: Disallow: / to all, 4 candidacies",
    "bip.gromadka.pl": "Gromadka: Disallow: / to all, 3 candidacies",
    "bip.slupia.pl": "Słupia: search engines only, 3 candidacies",
    "bip.swidnica.zgora.pl": "Świdnica: Disallow: / to all, 3 candidacies",
    "bip.radwanice.pl": "Radwanice: search engines only, 3 candidacies",
    "bip.gabin.pl": "Gąbin: search engines only, 3 candidacies",
    "konarzyny.pl": "Konarzyny: Disallow: / to all, 3 candidacies",
    "bip.jejkowice.pl": "Jejkowice: search engines only, 3 candidacies",
    "bip.zlotoryja.com.pl": "Złotoryja: Disallow: / to all, 3 candidacies",
    "bip.lopuszno.pl": "Łopuszno: search engines only, 3 candidacies",
    "ugjastkow.bip.e-zeto.eu": "Jastków: search engines only, 3 candidacies",
    "bip.paszowice.pl": "Paszowice: Disallow: / to all, 2 candidacies",
    "uglopiennikgorny.bip.e-zeto.eu": (
        "Łopiennik Górny: search engines only, 2 candidacies"
    ),
    "ugrudnik.bip.e-zeto.eu": "Rudnik: search engines only, 2 candidacies",
    "bip.maciejowice.pl": "Maciejowice: search engines only, 2 candidacies",
    "umbilgoraj.bip.e-zeto.eu": "Biłgoraj: search engines only, 2 candidacies",
    "miedzyrzecgmina.pl": "Międzyrzec Podlaski: search engines only, 2 candidacies",
    "ugkrasnystaw.bip.e-zeto.eu": "Krasnystaw: search engines only, 2 candidacies",
    "bip.kotla.pl": "Kotla: Disallow: / to all, 2 candidacies",
    "bip.sieniawa.pl": "Sieniawa: search engines only, 2 candidacies",
    "bip.lubsko.pl": "Lubsko: Disallow: / to all, 2 candidacies",
    "ugizbica.bip.e-zeto.eu": "Izbica: search engines only, 1 candidacy",
    "gminagorzyce.pl": "Gorzyce: search engines only, 1 candidacy",
    "zelechlinek.pl": "Żelechlinek: search engines only, 1 candidacy",
    "ugrejowiec.bip.e-zeto.eu": "Rejowiec: search engines only, 1 candidacy",
    "bip.pietrowicewielkie.pl": "Pietrowice Wielkie: Disallow: / to all, 1 candidacy",
}


def passes(url: str) -> bool:
    """Whether ``url`` goes past robots.txt: any page of a `SITES` host, a file
    link of a `FILES` one."""
    host = host_of(url)
    return host in SITES or (host in FILES and is_file_link(url))


def allowed(robots_allowed: Callable[[str], bool]) -> Callable[[str], bool]:
    """``robots_allowed``, the hosts above let through."""
    return lambda url: passes(url) or robots_allowed(url)
