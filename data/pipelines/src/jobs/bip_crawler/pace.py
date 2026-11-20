"""Servers the people mode asks more slowly than a host's rate.

The rate (``--rate``, 1 s) is a host's. A server that hosts many BIPs under
their own names may count every request it gets from one client, whichever
host it is for, and refuse one that asks faster than it likes. Each server
below gets a turn of its own, by the address its hosts resolve to, which every
unit's walk on it shares (`people.PeopleSearch._wait_turn`). Slower is politer;
none of them puts up a bot check. Each one says what was measured.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Mapping

#: Seconds between two requests to a server, by the address its hosts resolve to.
SERVERS: dict[str, float] = {
    # ZETO Lublin's e-zeto: every *.bip.e-zeto.eu BIP and bip.powiatboleslawiecki.pl.
    # It answers 403 to any client asking about once a second (11-13): powiat
    # bolesławiecki's walk at 1 s read 350 pages and got 403 for all 9 of its
    # files, 4 tries each; asked 10 s apart it answered 206, 206, 403, 403, 403;
    # six requests 15 s apart, 30 minutes later, all 200 or 206. Powiat
    # świdnicki's 11-05 walk at 1 s got 403 for 71 of the 188 files it tried.
    # At 15 s the walks of Bolesławiec and Świdnica read 119 pages each and got
    # every file, 49 and 106.
    "185.182.96.228": 15.0,
}


class Paces:
    """A host's server and the seconds it wants between requests, ("", 0.0)
    for a host on any other server. A host's server is resolved once.
    Thread-safe."""

    def __init__(
        self,
        resolve: Callable[[str], str],
        servers: Mapping[str, float] = SERVERS,
    ) -> None:
        self.resolve = resolve
        self.servers = servers
        self._servers: dict[str, str] = {}
        self._lock = threading.Lock()

    def __call__(self, host: str) -> tuple[str, float]:
        if not self.servers:
            return "", 0.0
        host = host.lower()
        with self._lock:
            server = self._servers.get(host)
        if server is None:
            server = self.resolve(host)
            with self._lock:
                self._servers[host] = server
        interval = self.servers.get(server, 0.0)
        return (server, interval) if interval > 0 else ("", 0.0)
