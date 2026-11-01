"""People mode on the hosting platforms whose BIPs it read badly on 10-31."""

from __future__ import annotations

from dataclasses import replace
from typing import cast

from jobs.bip_crawler.people import PeopleOptions, PeopleSearch
from jobs.bip_crawler.people_list import to_search
from jobs.bip_crawler.tests.test_bip import FakeFrontier
from jobs.bip_crawler.tests.test_people_mode_review import (
    PDF,
    Web,
    html,
    row,
    search,
)
from scrapers.bip.classify import normalize_url
from scrapers.bip.people import Candidate, Seeker, candidates, satisfied
from scrapers.bip.units import UnitSeed
from scrapers.common.fetch import HttpResult
from scrapers.common.links import LinkContext, extract_link_contexts
from scrapers.common.ratelimit import HostTokenBucket
from scrapers.stores import BipQueue, with_outcomes
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
    assert store.outcomes["m"].status == "found"
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
    assert store.outcomes["n"].status == "not_found"


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
    assert store.outcomes["n"].status == "found"
    assert web.calls.count("https://u1.pl/om") == 3


def test_a_bip_that_keeps_saying_not_now_is_left_for_a_later_run(tmp_path):
    years = "".join(
        f'<a href="/om/{y}">Oświadczenia majątkowe {y}</a>' for y in (2023, 2024, 2025)
    )
    sites = {**DECLARATIONS, "https://u1.pl": html("BIP", years)}
    busy = {f"https://u1.pl/om/{y}": 99 for y in (2023, 2024, 2025)}
    web = NotNow(sites, busy)
    _, store, _, _ = search(tmp_path, {}, [row("n", "u1", "Jan", "Nowak")], web=web)
    assert (store.outcomes["n"].status, store.outcomes["n"].reason) == (
        "not_found",
        "throttled",
    )
    assert store.units["u1"].status == "throttled"
    web = NotNow(DECLARATIONS, {"https://u1.pl": 99})  # nothing read at all
    _, store, _, _ = search(tmp_path, {}, [row("n", "u1", "Jan", "Nowak")], web=web)
    assert store.outcomes["n"].reason == "throttled"


def test_one_page_that_never_answers_settles_nothing(tmp_path):
    # A module that is down must not send the unit back to every later run.
    sites = {
        **DECLARATIONS,
        "https://u1.pl": html(
            "BIP",
            '<a href="/om">Oświadczenia majątkowe radnych</a>'
            '<a href="/rejestr">Oświadczenia - rejestr</a>',
        ),
    }
    web = NotNow(sites, {"https://u1.pl/rejestr": 99})
    _, store, _, _ = search(tmp_path, {}, [row("n", "u1", "Jan", "Nowak")], web=web)
    assert store.outcomes["n"].status == "found"
    web = NotNow(sites, {"https://u1.pl/rejestr": 99, "https://u1.pl/f/1.pdf": 0})
    _, store, _, _ = search(tmp_path, {}, [row("x", "u1", "Ewa", "Lis")], web=web)
    assert store.units["u1"].status == "searched"


def test_a_refusal_dressed_as_a_page_ends_the_walk(tmp_path):
    sites = {**DECLARATIONS, "https://u1.pl": E_LINE}
    _, store, web, _ = search(tmp_path, sites, [row("n", "u1", "Jan", "Nowak")])
    assert (store.outcomes["n"].status, store.outcomes["n"].reason) == (
        "not_found",
        "refused",
    )
    assert web.calls[-1] == "https://u1.pl" and "https://u1.pl/om" not in web.calls


def test_a_refused_download_says_refused(tmp_path):
    sites = {**DECLARATIONS, "https://u1.pl/f/1.pdf": E_LINE}
    _, store, _, _ = search(tmp_path, sites, [row("n", "u1", "Jan", "Nowak")])
    assert store.outcomes["n"].reason == "refused"


def test_a_websites_bot_check_is_a_refusal(tmp_path):
    challenge = (
        b"<html><head><title>One moment, please...</title></head><body>"
        b'<form id="wsidchk-form"></form><script>check()</script></body></html>'
    )
    web = Web({"https://www.u1.pl": (200, "text/html", challenge)})
    store = MemoryBipPeopleStore()
    listed = [row("n", "u1", "Jan", "Nowak")]
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
    search_.run(
        to_search(
            with_outcomes(listed, store.searched()),
            refresh=False,
            max_priority=None,
            limit=None,
        )
    )
    assert store.outcomes["n"].reason == "refused"


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


def test_a_file_a_host_holds_back_is_left_for_a_later_run(tmp_path):
    web = NotNow(DECLARATIONS, {"https://u1.pl/f/1.pdf": 99})
    _, store, _, _ = search(tmp_path, {}, [row("n", "u1", "Jan", "Nowak")], web=web)
    assert store.outcomes["n"].reason == "throttled"
    assert web.calls.count("https://u1.pl/f/1.pdf") == 3


def test_a_file_held_back_beside_a_lost_one_is_left_for_a_later_run(tmp_path):
    sites = {
        **DECLARATIONS,
        "https://u1.pl/om": html(
            "Oświadczenia majątkowe",
            '<a href="/f/1.pdf">Jan Nowak - oświadczenie majątkowe 2024</a>'
            '<a href="/f/2.pdf">Jan Nowak - oświadczenie majątkowe 2023</a>',
        ),
    }
    web = NotNow(sites, {"https://u1.pl/f/1.pdf": 99})  # /f/2.pdf is gone: 404
    _, store, _, _ = search(tmp_path, {}, [row("n", "u1", "Jan", "Nowak")], web=web)
    assert store.outcomes["n"].reason == "throttled"


def test_a_sitemap_that_says_not_now_is_read_again_by_the_next_unit(tmp_path):
    sitemap = b"<urlset><url><loc>https://u1.pl/oswiadczenia</loc></url></urlset>"
    sites = {**DECLARATIONS, "https://u1.pl/sitemap.xml": (200, "text/xml", sitemap)}
    web = NotNow(sites, {"https://u1.pl/sitemap.xml": 3})
    people, _, _, _ = search(tmp_path, {}, [row("n", "u1", "Jan", "Nowak")], web=web)
    assert "u1.pl" not in people._sitemaps
    assert people._sitemap_urls("https://u1.pl") == ["https://u1.pl/oswiadczenia"]


class Redirects(Web):
    """A site some of whose addresses answer 301 to another."""

    def __init__(self, sites, moved: dict[str, str]) -> None:
        super().__init__(sites)
        self.moved = moved

    def fetch(self, url: str, timeout: float, user_agent: str) -> HttpResult:
        if url in self.moved:
            self.calls.append(url)
            return HttpResult(url, 301, "text/html", b"", location=self.moved[url])
        return super().fetch(url, timeout, user_agent)


def test_a_redirect_is_asked_about_in_robots_txt_hop_by_hop(tmp_path):
    # AkcessNet links /admin, which goes to the /admin/ robots.txt disallows.
    sites = {
        **DECLARATIONS,
        "https://u1.pl": html(
            "BIP",
            '<a href="/admin">Oświadczenia majątkowe - panel</a>'
            '<a href="/stare-om">Oświadczenia majątkowe radnych</a>',
        ),
        "https://u1.pl/admin/": html("Panel", '<a href="/f/9.pdf">Jan Nowak</a>'),
    }
    moved = {"https://u1.pl/admin": "/admin/", "https://u1.pl/stare-om": "om"}
    web = Redirects(sites, moved)
    _, store, _, _ = search(
        tmp_path,
        {},
        [row("n", "u1", "Jan", "Nowak")],
        web=web,
        robots=lambda url: "/admin/" not in url,
    )
    assert "https://u1.pl/admin/" not in web.calls
    assert "https://u1.pl/om" in web.calls
    assert store.outcomes["n"].status == "found"


def test_a_start_whose_robots_txt_does_not_answer_is_unreachable(tmp_path):
    # Not robots, which no default run retries: the start's final slash put
    # it through the as-linked check.
    seeds_ = {"u1": UnitSeed("u1", bip_urls=["https://u1.pl/bip/"], scopes=["u1.pl"])}
    store = MemoryBipPeopleStore()
    listed = [row("n", "u1", "Jan", "Nowak")]
    people = PeopleSearch(
        store,
        cast("BipQueue", FakeFrontier([])),
        LocalBundleStore(tmp_path / "b"),
        seeds_,
        PeopleOptions(workers=1),
        fetch=Web({}).fetch,
        robots_allowed=lambda url: False,
        robots_unreachable=lambda url: True,
        limiter=HostTokenBucket(0),
        sleep=lambda s: None,
    )
    people.run(
        to_search(
            with_outcomes(listed, store.searched()),
            refresh=False,
            max_priority=None,
            limit=None,
        )
    )
    assert store.outcomes["n"].reason == "unreachable"


def test_a_seekers_declaration_page_comes_before_the_next_person(tmp_path):
    # Mazowieckie's sejmik: every councillor sought, a list of their pages,
    # each linking a page per declaration, the file one click further.
    people = [("Grzegorz", "Benedykciński"), ("Katarzyna", "Bornowska")]
    people += [("Anna", "Brzezińska")]
    om = "/oswiadczenia-majatkowe"
    sites = {
        "https://u1.pl": html(
            "Oświadczenia majątkowe",
            "".join(f'<a href="{om}?p=Radni^{s}">{s}@{f}</a>' for f, s in people),
        )
    }
    for first, last in people:
        sites[f"https://u1.pl{om}?p=Radni^{last}"] = html(
            "Oświadczenia majątkowe",
            f'<a href="{om}/{last}.html">Oświadczenie majątkowe {first} {last}</a>',
        )
        sites[f"https://u1.pl{om}/{last}.html"] = html(
            f"Oświadczenie majątkowe {first} {last}",
            f'<a href="/f/{last}.pdf">pobierz</a>',
        )
        sites[f"https://u1.pl/f/{last}.pdf"] = (200, "application/pdf", PDF + b"x")
    rows = [row(last, "u1", first, last) for first, last in people]
    _, store, _, _ = search(tmp_path, sites, rows, unit_pages=3, pages_per_candidacy=1)
    assert store.outcomes["Benedykciński"].status == "found"


def test_only_files_satisfy_a_seeker():
    wojtczak = Seeker.of("w", "Wojciech", "Wojtczak")
    pages = [
        Candidate(
            "w",
            f"https://u1.pl/index.php?cmd=zawartosc&opt=pokaz&id={year}",
            f"Oświadczenie majątkowe za rok {year}",
            "Wojtczak Wojciech",
            "https://u1.pl",
            True,
            True,
            6.5,
        )
        for year in (2022, 2023, 2024)
    ]
    assert not satisfied(pages, [wojtczak], 3)
    # The walk asked for each and got a file back.
    assert satisfied(pages, [wojtczak], 3, {normalize_url(c.url) for c in pages})
    pdfs = [replace(c, url=f"https://u1.pl/f/{i}.pdf") for i, c in enumerate(pages)]
    assert satisfied(pdfs, [wojtczak], 3)


def test_a_link_the_walk_read_as_a_page_is_no_file(tmp_path):
    # Grójec (11-01): a councillor's row links a page a year (index.php?...&id=),
    # which names them in full only in a link back to their page and holds the
    # PDF, named by the surname alone. The walk took the three links for files,
    # ended on the list and downloaded three pages.
    show = "/index.php?cmd=zawartosc&opt=pokaz&id="
    years = (2024, 2023, 2022)
    cells = "".join(
        f'<td><a href="{show}{y}">Oświadczenie majątkowe za rok {y}</a></td>'
        for y in years
    )
    sites = {
        "https://u1.pl": html(
            "Oświadczenia majątkowe radnych",
            f"<table><tr><td>Wojtczak Wojciech</td>{cells}</tr></table>",
        ),
        f"https://u1.pl{show}900": html("Wojtczak Wojciech", f"<table>{cells}</table>"),
    }
    for y in years:
        sites[f"https://u1.pl{show}{y}"] = html(
            f"Oświadczenie majątkowe za rok {y}",
            f'<a href="{show}900">Wojtczak Wojciech</a>'
            f"<h3>Oświadczenie majątkowe za rok {y}</h3>"
            f'<a href="/pliki/radni/wojtczak_{y}.pdf">Pobierz plik</a>',
        )
        sites[f"https://u1.pl/pliki/radni/wojtczak_{y}.pdf"] = (
            200,
            "application/pdf",
            PDF + str(y).encode(),
        )
    _, store, _, _ = search(tmp_path, sites, [row("w", "u1", "Wojciech", "Wojtczak")])
    assert store.outcomes["w"].status == "found"
    assert {d.url for d in store.person_docs("w")} == {
        f"https://u1.pl/pliki/radni/wojtczak_{y}.pdf" for y in years
    }


def test_an_id_link_that_is_a_file_ends_the_walk_and_comes_down_once(tmp_path):
    # Most ?id= links are files: the walk asks for them as pages, keeps what
    # comes back, counts it, and the download takes it from there.
    get = "/index.php?id="
    items = "".join(
        f'<li><a href="{get}{i}">Oświadczenie majątkowe za {y} - Jan Nowak</a></li>'
        for i, y in enumerate((2024, 2023, 2022), 1)
    )
    sites = {
        "https://u1.pl": html(
            "Oświadczenia majątkowe radnych",
            f'<ul>{items}</ul><a href="/dalej">Dalej</a>',
        ),
        "https://u1.pl/dalej": html("Oświadczenia majątkowe", "nic"),
    }
    for i in (1, 2, 3):
        sites[f"https://u1.pl{get}{i}"] = (200, "application/pdf", PDF + bytes([i]))
    _, store, web, _ = search(tmp_path, sites, [row("n", "u1", "Jan", "Nowak")])
    assert store.outcomes["n"].status == "found"
    assert len(store.person_docs("n")) == 3
    for i in (1, 2, 3):
        assert web.calls.count(f"https://u1.pl{get}{i}") == 1
    assert "https://u1.pl/dalej" not in web.calls


def test_a_files_publication_record_names_nobody_it_is_about():
    # Kraków's declaration cards (11-01): each version's row ends in who entered
    # it, which took the PDF from the councillor the card is titled with.
    card = "https://www.bip.krakow.pl/oswiadczenie/25420/karta/"
    title = "BIP MK | Oświadczenie nr 25420, Sławomir Pietrzyk, rok: 2024"
    pdf = LinkContext(
        "https://www.bip.krakow.pl/oswiadczenia/osw_25420.pdf",
        "zobacz",
        row="zobacz 1.11 MB 2024-05-22 13:23:37 AGATA MICHALISZYN 1 (Najnowsza)",
        heading="wersja",
    )
    pietrzyk = Seeker.of("p", "Sławomir", "Pietrzyk")
    (found,) = candidates(card, title, [pdf], [pietrzyk])
    assert (found.key, found.first_name, found.declaration_like) == ("p", True, True)
    # A declarant named before the record stays the row's (Warka).
    warka = LinkContext(
        "https://warka.bipgminy.pl/f/1.pdf",
        "Oświadczenie majątkowe złożone na koniec kadencji",
        row="Oświadczenie majątkowe złożone na koniec kadencji Typ pliku: PDF, "
        "Rozmiar: 700 KB Wytworzył: Grzegorz Szydło Udostępnił: Fronczek Mariusz "
        "(2024-03-13 12:57:47)",
    )
    szydlo = Seeker.of("s", "Grzegorz", "Szydło")
    page = "https://warka.bipgminy.pl/oswiadczenia"
    (own,) = candidates(page, "Oświadczenia majątkowe", [warka], [szydlo])
    assert (own.key, own.first_name) == ("s", True)


RYBNIK = (("Joanna", "Brzózka"), ("Marian", "Kaim"), ("Tadeusz", "Pałka"))


def rybnik_detail(first: str, last: str, file: str) -> str:
    """The page "Pokaż" opens: the person in a form field, the editor beside."""
    return (
        '<a href="/Default.aspx?Page=18&Id=667">Sylwia Grzyb (Kierownik Biura)</a>'
        f"<div><strong>Nazwisko i imię</strong></div><div>{first} {last}</div>"
        f'<span><a href="{file}">Oświadczenie majątkowe</a> [pdf - 1037 KB]</span>'
    )


def test_a_page_a_seekers_declaration_link_opens_lends_them_its_file():
    palka = Seeker.of("p", "Tadeusz", "Pałka")
    page = "https://u1.pl/Default.aspx?Page=88&Id=2"
    detail = rybnik_detail("Tadeusz", "Pałka", "/Download.ashx?id=7")
    _, _, body = html("Radni - BIP", detail)
    title, links = extract_link_contexts(body, page)
    assert [c.key for c in candidates(page, title, links, [palka])] == []
    (lent,) = candidates(page, title, links, [palka], lender=palka.name)
    assert (lent.url, lent.key, lent.first_name, lent.declaration_like) == (
        "https://u1.pl/Download.ashx?id=7",
        "p",
        True,
        True,
    )
    # A page titled with somebody else's name lends nobody its files.
    other = "Oświadczenie majątkowe - J. Kowalski"
    assert candidates(page, other, links, [palka], lender=palka.name) == []


def test_a_pokaz_whose_row_says_a_seekers_declaration_is_read_first(tmp_path):
    # Rybnik (11-01): 254 rows like "Joanna Brzózka Oświadczenie majątkowe
    # 2026-04-30 Pokaż", every link only "Pokaż": all ranked alike.
    rows = "".join(
        f"<tr><td>{first} {last}</td><td>Oświadczenie majątkowe</td>"
        f'<td>2026-04-30</td><td><a href="/Default.aspx?Page=88&Id={i}">Pokaż</a>'
        "</td></tr>"
        for i, (first, last) in enumerate(RYBNIK)
    )
    sites = {"https://u1.pl": html("Radni - BIP", f"<table>{rows}</table>")}
    for i, (first, last) in enumerate(RYBNIK):
        file = f"/Download.ashx?id={100 + i}"
        sites[f"https://u1.pl/Default.aspx?Page=88&Id={i}"] = html(
            "Radni - BIP", rybnik_detail(first, last, file)
        )
        sites[f"https://u1.pl{file}"] = (200, "application/pdf", PDF + bytes([i]))
    _, store, _, _ = search(
        tmp_path,
        sites,
        [row("p", "u1", "Tadeusz", "Pałka")],
        unit_pages=2,
        pages_per_candidacy=0,
        sitemaps=False,
    )
    assert store.outcomes["p"].status == "found"
    assert [d.url for d in store.person_docs("p")] == [
        "https://u1.pl/Download.ashx?id=102"
    ]
