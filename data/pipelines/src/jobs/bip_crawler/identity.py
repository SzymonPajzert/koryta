"""The User-Agent each host is asked with.

The crawler names itself ("KorytaBIPCrawler/0.1 (+http://koryta.pl/crawler)").
A few servers keep the public data on their BIPs from that name and let a
browser's through. Those are asked with `BROWSER_AGENT`, which still names
koryta.pl; robots.txt (read as that agent, its rules taken as the crawler's)
and the host's rate hold for them as for any host. Szymon's decision of 11-01
(decide-scraper-identity-policy): the data is public by law, and no office is
waited for to unblock it. Each exception below says why it is one.
"""

from __future__ import annotations

import threading
from collections.abc import Callable

#: Passes the filters below (11-01) and names koryta.pl, as Googlebot names
#: itself; not "crawler", the word E-LINE's filter looks for.
BROWSER_AGENT = "Mozilla/5.0 (compatible; KorytaBIP/0.1; +https://koryta.pl)"

#: Servers, by the address a host resolves to: every BIP a platform hosts.
SERVERS = {
    # E-LINE's SYSTEMDOBIP.PL (74 units, 646 candidacies refused on 11-01):
    # a User-Agent with "crawler" in it gets HTTP 200 "Zbyt dużo jednoczesnych
    # połączeń do strony" at any pace, also after an hour of silence; the same
    # machine with another User-Agent gets the pages.
    "91.224.198.130": "E-LINE SYSTEMDOBIP.PL",
    "176.119.35.31": "E-LINE SYSTEMDOBIP.PL",
}

#: Hosts, without www.
HOSTS = {
    # Every /resource/ file answers 403 to a client that is no browser, with the
    # page's cookie and Referer or without, while the pages answer: the walk
    # found 141 links to the declarations of Mazowieckie's 119 councillors and
    # brought none down (11-01).
    "bip.mazovia.pl": "Urząd Marszałkowski Województwa Mazowieckiego",
    # These answer the crawler's name 403, its robots.txt too, and a browser
    # 200; the robots.txt they show a browser lets the crawler in (its `*`
    # group; Przemyśl's names a "Mozilla/5" bot among 157, not us). Checked on
    # 11-02 for the units the people mode had settled unreachable.
    "bip.przemysl.pl": "Przemyśl, 43 candidacies",
    "bip.powiatoleski.pl": "powiat oleski, 35 candidacies",
    "bip.powiat.kedzierzyn-kozle.pl": "powiat kędzierzyńsko-kozielski, 28 candidacies",
    "bip.kluczewsko.pl": "Kluczewsko, 20 candidacies",
    "bip.klobuck.pl": "powiat kłobucki, 17 candidacies",
    "bip.powiatglubczycki.pl": "powiat głubczycki, 17 candidacies",
    "bip.barczewo.pl": "Barczewo, 17 candidacies",
    "bip.namyslow.pl": "powiat namysłowski, 13 candidacies",
    "bip.powiatkrapkowicki.pl": "powiat krapkowicki, 13 candidacies",
    "bip.powiatopolski.pl": "powiat opolski, 13 candidacies",
    "bip.kietrz.pl": "Kietrz, 12 candidacies",
    "bip.krapkowice.pl": "Krapkowice, 12 candidacies",
    "bip.namyslow.eu": "Namysłów, 10 candidacies",
    "bip.olecko.pl": "Olecko, 10 candidacies",
    "bip.pabianice.gmina.pl": "Pabianice, 10 candidacies",
    "bip.proszkow.pl": "Prószków, 10 candidacies",
    "bip.wilkow.pl": "Wilków, 8 candidacies",
    "bip.gogolin.pl": "Gogolin, 8 candidacies",
    "bip.ug.wislica.pl": "Wiślica, 8 candidacies",
    "bip.glogowek.pl": "Głogówek, 7 candidacies",
    "bip.lask.pl": "Łask, 6 candidacies",
    "bip.gminadabrowa.pl": "Dąbrowa, 6 candidacies",
    "bip.lesnica.pl": "Leśnica, 6 candidacies",
    "bip.komprachcice.pl": "Komprachcice, 6 candidacies",
    "bip.krasocin.com.pl": "Krasocin, 5 candidacies",
    "bip.bartniczka.pl": "Bartniczka, 5 candidacies",
    "bip.kolonowskie.pl": "Kolonowskie, 5 candidacies",
    "bip.tarnowopolski.pl": "Tarnów Opolski, 5 candidacies",
    "bip.turawa.pl": "Turawa, 5 candidacies",
    "bip.byczyna.pl": "Byczyna, 5 candidacies",
    "bip.lubniany.pl": "Łubniany, 4 candidacies",
    "bip.cisek.pl": "Cisek, 3 candidacies",
    "bip.niemodlin.pl": "Niemodlin, 3 candidacies",
    "bip.baborow.pl": "Baborów, 3 candidacies",
    "bip.przemet.pl": "Przemęt, 3 candidacies",
    "bip.sieroszewice.pl": "Sieroszewice, 3 candidacies",
    "bip.rudniki.pl": "Rudniki, 2 candidacies",
    "bip.popielow.pl": "Popielów, 2 candidacies",
    "bip.zdzieszowice.pl": "Zdzieszowice, 2 candidacies",
    "bip.rudziniec.pl": "Rudziniec, 2 candidacies",
    "bip.susz.pl": "Susz, 2 candidacies",
    "bip.dobrodzien.pl": "Dobrodzień, 1 candidacies",
    "bip.swierczow.pl": "Świerczów, 1 candidacies",
    "bip.dobrzenwielki.pl": "Dobrzeń Wielki, 1 candidacies",
}


class Agents:
    """Which User-Agent a host is asked with: ``own``, or `BROWSER_AGENT` for
    the exceptions above. A host's server is resolved once. Thread-safe."""

    def __init__(self, own: str, resolve: Callable[[str], str] = lambda h: h) -> None:
        self.own = own
        self.resolve = resolve
        self._servers: dict[str, str] = {}
        self._lock = threading.Lock()

    def __call__(self, host: str) -> str:
        host = host.lower()
        if host.removeprefix("www.") in HOSTS:
            return BROWSER_AGENT
        if not SERVERS:
            return self.own
        with self._lock:
            server = self._servers.get(host)
        if server is None:
            server = self.resolve(host)
            with self._lock:
                self._servers[host] = server
        return BROWSER_AGENT if server in SERVERS else self.own
