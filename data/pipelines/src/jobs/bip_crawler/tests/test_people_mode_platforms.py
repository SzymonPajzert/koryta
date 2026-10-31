"""People mode on the hosting platforms whose BIPs it read badly on 10-31."""

from __future__ import annotations

from typing import cast

from jobs.bip_crawler.people import PeopleOptions, PeopleSearch
from jobs.bip_crawler.tests.test_bip import FakeFrontier
from jobs.bip_crawler.tests.test_people_mode_review import (
    PDF,
    Web,
    html,
    row,
    search,
)
from scrapers.bip.classify import normalize_url
from scrapers.bip.people import Seeker, candidates
from scrapers.bip.units import UnitSeed
from scrapers.common.fetch import HttpResult
from scrapers.common.links import LinkContext
from scrapers.common.ratelimit import HostTokenBucket
from scrapers.stores import BipQueue
from stores.bip_bundles import LocalBundleStore
from stores.bip_people import MemoryBipPeopleStore

#: SYSTEMDOBIP.PL's answer to the crawler (10-31), whatever the pace.
NOTICE = "Zbyt dużo jednoczesnych połączeń do strony. Prosze spróbowac za moment. #13"
E_LINE = (200, "text/html; charset=UTF-8", NOTICE.encode())


def test_bip_net_pl_attachments_on_the_api_host_are_files(tmp_path):
    # bip.net.pl (BIP v2): titles carry the office's name only, the file links
    # go to the office's -api host with no extension and redirect to the PDF.
    article = (
        "<h2>Oświadczenie majątkowe radnych złożone na rozpoczęcie kadencji</h2>"
        "<ul><li>"
        '<a href="https://u1-api.bip.net.pl/api/attachments/1835">'
        "Jan Malinowski.pdf Jan Malinowski.pdf 3.51 MB</a></li><li>"
        '<a href="https://u1-api.bip.net.pl/api/attachments/1836">'
        "Ewa Lis.pdf Ewa Lis.pdf 3.48 MB</a></li></ul>"
    )
    category = "/kategorie/51-oswiadczenia-majatkowe"
    radni = f"{category}/artykuly/1229-radni?lang=PL"
    sites = {
        "https://u1.pl": html(
            "BIP Urząd Gminy U1",
            f'<a href="{category}?lang=PL">Oświadczenia majątkowe</a>',
        ),
        f"https://u1.pl{category}?lang=PL": html(
            "BIP Urząd Gminy U1",
            f'<a href="{radni}">'
            "Oświadczenie majątkowe radnych złożone na rozpoczęcie kadencji</a>",
        ),
        f"https://u1.pl{radni}": html("BIP Urząd Gminy U1", article),
        "https://u1-api.bip.net.pl/api/attachments/1835": (
            200,
            "application/pdf",
            PDF + b"jm",
        ),
        "https://u1-api.bip.net.pl/api/attachments/1836": (
            200,
            "application/pdf",
            PDF + b"el",
        ),
    }
    _, store, web, _ = search(tmp_path, sites, [row("m", "u1", "Jan", "Malinowski")])
    assert store.people["m"].status == "found"
    assert [d.url for d in store.person_docs("m")] == [
        "https://u1-api.bip.net.pl/api/attachments/1835"
    ]
    assert "https://u1-api.bip.net.pl/api/attachments/1836" not in web.calls


def test_robots_txt_is_asked_about_a_page_as_it_was_linked(tmp_path):
    # AkcessNet's robots.txt disallows /admin/; normalize_url drops the slash,
    # and the 10-31 walks asked robots.txt about /admin alone.
    sites = {
        "https://u1.pl": html(
            "BIP", '<a href="/admin/">Oświadczenia majątkowe radnych</a>'
        ),
        "https://u1.pl/admin": html(
            "Oświadczenia majątkowe",
            '<a href="/f/1.pdf">Jan Nowak - oświadczenie majątkowe</a>',
        ),
        "https://u1.pl/f/1.pdf": (200, "application/pdf", PDF + b"n"),
    }
    _, store, web, _ = search(
        tmp_path,
        sites,
        [row("n", "u1", "Jan", "Nowak")],
        robots=lambda url: "/admin/" not in url,
    )
    assert not any("/admin" in call for call in web.calls)
    assert store.people["n"].status == "not_found"


class NotNow(Web):
    """A site whose pages answer 429 a given number of times first."""

    def __init__(self, sites, not_now: dict[str, int]) -> None:
        super().__init__(sites)
        self.not_now = {normalize_url(u).rstrip("/"): n for u, n in not_now.items()}

    def fetch(self, url: str, timeout: float, user_agent: str) -> HttpResult:
        key = normalize_url(url).rstrip("/")
        if self.not_now.get(key, 0) > 0:
            self.not_now[key] -= 1
            self.calls.append(url)
            return HttpResult(url, 429, "text/html", b"<center>nginx</center>")
        return super().fetch(url, timeout, user_agent)


DECLARATIONS = {
    "https://u1.pl": html("BIP", '<a href="/om">Oświadczenia majątkowe radnych</a>'),
    "https://u1.pl/om": html(
        "Oświadczenia majątkowe",
        '<a href="/f/1.pdf">Jan Nowak - oświadczenie majątkowe</a>',
    ),
    "https://u1.pl/f/1.pdf": (200, "application/pdf", PDF + b"n"),
}


def test_a_page_that_says_not_now_is_asked_again(tmp_path):
    web = NotNow(DECLARATIONS, {"https://u1.pl/om": 2})
    _, store, _, _ = search(tmp_path, {}, [row("n", "u1", "Jan", "Nowak")], web=web)
    assert store.people["n"].status == "found"
    assert web.calls.count("https://u1.pl/om") == 3


def test_a_bip_that_keeps_saying_not_now_is_left_for_a_later_run(tmp_path):
    web = NotNow(DECLARATIONS, {"https://u1.pl/om": 99})
    _, store, _, _ = search(tmp_path, {}, [row("n", "u1", "Jan", "Nowak")], web=web)
    assert (store.people["n"].status, store.people["n"].reason) == (
        "not_found",
        "throttled",
    )
    assert store.units["u1"].status == "throttled"


def test_a_refusal_dressed_as_a_page_ends_the_walk(tmp_path):
    sites = {**DECLARATIONS, "https://u1.pl": E_LINE}
    _, store, web, _ = search(tmp_path, sites, [row("n", "u1", "Jan", "Nowak")])
    assert (store.people["n"].status, store.people["n"].reason) == (
        "not_found",
        "refused",
    )
    assert web.calls[-1] == "https://u1.pl" and "https://u1.pl/om" not in web.calls


def test_a_refused_download_says_refused(tmp_path):
    sites = {**DECLARATIONS, "https://u1.pl/f/1.pdf": E_LINE}
    _, store, _, _ = search(tmp_path, sites, [row("n", "u1", "Jan", "Nowak")])
    assert store.people["n"].reason == "refused"


def test_a_websites_bot_check_is_a_refusal(tmp_path):
    challenge = (
        b"<html><head><title>One moment, please...</title></head><body>"
        b'<form id="wsidchk-form"></form><script>check()</script></body></html>'
    )
    web = Web({"https://www.u1.pl": (200, "text/html", challenge)})
    store = MemoryBipPeopleStore()
    store.upsert_people([row("n", "u1", "Jan", "Nowak")])
    search_ = PeopleSearch(
        store,
        cast("BipQueue", FakeFrontier([])),
        LocalBundleStore(tmp_path / "b"),
        {"u1": UnitSeed("u1", www_urls=["https://www.u1.pl"])},
        PeopleOptions(workers=1),
        fetch=web.fetch,
        limiter=HostTokenBucket(0),
        sleep=lambda s: None,
    )
    search_.run(store.people_to_search(refresh=False, max_priority=None, limit=None))
    assert store.people["n"].reason == "refused"


def test_a_walk_takes_one_request_a_second_from_the_start():
    search_ = PeopleSearch(
        MemoryBipPeopleStore(),
        cast("BipQueue", FakeFrontier([])),
        LocalBundleStore("/nonexistent"),
        {},
        PeopleOptions(workers=1),
    )
    assert search_.limiter.acquire("u1.pl")
    assert not search_.limiter.acquire("u1.pl")


def test_a_paused_host_gets_no_token_until_the_pause_is_over():
    now = [0.0]
    bucket = HostTokenBucket(1.0, clock=lambda: now[0])
    assert bucket.acquire("h")
    bucket.pause("h", 30)
    now[0] = 29.0
    assert not bucket.acquire("h")
    now[0] = 31.5
    assert bucket.acquire("h")


def test_akcessnet_menu_links_are_pages_not_files():
    # An AkcessNet person page lent its person every menu link (10-31).
    base = "https://www.bip.x.akcessnet.net"
    links = [
        LinkContext(f"{base}/index.php?idg=4&id=375&x=138&y=16", "Rada Gminy"),
        LinkContext(f"{base}/upload/plik,20250430,kowalski.pdf", "za 2024"),
    ]
    jan = Seeker.of("k", "Jan", "Kowalski")
    found = candidates(f"{base}/o", "Jan Kowalski - oświadczenia", links, [jan])
    assert [c.url for c in found] == [links[1].url]
