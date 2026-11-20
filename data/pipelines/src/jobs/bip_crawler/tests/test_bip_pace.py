"""Servers asked more slowly than a host's rate: one turn for all their hosts,
shared by every unit's walk on them."""

from __future__ import annotations

from pathlib import Path
from typing import cast

import pytest

from jobs.bip_crawler.pace import SERVERS, Paces
from jobs.bip_crawler.people import PeopleOptions, PeopleSearch
from jobs.bip_crawler.people_list import to_search
from jobs.bip_crawler.tests.test_bip import FakeFrontier
from jobs.bip_crawler.tests.test_people_mode_review import PDF, Web, html, row
from scrapers.bip.units import UnitSeed
from scrapers.common.fetch import HttpResult
from scrapers.common.ratelimit import HostTokenBucket
from scrapers.stores import BipQueue, with_outcomes
from stores.bip_bundles import LocalBundleStore
from stores.bip_people import MemoryBipPeopleStore

#: ZETO Lublin's e-zeto server: Żółkiewka's and powiat bolesławiecki's BIPs.
E_ZETO = "185.182.96.228"
SERVED = {"ugzolkiewka.bip.e-zeto.eu": E_ZETO, "bip.powiatboleslawiecki.pl": E_ZETO}


class Clock:
    """Time that passes only while the search sleeps."""

    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


def people(tmp_path: Path, clock: Clock, **kwargs) -> PeopleSearch:
    return PeopleSearch(
        MemoryBipPeopleStore(),
        cast("BipQueue", FakeFrontier([])),
        LocalBundleStore(tmp_path / "b"),
        kwargs.pop("seeds", {}),
        PeopleOptions(workers=1, sitemaps=False),
        limiter=HostTokenBucket(1.0, burst_window_s=1.0, clock=clock),
        sleep=clock.sleep,
        clock=clock,
        resolve=lambda host: SERVED.get(host, host),
        **kwargs,
    )


def test_a_hosts_server_is_looked_up_once() -> None:
    asked: list[str] = []

    def resolve(host: str) -> str:
        asked.append(host)
        return SERVED.get(host, "10.0.0.1")

    paces = Paces(resolve)
    assert SERVERS[E_ZETO] == 15.0
    assert paces("ugzolkiewka.bip.e-zeto.eu") == (E_ZETO, 15.0)
    assert paces("UGZOLKIEWKA.bip.e-zeto.eu") == (E_ZETO, 15.0)
    assert paces("bip.x.pl") == ("", 0.0)
    assert asked == ["ugzolkiewka.bip.e-zeto.eu", "bip.x.pl"]


def test_two_hosts_on_a_slow_server_share_its_turn(tmp_path) -> None:
    clock = Clock()
    search = people(tmp_path, clock)
    turns = []
    for host in (
        "ugzolkiewka.bip.e-zeto.eu",
        "bip.powiatboleslawiecki.pl",  # its own host's first turn, the server's second
        "bip.x.pl",  # another server: no wait
        "ugzolkiewka.bip.e-zeto.eu",
    ):
        search._wait_turn(host)
        turns.append(clock.now)
    assert turns == pytest.approx([0.0, 15.0, 15.0, 30.0], abs=0.1)


class Timed(Web):
    """A site that notes when each address was asked for."""

    def __init__(self, sites: dict, clock: Clock) -> None:
        super().__init__(sites)
        self.clock = clock
        self.times: list[float] = []

    def fetch(self, url: str, timeout: float, user_agent: str) -> HttpResult:
        self.times.append(self.clock.now)
        return super().fetch(url, timeout, user_agent)


def test_a_walk_on_a_slow_server_asks_it_once_in_its_interval(tmp_path) -> None:
    host = "https://ugzolkiewka.bip.e-zeto.eu"
    clock = Clock()
    web = Timed(
        {
            host: html("BIP", '<a href="/om">Oświadczenia majątkowe</a>'),
            f"{host}/om": html(
                "Oświadczenia majątkowe",
                '<a href="/f/kania.pdf">Marian Kania - oświadczenie majątkowe</a>',
            ),
            f"{host}/f/kania.pdf": (200, "application/pdf", PDF + b"k"),
        },
        clock,
    )
    seeds = {
        "u1": UnitSeed("u1", bip_urls=[host], scopes=["ugzolkiewka.bip.e-zeto.eu"])
    }
    search = people(tmp_path, clock, seeds=seeds, fetch=web.fetch)
    listed = [row("k", "u1", "Marian", "Kania")]
    search.run(
        to_search(
            with_outcomes(listed, search.people_store.searched()),
            refresh=False,
            max_priority=None,
            limit=None,
        )
    )
    assert cast("MemoryBipPeopleStore", search.people_store).outcomes["k"].status == (
        "found"
    )
    # The start, the declarations page, the file: 15 s apart, not 1 s.
    assert web.times == pytest.approx([0.0, 15.0, 30.0], abs=0.1)
