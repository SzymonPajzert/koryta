"""Pages that say only in their breadcrumb that they stand under declarations:
Alfa TV's, 2ClickPortal's, SkyCMS's and Sputnik BIPv2's; and BIPv2's category
lists, read whole."""

from __future__ import annotations

from jobs.bip_crawler.crumbs import declarations, trail
from jobs.bip_crawler.sputnik import whole_list
from jobs.bip_crawler.tests.test_people_mode_review import PDF, html, row, search

HOST = "https://u1.pl"

#: Żnin's person page (Alfa TV), bip.powiatzninski.pl/dokumenty/5647.
ZNIN = (
    '<nav class="mt-3 mb-3" aria-label="breadcrumb">\n    <ol class="breadcrumb">\n'
    '        <li class="breadcrumb-item"><a>Oświadczenia majątkowe</a></li>'
    '<li class="breadcrumb-item"><a href="/dokumenty/menu/54">Oświadczenia '
    'majątkowe</a></li><li class="breadcrumb-item"><a href="/dokumenty/5586">Na '
    "początek kadencji 2024-2029</a></li>"
    '<li class="breadcrumb-item"><a href="/dokumenty/5632">Radni Rady Powiatu w '
    'Żninie</a></li><li class="breadcrumb-item"><a href="/dokumenty/5647">'
    "Falkowska Anna</a></li>    </ol>\n</nav>"
)
#: The file under it, which says nothing of declarations.
ZNIN_FILE = (
    '<h2 class="mt-5 mb-5">Załączniki do pobrania</h2><table><thead><tr>'
    "<th>Lp.</th><th>Plik</th><th>Data dodania</th><th>Liczba pobrań</th></tr>"
    "</thead><tbody><tr><td>1</td>"
    '<td><a href="/pobierz/5896">Falkowska Anna.pdf (PDF, 255.86Kb)</a> </td>'
    "<td>2024-07-23 10:13:19</td><td> 389 razy</td></tr></tbody></table>"
)
#: Brzostek's councillors for 2024 (2ClickPortal): an item's neighbours follow
#: its link.
BRZOSTEK = """<nav class="breadcrumbs" aria-label="Ścieżka nawigacyjna">
    <ul class="row v_center breadcrumbs__wrap">
        <li class="breadcrumbs__item ">
            <a href="https://bip.brzostek.pl/" class="breadcrumbs__link">
                <span>Strona główna</span></a></li>
        <li class="breadcrumbs__item ">
            <a href="219-oswiadczenia-majatkowe.html" class="breadcrumbs__link -active">
                <span>Oświadczenia majątkowe</span></a></li>
        <li class="breadcrumbs__item breadcrumbs__item--neighbors">
            <a href="2024-rok.html" class="breadcrumbs__link">
                <span>za 2024 rok</span></a>
            <button type="button" class="breadcrumbs__neighborsToggle">
                <span class="visuallyHidden">Pokaż strony sąsiednie: za 2024 rok</span>
            </button>
            <div id="breadcrumbs_neighbors_3" class="breadcrumbs_neighbors_container">
                <ul class="level1 breadcrumbs_sub_ul">
                    <li class="level1 breadcrumbs_sub_li">
                        <a href="/2023-rok.html" class="breadcrumbsSub__link">
                            za 2023 rok</a>
                    </li>
                </ul>
            </div></li>
        <li class="breadcrumbs__item breadcrumbs__item--neighbors">
            <a href="2170-radni-rady-miejskiej.html" class="breadcrumbs__link -active"
               aria-current="page"><span>Radni Rady Miejskiej</span></a></li>
    </ul>
</nav>"""
#: Opole's councillors (SkyCMS), every ?Page=N of them.
OPOLE = (
    '<ul class="pageBreadcumb">\n\t\t\t\n\t\t\t<li class="pageBreadcumbLink">\n'
    '\t\t\tMenu przedmiotowe\n\t\t\t</li>\n\t\t\t<li class="pageBreadcumbSeparator">'
    '</li>\n\t\t\t<li class="pageBreadcumbLink">\n\t\t\tOświadczenia majątkowe\n'
    '\t\t\t</li>\n\t\t\t<li class="pageBreadcumbSeparator"></li>\n'
    '\t\t\t<li class="pageBreadcumbLink">\n\t\t\t\n\t\t\t\t<a href="https://bip.'
    'powiatopolski.pl/2553/radni-powiatu.html">Oświadczenia Radnych Powiatu</a>\n'
    "\t\t\t\n\t\t\t</li>\n\t\t\t\n\t\t\t</ul>"
)
_ITEM = '<li class="text-sm uppercase leading-normal flex items-center">'
_CHEVRON = (
    '<div class="flex justify-center items-center mx-[5px]"><svg aria-hidden="true" '
    'data-icon="chevron-right" viewBox="0 0 320 512"><path fill="currentColor" '
    'd="M310.6 233.4c12.5 12.5 12.5 32.8 0 45.3l-192 192z"></path></svg></div>'
)


def sputnik_trail(*sections: str) -> str:
    """Sputnik BIPv2's breadcrumb (bip.mogilno.pl): the sections linked, the
    page itself a span."""
    *above, here = sections
    return (
        f'<ul class="wrapper flex items-center flex-wrap">{_ITEM}<a target="_self" '
        'class="text-primary font-bold" title="Strona główna" href="/?lang=PL">'
        "Strona główna</a></li>"
        + "".join(
            f'{_ITEM}{_CHEVRON}<a target="_self" class="text-primary font-bold" '
            f'title="{s}" href="/kategorie/{i}-x?lang=PL">{s}</a></li>'
            for i, s in enumerate(above, 21)
        )
        + f'{_ITEM}{_CHEVRON}<span title="{here}" class="text-breadcrumbsText '
        f'uppercase font-bold">{here}</span></li></ul>'
    )


def sputnik_list(category: str, people: list[str], total: int) -> str:
    """A BIPv2 category's articles, as many as shown, and its payload's count."""
    items = "".join(
        '<li class="items-start pl-[20px] mt-[20px] flex bg-transparent">'
        f'<div class="w-[10px]">{i}<!-- -->.</div><div class="ml-[10px]">'
        f'<div class="inline-flex"><a target="_self" class="text-primary underline" '
        f'title="{name}" href="/kategorie/{category}/artykuly/{100 + i}-x?lang=PL">'
        f"{name}</a></div><div>(Opublikowano: 2024-07-26)</div></div></li>"
        for i, name in enumerate(people, 1)
    )
    payload = (
        r'<script>self.__next_f.push([1,"[\"$\",\"$L2a\",null,{\"pagination\":'
        r"{\"first\":\"Pierwszy\",\"last\":\"Ostatni\",\"show\":\"Pokaż\","
        r"\"size\":[10,25,50,100]},\"totalItems\":"
        + str(total)
        + r',\"searchParams\":{\"lang\":\"PL\"}}]"])</script>'
    )
    return f"<ul>{items}</ul>{payload}"


def test_each_platforms_breadcrumb_says_where_a_page_stands() -> None:
    assert trail(ZNIN.encode()) == (
        "Oświadczenia majątkowe > Oświadczenia majątkowe > Na początek kadencji "
        "2024-2029 > Radni Rady Powiatu w Żninie > Falkowska Anna"
    )
    # Each item's own link, not its neighbours'.
    assert trail(BRZOSTEK.encode()) == (
        "Oświadczenia majątkowe > za 2024 rok > Radni Rady Miejskiej"
    )
    assert trail(OPOLE.encode()) == (
        "Menu przedmiotowe > Oświadczenia majątkowe > Oświadczenia Radnych Powiatu"
    )
    mogilno = sputnik_trail("Oświadczenia majątkowe", "Rok 2024", "Nawrot Karol")
    assert trail(mogilno.encode()) == (
        "Oświadczenia majątkowe > Rok 2024 > Nawrot Karol"
    )
    # A page in windows-1250, as its <meta> says.
    old = html("BIP", OPOLE, "windows-1250")[2].replace(
        b"<head>", b'<head><meta charset="windows-1250">'
    )
    assert trail(old) == trail(OPOLE.encode())
    # A list of the same classes that is no breadcrumb.
    assert (
        trail(b'<ul class="wrapper flex items-center flex-wrap"><li>a</li></ul>') == ""
    )
    assert trail(html("BIP", "<ul><li>Oświadczenia majątkowe</li></ul>")[2]) == ""
    # What a page's files carry: the trail up to the declarations.
    assert declarations(trail(ZNIN.encode())) == (
        "Oświadczenia majątkowe > Oświadczenia majątkowe"
    )
    assert declarations("Mienie > Sprzedaż majątku") == ""


def test_a_file_on_a_page_only_its_breadcrumb_calls_declarations_comes_down(
    tmp_path,
) -> None:
    # Żnin: a person's page titled with her name alone, her file labelled so.
    person = html("Falkowska Anna - BIP Powiat Żniński", ZNIN + ZNIN_FILE)
    sites = {
        HOST: html(
            "BIP Powiat Żniński", '<a href="/dokumenty/5647">Falkowska Anna</a>'
        ),
        f"{HOST}/dokumenty/5647": person,
        f"{HOST}/pobierz/5896": (200, "application/pdf", PDF + b"f"),
    }
    seekers = [row("f", "u1", "Anna", "Falkowska")]
    _, store, _, _ = search(tmp_path / "a", sites, seekers, sitemaps=False)
    assert store.outcomes["f"].status == "found"
    assert [d.url for d in store.person_docs("f")] == [f"{HOST}/pobierz/5896"]
    assert store.units["u1"].declaration_pages == 1
    # Without the breadcrumb nothing says the file is a declaration.
    sites[f"{HOST}/dokumenty/5647"] = html(
        "Falkowska Anna - BIP Powiat Żniński", ZNIN_FILE
    )
    _, store, _, _ = search(tmp_path / "b", sites, seekers, sitemaps=False)
    assert store.outcomes["f"].status == "not_found"


def test_the_crumbs_past_the_declarations_name_nobody(tmp_path) -> None:
    # A page under the mayor's section: its file is the deputy's, whose name
    # the heading over it says; the crumb naming the mayor lends him nothing.
    crumb = (
        '<ol class="breadcrumb"><li class="breadcrumb-item"><a href="/om">'
        'Oświadczenia majątkowe</a></li><li class="breadcrumb-item"><a href="/b">'
        'Burmistrz Jan Kowalski</a></li><li class="breadcrumb-item active">'
        "Zastępca</li></ol>"
    )
    sites = {
        HOST: html("BIP", '<a href="/z">Zastępca</a>'),
        f"{HOST}/z": html(
            "Zastępca - BIP",
            crumb + '<h3>Anna Nowak</h3><p><a href="/f/9.pdf">za 2024 rok</a></p>',
        ),
        f"{HOST}/f/9.pdf": (200, "application/pdf", PDF + b"n"),
    }
    _, store, _, _ = search(
        tmp_path,
        sites,
        [row("n", "u1", "Anna", "Nowak"), row("k", "u1", "Jan", "Kowalski")],
        sitemaps=False,
    )
    assert store.outcomes["n"].status == "found"
    assert store.outcomes["k"].status == "not_found"


def test_two_click_portals_councillors_come_down(tmp_path) -> None:
    files = (
        '<h3>Załączniki</h3><ul><li><a href="/files/file_add/download/3975_pawel-'
        'hipszer.pdf">Paweł Hipszer - Przewodniczący Rady Miejskiej w Brzostku.pdf'
        '</a></li><li><a href="/files/file_add/download/3974_jerzy-kmiecik.pdf">'
        "Jerzy Kmiecik - Radny Rady Miejskiej w Brzostku.pdf</a></li></ul>"
    )
    sites = {
        HOST: html("BIP UM Brzostek", '<a href="/2170">Radni Rady Miejskiej</a>'),
        f"{HOST}/2170": html(
            "Radni Rady Miejskiej - BIP UM Brzostek", BRZOSTEK + files
        ),
        f"{HOST}/files/file_add/download/3975_pawel-hipszer.pdf": (
            200,
            "application/pdf",
            PDF + b"h",
        ),
    }
    _, store, _, _ = search(
        tmp_path, sites, [row("h", "u1", "Paweł", "Hipszer")], sitemaps=False
    )
    assert store.outcomes["h"].status == "found"


def test_skycms_councillors_list_leads_to_their_declarations(tmp_path) -> None:
    # Opole: the list says declarations in its breadcrumb alone; the person's
    # page nowhere, its files labelled with the name and the term.
    listing = (
        '<h1 class="pageHeader">Radni Powiatu</h1><ul class="pageOnPage"><li>'
        '<h2 class="pageOnPageHeader"><a href="/7309/sulikowski-jacek-radny-powiatu'
        '.html">Sulikowski Jacek - Radny Powiatu</a></h2></li></ul>'
    )
    person = (
        '<h1 class="pageHeader">Sulikowski Jacek - Radny Powiatu</h1><p><span>'
        '<a class="fileLink" href="/download/attachment/38227/jacek-sulikowski.pdf">'
        '<span class="fileName">Jacek Sulikowski - rozpoczęcie VII kadencji (PDF | '
        "113,33KB)</span></a></span></p>"
    )
    title = "Sulikowski Jacek - Radny Powiatu - Starostwo Powiatowe w Opolu"
    sites = {
        HOST: html("Starostwo", '<a href="/2553/radni-powiatu.html">Radni</a>'),
        f"{HOST}/2553/radni-powiatu.html": html("Radni Powiatu", OPOLE + listing),
        f"{HOST}/7309/sulikowski-jacek-radny-powiatu.html": html(title, person),
        f"{HOST}/download/attachment/38227/jacek-sulikowski.pdf": (
            200,
            "application/pdf",
            PDF + b"s",
        ),
    }
    _, store, _, _ = search(
        tmp_path, sites, [row("s", "u1", "Jacek", "Sulikowski")], sitemaps=False
    )
    assert store.outcomes["s"].status == "found"


def test_a_bipv2_list_is_read_whole(tmp_path) -> None:
    # Mogilno: the councillors' list shows ten of twelve; Nawrot is the 11th.
    shown = [f"Radny{chr(65 + i)} Jan" for i in range(10)]
    category = "335-radni-rady-miejskiej"
    trail_ = sputnik_trail("Oświadczenia majątkowe", "Rok 2024", "Radni Rady Miejskiej")
    article = sputnik_trail(
        "Oświadczenia majątkowe", "Rok 2024", "Radni Rady Miejskiej", "Nawrot Karol"
    ) + (
        '<h3 class="text-primary">Nawrot Karol</h3><div>Załączniki</div><ul><li>'
        '<a href="https://bip-api.u1.pl/api/attachments/911" title="nawrot karol.pdf">'
        "nawrot karol.pdf 507.36 KB</a></li></ul>"
    )
    office = "BIP Urząd Miejski w Mogilnie"
    sites = {
        HOST: html(office, f'<a href="/kategorie/{category}?lang=PL">Radni</a>'),
        f"{HOST}/kategorie/{category}?lang=PL": html(
            office, trail_ + sputnik_list(category, shown, 12)
        ),
        f"{HOST}/kategorie/{category}?lang=PL&size=100": html(
            office,
            trail_ + sputnik_list(category, [*shown, "Nawrot Karol", "Zych Ewa"], 12),
        ),
        f"{HOST}/kategorie/{category}/artykuly/111-x?lang=PL": html(office, article),
        "https://bip-api.u1.pl/api/attachments/911": (
            200,
            "application/pdf",
            PDF + b"k",
        ),
    }
    _, store, web, _ = search(
        tmp_path, sites, [row("k", "u1", "Karol", "Nawrot")], sitemaps=False
    )
    assert f"{HOST}/kategorie/{category}?lang=PL&size=100" in web.calls
    assert store.outcomes["k"].status == "found"


def test_a_page_its_breadcrumb_alone_calls_declarations_counts_as_one(
    tmp_path,
) -> None:
    # Every BIPv2 unit's pages are titled with the office's name: a unit whose
    # declarations name somebody else read no_declarations.
    category = "336-radni"
    sites = {
        HOST: html("BIP Gmina", f'<a href="/kategorie/{category}?lang=PL">Radni</a>'),
        f"{HOST}/kategorie/{category}?lang=PL": html(
            "BIP Gmina",
            sputnik_trail("Oświadczenia majątkowe", "Radni")
            + sputnik_list(category, ["Zych Ewa"], 1),
        ),
    }
    _, store, web, _ = search(
        tmp_path, sites, [row("k", "u1", "Karol", "Nawrot")], sitemaps=False
    )
    assert store.units["u1"].declaration_pages == 1
    assert store.outcomes["k"].reason == "not_listed"
    # One shown of one: nothing more to list.
    assert not any("size=" in call for call in web.calls)


def test_a_bipv2_list_shows_ten_unless_asked_for_more() -> None:
    page = html("BIP", sputnik_list("335-radni", ["Zych Ewa"], 18))[2]
    url = f"{HOST}/kategorie/335-radni?lang=PL"
    assert whole_list(page, url) == [f"{url}&size=100"]
    assert whole_list(html("BIP", sputnik_list("335-radni", [], 250))[2], url) == [
        f"{url}&size=100",
        f"{url}&size=100&page=1",
        f"{url}&size=100&page=2",
    ]
    # All shown, already whole, or no category list.
    assert whole_list(html("BIP", sputnik_list("335-radni", [], 10))[2], url) == []
    assert whole_list(page, f"{url}&size=100") == []
    assert whole_list(page, f"{HOST}/kategorie/335-radni/artykuly/1-x?lang=PL") == []
    assert whole_list(page, f"{HOST}/?lang=PL") == []
