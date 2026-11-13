"""bip.warszawa.pl: one search page for 22,125 declarations, searched by GET,
each entry a page that names its filer in "Imię"/"Nazwisko" fields."""

from __future__ import annotations

from urllib.parse import parse_qsl, urlsplit

from jobs.bip_crawler.liferay import search_links
from jobs.bip_crawler.person_page import name
from jobs.bip_crawler.tests.test_people_mode_big_bips import search as drawn_search
from jobs.bip_crawler.tests.test_people_mode_review import PDF, html, row, search
from scrapers.bip.people import Seeker, candidates
from scrapers.common.fetch import HttpResult
from scrapers.common.links import LinkContext

PORTLET = "web_content_search_portlet_INSTANCE_xgdl"
NS = f"_{PORTLET}_"
BOX = (
    f'<form method="post"><input id="{NS}keyword" name="{NS}keyword" '
    'placeholder="Czego szukasz?" type="text" value="" /></form>'
)
SEARCH = (
    f"https://u1.pl/oswiadczenia-majatkowe?p_p_id={PORTLET}&p_p_lifecycle=0"
    f"&{NS}mvcPath=%2Fview.jsp"
)


def entry(slug: str, title: str, district: str) -> str:
    """A result: one link around the whole card."""
    return (
        f'<li><a class="search-entry-link-wrapper" href="/web/{district}/-/{slug}">'
        f"<p>Oświadczenie majątkowe</p><dl><dd><p>{title}</p></dd>"
        "<dt>Typ osoby</dt><dd><p>Radny Dzielnicy</p></dd>"
        f"<dt>Dzielnica</dt><dd><p>{district}</p></dd></dl></a></li>"
    )


def filer(first: str, last: str, file_name: str, href: str) -> str:
    """An entry's page: the filer in fields, the file under "Załączniki"."""
    return (
        '<dl class="bip-article-row">'
        f"<div><dt>Imię</dt><dd>{first}</dd></div>"
        f"<div><dt>Nazwisko</dt><dd>{last}</dd></div>"
        "<div><dt>Dzielnica</dt><dd>Mokotów</dd></div></dl>"
        "<h3>Załączniki</h3><ul><li><div>"
        f"<span>{file_name}</span>"
        f'<a aria-label="Pobierz plik o nazwie {file_name}" href="{href}">'
        "<span>Pobierz</span></a></div></li></ul>"
    )


def test_a_search_narrowed_to_a_district_is_asked_for_each_seeker() -> None:
    seekers = [
        Seeker.of("a", "Sylwia", "MENDELEWSKA"),
        Seeker.of("b", "Elżbieta", "KOWALSKA-KOBUS"),
    ]
    narrowed = f"{SEARCH}&{NS}district=46385&{NS}cur=3"
    links = search_links(html("Oświadczenia majątkowe", BOX)[2], narrowed, seekers)
    asked = [dict(parse_qsl(urlsplit(x.url).query)) for x in links]
    # The surname as the list spells it (the box wants whole words, not
    # "mendelewsk"), the district kept, the page number dropped.
    assert [q[f"{NS}keyword"] for q in asked] == ["MENDELEWSKA", "KOWALSKA-KOBUS"]
    assert all(q[f"{NS}district"] == "46385" and f"{NS}cur" not in q for q in asked)
    assert all(q["p_p_id"] == PORTLET for q in asked)
    # The seeker's own name labels the link: it is read before the menus.
    assert "mendelewsk" in links[0].anchor


def test_an_unnarrowed_search_or_a_page_without_the_box_asks_nothing() -> None:
    seekers = [Seeker.of("a", "Radosław", "Sosnowski")]
    page = html("Oświadczenia majątkowe", BOX)[2]
    # Every district's Sosnowskis: Włochy's Radosław is not Mokotów's.
    assert search_links(page, "https://u1.pl/oswiadczenia-majatkowe", seekers) == []
    assert search_links(page, SEARCH, seekers) == []
    assert (
        search_links(html("x", "<p>nic</p>")[2], f"{SEARCH}&{NS}district=1", seekers)
        == []
    )
    # Narrowed to a kind of filer: the city's councillors.
    city = f"{SEARCH}&{NS}categoryIds=76220"
    assert len(search_links(page, city, seekers)) == 1


def test_another_filers_page_lends_nobody_its_files() -> None:
    """Jadwiga Skurska's 2025 declaration, a file whose label says "Pobierz"
    and whose name runs surname_first: Mokotów's 23 candidacies were each
    left unconfirmed on it (11-13)."""
    pdf = (
        "https://u1.pl/documents/50513/70595877/skurska_jadwiga_coroczne_2025.pdf"
        "/ae78256f-7101-fb75-82a2-b274f0b8a0ca?t=1781184325086"
    )
    page = html(
        "Jadwiga Skurska, oświadczenie majątkowe, coroczne 2025 - BIP",
        filer("Jadwiga", "Skurska", "skurska_jadwiga_coroczne_2025.pdf", pdf),
    )[2]
    owner = name(page)
    assert owner == "Jadwiga Skurska"
    link = LinkContext(
        pdf, "Pobierz", "skurska_jadwiga_coroczne_2025.pdf Pobierz", "Załączniki"
    )
    title = f"{owner} | Jadwiga Skurska, oświadczenie majątkowe, coroczne 2025 - BIP"
    seeker = Seeker.of("a", "Sylwia", "Mendelewska")
    assert (
        candidates("https://u1.pl/web/x/-/s", title, [link], [seeker], owner=owner)
        == []
    )
    # Without the fields it would have been the whole council's file.
    assert [
        c.key for c in candidates("https://u1.pl/web/x/-/s", title, [link], [seeker])
    ] == [""]
    # The filer sought: hers.
    hers = Seeker.of("s", "Jadwiga", "Skurska")
    found = candidates("https://u1.pl/web/x/-/s", title, [link], [hers], owner=owner)
    assert [(c.key, c.first_name) for c in found] == [("s", True)]


def test_the_walk_finds_a_district_councillor_through_the_search(tmp_path) -> None:
    narrowed = f"{SEARCH}&{NS}district=46385"
    keyword = f"{narrowed}&{NS}keyword=Mendelewska"
    mine = "https://u1.pl/web/mokotow/-/sylwia-mendelewska-oswiadczenie-majatkowe-coroczne-2025"
    other = "https://u1.pl/web/mokotow/-/jan-kowal-oswiadczenie-majatkowe-coroczne-2025"
    her_pdf = "https://u1.pl/documents/1/2/Mendelewska_2025.pdf/uuid-1?t=1"
    his_pdf = "https://u1.pl/documents/1/3/kowal_jan_2025.pdf/uuid-2?t=2"
    sites = {
        "https://u1.pl": html(
            "BIP", f'<a href="{narrowed}">Oświadczenia majątkowe</a>'
        ),
        # The district's newest 25: somebody else's.
        narrowed: html(
            "Oświadczenia majątkowe - BIP",
            BOX
            + "<ul>"
            + entry(
                "jan-kowal-oswiadczenie-majatkowe-coroczne-2025",
                "Jan Kowal, oświadczenie majątkowe, coroczne 2025",
                "mokotow",
            )
            + "</ul>",
        ),
        keyword: html(
            "Oświadczenia majątkowe - BIP",
            BOX
            + "<ul>"
            + entry(
                "sylwia-mendelewska-oswiadczenie-majatkowe-coroczne-2025",
                "Sylwia Mendelewska, oświadczenie majątkowe, coroczne 2025",
                "mokotow",
            )
            + "</ul>",
        ),
        mine: html(
            "Sylwia Mendelewska, oświadczenie majątkowe, coroczne 2025 - Mokotów - BIP",
            filer("Sylwia", "Mendelewska", "Mendelewska_2025.pdf", her_pdf),
        ),
        other: html(
            "Jan Kowal, oświadczenie majątkowe, coroczne 2025 - Mokotów - BIP",
            filer("Jan", "Kowal", "kowal_jan_2025.pdf", his_pdf),
        ),
        her_pdf: (200, "application/pdf", PDF + b"1"),
        his_pdf: (200, "application/pdf", PDF + b"2"),
    }
    rows = [
        row("a", "u1", "Sylwia", "Mendelewska"),
        # Nobody's file of hers on the BIP: not lent Jan Kowal's.
        row("b", "u1", "Maria", "Szreder"),
    ]
    _, store, web, _ = search(tmp_path, sites, rows, sitemaps=False)
    assert store.outcomes["a"].status == "found"
    assert [d.url for d in store.person_docs("a") if d.status == "ok"] == [her_pdf]
    assert store.outcomes["b"].status == "not_found"
    assert store.person_docs("b") == []


def test_a_page_a_seekers_link_led_to_is_still_lent_them() -> None:
    """The fields name somebody else, the link said hers (`declarants`): as
    before, hers; only a file nobody's link vouched for loses its lender."""
    pdf = "https://u1.pl/documents/1/2/oswiadczenie_2025.pdf/uuid?t=1"
    link = LinkContext(pdf, "Pobierz", "oswiadczenie_2025.pdf Pobierz", "Załączniki")
    seeker = Seeker.of("a", "Sylwia", "Mendelewska")
    found = candidates(
        "https://u1.pl/web/x/-/s",
        "Anna Nowak | Oświadczenie majątkowe - BIP",
        [link],
        [seeker],
        owner="Anna Nowak",
        lender=seeker.name,
    )
    assert [c.key for c in found] == ["a"]


def test_a_double_surname_is_asked_whole() -> None:
    """The search wants every word it is given ("CIECHOMSKA-XYZQW" finds
    nothing, "CIECHOMSKA" Małgorzata Ciechomska-Sołtyk's three entries), and
    finds a double surname whole however an entry writes it: Wola's "Joanna
    Tracz Łaptaszyńska", five entries by "TRACZ-ŁAPTASZYŃSKA" (11-13). A list
    that spaces the hyphen asks the same."""
    seekers = [
        Seeker.of("a", "Joanna", "TRACZ-ŁAPTASZYŃSKA"),
        Seeker.of("b", "Ewa", "Malinowska - Grupińska", "Dorota"),
    ]
    city = f"{SEARCH}&{NS}categoryIds=76220"
    links = search_links(html("Oświadczenia majątkowe", BOX)[2], city, seekers)
    asked = [dict(parse_qsl(urlsplit(x.url).query)) for x in links]
    assert [q[f"{NS}keyword"] for q in asked] == [
        "TRACZ-ŁAPTASZYŃSKA",
        "Malinowska-Grupińska",
    ]
    assert all(q[f"{NS}categoryIds"] == "76220" for q in asked)


def test_a_page_a_script_fills_keeps_the_name_its_fields_give(tmp_path) -> None:
    """A person's page that names her in fields and leaves her files to a
    script (`_empty_declarations`): the drawn page's title says nothing of
    her, so the fields' name goes in front of it as before the render, or the
    page would be a filer's nobody seeks and lend her nothing."""
    page = "https://u1.pl/oswiadczeniamajatkowe/osw_osoba.aspx?OsobaID=5343"
    person = (
        "<dl><dt>Imię</dt><dd>Ewa</dd><dt>Nazwisko</dt><dd>Lis</dd></dl>"
        '<div class="col-md-12 osw5343">{box}</div>'
        + "".join(f'<a href="/m{i}">Menu {i}</a>' for i in range(8))
    )
    sites = {
        # No declarations page, so no link lends her the page (`lenders`).
        "https://u1.pl": html("BIP", f'<a href="{page}">Ewa Lis</a>'),
        page: html("Strona podstawowa", person.format(box="")),
        "https://u1.pl/files/1.pdf": (200, "application/pdf", PDF + b"1"),
    }

    def render(url: str) -> tuple[HttpResult, int]:
        box = '<ul><li><a href="/files/1.pdf">Oświadczenie za 2025</a></li></ul>'
        drawn = html("Strona podstawowa", person.format(box=box))
        return HttpResult(url, drawn[0], "text/html", drawn[2]), 0

    rows = [row("lis", "u1", "Ewa", "Lis")]
    _, store, _ = drawn_search(tmp_path, sites, rows, render=render, sitemaps=False)
    assert store.outcomes["lis"].status == "found"
    assert {url for _, url in store.docs} == {"https://u1.pl/files/1.pdf"}
