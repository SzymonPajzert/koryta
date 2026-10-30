"""People mode on big BIPs: a budget by unit size, the seekers' own council
first, walks that start from declaration URLs known before walking, and pages
drawn by a script rendered first."""

from __future__ import annotations

import gzip
import json
import threading
import time
from collections import Counter
from pathlib import Path
from typing import cast

from jobs.bip_crawler.people import (
    PeopleOptions,
    PeopleSearch,
    apply_unit_starts,
    load_known_urls,
    read_unit_starts,
)
from jobs.bip_crawler.tests.test_bip import FakeFrontier
from jobs.bip_crawler.tests.test_people_mode_review import PDF, Web, html, row
from scrapers.bip.classify import normalize_url
from scrapers.bip.people import link_score, office_terms
from scrapers.bip.units import UnitSeed
from scrapers.common.fetch import HttpResult
from scrapers.common.links import LinkContext
from scrapers.common.ratelimit import HostTokenBucket
from scrapers.stores import BipQueue
from stores.bip_bundles import LocalBundleStore
from stores.bip_people import MemoryBipPeopleStore


def search(
    tmp_path: Path,
    sites,
    rows,
    *,
    known=None,
    scopes=None,
    render=None,
    clock=time.monotonic,
    **options,
):
    web = Web(sites)
    store = MemoryBipPeopleStore()
    store.upsert_people(rows)
    seeds = {
        r.unit: UnitSeed(
            r.unit,
            bip_urls=[f"https://{(scopes or {}).get(r.unit, r.unit + '.pl')}"],
            scopes=[(scopes or {}).get(r.unit, r.unit + ".pl")],
        )
        for r in rows
    }
    people = PeopleSearch(
        store,
        cast("BipQueue", FakeFrontier([])),
        LocalBundleStore(tmp_path / "b"),
        seeds,
        PeopleOptions(workers=1, **options),
        fetch=web.fetch,
        limiter=HostTokenBucket(0),
        sleep=lambda s: None,
        known=known,
        render=render,
        clock=clock,
    )
    people.run(store.people_to_search(refresh=False, max_priority=None, limit=None))
    return people, store, web


def test_the_budget_grows_with_the_units_candidacies(tmp_path):
    people, _, _ = search(tmp_path, {}, [])
    assert people._budget(1) == 150
    assert people._budget(30) == 450
    assert people._budget(500) == 1000


def test_the_seekers_own_council_is_walked_first():
    council = LinkContext(
        "https://x.pl/rm", "Oświadczenia majątkowe radnych Rady Miasta"
    )
    staff = LinkContext("https://x.pl/pr", "Oświadczenia majątkowe pracowników urzędu")
    districts = LinkContext("https://x.pl/dz", "Oświadczenia majątkowe rad dzielnic")
    city = office_terms(["Rada miasta"])
    assert link_score(council, [], 1, city) > link_score(staff, [], 1, city)
    district = office_terms(["Rada dzielnicy"])
    assert link_score(districts, [], 1, district) > link_score(districts, [], 1, city)
    assert office_terms(["nobody knows"]) is None


def test_a_known_file_finds_a_person_the_menu_hides(tmp_path):
    sites = {
        "https://u1.pl": html("BIP", '<a href="/przetargi">Przetargi</a>'),
        "https://u1.pl/pliki/oswiadczenie-majatkowe-ewa-lis-2024.pdf": (
            200,
            "application/pdf",
            PDF + b"lis",
        ),
    }
    known = {"u1.pl": ["https://u1.pl/pliki/oswiadczenie-majatkowe-ewa-lis-2024.pdf"]}
    _, store, _ = search(tmp_path, sites, [row("lis", "u1", "Ewa", "Lis")], known=known)
    assert store.people["lis"].status == "found"
    (doc,) = store.person_docs("lis")
    assert doc.page_url == "known-urls"


def test_a_known_page_starts_the_walk(tmp_path):
    sites = {
        "https://u1.pl": html("BIP", '<a href="/przetargi">Przetargi</a>'),
        "https://u1.pl/rada/oswiadczenia-majatkowe": html(
            "Oświadczenia majątkowe radnych",
            '<a href="/f/1.pdf">Ewa Lis - oświadczenie majątkowe za 2024</a>',
        ),
        "https://u1.pl/f/1.pdf": (200, "application/pdf", PDF + b"1"),
    }
    known = {"u1.pl": ["https://u1.pl/rada/oswiadczenia-majatkowe"]}
    _, store, _ = search(tmp_path, sites, [row("lis", "u1", "Ewa", "Lis")], known=known)
    assert store.people["lis"].status == "found"


def test_a_sitemap_leads_to_the_declarations(tmp_path):
    index = (
        "<sitemapindex><sitemap><loc>https://u1.pl/sm-news.xml</loc></sitemap>"
        "<sitemap><loc>https://u1.pl/sm-oswiadczenia.xml.gz</loc></sitemap>"
        "</sitemapindex>"
    )
    pages = (
        "<urlset><url><loc>https://u1.pl/aktualnosci/1</loc></url>"
        "<url><loc>https://u1.pl/oswiadczenia-majatkowe-radnych</loc></url></urlset>"
    )
    sites = {
        "https://u1.pl": html("BIP", '<a href="/przetargi">Przetargi</a>'),
        "https://u1.pl/robots.txt": (
            200,
            "text/plain",
            b"User-agent: *\nSitemap: https://u1.pl/sitemap-index.xml\n",
        ),
        "https://u1.pl/sitemap-index.xml": (200, "application/xml", index.encode()),
        "https://u1.pl/sm-oswiadczenia.xml.gz": (
            200,
            "application/gzip",
            gzip.compress(pages.encode()),
        ),
        "https://u1.pl/oswiadczenia-majatkowe-radnych": html(
            "Oświadczenia majątkowe radnych",
            '<a href="/f/1.pdf">Ewa Lis - oświadczenie majątkowe za 2024</a>',
        ),
        "https://u1.pl/f/1.pdf": (200, "application/pdf", PDF + b"1"),
    }
    _, store, web = search(tmp_path, sites, [row("lis", "u1", "Ewa", "Lis")])
    assert store.people["lis"].status == "found"
    # The declarations' sitemap is read; the news one is not needed.
    assert "https://u1.pl/sm-oswiadczenia.xml.gz" in web.calls


def test_known_urls_stay_inside_a_shared_platforms_path(tmp_path):
    sites = {
        "https://bip.x.pl/u1": html("BIP", '<a href="/u1/przetargi">Przetargi</a>'),
        "https://bip.x.pl/u2/oswiadczenie-majatkowe-ewa-lis.pdf": (
            200,
            "application/pdf",
            PDF + b"other",
        ),
    }
    known = {"bip.x.pl": ["https://bip.x.pl/u2/oswiadczenie-majatkowe-ewa-lis.pdf"]}
    _, store, web = search(
        tmp_path,
        sites,
        [row("lis", "u1", "Ewa", "Lis")],
        known=known,
        scopes={"u1": "bip.x.pl/u1"},
    )
    assert store.people["lis"].status == "not_found"
    assert not any("/u2/" in c for c in web.calls)


def test_known_urls_are_read_by_host(tmp_path):
    path = tmp_path / "urls.jsonl"
    path.write_text(
        "\n".join(
            [
                json.dumps({"url": "https://www.bip.u1.pl/oswiadczenia/lis.pdf"}),
                json.dumps(
                    {"url": "https://bip.u1.pl/przetargi/1", "category": "inne"}
                ),
                json.dumps(
                    {"url": "https://bip.u1.pl/dok/77", "category": "oswiadczenia"}
                ),
                "not json",
            ]
        )
    )
    assert load_known_urls(path) == {
        "bip.u1.pl": [
            "https://www.bip.u1.pl/oswiadczenia/lis.pdf",
            "https://bip.u1.pl/dok/77",
        ]
    }


SHELL = (
    200,
    "text/html",
    b'<html><head><script src="/static/js/main.js"></script></head>'
    b'<body><nav><a href="/">Home</a></nav><div id="root"></div></body></html>',
)
JS_SITE = {
    "https://u1.pl": SHELL,
    "https://u1.pl/om": SHELL,
    "https://u1.pl/api/files/7": (200, "application/pdf", PDF + b"7"),
}
DRAWN = {
    "https://u1.pl": html("BIP", '<a href="/om">Oświadczenia majątkowe</a>'),
    "https://u1.pl/om": html(
        "Oświadczenia majątkowe radnych",
        '<a href="/api/files/7">Ewa Lis - oświadczenie majątkowe za 2024</a>',
    ),
}


def test_a_page_a_script_draws_is_read_once_rendered(tmp_path):
    drawn: list[str] = []

    def render(url: str) -> tuple[HttpResult, int]:
        drawn.append(url)
        status, kind, body = DRAWN[normalize_url(url).rstrip("/")]
        return HttpResult(url, status, kind, body), 0

    rows = [row("lis", "u1", "Ewa", "Lis")]
    _, store, _ = search(tmp_path, JS_SITE, rows, render=render, sitemaps=False)
    assert store.people["lis"].status == "found"
    assert [normalize_url(u).rstrip("/") for u in drawn] == [
        "https://u1.pl",
        "https://u1.pl/om",
    ]


def test_unrendered_a_script_drawn_bip_shows_nothing(tmp_path):
    rows = [row("lis", "u1", "Ewa", "Lis")]
    _, store, _ = search(tmp_path, JS_SITE, rows, sitemaps=False)
    assert (store.people["lis"].status, store.people["lis"].reason) == (
        "not_found",
        "no_declarations",
    )


def test_checked_starts_replace_what_the_lists_had():
    seeds = {
        "020101": UnitSeed(
            "020101", ["http://www.boleslawiec.pl"], [], ["boleslawiec.pl"]
        ),
        "120000": UnitSeed("120000", ["https://bip.x.pl/umwm"], [], ["bip.x.pl/umwm"]),
    }
    starts = [
        {
            "unit": "020101",
            "bip_url": "https://bip.um.boleslawiec.pl/",
            "declarations_url": "https://bip.um.boleslawiec.pl/oswiadczenia-majatkowe",
        },
        {
            "unit": "140000",
            "bip_url": "https://bip.mazovia.pl/",
            "declarations_url": "",
        },
        {
            "unit": "180509",
            "bip_url": "https://samorzad.gov.pl/web/gmina-skolyszyn",
            "declarations_url": "",
        },
    ]
    assert apply_unit_starts(seeds, starts) == 3
    assert seeds["020101"].bip_urls == [
        "https://bip.um.boleslawiec.pl/oswiadczenia-majatkowe",
        "https://bip.um.boleslawiec.pl/",
    ]
    assert seeds["020101"].scopes == ["bip.um.boleslawiec.pl"]
    assert seeds["140000"].bip_urls == ["https://bip.mazovia.pl/"]
    assert seeds["180509"].scopes == ["samorzad.gov.pl/web/gmina-skolyszyn"]
    # Untouched units keep what the lists had.
    assert seeds["120000"].scopes == ["bip.x.pl/umwm"]


def test_the_checked_in_starts_parse(tmp_path):
    for start in read_unit_starts():
        assert len(start["unit"]) == 6 and start["unit"].isdigit()
        assert start["bip_url"].startswith(("http://", "https://"))
    assert read_unit_starts(tmp_path / "missing.csv") == []


class CountingLimiter:
    def __init__(self) -> None:
        self.turns: list[str] = []

    def acquire(self, host: str) -> bool:
        self.turns.append(host)
        return True

    def next_available_in(self, host: str) -> float:
        return 0.0


def test_a_render_pays_a_turn_for_each_request_to_the_host(tmp_path):
    limiter = CountingLimiter()
    people = PeopleSearch(
        MemoryBipPeopleStore(),
        cast("BipQueue", FakeFrontier([])),
        LocalBundleStore(tmp_path / "b"),
        {},
        PeopleOptions(),
        limiter=cast("HostTokenBucket", limiter),
        sleep=lambda s: None,
        render=lambda url: (HttpResult(url, 200, "text/html", b"<html></html>"), 3),
    )
    people._drawn("https://u1.pl/om")
    assert limiter.turns == ["u1.pl"] * 4


def test_a_retry_of_a_big_unit_gets_a_big_units_pages(tmp_path, monkeypatch):
    asked: list[int] = []
    original = PeopleSearch._budget

    def budget(self, candidacies):
        asked.append(candidacies)
        return original(self, candidacies)

    monkeypatch.setattr(PeopleSearch, "_budget", budget)
    sites = {"https://u1.pl": html("BIP", "")}
    rows = [row(f"r{i}", "u1", "Ewa", f"Lis{i}") for i in range(10)]
    web = Web(sites)
    store = MemoryBipPeopleStore()
    store.upsert_people(rows)
    people = PeopleSearch(
        store,
        cast("BipQueue", FakeFrontier([])),
        LocalBundleStore(tmp_path / "b"),
        {"u1": UnitSeed("u1", bip_urls=["https://u1.pl"], scopes=["u1.pl"])},
        PeopleOptions(workers=1, sitemaps=False),
        fetch=web.fetch,
        limiter=HostTokenBucket(0),
        sleep=lambda s: None,
        unit_sizes={"u1": 60},
    )
    people.run(store.people_to_search(refresh=False, max_priority=None, limit=None))
    assert asked == [60] and original(people, 60) == 900


def test_a_drawn_page_elsewhere_keeps_the_fetched_pages_links(tmp_path):
    sites = {
        "https://u1.pl": SHELL,
        "https://u1.pl/om": html(
            "Oświadczenia majątkowe radnych",
            '<a href="/f/1.pdf">Ewa Lis - oświadczenie majątkowe za 2024</a>',
        ),
        "https://u1.pl/f/1.pdf": (200, "application/pdf", PDF + b"1"),
    }

    def render(url: str) -> tuple[HttpResult, int]:
        # The script sends the browser to a cookie wall on another host.
        return HttpResult(
            "https://consent.example/", 200, "text/html", b"<html></html>"
        ), 0

    shell_with_link = (
        200,
        "text/html",
        SHELL[2].replace(b'<div id="root">', b'<a href="/om">x</a><div id="root">'),
    )
    sites["https://u1.pl"] = shell_with_link
    rows = [row("lis", "u1", "Ewa", "Lis")]
    _, store, _ = search(tmp_path, sites, rows, render=render, sitemaps=False)
    assert store.people["lis"].status == "found"


def test_a_broken_gzip_sitemap_is_skipped_not_fatal(tmp_path):
    whole = gzip.compress(b"<urlset><url><loc>https://u1.pl/x</loc></url></urlset>")
    sites = {
        "https://u1.pl": html("BIP", '<a href="/om">Oświadczenia majątkowe</a>'),
        "https://u1.pl/robots.txt": (
            200,
            "text/plain",
            b"Sitemap: https://u1.pl/sm.xml.gz\n",
        ),
        "https://u1.pl/sm.xml.gz": (200, "application/gzip", whole[:-6]),
        "https://u1.pl/om": html(
            "Oświadczenia majątkowe radnych",
            '<a href="/f/1.pdf">Ewa Lis - oświadczenie majątkowe za 2024</a>',
        ),
        "https://u1.pl/f/1.pdf": (200, "application/pdf", PDF + b"1"),
    }
    _, store, _ = search(tmp_path, sites, [row("lis", "u1", "Ewa", "Lis")])
    assert store.people["lis"].status == "found"


def test_known_id_addresses_are_not_walked_as_pages(tmp_path):
    # bip.podkarpackie.pl: every known address is an attachment behind an ?id=.
    attachment = (
        "https://u1.pl/component/govarticle?id=1000&task=article.downloadAttachment"
    )
    sites = {
        "https://u1.pl": html("BIP", '<a href="/om">Oświadczenia majątkowe</a>'),
        "https://u1.pl/om": html(
            "Oświadczenia majątkowe radnych",
            '<a href="/f/1.pdf">Ewa Lis - oświadczenie majątkowe za 2024</a>',
        ),
        "https://u1.pl/f/1.pdf": (200, "application/pdf", PDF + b"1"),
        attachment: (200, "application/pdf", PDF + b"other"),
    }
    rows = [row("lis", "u1", "Ewa", "Lis")]
    _, store, web = search(
        tmp_path, sites, rows, known={"u1.pl": [attachment]}, sitemaps=False
    )
    assert store.people["lis"].status == "found"
    assert not any("govarticle" in c for c in web.calls)


def test_known_files_never_end_a_walk_before_it_starts(tmp_path):
    known = {
        "u1.pl": [
            f"https://u1.pl/pliki/oswiadczenie-majatkowe-ewa-lis-{year}.pdf"
            for year in (2022, 2023, 2024)
        ]
    }
    sites = {"https://u1.pl": html("BIP", "")}  # the old files are gone
    rows = [row("lis", "u1", "Ewa", "Lis")]
    people, store, web = search(tmp_path, sites, rows, known=known, sitemaps=False)
    assert "https://u1.pl" in [c.rstrip("/") for c in web.calls]  # the BIP was asked
    assert store.people["lis"].status == "not_found"


def test_a_file_spelt_twice_counts_and_comes_down_once(tmp_path):
    files = [
        "http://u1.pl/f/oswiadczenie-majatkowe-ewa-lis-2024.pdf",
        "https://u1.pl/f/oswiadczenie-majatkowe-ewa-lis-2024.pdf",
        "https://www.u1.pl/f/oswiadczenie-majatkowe-ewa-lis-2024.pdf",
    ]
    links = "".join(
        f'<a href="{u}">Ewa Lis - oświadczenie majątkowe</a>' for u in files
    )
    sites = {
        "https://u1.pl": html("Oświadczenia majątkowe radnych", links),
        **{u: (200, "application/pdf", PDF + b"1") for u in files},
    }
    rows = [row("lis", "u1", "Ewa", "Lis")]
    _, store, web = search(tmp_path, sites, rows, sitemaps=False)
    assert store.people["lis"].status == "found"
    assert len([c for c in web.calls if c.endswith(".pdf")]) == 1


def test_a_shared_hosts_sitemaps_are_read_once(tmp_path):
    sites = {
        "https://bip.x.pl/u1": html("BIP", ""),
        "https://bip.x.pl/u2": html("BIP", ""),
        "https://bip.x.pl/robots.txt": (200, "text/plain", b"User-agent: *\n"),
    }
    rows = [row("a", "u1", "Ewa", "Lis"), row("b", "u2", "Jan", "Kot")]
    _, _, web = search(
        tmp_path, sites, rows, scopes={"u1": "bip.x.pl/u1", "u2": "bip.x.pl/u2"}
    )
    assert web.calls.count("https://bip.x.pl/robots.txt") == 1
    assert web.calls.count("https://bip.x.pl/sitemap.xml") == 1


def test_the_city_council_comes_before_the_districts_in_warsaw():
    city = office_terms(["Rada miasta"])
    council = LinkContext(
        "https://x.pl/1", "Oświadczenia majątkowe radnych m.st. Warszawy"
    )
    district = LinkContext(
        "https://x.pl/2", "Oświadczenia majątkowe radnych Dzielnicy Bemowo"
    )
    assert link_score(council, [], 1, city) > link_score(district, [], 1, city)
    bemowo = office_terms(["Rada dzielnicy"], ["Bemowo (dzielnica)"])
    wola = LinkContext(
        "https://x.pl/3", "Oświadczenia majątkowe radnych Dzielnicy Wola"
    )
    assert link_score(district, [], 1, bemowo) > link_score(wola, [], 1, bemowo)


def test_units_on_one_host_are_searched_one_at_a_time(tmp_path, monkeypatch):
    # bip.malopolska.pl: one host, one rate, many units.
    shared = {
        u: UnitSeed(
            u, bip_urls=[f"https://bip.shared.pl/{u}"], scopes=[f"bip.shared.pl/{u}"]
        )
        for u in ("a", "b", "c")
    }
    own = {
        u: UnitSeed(u, bip_urls=[f"https://{u}.pl"], scopes=[f"{u}.pl"])
        for u in ("d", "e")
    }
    active: Counter[str] = Counter()
    peak: Counter[str] = Counter()
    lock = threading.Lock()

    def unit(self, unit, rows):
        host = self._unit_host(unit)
        with lock:
            active[host] += 1
            peak[host] = max(peak[host], active[host])
        time.sleep(0.05)
        with lock:
            active[host] -= 1
        return {r.key: "found" for r in rows}

    monkeypatch.setattr(PeopleSearch, "_unit", unit)
    rows = [row(u, u, "Ewa", "Lis") for u in "abcde"]
    store = MemoryBipPeopleStore()
    store.upsert_people(rows)
    people = PeopleSearch(
        store,
        cast("BipQueue", FakeFrontier([])),
        LocalBundleStore(tmp_path / "b"),
        shared | own,
        PeopleOptions(workers=4),
    )
    counts = people.run(
        store.people_to_search(refresh=False, max_priority=None, limit=None)
    )
    assert counts == {"found": 5}
    assert peak["bip.shared.pl"] == 1
    assert peak["d.pl"] == 1 and peak["e.pl"] == 1


def test_a_walk_past_its_own_time_ends_as_budget(tmp_path):
    # A chain of pages that never ends; each look at the clock moves it 60 s.
    sites = {
        f"https://u1.pl/p{i}": html("BIP", f'<a href="/p{i + 1}">dalej</a>')
        for i in range(50)
    }
    sites["https://u1.pl"] = html("BIP", '<a href="/p0">dalej</a>')
    ticks = iter(range(0, 1_000_000, 60))
    rows = [row("lis", "u1", "Ewa", "Lis")]
    _, store, web = search(
        tmp_path,
        sites,
        rows,
        sitemaps=False,
        max_unit_seconds=150,
        clock=lambda: next(ticks),
    )
    assert (store.people["lis"].status, store.people["lis"].reason) == (
        "not_found",
        "budget",
    )
    assert len(web.calls) <= 4  # the depth limit (6) would have allowed 7
