"""People mode on big BIPs: a budget by unit size, the seekers' own council
first, walks that start from declaration URLs known before walking, and pages
drawn by a script rendered first."""

from __future__ import annotations

import gzip
import json
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
    tmp_path: Path, sites, rows, *, known=None, scopes=None, render=None, **options
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

    def render(url: str) -> HttpResult:
        drawn.append(url)
        status, kind, body = DRAWN[normalize_url(url).rstrip("/")]
        return HttpResult(url, status, kind, body)

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
