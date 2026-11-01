"""The BIPs whose robots.txt the people mode passes by (Szymon, 11-02)."""

from __future__ import annotations

import re

from jobs.bip_crawler.robots_exceptions import FILES, SITES, allowed, passes
from jobs.bip_crawler.tests.test_people_mode_review import PDF, html, row, search


def test_a_listed_hosts_files_pass_and_its_other_pages_do_not():
    assert passes("https://bip.lodzkie.pl/files/bip/oswiadczenie.pdf")
    assert passes("https://bip.powiat.bielsko.pl/api/download/file?id=109121")
    assert not passes("https://bip.lodzkie.pl/administrator/index.php")


def test_a_listed_site_passes_whole():
    assert passes("https://rudaslaska.bip.info.pl/index.php?idmp=1")
    assert passes("http://www.bip.chorzow.eu/")


def test_every_other_host_keeps_its_robots_txt():
    assert not allowed(lambda url: False)("https://www.bip.krakow.pl/f/1.pdf")
    assert allowed(lambda url: False)("https://rudaslaska.bip.info.pl/")
    assert allowed(lambda url: True)("https://www.bip.krakow.pl/")


def test_each_exception_says_why():
    for table in (FILES, SITES):
        for host, why in table.items():
            assert host == host.lower() and not host.startswith("www."), host
            assert re.search(r"^.+: .+, \d+ candidac(y|ies)$", why), why
    assert not set(FILES) & set(SITES)


SITE = {
    "https://u1.pl": html(
        "Oświadczenia majątkowe",
        '<a href="/f/nowak.pdf">Jan Nowak - oświadczenie majątkowe</a>',
    ),
    "https://u1.pl/f/nowak.pdf": (200, "application/pdf", PDF + b"n"),
}


def test_a_walk_goes_past_a_listed_sites_robots_txt(tmp_path, monkeypatch):
    nowak = [row("n", "u1", "Jan", "Nowak")]
    keep_out = allowed(lambda url: False)
    _, store, _, _ = search(tmp_path / "unlisted", SITE, nowak, robots=keep_out)
    assert (store.outcomes["n"].status, store.outcomes["n"].reason) == (
        "not_found",
        "robots",
    )
    monkeypatch.setitem(SITES, "u1.pl", "U1: search engines only, 1 candidacy")
    _, store, _, _ = search(tmp_path / "listed", SITE, nowak, robots=keep_out)
    assert store.outcomes["n"].status == "found"


def test_a_walk_takes_a_listed_hosts_forbidden_file(tmp_path, monkeypatch):
    nowak = [row("n", "u1", "Jan", "Nowak")]
    files_out = allowed(lambda url: not url.endswith(".pdf"))
    _, store, _, _ = search(tmp_path / "unlisted", SITE, nowak, robots=files_out)
    assert store.outcomes["n"].status == "not_found"
    monkeypatch.setitem(FILES, "u1.pl", "U1: forbids /f/, 1 candidacy")
    _, store, _, _ = search(tmp_path / "listed", SITE, nowak, robots=files_out)
    assert store.outcomes["n"].status == "found"
