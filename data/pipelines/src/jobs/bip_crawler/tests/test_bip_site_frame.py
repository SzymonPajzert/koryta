"""A page about one person lends them the files of its content, not of the
site's frame around it: menus, the site's header and footer, sidebars.

The snippets are the BIPs' own markup (11-13), cut down to the parts that
matter: on bip_poi_docs of 11-13 a page about one person had lent menu and
footer files ("Statut", "Odprowadzenie wód opadowych z posesji", "Wniosek o
wydanie prawa jazdy") to 57 candidacies as their declarations.
"""

from __future__ import annotations

from scrapers.bip.people import Seeker, candidates
from scrapers.common.links import _frame_name, extract_link_contexts

UTF8 = "text/html; charset=utf-8"

#: biuletyn.net (Karczew, Sulejów, Piława Górna, Chybie): the left menu is a
#: <nav> in an <aside> in <main>, beside the page's own content.
BIULETYN_MENU = """
<aside class="menu-lewe-tlo"><nav class="menu-lewe" id="menu-lewe">
<ul class="menu-lewe-1-poziom"><li class="rozwijka">
<a href="?bip=2&amp;cid=25">Gmina</a><ul><li><a
href="https://bip.karczew.pl/fls/bip_pliki/2026_10/BIPF65F097DBB674EZ/501.pdf"
title="Dokument PDF 822 KB - otworzy się w nowym oknie">Statut</a></li></ul>
</li></ul></nav></aside>
"""


def biuletyn(title: str, content: str) -> str:
    return (
        f"<html><head><title>{title}</title></head><body>"
        f'<h1 id="skip-start">Za 2023 rok</h1><main>{BIULETYN_MENU}'
        '<div class="srodek-tlo"><div id="skip-tresc" class="strona-tresc">'
        '<div class="artykuly"><article class="artykul-tlo aktualnosci-tlo">'
        f"{content}</article></div></div></div></main>"
        '<footer><nav class="stopka menu-dol-tlo" id="menu-dol">'
        "<h2>Menu dolne</h2></nav></footer></body></html>"
    )


def test_a_menu_file_on_a_persons_page_is_not_theirs():
    # Karczew's page of Tadeusz Płaczek: his declaration in the article, and
    # the left menu's "Statut", which was stored as his declaration too (11-13).
    page = "https://bip.karczew.pl/?bip=2&cid=785&id=4369"
    title = (
        "Tadeusz Marek Płaczek - Za 2023 rok - VIII Kadencja - Rada Miejska - "
        "Oświadczenia majątkowe - BIP - Urząd Miejski w Karczewie"
    )
    html = biuletyn(
        title,
        '<h2 class="h1-tytul aktualnosci-tytul"><span class="ariaonly">Treść '
        "zakładki</span>Tadeusz Marek Płaczek</h2>"
        '<div class="aktualnosci-tresc"><p><strong>Wyłączenia jawności części B '
        "oświadczeń majątkowych dokonali pracownicy Biura Rady</strong></p>"
        '<p><a title="PDF" href="fls/bip_pliki/2024_05/BIPF61930202C92C3Z/'
        '2023_Tadeusz_Marek_Placzek_anoni_spr.pdf">Treść</a></p></div>',
    )
    title, links = extract_link_contexts(html, page, UTF8)
    statut = next(x for x in links if x.url.endswith("501.pdf"))
    assert statut.frame
    placzek = Seeker.of("p", "Tadeusz", "Płaczek", "Marek")
    found = candidates(page, title, links, [placzek])
    assert [c.url.rsplit("/", 1)[-1] for c in found] == [
        "2023_Tadeusz_Marek_Placzek_anoni_spr.pdf"
    ]


def test_a_persons_own_file_beside_the_menu_is_still_theirs():
    # Chybie, the same platform: the wójt's page links his declaration in its
    # article, labelled "OTWÓRZ/POBIERZ".
    page = "https://chybie.biuletyn.net/?bip=2&cid=141&id=2319"
    title = (
        "Oświadczenie majątkowe - początek kadencji - Janusz Żydek -Wójt Gminy - "
        "Pracownicy samorządowi - Oświadczenia majątkowe - OŚWIADCZENIA "
        "MAJĄTKOWE - MENU PRZEDMIOTOWE - BIP - Urząd Gminy w Chybiu"
    )
    html = biuletyn(
        title,
        '<h2 class="h1-tytul aktualnosci-tytul"><span class="ariaonly">Treść '
        "zakładki</span>Oświadczenie majątkowe - początek kadencji</h2>"
        '<div class="aktualnosci-tresc"><p><a href="fls/bip_pliki/2024_08/'
        'BIPF61F3C81FFB101Z/2024_Wojt_Chybie_-_na_rozpoczecie_kadencji.pdf" '
        'target="_blank" rel="noopener">OTWÓRZ/POBIERZ</a></p></div>',
    )
    title, links = extract_link_contexts(html, page, UTF8)
    zydek = Seeker.of("z", "Janusz", "Żydek")
    found = candidates(page, title, links, [zydek])
    assert [(c.key, c.url.rsplit("/", 1)[-1], c.declaration_like) for c in found] == [
        ("z", "2024_Wojt_Chybie_-_na_rozpoczecie_kadencji.pdf", True)
    ]


#: The template of Mysłowice, Myślibórz, Żnin, Krynica Morska, Złocieniec,
#: Lębork: the menu in the header's <nav> for phones, and again down the side
#: of the content for wider screens, in no <nav>.
MENU_TWICE = """
<header class="header-global bg-light pt-5"><nav id="navbar-main"
class="navbar navbar-main navbar-expand-lg navbar-theme-primary headroom navbar-dark">
<div class="container position-relative"><div id="navbar-default-primary"
class="navbar-collapse collapse">
<ul class="navbar-nav navbar-nav-hover align-items-lg-center">
<li class="nav-item dropdown d-lg-none">
<a href="#" class="nav-link">Gospodarka wodna</a>
<ul class="dropdown-menu"><li><a class="dropdown-item"
href="/pliki/myslowice/pliki/odprowadzenie_wod_opadowych_z_posesji_1.pdf">Odprowadzenie
wód opadowych z posesji</a></li></ul></li></ul></div></div></nav></header>
<main><div class="section section-sm"><div class="container border-soft shadow-lg">
<div class="row justify-content-center py-3"><div class="d-none d-lg-block col-lg-3">
<div class="card bg-secondary">
<ul id="accordionExample1" class="accordion list-unstyled mb-0">
<li class="card card-sm card-body bg-secondary mb-0"><div id="level-5" class="collapse">
<div class="pt-3"><ul class="list-group list-group-flush">
<li class="list-group-item border-primary px-0"><a
href="/pliki/myslowice/pliki/odprowadzenie_wod_opadowych_z_posesji_1.pdf"
class="text-white">Odprowadzenie wód opadowych z posesji</a></li>
</ul></div></div></li></ul></div></div>
"""


def menu_twice(title: str, content: str) -> str:
    return (
        f"<html><head><title>{title}</title></head><body>{MENU_TWICE}"
        f'<article id="content" class="col-md-12 col-lg-9">{content}</article>'
        "</div></div></div></main></body></html>"
    )


def test_a_menu_drawn_twice_lends_its_file_from_neither_copy():
    # 11 Mysłowice councillors each held the menu's "Odprowadzenie wód
    # opadowych z posesji" as theirs: a link that named one of them led the
    # walk to the declarations page, which names nobody.
    page = "https://bip.myslowice.pl/artykul/oswiadczenia-majatkowe"
    html = menu_twice(
        "Oświadczenia majątkowe | BIP - Urząd Miasta Mysłowice",
        '<h1 class="h3 my-3 my-md-4">Oświadczenia majątkowe</h1>'
        '<div class="py-2" id="tresc"><p>Zgodnie z art. 24h oraz art. 24i ustawy '
        "z dnia 8 marca 1990 r. o samorządzie gminnym w tym katalogu publikowane "
        "są jawne informacje zawarte w oświadczeniach majątkowych.</p></div>",
    )
    title, links = extract_link_contexts(html, page, UTF8)
    (menu_file,) = [x for x in links if x.url.endswith(".pdf")]
    assert menu_file.frame
    harmata = Seeker.of("h", "Agnieszka", "Harmata", "Maria")
    found = candidates(page, title, links, [harmata], lender=harmata.name)
    assert found == []
    # Nor is it the council's file that names nobody.
    assert candidates(page, title, links, [harmata], declared=True) == []


def test_the_content_file_of_a_template_with_its_menu_twice_is_lent():
    # Lębork, the same template: the burmistrz's page, his file in its table.
    page = (
        "https://bip.um.lebork.pl/artykul/"
        "oswiadczenie-majatkowe-burmistrza-miasta-leborka-pana-jaroslawa-litwina"
    )
    html = menu_twice(
        "Oświadczenie majątkowe Burmistrza Miasta Lęborka – Pana Jarosława "
        "Litwina | BIP - Urząd Miejski w Lęborku",
        '<h1 class="h3 my-3 my-md-4">Oświadczenie majątkowe Burmistrza Miasta '
        "Lęborka – Pana Jarosława Litwina</h1><hr />"
        '<h2 class="h4 my-3 my-md-4">Załączniki do pobrania</h2>'
        '<div class="table-responsive-sm mb-4"><table class="table table-striped">'
        "<thead><tr><th>Plik</th><th>Nazwa</th><th>Data dodania</th><th>Pobrań</th>"
        "</tr></thead><tbody><tr><td></td><td>"
        '<a href="/pliki/lebork/zalaczniki/20935/lebork-burmistrz.pdf" '
        'class="download" id="31505" download="">Lębork - Burmistrz (PDF, 2.14 MB)'
        "</a></td><td>2026-06-22 11:03:13</td><td>83</td></tr></tbody></table></div>",
    )
    title, links = extract_link_contexts(html, page, UTF8)
    litwin = Seeker.of("l", "Jarosław", "Litwin")
    found = candidates(page, title, links, [litwin])
    assert [c.url.rsplit("/", 1)[-1] for c in found] == ["lebork-burmistrz.pdf"]


def test_a_footer_is_not_under_the_last_heading_of_the_content():
    # Gliwice: the declarations list, then the footer's forms. The footer's
    # links took the list's heading "Oświadczenia majątkowe", and fifteen
    # councillors their "Wniosek o wydanie prawa jazdy" (11-13).
    page = "https://bip.gliwice.eu/oswiadczeniaMajatkowe/lista"
    html = (
        "<html><head><title>Oświadczenia majątkowe | Biuletyn Informacji "
        "Publicznej Urzędu Miejskiego w Gliwicach</title></head><body>"
        "<main><h2>Oświadczenia majątkowe</h2><p>Lista oświadczeń</p></main>"
        '<footer id="stopka" class="footer"><div class="footer-top">'
        '<div class="container"><div class="footer-item">'
        '<div class="footer-item-head"><hr class="hr-footer" />'
        "<span>Urząd Miejski w Gliwicach</span></div>"
        '<div class="footer-item-content"><ul class="menu-sidebar"><li>'
        '<a href="https://bip.gliwice.eu/wirtualne-biuro-obslugi/'
        'formularze-do-pobrania/km/km-42.pdf" target="_self">'
        "<span>Wniosek o wydanie prawa jazdy</span></a></li></ul></div>"
        "</div></div></div></footer></body></html>"
    )
    title, links = extract_link_contexts(html, page, UTF8)
    (form,) = [x for x in links if x.url.endswith(".pdf")]
    assert form.frame and form.heading == ""
    kleczka = Seeker.of("k", "Krzysztof", "Kleczka", "Robert")
    assert candidates(page, title, links, [kleczka], lender=kleczka.name) == []
    assert candidates(page, title, links, [kleczka], declared=True) == []


def test_a_menu_banner_is_not_the_declaration_of_the_seeker_a_link_named():
    # Lwówek Śląski (11-13): a link naming Zdzisława Trzaska led the walk to
    # the declarations search page, and the left menu's banner (rodo.pdf, a
    # picture for a label) became her declaration.
    page = "https://bip.lwowekslaski.pl/oswiadczenia"
    html = (
        "<html><head><title>Biuletyn Informacji Publicznej Gminy i Miasta Lwówek "
        "Śląski - Oświadczenia majątkowe</title></head><body>"
        '<div id="Layout"><div id="MainContent" class="contener">'
        '<div id="MenuLeft"><h2 class="first" id="MenuPodmiotowe">Menu '
        'podmiotowe</h2><ul class="main"><li><a href="https://bip.lwowekslaski.pl'
        '/dane">Dane teleadresowe</a></li></ul><h2>Ogłoszenia</h2>'
        '<div class="center"><div class="R_img"><a href="http://assets.'
        'lwowekslaski.pl/pliki/rodo.pdf" target="_blank"><img src="https://bip-v1-'
        'files.idcom-jst.pl/sites/3103/bannery/rodo.jpg" alt="Klauzula '
        'informacyjna" /></a></div></div></div>'
        '<div id="Content"><h2 class="header">Oświadczenia majątkowe</h2>'
        '<form method="get" action="https://bip.lwowekslaski.pl/oswiadczenia" '
        'id="OswiadczeniaFiltr"><input type="hidden" name="opcja" value="szukaj" />'
        "</form></div></div></div></body></html>"
    )
    title, links = extract_link_contexts(html, page, UTF8)
    (rodo,) = [x for x in links if x.url.endswith("rodo.pdf")]
    assert rodo.frame
    trzaska = Seeker.of("t", "Zdzisława", "Trzaska")
    assert candidates(page, title, links, [trzaska], lender=trzaska.name) == []


def test_a_menu_file_that_says_declaration_is_still_the_councils():
    # A file of the frame is somebody's declaration only by its own words.
    page = "https://bip.x.pl/oswiadczenia-majatkowe"
    html = (
        "<html><head><title>Oświadczenia majątkowe</title></head><body>"
        '<div id="menu-lewe"><ul><li><a href="/pliki/osw_radni_2024.pdf">'
        "Oświadczenia majątkowe radnych za 2024 r.</a></li></ul></div>"
        "<div><p>Oświadczenia majątkowe radnych</p></div></body></html>"
    )
    title, links = extract_link_contexts(html, page, UTF8)
    (council,) = [x for x in links if x.url.endswith(".pdf")]
    assert council.frame
    wilk = Seeker.of("w", "Marek", "Wilk")
    (found,) = candidates(page, title, links, [wilk], declared=True)
    assert found.key == "" and found.declaration_like


def test_what_holds_the_content_is_never_the_frame():
    cases = {
        # Kraków's declaration cards stand in a "nav-container".
        "https://www.bip.krakow.pl/oswiadczenie/34231/karta/": (
            '<div class="lbg"><div class="container nav-container"><div class="row">'
            '<div class="col-lg-9 col-11" id="newsblock"><h1>Oświadczenie nr 34231, '
            "Mariusz, Bogusław Kękuś, rok: 2025</h1>"
            '<table class="karta_zalacznika"><tr><td><a class="btn btn-primary" '
            'href="/oswiadczenia/osw_34231.pdf" target="_blank">zobacz</a></td>'
            "<td>348.42 kB</td></tr></table></div></div></div></div>"
        ),
        # Toruń's files each under their own "header".
        "https://bip.torun.pl/oswiadczenie-majatkowe/50526/wojciech-klabun": (
            '<main class="container-fluid"><div id="main-content" class="contents">'
            '<article class="box"><section id="attachments" class="attachments">'
            '<div class="header"><span><a id="attachments-title" '
            'href="https://bip.torun.pl/attachments/download/52264.pdf">'
            "Oświadczenie majątkowe złożone w 2025 r.</a></span></div>"
            "</section></article></div></main>"
        ),
        # Lubicz's content in a "footer-bg".
        "https://www.bip.lubicz.pl/5801,radni?tresc=73606": (
            '<div id="wrapperSectionContent" class="wrapper footer-bg">'
            '<main id="main"><article><div id="PageContent"><ul class="system_ul '
            'zbior_plikow_box"><li class="pliki_box"><a href="plik,36976,'
            'oswiadczenie-majatkowe-za-2025-r.pdf" class="pliki_link">Oświadczenie '
            "majątkowe za 2025 r.</a></li></ul></div></article></main></div>"
        ),
        # Krzyżanowice's header leaves a <div> open in its logo's link, and
        # lxml reads the content as standing in the header's <nav>.
        "https://www.krzyzanowice.pl/bip/oswiadczenia-majatkowe-pracownikow/": (
            '<header class="bip-header__container no-print"><div '
            'class="content-wrapper"><nav><div class="bip-header__inner"><a '
            'class="bip-header__logo-wrapper" href="https://www.krzyzanowice.pl/">'
            '<div class="bip-header__logo"><img src="logo.svg" alt="Krzyżanowice">'
            "</a></div></nav></div></header>"
            '<div id="content" class="bip-content-wrapper"><ul class="lazyblocks__'
            'download-files-list"><li><a href="https://www.krzyzanowice.pl/'
            'wp-content/uploads/2025/07/E_Starosta-Pilat_zakonczenie_2025.pdf">'
            "</a></li></ul></div>"
        ),
    }
    for page, body in cases.items():
        html = f"<html><head><title>x</title></head><body>{body}</body></html>"
        _, links = extract_link_contexts(html, page, UTF8)
        files = [x for x in links if ".pdf" in x.url]
        assert files and not any(x.frame for x in files), page


def test_what_names_a_frame():
    for name in (
        "MenuLeft",
        "menu-lewe",
        "menu-lewe-1-poziom",
        "right_menu",
        "menu-pion",
        "menuPrzedmiotowe",
        "left-sidebar",
        "sidebar",
        "topbar",
        "stopka",
        "navbar",
        # Łódź's menu: a <div class="col-3 aside"> in its <main> (11-13).
        "aside",
        "aside-nav",
    ):
        assert _frame_name(name), name
    for name in (
        # Bootstrap's "nav" may be a content's tabs.
        "nav",
        "nav-tabs",
        "nav-container",
        "aside-container",
        "footer-bg",
        "header",
        "dropdown-menu",
        "has-sidebar",
        "sidebar-content",
        "menu-lewe-tlo",
        "content",
        "",
    ):
        assert not _frame_name(name), name
