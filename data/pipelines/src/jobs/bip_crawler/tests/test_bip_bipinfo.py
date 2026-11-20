"""bip.info.pl's Angular BIPs read through their API: the shell told apart,
the menus as the start page, a declarations list whose people the walk opens
for the seekers alone, and a walk that finds a councillor without a render.
The answers are trimmed from lubliniec-starostwo.bip.info.pl,
bip.mierzecice.pl and glogow.bip.info.pl (11-13)."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from urllib.parse import quote

from jobs.bip_crawler import people as people_mode
from jobs.bip_crawler.bipinfo import ROBOTS, BipInfo, is_shell
from jobs.bip_crawler.tests.test_people_mode_big_bips import search
from jobs.bip_crawler.tests.test_people_mode_review import PDF, Web, row
from scrapers.bip.people import Entry, Seeker, candidates, entries_to_open
from scrapers.common.fetch import HttpResult
from scrapers.common.links import LinkContext, extract_link_contexts

HOST = "https://lubliniec-starostwo.bip.info.pl"
API = HOST + "/api/fo/"
#: The shell every address answers, trimmed of its styles and preloads.
SHELL = (
    b'<!doctype html>\n<html lang="pl" data-beasties-container>\n<head>\n'
    b'  <title></title>\n  <base href="/">\n'
    b'  <script type="text/javascript" src="./assets/config.js"></script>\n'
    b'  <link id="favicon" rel="icon" type="image/x-icon" '
    b'href="/api/fo/favicon.ico">\n</head>\n'
    b'<body class="mat-typography" data-szafirsdk-ready="no">\n<app-root>\n'
    b'  <div class="loading-bar-content">\n    <div class="loading-bar"></div>\n'
    b"  </div>\n</app-root>\n<noscript>Please enable JavaScript to continue using "
    b"this application.</noscript>\n"
    b'<script src="main-7SCL7MM5.js" type="module"></script></body>\n</html>\n'
)
DECLARATIONS = "/oswiadczenia-majatkowe-4sp"
TERM = (
    DECLARATIONS
    + "/vii-kadencja-2024-2029-910sp/oswiadczenia-majatkowe-za-2024-rok-943sp"
)
RADA = TERM + "/rada-powiatu-w-lublincu-944sp"
STAFF = TERM + "/pracownicy-samorzadowi-946sp"
OLD = (
    DECLARATIONS
    + "/v-kadencja-2014-2018-607sp/oswiadczenia-majatkowe-za-2017-rok-745sp"
    "/rada-powiatu-w-lublincu-746sp"
)
FILE = API + "files/c28cf1a11ec83b22f51f76ac462ed7/download"


def js(data: object) -> tuple[int, str, bytes]:
    return 200, "application/vnd.api+json", json.dumps(data).encode()


def item(ident: str, title: str, kind: str, url: str | None, *children: dict) -> dict:
    return {
        "id": ident,
        "type": "Menu",
        "attributes": {
            "title": title,
            "type": kind,
            "url": url,
            "children": list(children),
        },
    }


MENU_RIGHT = {
    "data": [
        item(
            "1645561da9c28c7e4599",
            "MENU PRZEDMIOTOWE",
            "group",
            None,
            item(
                "przedmiotowe4sp",
                "Oświadczenia majątkowe",
                "page",
                DECLARATIONS,
                item(
                    "przedmiotowe607sp",
                    "V kadencja (2014-2018)",
                    "group",
                    None,
                    item(
                        "przedmiotowe745sp",
                        "Oświadczenia majątkowe za 2017 rok",
                        "group",
                        None,
                        item(
                            "przedmiotowe746sp", "Rada Powiatu w Lublińcu", "page", OLD
                        ),
                    ),
                ),
                item(
                    "przedmiotowe910sp",
                    "VII kadencja (2024-2029)",
                    "group",
                    None,
                    item(
                        "przedmiotowe943sp",
                        "Oświadczenia majątkowe za 2024 rok",
                        "group",
                        None,
                        item(
                            "przedmiotowe944sp", "Rada Powiatu w Lublińcu", "page", RADA
                        ),
                        item(
                            "przedmiotowe946sp", "Pracownicy Samorządowi", "page", STAFF
                        ),
                    ),
                ),
            ),
            item(
                "przedmiotowe40sp",
                "Realizowane strategie",
                "page",
                "/programy-zamierzenia-39sp/realizowane-strategie-40sp",
            ),
        )
    ]
}
MENU_LEFT = {
    "data": [
        item(
            "0822715a97dc5e5d6b2b",
            "SPIS PODMIOTÓW",
            "group",
            None,
            item(
                "podmiotowe33sp",
                "Radni Powiatu",
                "page",
                "/organy-powiatu-1sp/rada-powiatu-32sp/radni-powiatu-33sp",
            ),
        )
    ]
}


def meta(ident: str, name: str) -> tuple[int, str, bytes]:
    return js(
        {
            "meta": {
                "type": "articleCategory",
                "objectId": ident,
                "isCore": False,
                "name": name,
            }
        }
    )


def listing(path: str, ident: str, page: int = 1) -> str:
    return (
        f"{API}articles?page={page}&count=100&path={quote(path, safe='/')}"
        f"&category={ident}"
    )


def entry(number: str, slug: str, title: str, path: str) -> dict:
    return {
        "id": f"0{number}sp",
        "type": "CmsArticle",
        "attributes": {
            "slug": f"{number}sp-{slug}",
            "title": title,
            "publishedFrom": "2025-07-31T10:59:03+02:00",
            "url": f"{path}/{number}sp-{slug}",
        },
    }


def article(
    title: str, *attachments: dict, content: str = ""
) -> tuple[int, str, bytes]:
    return js(
        {
            "data": {
                "type": "CmsArticle",
                "attributes": {
                    "title": title,
                    "content": content,
                    "category": {"attributes": {"title": "Rada Powiatu w Lublińcu"}},
                    "attachments": list(attachments),
                },
            }
        }
    )


MAJCHRZYK = {
    "id": "c28cf1a11ec83b22f51f76ac462ed7",
    "type": "CmsFile",
    "attributes": {
        "originalName": "Rufin Majchrzyk",
        "downloadName": "Rufin Majchrzyk_Zredagowany.pdf",
        "extension": "pdf",
        "content": "OŚWIADCZENIE MAJĄTKOWE radnego powiatu Boronów, dnia 27.04.2025r.",
    },
}


def lubliniec(**extra: tuple[int, str, bytes]) -> dict[str, tuple[int, str, bytes]]:
    """The office: its 2024 councillors' list (Rufin Majchrzyk, Sonia
    Wachowska), its staff's (Andrzej Majchrzyk), each one article a person."""
    return {
        HOST + "/": (200, "text/html", SHELL),
        API + "getVersion": js({"data": {"id": "4.3.1-RC8", "type": "Wersja systemu"}}),
        API + "menu/right": js(MENU_RIGHT),
        API + "menu/left": js(MENU_LEFT),
        API + "search/getMetadata/" + RADA.replace("/", ","): meta(
            "przedmiotowe944sp", "Rada Powiatu w Lublińcu"
        ),
        listing(RADA, "przedmiotowe944sp"): js(
            {
                "meta": {"pages": 1, "amount": 2},
                "data": [
                    entry("23793", "sonia-wachowska", "Sonia Wachowska", RADA),
                    entry("23792", "rufin-majchrzyk", "Rufin Majchrzyk", RADA),
                ],
            }
        ),
        API + "articles/23792sp-rufin-majchrzyk": article("Rufin Majchrzyk", MAJCHRZYK),
        API + "articles/23793sp-sonia-wachowska": article("Sonia Wachowska"),
        API + "search/getMetadata/" + STAFF.replace("/", ","): meta(
            "przedmiotowe946sp", "Pracownicy Samorządowi"
        ),
        listing(STAFF, "przedmiotowe946sp"): js(
            {
                "meta": {"pages": 1, "amount": 1},
                "data": [
                    entry("23801", "andrzej-majchrzyk", "Andrzej Majchrzyk", STAFF)
                ],
            }
        ),
        FILE: (200, "application/pdf", PDF + b"majchrzyk"),
        **extra,
    }


def adapter(sites: dict, hidden: frozenset[str] = frozenset()) -> tuple[BipInfo, Web]:
    web = Web(sites)

    def get(url: str) -> HttpResult | str:
        return ROBOTS if url in hidden else web.fetch(url, 15.0, "test")

    return BipInfo(get, lambda url: url not in hidden), web


def probed(sites: dict, hidden: frozenset[str] = frozenset()) -> tuple[BipInfo, Web]:
    bipinfo, web = adapter(sites, hidden)
    assert bipinfo.probe(HttpResult(HOST + "/", 200, "text/html", SHELL))
    return bipinfo, web


def drawn(page: HttpResult | str | None) -> tuple[str, dict[str, str]]:
    assert isinstance(page, HttpResult) and page.ok
    title, links = extract_link_contexts(page.content, page.url, page.content_type)
    return title, {link.url: link.anchor for link in links}


MAJCHRZYK_SEEKER = Seeker.of("rm", "Rufin", "MAJCHRZYK", "Roman")


def test_the_shell_is_told_by_its_api_alone() -> None:
    assert is_shell(SHELL)
    madkom_shell = b"<html><script>var MadkomConfiguration = {}</script></html>"
    assert not is_shell(madkom_shell)
    bipinfo, web = adapter(lubliniec())
    plain = HttpResult("https://other.pl/", 200, "text/html", b"<html>BIP</html>")
    assert not bipinfo.probe(plain) and not bipinfo.knows("https://other.pl/x")
    pdf = HttpResult(HOST + "/f.pdf", 200, "application/pdf", PDF)
    assert not bipinfo.probe(pdf) and not bipinfo.knows(HOST + "/")
    assert web.calls == []  # no shell, no API call
    assert bipinfo.probe(HttpResult(HOST + "/x", 200, "text/html", SHELL))
    assert bipinfo.knows(HOST + RADA) and web.calls == [API + "getVersion"]


def test_a_shell_whose_api_does_not_answer_is_no_host_of_the_apps() -> None:
    bipinfo, _ = adapter({HOST + "/": (200, "text/html", SHELL)})
    assert not bipinfo.probe(HttpResult(HOST + "/", 200, "text/html", SHELL))
    assert bipinfo.page(HOST + "/") is None


def test_the_start_page_is_the_menus_the_newest_term_first() -> None:
    bipinfo, web = probed(lubliniec())
    page = bipinfo.page(HOST + "/")
    assert isinstance(page, HttpResult)
    _, links = extract_link_contexts(page.content, page.url, page.content_type)
    by_url = {link.url: link for link in links}
    assert by_url[HOST + RADA].anchor == "Rada Powiatu w Lublińcu"
    assert by_url[HOST + RADA].path.endswith(
        "Oświadczenia majątkowe > VII kadencja (2024-2029)"
        " > Oświadczenia majątkowe za 2024 rok"
    )
    order = [link.url for link in links]
    assert order.index(HOST + RADA) < order.index(HOST + OLD)
    assert HOST + "/organy-powiatu-1sp/rada-powiatu-32sp/radni-powiatu-33sp" in by_url
    assert web.calls[-2:] == [API + "menu/right", API + "menu/left"]


def test_a_declarations_list_names_its_people_without_links() -> None:
    bipinfo, web = probed(lubliniec())
    title, links = drawn(bipinfo.page(HOST + RADA))
    assert title.startswith(
        "Rada Powiatu w Lublińcu - Oświadczenia majątkowe za 2024 rok"
        " - VII kadencja (2024-2029) - Oświadczenia majątkowe"
    )
    assert "MENU" not in title
    assert links == {}  # 1,425 people in Lubliniec: the walk opens its own
    # What the address is, then its articles by the id that says.
    assert API + "search/getMetadata/" + RADA.replace("/", ",") in web.calls
    assert web.calls[-1] == listing(RADA, "przedmiotowe944sp")


def test_the_walk_opens_the_seekers_articles_alone() -> None:
    bipinfo, web = probed(lubliniec())
    page = bipinfo.page(HOST + RADA)
    assert isinstance(page, HttpResult)
    opened: Counter[tuple[str, str]] = Counter()
    (document,) = bipinfo.documents(
        page, [MAJCHRZYK_SEEKER], None, frozenset(), 3, opened
    )
    assert document.url == HOST + RADA + "/23792sp-rufin-majchrzyk"
    assert document.title.startswith("Rufin Majchrzyk - Rada Powiatu w Lublińcu")
    (link,) = document.links
    assert link.url == FILE
    assert link.anchor == "Rufin Majchrzyk (Rufin Majchrzyk_Zredagowany.pdf)"
    assert "opublikowano 2025-07-31" in link.row
    assert API + "articles/23793sp-sonia-wachowska" not in web.calls
    assert opened[MAJCHRZYK_SEEKER.name] == 1
    (found,) = candidates(
        document.url, document.title, list(document.links), [MAJCHRZYK_SEEKER]
    )
    assert found.key == "rm" and found.first_name and found.declaration_like


def test_a_staff_namesake_is_left_unopened() -> None:
    bipinfo, web = probed(lubliniec())
    page = bipinfo.page(HOST + STAFF)
    assert isinstance(page, HttpResult)
    found = bipinfo.documents(page, [MAJCHRZYK_SEEKER], None, frozenset(), 3, Counter())
    assert found == []
    assert API + "articles/23801sp-andrzej-majchrzyk" not in web.calls


def test_an_article_robots_txt_hides_is_not_opened() -> None:
    hidden = frozenset({HOST + RADA + "/23792sp-rufin-majchrzyk"})
    bipinfo, web = probed(lubliniec(), hidden)
    page = bipinfo.page(HOST + RADA)
    assert isinstance(page, HttpResult)
    assert (
        bipinfo.documents(page, [MAJCHRZYK_SEEKER], None, frozenset(), 3, Counter())
        == []
    )
    assert API + "articles/23792sp-rufin-majchrzyk" not in web.calls


def test_a_new_sections_list_is_asked_by_its_metadata_id() -> None:
    # bip.mierzecice.pl's 2025 councillors: menu id B99C9B31..., objectId
    # 92CA6587... in the menu, 99EE4ECE... in getMetadata, the one its
    # articles are asked by (by either of the others: none).
    section = (
        "/oswiadczenia-majatkowe-15/kadencja-2024---2029-765"
        "/oswiadczenia-majatkowe-za-2025-rok/oswiadczenia-majatkowe-radnych"
    )
    guid = "99EE4ECE-090C-48D9-B3F3-F5F7E29AE8B3"
    menu = {
        "data": [
            item(
                "B99C9B31-742F-45B8-9222-9ECBA58DE607",
                "Oświadczenia majątkowe radnych",
                "articleCategory",
                section,
            )
        ]
    }
    kobialka = {
        "id": "D80A12CC-A399-4DA1-A71E-7A442BBB1E02",
        "attributes": {
            "slug": "radny-krzysztof-kobialka",
            "title": "Radny Krzysztof Kobiałka",
            "publishedFrom": "2026-05-11T13:35:59+02:00",
            "url": section + "/radny-krzysztof-kobialka",
        },
    }
    attachment = {
        "id": "08760A9A-6933-4A7E-8A36-F99433744ADE",
        "attributes": {
            "originalName": "Oświadczenie majątkowe",
            "downloadName": "Radny Krzysztof Kobiałka.pdf",
        },
    }
    sites = lubliniec(
        **{
            API + "menu/right": js(menu),
            API + "search/getMetadata/" + section.replace("/", ","): meta(
                guid, "Oświadczenia majątkowe radnych"
            ),
            listing(section, guid): js({"meta": {"pages": 1}, "data": [kobialka]}),
            API + "articles/radny-krzysztof-kobialka": article(
                "Radny Krzysztof Kobiałka", attachment
            ),
        }
    )
    bipinfo, _ = probed(sites)
    page = bipinfo.page(HOST + section)
    seeker = Seeker.of("kk", "Krzysztof", "KOBIAŁKA", "Piotr")
    assert isinstance(page, HttpResult)
    (document,) = bipinfo.documents(page, [seeker], None, frozenset(), 3, Counter())
    (link,) = document.links
    assert link.url == API + "files/08760A9A-6933-4A7E-8A36-F99433744ADE/download"
    assert link.anchor == "Oświadczenie majątkowe (Radny Krzysztof Kobiałka.pdf)"


def test_another_list_links_its_articles() -> None:
    strategies = "/programy-zamierzenia-39sp/realizowane-strategie-40sp"
    sites = lubliniec(
        **{
            API + "search/getMetadata/" + strategies.replace("/", ","): meta(
                "przedmiotowe40sp", "Realizowane strategie"
            ),
            listing(strategies, "przedmiotowe40sp"): js(
                {
                    "meta": {"pages": 3},
                    "data": [entry("5", "strategia", "Strategia Rozwoju", strategies)],
                }
            ),
        }
    )
    bipinfo, web = probed(sites)
    _, links = drawn(bipinfo.page(HOST + strategies))
    assert links == {HOST + strategies + "/5sp-strategia": "Strategia Rozwoju"}
    assert web.calls[-1] == listing(strategies, "przedmiotowe40sp")  # its first page


def test_a_menu_article_shows_its_files_and_the_sections_below() -> None:
    # glogow.bip.info.pl: "Oświadczenia majątkowe Radnych" is an article in the
    # menu, over the terms and a page a councillor.
    host = "https://glogow.bip.info.pl"
    section = "/rada-miejska-4d/oswiadczenia-majatkowe-radnych-31d"
    main = section + "/1529d-Oświadczenia-majątkowe-Radnych-Rady-Miejskiej"
    brok = section + "/oswiadczenia-majatkowe-kadencja-2024---2029-924d/brok-anna-929d"
    menu = {
        "data": [
            item(
                "91d58dfc45590991d665",
                "SPIS PODMIOTÓW",
                "group",
                None,
                item(
                    "podmiotowe31d",
                    "Oświadczenia majątkowe Radnych",
                    "article",
                    main,
                    item(
                        "podmiotowe924d",
                        "OŚWIADCZENIA MAJĄTKOWE KADENCJA 2024 - 2029",
                        "group",
                        None,
                        item("podmiotowe929d", "Brok Anna", "page", brok),
                    ),
                ),
            )
        ]
    }
    api = host + "/api/fo/"
    slug = quote("1529d-Oświadczenia-majątkowe-Radnych-Rady-Miejskiej", safe="")
    sites = {
        api + "getVersion": js({"data": {"id": "4.3.1-RC8"}}),
        api + "menu/left": js(menu),
        api + "search/getMetadata/" + _commas(main): js(
            {"meta": {"type": "article", "objectId": None}}
        ),
        api + "articles/" + slug: article(
            "Oświadczenia majątkowe Radnych Rady Miejskiej",
            content='<p><a href="/api/fo/files/abc123/download">Zimna Anna</a></p>',
        ),
    }
    bipinfo, _ = adapter(sites)
    assert bipinfo.probe(HttpResult(host + "/", 200, "text/html", SHELL))
    title, links = drawn(bipinfo.page(host + quote(main)))
    assert title.startswith(
        "Oświadczenia majątkowe Radnych Rady Miejskiej - Oświadczenia majątkowe Radnych"
    )
    assert links[host + "/api/fo/files/abc123/download"] == "Zimna Anna"
    assert links[host + brok] == "Brok Anna"


def _commas(path: str) -> str:
    return ",".join(quote(s, safe="-._~") for s in path.split("/"))


def test_the_walk_finds_a_councillor_on_a_bipinfo_bip(tmp_path: Path) -> None:
    rendered: list[str] = []

    def render(url: str):
        rendered.append(url)
        return HttpResult(url, 0, "", b"", "no browser"), 0

    people, store, web = search(
        tmp_path,
        lubliniec(),
        [row("rm", "u1", "Rufin", "MAJCHRZYK"), row("so", "u1", "Sonia", "Wilk")],
        scopes={"u1": "lubliniec-starostwo.bip.info.pl"},
        render=render,
        sitemaps=False,
    )
    assert store.outcomes["rm"].status == "found"
    (doc,) = [d for d in store.person_docs("rm") if d.status == "ok"]
    assert doc.url == FILE
    assert doc.page_url == HOST + RADA + "/23792sp-rufin-majchrzyk"
    assert store.outcomes["so"].status == "not_found"
    assert rendered == []
    assert API + "articles/23793sp-sonia-wachowska" not in web.calls
    assert people.bipinfo.knows(HOST + "/")


def test_bipinfo_and_the_walk_agree_on_robots() -> None:
    assert ROBOTS == people_mode.ROBOTS


def test_a_person_sought_for_three_candidacies_gets_three_articles() -> None:
    # Mierzęcice's wójt, sought for 2014, 2018 and 2024: three seekers of one
    # name, and the one article opened for them counted three times (11-13).
    wojt = [Seeker.of(key, "Grzegorz", "PODLEJSKI", "Jerzy") for key in "abc"]
    entries = [
        Entry(
            f"Grzegorz Podlejski - Wójt Gminy Mierzęcice - za {year} rok",
            f"{year + 1}-05-20",
            False,
            "kierownictwo",
        )
        for year in (2021, 2022, 2023, 2024)
    ]
    assert entries_to_open(entries, wojt) == [3, 2, 1]


GLOGOW_FILES = "https://glogow.bip.info.pl/api/fo/files/"


def test_another_councillors_file_on_a_persons_page_is_not_theirs() -> None:
    # Głogów filed Łukasz Kogut's declaration on Mariusz Kędziora's page; the
    # page lent it him, as "named" (walk of 11-13).
    kedziora = Seeker.of("mk", "Mariusz", "KĘDZIORA", "Kamil")
    page = (
        "https://glogow.bip.info.pl/rada-miejska-4d/oswiadczenia-majatkowe-radnych-31d"
        "/oswiadczenia-majatkowe-kadencja-2018---2023-674d/mariusz-kedziora-679d"
        "/11272d-O%C5%9Bw.maj%C4%85tkowe-stan-na-31.12.2023"
    )
    subject = "Ośw.majątkowe stan na 31.12.2023 - Mariusz Kędziora"
    title = f"{subject} - oświadczenia majątkowe kadencja 2018 - 2023 - Rada Miejska"
    row = f"{subject} - opublikowano 2024-04-26"
    kogut = "Ł. Kogut ośw. majątkowe stan na 31.12.23.pdf"
    own = "Ośw. na 2 m-ce przed końcem kadencji (3).pdf"
    links = [
        LinkContext(
            GLOGOW_FILES + "0ecda57323d16b0295f87b63cde1e2/download", kogut, row
        ),
        LinkContext(GLOGOW_FILES + "2fd01edac54d1992595dc86b14e033/download", own, row),
    ]
    found = candidates(page, title, links, [kedziora])
    assert [(c.key, c.anchor) for c in found] == [("mk", own)]
    # "J. Kaczmarka" on Jan Kaczmarek's page stays his.
    kaczmarek = Seeker.of("jk", "Jan", "Kaczmarek")
    (mine,) = candidates(
        page,
        "Jan Kaczmarek - oświadczenia majątkowe",
        [LinkContext(GLOGOW_FILES + "1/download", "J. Kaczmarka oświadczenie.pdf")],
        [kaczmarek],
    )
    assert mine.key == "jk"


def test_a_gdpr_clause_a_guide_and_a_template_are_nobodys_declarations() -> None:
    # Głogów's section articles: three files sent as unnamed declarations to
    # three councillors of 2014 (walk of 11-13).
    page = (
        "https://glogow.bip.info.pl/prezydent-miasta-glogowa-1d/oswiadczenia-majatkowe"
        "-24d/1528d-O%C5%9Bwiadczenia-maj%C4%85tkowe-kadry-zarz%C4%85dzaj%C4%85cej"
    )
    title = "Oświadczenia majątkowe kadry zarządzającej w Urzędzie Miejskim"
    labels = [
        "RODO oświadczenia majątkowe.docx",
        "Poradnik, jak prawidłowo wypełnić oświadczenie majątkowe? "
        "(Poradnik jak prawidłowo wypełnić oświadczenie majątkowe.pdf)",
        "OŚWIADCZENIE MAJĄTKOWE szablon.doc",
        "Oświadczenie majątkowe za 2024 rok.pdf",
    ]
    links = [
        LinkContext(f"{GLOGOW_FILES}{i}/download", label)
        for i, label in enumerate(labels)
    ]
    seeker = Seeker.of("ks", "Kazimierz", "Borecki")
    found = candidates(page, title, links, [seeker], declared=True)
    assert [(c.key, c.anchor) for c in found] == [("", labels[-1])]
