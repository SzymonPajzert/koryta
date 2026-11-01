"""Madkom's BIPs read through their API: the app's addresses, the pages drawn
from its JSON, what robots.txt hides, and a walk that never renders them."""

from __future__ import annotations

import json
from pathlib import Path

from jobs.bip_crawler import people as people_mode
from jobs.bip_crawler.madkom import PROBES, ROBOTS, Madkom, Route, route
from jobs.bip_crawler.tests.test_people_mode_big_bips import search
from jobs.bip_crawler.tests.test_people_mode_review import PDF, Web, row
from scrapers.common.fetch import HttpResult
from scrapers.common.links import extract_link_contexts

SHELL = (
    b'<!doctype html><html data-ng-app="app"><body><div data-ui-view="content">'
    b"</div><script>var MadkomConfiguration = {}</script>"
    b'<script src="./app-conf.js"></script></body></html>'
)
REACT_SHELL = (
    b'<!doctype html><html><body><nav><a id="home" href="/">Home</a> | '
    b'<a id="calc" href="/e,kalkulator.html">Calculators</a></nav>'
    b'<div id="root"></div><script src="/static/js/main.1.chunk.js"></script>'
    b"</body></html>"
)
API = "https://bip.m.pl/api/"
LIST = "limit=100&offset=0"


def js(data: object) -> tuple[int, str, bytes]:
    return 200, "application/json", json.dumps(data).encode()


def menu(*branch: dict) -> list[dict]:
    """The office's menu as menu/<id> answers it, ``branch`` unfolded."""
    return [
        {"id": "5", "type": "S", "name": "Podmiotowe", "link": "ugx,m,5,p.html"},
        {
            "id": "10",
            "type": "D",
            "name": "Oświadczenia majątkowe",
            "link": "ugx,m,11,radni.html",
            "children": list(branch) or None,
        },
        {
            "id": "20",
            "type": "N",
            "name": "Przetargi",
            "link": "ugx,m,20,przetargi.html",
        },
    ]


RADNI = {"id": "11", "type": "N", "name": "Radni", "link": "ugx,m,11,radni.html"}
PATH = [
    {"id": "11", "parentId": "10", "name": "Radni"},
    {"id": "10", "parentId": "1", "name": "Oświadczenia majątkowe"},
    {"id": "1", "parentId": None, "name": "Menu podmiotowe"},
]


def article(ident: str, title: str) -> dict:
    return {
        "id": ident,
        "link": f"ugx,a,{ident},{title.lower().replace(' ', '-')}.html",
        "columnFields": [{"fieldId": "title", "value": title.replace("ó", "&oacute;")}],
        "aliasFields": [
            {"alias": "title", "value": title},
            {"alias": "lead", "value": "Oświadczenie majątkowe 2024"},
        ],
    }


def office(**extra: tuple[int, str, bytes]) -> dict[str, tuple[int, str, bytes]]:
    """An office "ugx" on bip.m.pl: two councillors, Ewa Lis with one file."""
    return {
        "https://bip.m.pl/ugx": (200, "text/html", SHELL),
        API + "contexts/ugx": js(
            {"defaultMenuId": "1", "unitFullName": "Urząd Gminy X"}
        ),
        API + "menu/1": js(menu()),
        API + "menu/11": js(menu(RADNI)),
        API + f"menu/11/articles?{LIST}": js(
            {
                "total": 2,
                "offset": 0,
                "articles": [article("101", "Ewa Lis"), article("102", "Jan Nowak")],
                "menuPath": PATH,
                "hasArchived": True,
                "outdatedListLink": "ugx,o,11,radni.html",
            }
        ),
        API + "articles/101": js(
            {
                "title": "Ewa Lis",
                "content": '<p><a href="https://bip.m.pl/e,pobierz,get.html?id=501">'
                "Oświadczenie za 2024</a></p>",
                "attachments": [
                    {
                        "id": 501,
                        "name": "Oświadczenie majątkowe - radna Ewa Lis - 2024",
                        "extension": "pdf",
                        "downloadable": True,
                        "deleted": False,
                    },
                    {"id": 502, "name": "stare", "extension": "pdf", "deleted": True},
                ],
                "mainMenuPath": PATH,
            }
        ),
        API + "files/501": (200, "application/pdf", PDF + b"501"),
        **extra,
    }


def adapter(sites: dict, hidden: frozenset[str] = frozenset()) -> tuple[Madkom, Web]:
    web = Web(sites)

    def get(url: str) -> HttpResult | str:
        return ROBOTS if url in hidden else web.fetch(url, 15.0, "test")

    madkom = Madkom(get, lambda url: url not in hidden)
    return madkom, web


def links(page: HttpResult | str | None) -> dict[str, str]:
    assert isinstance(page, HttpResult) and page.ok
    _, found = extract_link_contexts(page.content, page.url, page.content_type)
    return {link.url: link.anchor for link in found}


def probed(sites: dict, hidden: frozenset[str] = frozenset()) -> tuple[Madkom, Web]:
    madkom, web = adapter(sites, hidden)
    shell = web.fetch("https://bip.m.pl/ugx", 15.0, "test")
    assert madkom.probe(shell)
    return madkom, web


def test_addresses_are_read_as_the_apps_router_reads_them() -> None:
    assert route("https://bip.m.pl/umwm") == Route("umwm")
    assert route("https://bip.m.pl/umwm,m,439367,2024-2029.html") == Route(
        "umwm", "m", "439367"
    )
    assert route("https://bip.m.pl/umwm,o,439367,2024-2029.html?page=3") == Route(
        "umwm", "o", "439367", 3
    )
    assert route("https://bip.gminaolawa.pl/") == Route("default")
    assert route("https://bip.gminaolawa.pl/m,604,rada-gminy.html") == Route(
        "default", "m", "604"
    )
    assert route("https://bip.gminaolawa.pl/a,24533,artykul.html") == Route(
        "default", "a", "24533"
    )
    # The old addresses, as the app maps them.
    assert route("https://bip.m.pl/spkrakow/Article/id,46718.html") == Route(
        "spkrakow", "m", "46718"
    )
    assert route("http://bip.ug.nv.pl/Article/get/id,16046.html") == Route(
        "default", "a", "16046"
    )
    assert route("https://bip.m.pl/e,pobierz,get.html?id=1") == Route("default", "e")
    assert route("https://bip.m.pl/favicon.ico") is None
    assert route("https://bip.m.pl/static/js/main.js") is None


def test_the_offices_start_is_its_menu() -> None:
    madkom, web = probed(office())
    found = links(madkom.page("https://bip.m.pl/ugx"))
    assert found["https://bip.m.pl/ugx,m,11,radni.html"] == "Oświadczenia majątkowe"
    assert "https://bip.m.pl/ugx,m,5,p.html" not in found  # a separator: a heading
    # The context came with the probe: one more call, the menu.
    assert web.calls[-1] == API + "menu/1"


def test_a_section_lists_its_articles_under_their_titles() -> None:
    madkom, web = probed(office())
    page = madkom.page("https://bip.m.pl/ugx,m,11,radni.html")
    found = links(page)
    assert found["https://bip.m.pl/ugx,a,101,ewa-lis.html"] == "Ewa Lis"
    assert found["https://bip.m.pl/ugx,a,102,jan-nowak.html"] == "Jan Nowak"
    assert found["https://bip.m.pl/ugx,o,11,radni.html"] == "Archiwum"
    assert isinstance(page, HttpResult)
    title, _ = extract_link_contexts(page.content, page.url, page.content_type)
    assert title.startswith("Radni - Oświadczenia majątkowe")
    assert web.calls[-2:] == [API + "menu/11", API + f"menu/11/articles?{LIST}"]


def test_a_long_section_goes_on_to_its_next_page() -> None:
    first = {"total": 150, "offset": 0, "articles": [article("101", "Ewa Lis")]}
    madkom, web = probed(
        office(**{API + f"menu/11/articles?{LIST}": js(first)})
        | {API + "menu/11/articles?limit=100&offset=100": js({"articles": []})}
    )
    found = links(madkom.page("https://bip.m.pl/ugx,m,11,radni.html"))
    assert "https://bip.m.pl/ugx,m,11,radni.html?page=2" in found
    madkom.page("https://bip.m.pl/ugx,m,11,radni.html?page=2")
    assert web.calls[-1] == API + "menu/11/articles?limit=100&offset=100"


def test_an_archive_asks_for_the_archived_articles_alone() -> None:
    madkom, web = probed(
        office(
            **{
                API + f"menu/11/articles?{LIST}&archived=true": js(
                    {"articles": [article("103", "Adam Stary")], "menuPath": PATH}
                )
            }
        )
    )
    found = links(madkom.page("https://bip.m.pl/ugx,o,11,radni.html"))
    assert found["https://bip.m.pl/ugx,a,103,adam-stary.html"] == "Adam Stary"
    assert web.calls[-1] == API + f"menu/11/articles?{LIST}&archived=true"


def test_an_article_shows_its_files_by_their_names_first() -> None:
    madkom, _ = probed(office())
    page = madkom.page("https://bip.m.pl/ugx,a,101,ewa-lis.html")
    found = links(page)
    # The text's link to the same file keeps the attachment's fuller name.
    assert found["https://bip.m.pl/api/files/501"] == (
        "Oświadczenie majątkowe - radna Ewa Lis - 2024 (pdf)"
    )
    assert "https://bip.m.pl/api/files/502" not in found  # deleted
    # The way back to the office, as the app shows beside an article.
    assert found["https://bip.m.pl/ugx"] == "Urząd Gminy X"
    assert isinstance(page, HttpResult)
    title, _ = extract_link_contexts(page.content, page.url, page.content_type)
    assert title.startswith("Ewa Lis - Radni - Oświadczenia majątkowe")


def test_what_robots_txt_hides_by_the_apps_addresses_stays_hidden() -> None:
    hidden = frozenset(
        {
            "https://bip.m.pl/ugx,a,102,artykul.html",
            "https://bip.m.pl/e,pobierz,get.html?id=501",
        }
    )
    madkom, web = probed(office(), hidden)
    found = links(madkom.page("https://bip.m.pl/ugx,m,11,radni.html"))
    assert "https://bip.m.pl/ugx,a,102,jan-nowak.html" not in found
    asked = len(web.calls)
    assert madkom.page("https://bip.m.pl/ugx,a,102,jan-nowak.html") == ROBOTS
    assert len(web.calls) == asked  # no API call stood in for it
    found = links(madkom.page("https://bip.m.pl/ugx,a,101,ewa-lis.html"))
    assert not [u for u in found if "/api/files/" in u]


def test_a_host_is_probed_once_by_its_first_page() -> None:
    madkom, web = adapter(office())
    pdf = HttpResult("https://bip.m.pl/f.pdf", 200, "application/pdf", PDF)
    assert not madkom.probe(pdf)  # a file says nothing: not remembered
    assert not madkom.knows("https://bip.m.pl/ugx")
    plain = HttpResult("https://other.pl/", 200, "text/html", b"<html>BIP</html>")
    assert not madkom.probe(plain) and not madkom.knows("https://other.pl/x")
    assert web.calls == []  # no shell, no API call
    shell = HttpResult("https://bip.m.pl/ugx", 200, "text/html", SHELL)
    assert madkom.probe(shell) and madkom.knows("https://bip.m.pl/ugx,m,1,x.html")
    assert madkom.probe(shell) and web.calls == [API + "contexts/ugx"]


def test_a_shell_whose_api_does_not_answer_is_no_madkom_host() -> None:
    madkom, _ = adapter({"https://bip.m.pl/ugx": (200, "text/html", SHELL)})
    shell = HttpResult("https://bip.m.pl/ugx", 200, "text/html", SHELL)
    assert not madkom.probe(shell)
    assert madkom.page("https://bip.m.pl/ugx") is None


def test_an_api_robots_txt_keeps_out_is_not_read_around() -> None:
    madkom, _ = adapter(office(), frozenset({API + "contexts/ugx"}))
    shell = HttpResult("https://bip.m.pl/ugx", 200, "text/html", SHELL)
    assert madkom.probe(shell)
    assert madkom.page("https://bip.m.pl/ugx,m,11,radni.html") == ROBOTS


def test_a_single_office_hosts_react_app_is_read_from_its_default_context() -> None:
    sites = {
        "https://bip.r.pl/": (200, "text/html", REACT_SHELL),
        "https://bip.r.pl/api/contexts/default": js({"defaultMenuId": "12"}),
        "https://bip.r.pl/api/menu/12": js(
            [
                {
                    "id": "604",
                    "type": "D",
                    "name": "Rada Gminy",
                    "link": "m,604,rada.html",
                }
            ]
        ),
    }
    madkom, _ = adapter(sites)
    shell = HttpResult("https://bip.r.pl/", 200, "text/html", REACT_SHELL)
    assert madkom.probe(shell)
    assert links(madkom.page("https://bip.r.pl/")) == {
        "https://bip.r.pl/m,604,rada.html": "Rada Gminy"
    }
    # A page the API does not draw costs nothing.
    assert links(madkom.page("https://bip.r.pl/e,kalkulator.html")) == {}


def test_the_walk_reads_a_madkom_bip_through_its_api(tmp_path: Path) -> None:
    rendered: list[str] = []

    def render(url: str):
        rendered.append(url)
        return HttpResult(url, 0, "", b"", "no browser"), 0

    store_people, store, web = search(
        tmp_path,
        office(),
        [row("lis", "u1", "Ewa", "Lis")],
        scopes={"u1": "bip.m.pl/ugx"},
        render=render,
        sitemaps=False,
    )
    assert store.outcomes["lis"].status == "found"
    (doc,) = [d for d in store.person_docs("lis") if d.status == "ok"]
    assert doc.url == "https://bip.m.pl/api/files/501"
    assert doc.page_url == "https://bip.m.pl/ugx,a,101,ewa-lis.html"
    assert rendered == []
    # The shell once; then the API: the context, the menus, the list, the article.
    assert web.calls[0] == "https://bip.m.pl/ugx"
    assert all(c.startswith(API) for c in web.calls[1:])
    assert store_people.madkom.knows("https://bip.m.pl/ugx")


def test_a_walk_whose_madkom_api_says_not_now_is_left_for_later(tmp_path) -> None:
    busy = {url: (429, "text/html", b"busy") for url in office() if API in url}
    _, store, _ = search(
        tmp_path,
        office(**busy),
        [row("lis", "u1", "Ewa", "Lis")],
        scopes={"u1": "bip.m.pl/ugx"},
        sitemaps=False,
    )
    assert store.outcomes["lis"].reason == "throttled"


def test_madkom_and_the_walk_agree_on_robots() -> None:
    assert ROBOTS == people_mode.ROBOTS


# -- what the review of 10-30 found ----------------------------------------------
R_API = "https://bip.r.pl/api/"
ROK = {"id": "165", "type": "D", "name": "Rok 2025", "link": "m,165,rok-2025.html"}


def react_office(separator: str = "Oświadczenia majątkowe") -> dict:
    """bip.ugsiemiatkowo.nv.pl's shape: a D section linking to itself under a
    separator, its listing holding the councillors' article."""
    top = [
        {"id": "59", "type": "S", "name": separator, "link": "m,59,s.html"},
        ROK,
        {"id": "70", "type": "N", "name": "Przetargi", "link": "m,70,p.html"},
    ]
    return {
        "https://bip.r.pl/": (200, "text/html", REACT_SHELL),
        R_API + "contexts/default": js({"defaultMenuId": "12"}),
        R_API + "menu/12": js(top),
        R_API + "menu/165": js(top),
        R_API + f"menu/165/articles?{LIST}": js(
            {
                "total": 1,
                "offset": 0,
                "articles": [
                    {
                        "id": "17106",
                        "link": "a,17106,radni-gminy.html",
                        "aliasFields": [{"alias": "title", "value": "Radni Gminy"}],
                    }
                ],
                "menuPath": [
                    {"id": "165", "parentId": "12", "name": "Rok 2025"},
                    {"id": "12", "parentId": None, "name": "Menu podmiotowe"},
                ],
            }
        ),
        R_API + "articles/17106": js(
            {
                "title": "Radni Gminy",
                "mainMenuId": "165",
                "mainMenuPath": [
                    {
                        "id": "165",
                        "parentId": "12",
                        "name": "Rok 2025",
                        "url": "m,165,rok-2025.html",
                    },
                    {"id": "12", "parentId": None, "name": "Menu podmiotowe"},
                ],
                "attachments": [
                    {"id": 900, "name": "Domański Kazimierz", "extension": "pdf"}
                ],
            }
        ),
        R_API + "files/900": (200, "application/pdf", PDF + b"900"),
    }


def react(sites: dict) -> tuple[Madkom, Web]:
    madkom, web = adapter(sites)
    assert madkom.probe(HttpResult("https://bip.r.pl/", 200, "text/html", REACT_SHELL))
    return madkom, web


def title_of(page: HttpResult | str | None) -> str:
    assert isinstance(page, HttpResult) and page.ok
    return extract_link_contexts(page.content, page.url, page.content_type)[0]


def test_a_d_section_lists_its_own_articles() -> None:
    madkom, _ = react(react_office())
    madkom.page("https://bip.r.pl/")
    page = madkom.page("https://bip.r.pl/m,165,rok-2025.html")
    assert links(page)["https://bip.r.pl/a,17106,radni-gminy.html"] == "Radni Gminy"
    # The separator over the section is its only word about declarations.
    assert title_of(page).startswith("Rok 2025 - Oświadczenia majątkowe")
    article = madkom.page("https://bip.r.pl/a,17106,radni-gminy.html")
    assert title_of(article).startswith("Radni Gminy - Rok 2025 - Oświadczenia")


def test_a_separator_that_names_somebody_stays_out_of_titles() -> None:
    madkom, _ = react(react_office(separator="Wójt Jan Kowalski"))
    page = madkom.page("https://bip.r.pl/m,165,rok-2025.html")
    assert "Kowalski" not in title_of(page)


def test_files_named_by_the_councillor_alone_come_down_under_a_separator(
    tmp_path: Path,
) -> None:
    _, store, _ = search(
        tmp_path,
        react_office(),
        [row("dom", "u1", "Kazimierz", "Domański")],
        scopes={"u1": "bip.r.pl"},
        sitemaps=False,
    )
    assert store.outcomes["dom"].status == "found"


def test_a_listing_that_fails_keeps_the_menu() -> None:
    madkom, _ = probed(
        office(**{API + f"menu/11/articles?{LIST}": (500, "text/html", b"error")})
    )
    found = links(madkom.page("https://bip.m.pl/ugx,m,11,radni.html"))
    assert found["https://bip.m.pl/ugx,m,20,przetargi.html"] == "Przetargi"


def test_a_listing_that_says_not_now_is_left_unread() -> None:
    # Drawn without its articles, the section read as listing nobody.
    madkom, _ = probed(
        office(**{API + f"menu/11/articles?{LIST}": (429, "text/html", b"busy")})
    )
    page = madkom.page("https://bip.m.pl/ugx,m,11,radni.html")
    assert isinstance(page, HttpResult) and page.status == 429


def test_an_api_that_says_not_now_hands_the_walk_its_answer() -> None:
    def busy(url: str) -> HttpResult:
        return HttpResult(url, 429, "text/html", b"busy")

    madkom = Madkom(busy, lambda url: True)
    shell = HttpResult("https://bip.m.pl/ugx", 200, "text/html", SHELL)
    for _ in range(PROBES + 1):  # no probe used up: the host stays undecided
        assert not madkom.probe(shell)
        answer = madkom.busy("https://bip.m.pl/ugx,m,11,radni.html")
        assert answer is not None and answer.status == 429
    assert madkom.busy("https://bip.m.pl/ugx") is None


def test_an_article_as_the_first_page_draws_the_offices_menu() -> None:
    old = "https://bip.m.pl/ugx/Article/get/id,101.html"
    sites = office(
        **{
            old: (200, "text/html", SHELL),
            API + "articles/101": js(
                {
                    "title": "Ewa Lis",
                    "mainMenuId": "11",
                    "mainMenuPath": PATH,
                    # The text links from the app's root, not from the old address.
                    "content": '<a href="ugx,m,20,przetargi.html">Przetargi</a>',
                }
            ),
        }
    )
    madkom, _ = adapter(sites)
    assert madkom.probe(HttpResult(old, 200, "text/html", SHELL))
    found = links(madkom.page(old))
    assert found["https://bip.m.pl/ugx,m,11,radni.html"] == "Oświadczenia majątkowe"
    assert found["https://bip.m.pl/ugx"] == "Urząd Gminy X"
    assert "https://bip.m.pl/ugx/Article/get/ugx,m,20,przetargi.html" not in found


def test_robots_txt_hides_an_article_by_any_of_its_addresses() -> None:
    for form in (
        "ugx,a,102,artykul.html",
        "a,102,artykul.html",
        "a,102.html",
        "a,102,jan-nowak.html",
        "Article/get/id,102.html",
        "ugx/Article/get/id,102.html",
    ):
        madkom, _ = probed(office(), frozenset({f"https://bip.m.pl/{form}"}))
        found = links(madkom.page("https://bip.m.pl/ugx,m,11,radni.html"))
        assert "https://bip.m.pl/ugx,a,102,jan-nowak.html" not in found, form
        assert "https://bip.m.pl/ugx,a,101,ewa-lis.html" in found, form
        assert madkom.page("https://bip.m.pl/ugx,a,102,jan-nowak.html") == ROBOTS


def test_an_office_the_api_does_not_know_leaves_the_host_madkom() -> None:
    gone = "https://bip.m.pl/ugold"
    madkom, _ = adapter(
        office(
            **{
                gone: (200, "text/html", SHELL),
                API + "contexts/default": js({"defaultMenuId": "7"}),
            }
        )
    )
    assert madkom.probe(HttpResult(gone, 200, "text/html", SHELL))
    page = madkom.page(gone)
    assert isinstance(page, HttpResult) and not page.ok
    assert "https://bip.m.pl/ugx,m,11,radni.html" in links(
        madkom.page("https://bip.m.pl/ugx,m,11,radni.html")
    )


def test_an_api_that_may_answer_later_is_asked_again() -> None:
    asked: list[str] = []

    def down(url: str) -> HttpResult:
        asked.append(url)
        return HttpResult(url, 0, "", b"", "timed out")

    madkom = Madkom(down, lambda url: True)
    shell = HttpResult("https://bip.m.pl/ugx", 200, "text/html", SHELL)
    assert not madkom.probe(shell) and not madkom.probe(shell)
    assert len(asked) == 4  # the office's context and the default one, twice
    assert not madkom.probe(shell)
    assert not madkom.probe(shell) and len(asked) == 6  # settled: no Madkom host


def test_a_sections_main_article_is_linked_once() -> None:
    listing = {
        "total": 1,
        "articles": [article("101", "Ewa Lis")],
        "menuPath": PATH,
        "mainArticleId": 103,
    }
    madkom, _ = probed(office(**{API + f"menu/11/articles?{LIST}": js(listing)}))
    found = links(madkom.page("https://bip.m.pl/ugx,m,11,radni.html"))
    assert found["https://bip.m.pl/ugx,a,103,artykul.html"] == "Radni"
    listing["mainArticleId"] = 101
    madkom, _ = probed(office(**{API + f"menu/11/articles?{LIST}": js(listing)}))
    found = links(madkom.page("https://bip.m.pl/ugx,m,11,radni.html"))
    assert "https://bip.m.pl/ugx,a,101,artykul.html" not in found


def test_a_scope_ends_at_the_offices_name() -> None:
    frontier = people_mode._Frontier([("bip.malopolska.pl", "/ugt")])
    assert frontier.in_scope("https://bip.malopolska.pl/ugt")
    assert frontier.in_scope("https://bip.malopolska.pl/ugt,m,1,radni.html")
    assert frontier.in_scope("https://bip.malopolska.pl/ugt/Article/get/id,1.html")
    assert not frontier.in_scope("https://bip.malopolska.pl/ugtomice,m,1,radni.html")
