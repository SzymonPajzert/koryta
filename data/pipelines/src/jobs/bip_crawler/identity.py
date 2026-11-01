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
