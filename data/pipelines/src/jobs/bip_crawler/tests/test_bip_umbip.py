"""Gdynia's um-bip read through its API: the app's addresses, a category's and
a post's pages drawn from its JSON, and a walk that finds a councillor in a
declarations post and credits nobody with an official's file.

The JSON is api.um.gdynia.pl's, cut down (11-13)."""

from __future__ import annotations

import json
from pathlib import Path

from jobs.bip_crawler import people as people_mode
from jobs.bip_crawler.tests.test_people_mode_big_bips import search
from jobs.bip_crawler.tests.test_people_mode_review import PDF, Web, row
from jobs.bip_crawler.umbip import (
    PROBES,
    ROBOTS,
    Route,
    UmBip,
    names_every_declarant,
    route,
)
from scrapers.bip.people import Seeker, candidates
from scrapers.common.fetch import HttpResult
from scrapers.common.links import LinkContext, extract_link_contexts

BIP = "https://bip.um.gdynia.pl"
API = "https://api.um.gdynia.pl/contents/"
FILES = "https://legacy.um.gdynia.pl/module/Files/controller/Default/action/downloadFile/hash/"
#: Every address answers this (1,739 bytes, cut down).
SHELL = (
    b'<!doctype html><html lang="pl"><head><meta charset="utf-8"/>'
    b'<script src="/js/config.js"></script>'
    b"<title>Biuletyn Informacji Publicznej Urz\xc4\x99du Miasta Gdyni</title>"
    b'<script defer="defer" src="/static/js/main.cfe2394d.js"></script></head>'
    b"<body><noscript>You need to enable JavaScript to run this app.</noscript>"
    b'<div id="um-bip"></div></body></html>'
)
CONFIG = b"""window.config = Object.freeze({
\tget API_URL() { return "https://api.um.gdynia.pl" },
\tget BASE_URL() { return "/" },
\tget SEARCH_API_URL() { return "https://searcher.um.gdynia.pl/api/search" }
})"""
#: What posts/category/<id> answers for a category with none of its own.
NO_POSTS = {
    "posts": {
        "contents": [],
        "pages": {"limit": 100, "offset": 0, "pageCount": 0, "itemCount": "0"},
    }
}
NO_SUBCATEGORIES: dict[str, dict[str, list[dict[str, str]]]] = {
    "subcategories": {"categories": []}
}
CHAIN = [
    {
        "name": "Biuletyn Informacji Publicznej",
        "url": f"{BIP}/biuletyn-informacji-publicznej,1",
        "id": "1",
    },
    {"name": "Inne", "url": f"{BIP}/inne,2205", "id": "2205"},
    {
        "name": "Oświadczenia majątkowe",
        "url": f"{BIP}/oswiadczenia-majatkowe,2211",
        "id": "2211",
    },
]
COUNCILLORS = f"{BIP}/2025-2,9210/oswiadczenia-majatkowe-radnych-za-rok-2025,621729"
GENERAL = f"{BIP}/2023-2,8834/oswiadczenia-majatkowe-2023,581829"


def js(data: object) -> tuple[int, str, bytes]:
    return 200, "application/json", json.dumps(data).encode()


def subcategories(*items: tuple[str, str, str]) -> dict:
    return {
        "subcategories": {
            "categories": [
                {"id": i, "name": n, "url": f"{BIP}/{s},{i}", "redirect_url": None}
                for i, n, s in items
            ]
        }
    }


def posts(*items: tuple[str, str], total: int | None = None) -> dict:
    return {
        "posts": {
            "contents": [
                {"id": url.rsplit(",", 1)[1], "type": "declarations", "title": t}
                | {"url": url, "author": "Dagmara Rosochacka"}
                for url, t in items
            ],
            "pages": {"limit": 100, "offset": 0, "itemCount": str(total or len(items))},
        }
    }


def declarant(name: str, position: str, *files: tuple[str, str]) -> dict:
    """A row of a declarations post: who filed, and who entered it."""
    found = {
        ("protocol" if i == 0 else f"protocol{i + 1}"): {
            "url": FILES + digest,
            "icon": "fa fa-file-pdf-o",
            "extension": "pdf",
            "title": title,
        }
        for i, (digest, title) in enumerate(files)
    }
    return {
        "declarations_name": name,
        "declarations_position": position,
        **found,
        "responsible_person": "Magdalena Anuszek",
        "insert_author": "Bożena Słowi",
    }


def post(ident: str, title: str, year: tuple[str, str, str], *rows: dict) -> dict:
    ident_year, name, slug = year
    return {
        "posts": [
            {
                "id": ident,
                "type": "declarations",
                "title": title,
                "author": "Dorota Nelke",
                "content_app": (
                    "<p>Aktualny wz&oacute;r o&#347;wiadczenia maj&#261;tkowego "
                    f'dla RADNYCH do pobrania <a href="{FILES}ca658007b0b5ff2486'
                    '3ea7cb5732fb6f.doc" target="_blank" rel="noopener">tutaj</a>.'
                    "<br><br>Wy&#322;&#261;czenia jawno&#347;ci dokona&#322;y: "
                    "inspektor Bo&#380;ena S&#322;owi oraz naczelnik BRM Magdalena "
                    "Anuszek</p>\n"
                ),
                "all_categories": [
                    *CHAIN,
                    {
                        "name": name,
                        "url": f"{BIP}/{slug},{ident_year}",
                        "id": ident_year,
                    },
                ],
                "attachments": [],
                "extended_data": {"declarations": list(rows)},
            }
        ]
    }


SALOMON = "0abb0362cde20918226aebfb847fb556.pdf"
WOJCIK = "5f25eab78036ebfa56aa899a8f351b60.pdf"
DOMANSKA = "c92190510083412f277498154478e106.pdf"
SZCZUREK = "e56ef1b565a91ebfb57dcfca43815cb4.pdf"
STASIAK = "8c2f80b743c3894c35cdb14e8e71d761.pdf"
#: posts/621729: the councillors' declarations for 2025, three of 28 rows.
COUNCILLORS_POST = post(
    "621729",
    "Oświadczenia majątkowe radnych za rok 2025 ",
    ("9210", "2025", "2025-2"),
    declarant(
        "Bysewska Teresa",
        "radna",
        (
            "b84fb9dc0bb1726ffce1087c0a0feca9.pdf",
            "oświadczenie majątkowe radnej wg stanu na 31 grudnia 2025 r.",
        ),
        (
            "ce39a0d998f4624b61d317df4d4a9728.pdf",
            "korekta oświadczenia majątkowe radnej  z 13 maja  2026 r.",
        ),
    ),
    declarant(
        "Salomon Anna ",
        "radna",
        (SALOMON, "oświadczenie majątkowe radnej wg stanu na 31 grudnia 2025 r."),
    ),
    declarant(
        "W&oacute;jcik Małgorzata",
        "radna",
        (WOJCIK, "oświadczenie majątkowe radnej wg stanu na 31 grudnia 2025 r."),
    ),
)
#: posts/581829: everybody else's for 2023, three of 309 rows; one names its
#: declarant by her surname alone.
GENERAL_POST = post(
    "581829",
    "Oświadczenia majątkowe 2023",
    ("8834", "2023", "2023-2"),
    declarant(
        "Domańska-Ożga",
        "dyrektor przedszkola",
        (DOMANSKA, "oświadczenie majątkowe za 2023 elektronicznie"),
    ),
    declarant(
        "Stasiak Bogusław ",
        "prezes zarządu PKM Sp. z o.o.",
        (STASIAK, "oświadczenie majątkowe za 2023"),
    ),
    declarant(
        "Szczurek Wojciech",
        "Prezydent Miasta Gdyni",
        (SZCZUREK, "oświadczenie majątkowe za 2023"),
    ),
)
LIST = "limit=100&offset=0&basic=1"


def gdynia(**extra: tuple[int, str, bytes]) -> dict[str, tuple[int, str, bytes]]:
    """bip.um.gdynia.pl from its main page down to two years' declarations."""
    category = {
        "1": subcategories(("2205", "Inne", "inne")),
        "2205": subcategories(
            ("2211", "Oświadczenia majątkowe", "oswiadczenia-majatkowe")
        ),
        "2211": subcategories(("9210", "2025", "2025-2"), ("8834", "2023", "2023-2")),
        "9210": NO_SUBCATEGORIES,
        "8834": NO_SUBCATEGORIES,
    }
    listed = {
        "9210": posts((COUNCILLORS, "Oświadczenia majątkowe radnych za rok 2025 ")),
        "8834": posts((GENERAL, "Oświadczenia majątkowe 2023")),
    }
    sites = {
        BIP: (200, "text/html", SHELL),
        f"{BIP}/oswiadczenia-majatkowe,2211": (200, "text/html", SHELL),
        f"{BIP}/js/config.js": (200, "application/javascript", CONFIG),
        API + "category_by_id/1": js(
            {
                "category": {
                    "id": "1",
                    "name": "Biuletyn Informacji Publicznej",
                    "parent_id": "4148",
                }
            }
        ),
        API + "category_by_id/2211": js(
            {
                "category": {
                    "id": "2211",
                    "name": "Oświadczenia majątkowe",
                    "parent_id": "2205",
                }
            }
        ),
        API + "posts/621729": js(COUNCILLORS_POST),
        API + "posts/581829": js(GENERAL_POST),
        **{API + f"subcategories/{i}?bip=1": js(c) for i, c in category.items()},
        **{
            API + f"posts/category/{i}?{LIST}": js(listed.get(i, NO_POSTS))
            for i in category
        },
        **{
            FILES + digest: (200, "application/pdf", PDF + digest.encode())
            for digest in (SALOMON, WOJCIK, DOMANSKA, SZCZUREK, STASIAK)
        },
        **extra,
    }
    return sites


def probed(sites: dict) -> tuple[UmBip, Web]:
    web = Web(sites)
    app = UmBip(lambda url: web.fetch(url, 15.0, "test"))
    assert app.probe(web.fetch(f"{BIP}/oswiadczenia-majatkowe,2211", 15.0, "test"))
    return app, web


def drawn(page: HttpResult | str | None) -> tuple[str, list[LinkContext]]:
    assert isinstance(page, HttpResult) and page.ok
    return extract_link_contexts(page.content, page.url, page.content_type)


def test_addresses_are_read_as_the_apps_router_reads_them() -> None:
    assert route(f"{BIP}/") == Route("m", "1")  # the main categories
    assert route(f"{BIP}/oswiadczenia-majatkowe,2211") == Route("c", "2211")
    assert route(f"{BIP}/2025-2,9210?page=3") == Route("c", "9210", 3)
    assert route(COUNCILLORS) == Route("p", "621729")
    assert route(f"{BIP}/js/config.js") is None
    assert route(f"{BIP}/static/js/main.cfe2394d.js") is None
    assert route(f"{BIP}/szukaj") is None  # an old slug, or the search
    assert route(f"{BIP}/a,1/b,2/c,3") is None


def test_a_host_is_um_bip_when_its_shell_names_the_api() -> None:
    app, web = probed(gdynia())
    assert web.calls[-1] == f"{BIP}/js/config.js"
    assert app.knows(COUNCILLORS)
    # Decided for the host: no more config.js.
    assert app.probe(HttpResult(f"{BIP}/inne,2205", 200, "text/html", SHELL))
    assert web.calls.count(f"{BIP}/js/config.js") == 1
    other = UmBip(lambda url: "unused")
    assert not other.probe(
        HttpResult("https://bip.x.pl/", 200, "text/html", b"<html><a href=/a>A</a>")
    )
    assert not other.knows("https://bip.x.pl/a")


def test_a_config_that_may_answer_later_is_asked_again() -> None:
    web = Web(gdynia(**{f"{BIP}/js/config.js": (502, "text/html", b"")}))
    app = UmBip(lambda url: web.fetch(url, 15.0, "test"))
    shell = HttpResult(BIP, 200, "text/html", SHELL)
    for _ in range(PROBES):
        assert not app.probe(shell)
    assert web.calls.count(f"{BIP}/js/config.js") == PROBES
    assert not app.probe(shell)  # no um-bip host for the rest of the run
    assert web.calls.count(f"{BIP}/js/config.js") == PROBES


def test_a_config_that_says_not_now_hands_the_walk_its_answer() -> None:
    web = Web(gdynia(**{f"{BIP}/js/config.js": (429, "text/html", b"busy")}))
    app = UmBip(lambda url: web.fetch(url, 15.0, "test"))
    assert not app.probe(HttpResult(BIP, 200, "text/html", SHELL))
    busy = app.busy(BIP)
    assert busy is not None and busy.status == 429
    assert app.busy(BIP) is None  # once


def test_the_main_page_unfolds_its_menu_down_to_the_declarations() -> None:
    council = subcategories(("9175", "Radni IX kadencji 2024 - 2029 ", "radni-ix"))
    main = subcategories(
        ("1690", "Rada Miasta", "rada-miasta"),
        ("2205", "Inne", "inne"),
        ("1599", "Rady Dzielnic", "rady-dzielnic"),
    )
    app, web = probed(
        gdynia(
            **{
                API + "subcategories/1?bip=1": js(main),
                API + "subcategories/1690?bip=1": js(council),
                # A main category that does not answer ends the unfolding.
                API + "subcategories/1599?bip=1": (500, "text/html", b""),
            }
        )
    )
    title, links = drawn(app.page(f"{BIP}/"))
    assert title.startswith("Biuletyn Informacji Publicznej")
    found = {x.url: (x.anchor, x.path) for x in links}
    # "Inne", the last but one, holds the declarations: one link away.
    assert found[f"{BIP}/oswiadczenia-majatkowe,2211"] == (
        "Oświadczenia majątkowe",
        "Inne",
    )
    assert found[f"{BIP}/radni-ix,9175"] == (
        "Radni IX kadencji 2024 - 2029",
        "Rada Miasta",
    )
    assert found[f"{BIP}/rady-dzielnic,1599"] == ("Rady Dzielnic", "")
    # The year a category's page lists is titled with it, the main page's
    # categories with what it unfolded.
    title, _ = drawn(app.page(f"{BIP}/oswiadczenia-majatkowe,2211"))
    assert title.startswith("Oświadczenia majątkowe - Inne")
    assert API + "category_by_id/2211" not in web.calls


def test_a_category_links_its_subcategories_under_its_name() -> None:
    app, web = probed(gdynia())
    title, links = drawn(app.page(f"{BIP}/oswiadczenia-majatkowe,2211"))
    assert title.startswith("Oświadczenia majątkowe")
    assert {x.url: x.anchor for x in links} == {
        f"{BIP}/2025-2,9210": "2025",
        f"{BIP}/2023-2,8834": "2023",
    }
    assert {x.heading for x in links} == {"Oświadczenia majątkowe"}
    # Its subcategories, its posts, its name.
    assert web.calls[-3:] == [
        API + "subcategories/2211?bip=1",
        API + f"posts/category/2211?{LIST}",
        API + "category_by_id/2211",
    ]
    # A year met in that listing is titled with the category above it, and
    # its name is not asked for.
    title, links = drawn(app.page(f"{BIP}/2025-2,9210"))
    assert title.startswith("2025 - Oświadczenia majątkowe")
    assert [(x.url, x.anchor) for x in links] == [
        (COUNCILLORS, "Oświadczenia majątkowe radnych za rok 2025")
    ]
    assert API + "category_by_id/9210" not in web.calls


def test_a_long_category_goes_on_to_its_next_page() -> None:
    many = posts((GENERAL, "Oświadczenia majątkowe 2023"), total=150)
    app, web = probed(
        gdynia(
            **{
                API + f"posts/category/8834?{LIST}": js(many),
                API + "posts/category/8834?limit=100&offset=100&basic=1": js(NO_POSTS),
            }
        )
    )
    _, links = drawn(app.page(f"{BIP}/2023-2,8834"))
    assert links[-1].url == f"{BIP}/2023-2,8834?page=2"
    assert links[-1].anchor == "Następna strona (2)"
    asked = len(web.calls)
    drawn(app.page(f"{BIP}/2023-2,8834?page=2"))
    # The next hundred posts; the subcategories were on the first page.
    assert API + "posts/category/8834?limit=100&offset=100&basic=1" in web.calls
    assert API + "subcategories/8834?bip=1" not in web.calls[asked:]


def test_a_post_is_a_table_a_row_a_declarant() -> None:
    app, _ = probed(gdynia())
    page = app.page(COUNCILLORS)
    title, links = drawn(page)
    assert title.startswith(
        "Oświadczenia majątkowe radnych za rok 2025 - 2025 - Oświadczenia majątkowe"
        " - Inne - Biuletyn Informacji Publicznej"
    )
    rows = {x.url: x.row for x in links if x.url.startswith(FILES)}
    assert rows[FILES + SALOMON] == (
        "Salomon Anna radna oświadczenie majątkowe radnej wg stanu na 31 grudnia"
        " 2025 r."
    )
    # Entities read as the app reads them.
    assert rows[FILES + WOJCIK].startswith("Wójcik Małgorzata radna")
    # A row's every file, each under the declarant.
    assert rows[FILES + "ce39a0d998f4624b61d317df4d4a9728.pdf"].startswith(
        "Bysewska Teresa radna korekta"
    )
    # Who entered the files is no declarant: the app's "Metryczka" stays out,
    # and so does the text above the table, its blank form and the staff who
    # blacked out the addresses.
    assert isinstance(page, HttpResult) and b"Anuszek" not in page.content
    assert FILES + "ca658007b0b5ff24863ea7cb5732fb6f.doc" not in rows
    assert len(rows) == 4
    # The way back.
    assert {x.url for x in links} >= {c["url"] for c in CHAIN}
    assert names_every_declarant(page.content)


def test_a_post_without_declarations_shows_its_attachments_and_text() -> None:
    article = {
        "posts": [
            {
                "id": "7",
                "type": "article",
                "title": "Wyniki kontroli<BR>2025",
                "content_app": (
                    f'<p><a href="{FILES}aa.pdf">Protok&oacute;&#322;</a></p>'
                ),
                "attachments": [
                    {"title": "Za&#322;&#261;cznik 1", "url": FILES + "bb.pdf"},
                    {"title": "", "url": FILES + "cc.pdf"},  # the app hides it
                    ["Lp.", "Nazwa"],  # a table post's row
                ],
                "extended_data": [],
            }
        ]
    }
    app, _ = probed(gdynia(**{API + "posts/7": js(article)}))
    page = app.page(f"{BIP}/kontrole,279/wyniki,7")
    title, links = drawn(page)
    assert title.startswith("Wyniki kontroli 2025")
    assert {x.url: x.anchor for x in links} == {
        FILES + "bb.pdf": "Załącznik 1",
        FILES + "aa.pdf": "Protokół",
    }
    assert isinstance(page, HttpResult) and not names_every_declarant(page.content)


def test_a_post_that_is_gone_or_an_api_that_says_not_now() -> None:
    app, _ = probed(gdynia(**{API + "posts/1": js({"posts": []})}))
    gone = app.page(f"{BIP}/2025-2,9210/x,1")
    assert isinstance(gone, HttpResult) and gone.status == 404
    busy = {API + "subcategories/9210?bip=1": (429, "text/html", b"busy")}
    app, _ = probed(gdynia(**busy))
    answer = app.page(f"{BIP}/2025-2,9210")
    assert isinstance(answer, HttpResult) and answer.status == 429
    # robots.txt keeping the crawler from the API is the walk's answer.
    web = Web(gdynia())
    app = UmBip(lambda url: ROBOTS if url.startswith(API) else web.fetch(url, 15, ""))
    assert app.probe(web.fetch(BIP, 15.0, "test"))
    assert app.page(f"{BIP}/2025-2,9210") == ROBOTS


def test_a_surname_alone_in_a_row_would_be_nobodys_declaration() -> None:
    """Why the walk keeps an official's file from the unnamed pool: drawn as a
    row, "Domańska-Ożga" names nobody to `candidates`."""
    app, _ = probed(gdynia())
    title, links = drawn(app.page(GENERAL))
    felmet = Seeker.of("felmet", "Patryk", "Felmet")
    unnamed = {c.url for c in candidates(GENERAL, title, links, [felmet]) if not c.key}
    assert unnamed == {FILES + DOMANSKA}


def test_the_walk_finds_councillors_through_the_api_and_no_unnamed_files(
    tmp_path: Path,
) -> None:
    rendered: list[str] = []

    def render(url: str):
        rendered.append(url)
        return HttpResult(url, 0, "", b"", "no browser"), 0

    walk, store, web = search(
        tmp_path,
        gdynia(),
        [
            row("salomon", "u1", "Anna", "SALOMON"),
            row("szczurek", "u1", "Wojciech", "Szczurek"),
            row("felmet", "u1", "Patryk", "Felmet"),
        ],
        scopes={"u1": "bip.um.gdynia.pl"},
        render=render,
        sitemaps=False,
    )
    (salomon,) = [d for d in store.person_docs("salomon") if d.status == "ok"]
    assert salomon.url == FILES + SALOMON
    assert salomon.page_url == COUNCILLORS
    assert salomon.named and salomon.first_name
    (szczurek,) = [d for d in store.person_docs("szczurek") if d.status == "ok"]
    assert szczurek.url == FILES + SZCZUREK
    assert store.outcomes["salomon"].status == "found"
    assert store.outcomes["szczurek"].status == "found"
    # Nobody's row names him: no official's file for the OCR step to open.
    assert store.person_docs("felmet") == []
    assert (store.outcomes["felmet"].status, store.outcomes["felmet"].reason) == (
        "not_found",
        "not_listed",
    )
    assert rendered == []
    # The shell once; then config.js and the API, and the files.
    assert web.calls[0] == BIP
    assert web.calls[1] == f"{BIP}/js/config.js"
    assert all(c.startswith((API, FILES)) for c in web.calls[2:])
    assert walk.umbip.knows(BIP)


def test_umbip_and_the_walk_agree_on_robots() -> None:
    assert ROBOTS == people_mode.ROBOTS
