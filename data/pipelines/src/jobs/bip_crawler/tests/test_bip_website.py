"""The BIP an office's website links to (`website`), and a walk that starts
from the website: the snippets are the websites' own (11-13, 11-18)."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import cast

from jobs.bip_crawler import website
from jobs.bip_crawler.people import PeopleOptions, PeopleSearch, _foreign
from jobs.bip_crawler.people_list import to_search
from jobs.bip_crawler.tests.test_bip import FakeFrontier
from jobs.bip_crawler.tests.test_people_mode_review import PDF, Web, html, row
from scrapers.bip.classify import host_of
from scrapers.bip.units import UnitSeed
from scrapers.common.fetch import HttpResult
from scrapers.common.ratelimit import HostTokenBucket
from scrapers.stores import BipQueue, PersonRow, with_outcomes
from stores.bip_bundles import LocalBundleStore
from stores.bip_people import MemoryBipPeopleStore

SHARED = {"samorzad.gov.pl"}


def page(body: str, title: str = "Strona główna") -> bytes:
    return html(title, body)[2]


def links(body: str, url: str, shared: set[str] = SHARED) -> list[str]:
    return website.bip_links(page(body), url, "text/html; charset=utf-8", shared)


#: Every website has its own pages around the BIP's link.
MENU = (
    '<a href="/aktualnosci">Aktualności</a>'
    '<a href="/kontakt">Kontakt</a>'
    '<a href="https://www.facebook.com/gmina">Facebook</a>'
)


def test_a_logo_is_the_link_to_the_bip():
    # Iłowa: the picture's alt says it; the host ilowa.info.pl does not.
    ilowa = (
        '<a href="https://ilowa.info.pl/"><img src="https://www.ilowa.pl/wp-content'
        '/themes/city/inc/assets/img/bip.svg" alt="Link to Biuletynu Informacji '
        'Publicznej"></a>'
    )
    assert links(MENU + ilowa, "https://www.ilowa.pl/") == ["https://ilowa.info.pl/"]
    # Skoki: an empty alt, the picture's title and file name.
    skoki = (
        '<a href="http://skoki.nowoczesnagmina.pl/"><img src="https://www.gmina-'
        'skoki.pl/wp-content/uploads/2024/02/baner-bip-2-300x106.png" alt="" '
        'title="baner-bip-2"></a>'
    )
    assert links(skoki + MENU, "https://www.gmina-skoki.pl/") == [
        "http://skoki.nowoczesnagmina.pl/"
    ]
    # Szczawno-Zdrój: an empty SVG until a script shows data-orig-src's bip.png.
    szczawno = (
        '<a class="fusion-no-lightbox" href="http://um.szczawnozdroj.ibip.wroc.pl'
        '/public/" target="_blank"><img src="data:image/svg+xml,%3Csvg%20xmlns%3D'
        '%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%3E%3C%2Fsvg%3E" '
        'data-orig-src="http://szczawno-zdroj.pl/wp-content/uploads/2023/03/bip.png"'
        " alt></a>"
    )
    assert links(MENU + szczawno, "https://www.szczawno-zdroj.pl/") == [
        "http://um.szczawnozdroj.ibip.wroc.pl/public/"
    ]


def test_a_picture_on_the_websites_own_host_is_no_bip():
    # Powiat kościański's banner is a link back to the website (a redirect);
    # it is read one level down instead (`inner_links`).
    banner = (
        '<a href="https://www.powiatkoscian.pl/blue.php?id=103"><img src="photos/'
        'gal/ic_103.svg" alt="Biuletyn Informacji Publicznej"></a>'
    )
    url = "https://www.powiatkoscian.pl/"
    assert links(MENU + banner, url) == []
    assert website.inner_links(page(MENU + banner), url, "text/html", SHARED)[0] == (
        "https://www.powiatkoscian.pl/blue.php?id=103",
        True,
    )


def test_a_host_that_says_bip_inside_a_label_is_a_bip():
    for host in (
        "www.powiat-brzeziny.4bip.pl",
        "um.szczawnozdroj.ibip.wroc.pl",
        "www.e-bip.pl",
        "mst-ciechocinek.rbip.mojregion.info",
        "buczek.bipgmina.pl",
        "bip-umbransk.podlaskie.eu",
        "bukowsko.biuletyn.net",
        "ugtelatyn.e-biuletyn.pl",
        "bip4.wokiss.pl",
    ):
        assert website.bip_host(host), host
    assert not website.bip_host("ilowa.info.pl")
    # Buczek's logo says "Poradnik bezpieczeństwa 2025"; its host says BIP.
    buczek = (
        '<a href="https://buczek.bipgmina.pl/"><img src="https://www.buczek.pl/wp-'
        'content/uploads/2023/06/bip-logo.png" alt="Poradnik bezpieczeństwa 2025">'
        "</a>"
    )
    assert links(MENU + buczek, "https://www.buczek.pl/") == [
        "https://buczek.bipgmina.pl/"
    ]


def test_the_bip_linked_most_is_taken_its_logo_first_and_a_care_homes_never():
    # Powiat częstochowski: the logo and a page of articles to the powiat's
    # 4bip, its care home's 4bip in the menu.
    body = (
        '<a href="https://www.dpsblachownia.4bip.pl/" target="_blank">Dom Pomocy '
        "Społecznej w Blachowni</a>"
        '<a href="http://www.powiat-czestochowski.4bip.pl/index.php?idg=3&amp;id=142'
        '&amp;x=4"><img data-dz-thumbnail="" src="https://www.czestochowa.powiat.pl/'
        'upload/images/original/22.jpg" alt=""></a>'
        '<a href="http://www.powiat-czestochowski.4bip.pl/index.php?idg=6&amp;id=175'
        '&amp;x=8"><img src="https://www.czestochowa.powiat.pl/upload/images/'
        'original/24.jpg" alt=""></a>'
        '<a href="http://www.powiat-czestochowski.4bip.pl/index.php?idg=1&amp;id=1'
        '&amp;x=1"><img src="https://www.czestochowa.powiat.pl/front/assets/images/'
        'bip_logo.png" alt="bip"></a>'
    )
    found = links(MENU + body, "https://www.czestochowa.powiat.pl/")
    assert (
        found[0] == "http://www.powiat-czestochowski.4bip.pl/index.php?idg=1&id=1&x=1"
    )
    assert len(found) == 3
    assert not any("dps" in url for url in found)


def test_another_bodys_bip_is_never_the_units():
    # Wąbrzeźno: its care home's BIP in the menu, the town's under a logo.
    wabrzezno = (
        "<a href='https://dps-wabrzezno.rbip.mojregion.info/' target='_blank' "
        'data-level=\'3\'><span class="menu-item-text"><span class="menu-text">'
        "Dom Pomocy Społecznej</span></span></a>"
        '<a href="https://mst-wabrzezno.rbip.mojregion.info/" target="_blank">'
        '<img width="100" src="/wp-content/uploads/2019/12/bip@2x.png"/></a>'
    )
    assert links(wabrzezno + MENU, "https://wabrzezno.com/") == [
        "https://mst-wabrzezno.rbip.mojregion.info/"
    ]
    # Sierakowice's welfare centre alone: no BIP of the unit's.
    gops = '<a href="https://gops.sierakowice.ibip.pl/public/">GOPS - BIP</a>'
    assert links(MENU + gops, "https://www.sierakowice.pl/") == []
    for host in (
        "dpsblachownia.4bip.pl",
        "ccuw.rbip.mojregion.info",
        "bip.zdp.szczytno.pl",
        "gok-raciazek.naszgok.pl",
        "mgopsfrombork.nbip.pl",
        "moksir-jastarnia.4bip.pl",
        "pup.zywiec.ibip.pl",
    ):
        assert website.OTHER_BODY.search(host), host
    for host in ("bip.jastarnia.pl", "um.szczawnozdroj.ibip.wroc.pl", "bip.brzozow.pl"):
        assert not website.OTHER_BODY.search(host), host


def test_a_bip_on_another_host_comes_before_the_pages_own_and_no_editors_page():
    # Grodzisko Dolne's samorzad.gov.pl site: the portal's BIP pages for the
    # gmina first, its own BIP (with its declarations) further down.
    body = (
        '<a href="/web/gmina-grodzisko-dolne/mapa-strony?show-bip=true"><img '
        'src="/bip.svg" alt="">Przejdź do serwisu Biuletyn Informacji Publicznej '
        "Gmina Grodzisko Dolne</a>"
        '<a href="/web/gmina-grodzisko-dolne/biuletyn-informacji-publicznej">'
        "Biuletyn Informacji Publicznej</a>"
        '<a href="/web/gmina-grodzisko-dolne/redakcja-bip">Redakcja BiP</a>'
        '<a class="frame-banner" href="https://bip.grodziskodolne.pl/" title="BIP"'
        ' alt="grafika przedstawia baner ramkowy"><img src="/baner.png"></a>'
        '<a href="http://gops.grodziskodolne.pl">Gminny Ośrodek Pomocy Społecznej</a>'
        '<a href="http://bip.grodziskodolne.pl/23-strona-glowna.html">Strona '
        "archiwalna</a>"
    )
    url = "https://samorzad.gov.pl/web/gmina-grodzisko-dolne"
    assert links(body, url) == [
        "https://bip.grodziskodolne.pl/",
        "http://bip.grodziskodolne.pl/23-strona-glowna.html",
    ]
    # Without it, the portal's pages for the gmina; never "Redakcja BiP".
    own = body.split('<a class="frame-banner"', maxsplit=1)[0]
    assert links(own, url) == [
        f"{url}/mapa-strony?show-bip=true",
        f"{url}/biuletyn-informacji-publicznej",
    ]


def test_a_websites_own_bip_page_comes_after_another_hosts_bip():
    # Radziłów: its menu's "Biuletyn Informacji Publicznej" is a page of the
    # website; the BIP is where an election banner leads.
    body = (
        '<a href="https://radzilow.pl/biuletyn-informacji-publicznej/">Biuletyn '
        "Informacji Publicznej</a>"
        '<a href="https://bip-ugradzilow.wrotapodlasia.pl/aktualnosci_1/wybory-'
        'prezydenta-rp-2025/" target="_blank"><img src="https://radzilow.pl/wp-'
        'content/uploads/2025/01/wybory-prezydent-2025.jpg" alt="Wybory Prezydenta '
        'RP 2025"></a>'
    )
    assert links(MENU + body, "https://radzilow.pl/") == [
        "https://bip-ugradzilow.wrotapodlasia.pl/aktualnosci_1/wybory-prezydenta-rp-2025/"
    ]
    # The website's page when it is all there is (Hrubieszów's /bip).
    own = body.split('<a href="https://bip-ugradzilow', maxsplit=1)[0]
    assert links(MENU + own, "https://radzilow.pl/") == [
        "https://radzilow.pl/biuletyn-informacji-publicznej/"
    ]


def test_on_a_portal_the_units_own_bip_pages_outweigh_a_host_name():
    # Somianka on samorzad.gov.pl: its BIP's link says so; its old BIP, which
    # answers the crawler nothing, only by its host, under "legal aid".
    body = (
        '<a href="/web/gmina-somianka/bip?show-bip=true"> <span class="sr-only">'
        "Przejdź do serwisu Biuletyn Informacji Publicznej Gmina<br> Somianka"
        '</span> <img src="/img/bip_simple.svg" class="icon" alt="Logo Biuletynu '
        'Informacji Publicznej"></a>'
        '<a href="http://ugsomianka.bip.org.pl/index/index/id/1004"> <div class='
        '"header"><div class="icon"><img src="/photo/25705c33" alt="" aria-hidden='
        '"true"></div><div class="title"> Nieodpłatna pomoc prawna </div></div></a>'
    )
    assert links(body, "https://samorzad.gov.pl/web/gmina-somianka") == [
        "https://samorzad.gov.pl/web/gmina-somianka/bip?show-bip=true"
    ]


def test_a_pictures_file_name_outweighs_its_alt():
    # Stopnica: both pictures' alt is "Logo Bip", and the theme's aria-labels
    # are no link's own words (Czarnocin's says "strony BiP" on its session
    # videos, 11-18); the BIP's picture is bip-big-3-1.png, the council's video
    # archive's ic-sesje-rady.svg.
    body = (
        '<a href="https://stopnica.sesja.pl/" target="_blank" aria-label="Łącze '
        'zewnętrzne do transmisji rady"> <img alt="Logo Bip" src="https://umig.'
        'stopnica.pl/wp-content/themes/wp-realnet/images/ic-sesje-rady.svg"></a>'
        '<a href="https://stopnica.pl/bip/" target="_blank" aria-label="Łącze '
        'zewnętrzne do strony BiP"> <img alt="Logo Bip" src="https://umig.stopnica'
        '.pl/wp-content/themes/wp-realnet/images/bip-big-3-1.png"></a>'
    )
    assert links(MENU + body, "https://umig.stopnica.pl/") == [
        "https://stopnica.pl/bip/"
    ]


def test_a_file_name_that_only_spells_the_bip_out_is_no_link_to_it():
    # Kamieniec Ząbkowicki: the accessibility statement's picture links
    # dziennikustaw.gov.pl; its BIP is a page down, behind a picture.
    body = (
        '<a href="http://dziennikustaw.gov.pl/" title="Ważne linki"><img alt="Ważne'
        ' linki" src="https://kamienieczabkowicki.eu/wp-content/uploads/2021/03/'
        'Deklaracja-dostępności-Biuletynu-Informacji-Publicznej_.png"></a>'
        '<a href="https://kamienieczabkowicki.eu/biuletyn-informacji-publicznych/" '
        'title="BIULETYN INFORMACJI PUBLICZNYCH"><img alt="BIULETYN INFORMACJI '
        'PUBLICZNYCH" src="https://kamienieczabkowicki.eu/wp-content/uploads/2015/02'
        '/bip_logo_pomn1_grad.png"></a>'
    )
    url = "https://kamienieczabkowicki.eu/"
    assert links(MENU + body, url) == []
    inner = website.inner_links(page(MENU + body), url, "text/html", SHARED)
    assert inner[0] == (
        "https://kamienieczabkowicki.eu/biuletyn-informacji-publicznych/",
        True,
    )
    assert ("https://kamienieczabkowicki.eu/aktualnosci", False) in inner


def test_a_page_that_links_its_own_declarations_keeps_them():
    burzenin = page('<a href="/bip/oswiadczenia">Oświadczenia majątkowe</a>')
    assert website.keeps_declarations(burzenin, "https://www.ugburzenin.pl/bip", "")
    hrubieszow = page(
        '<a href="https://ughrubieszow.bip.lubelskie.pl/">https://ughrubieszow.bip.'
        'lubelskie.pl/</a><a href="https://ughrubieszow.bip.lubelskie.pl/index.php'
        '?id=69">Oświadczenia majątkowe</a>'
    )
    assert not website.keeps_declarations(
        hrubieszow, "https://gminahrubieszow.pl/bip", ""
    )


def test_one_level_down_stays_on_the_pages_own_unit_path():
    # samorzad.gov.pl's front page is the catalogue's website of two units:
    # the portal's news are no unit's pages.
    body = (
        '<a href="/web/gov/wiadomosci2">Wiadomości</a>'
        '<a href="/web/gmina-lubenia/biuletyn-informacji-publicznej2">BIP</a>'
    )
    assert (
        website.inner_links(page(body), "https://samorzad.gov.pl/", "text/html", SHARED)
        == []
    )
    lubenia = "https://samorzad.gov.pl/web/gmina-lubenia/"
    assert website.inner_links(page(body), lubenia, "text/html", SHARED) == [
        (
            "https://samorzad.gov.pl/web/gmina-lubenia/biuletyn-informacji-publicznej2",
            True,
        )
    ]


def test_a_refresh_says_where_the_page_sends_the_browser():
    somianka = (
        b'<meta http-equiv="refresh" '
        b'content="0;URL=https://samorzad.gov.pl/web/gmina-somianka">\n'
    )
    assert (
        website.refresh(somianka, "http://www.somianka.pl/")
        == "https://samorzad.gov.pl/web/gmina-somianka"
    )
    limanowa = (
        '<!DOCTYPE html><head><meta charset="utf-8"><title>Urząd Miasta Limanowa'
        '</title><meta http-equiv="refresh" content="10; URL=https://miastolimanowa'
        '.pl/"></head><body><h1>Nasz nowy adres to: <a href="https://miastolimanowa'
        '.pl/">www.miastolimanowa.pl</a></h1></body>'
    ).encode()
    assert (
        website.refresh(limanowa, "http://www.miasto.limanowa.pl/")
        == "https://miastolimanowa.pl/"
    )
    dobrcz = (
        b"<html><head><meta content='0; url=http://gminadobrcz.pl/' "
        b"http-equiv='Refresh' /></head></html>"
    )
    assert website.refresh(dobrcz, "https://www.dobrcz.pl/") == "http://gminadobrcz.pl/"
    # powmiedzy.nazwa.pl sends the browser to itself: nowhere.
    loop = b'<meta http-equiv="refresh" content="0; URL=http://powmiedzy.nazwa.pl">'
    assert website.refresh(loop, "http://powmiedzy.nazwa.pl/") == ""
    assert (
        website.refresh(b'<meta http-equiv="refresh" content="300">', "http://a.pl")
        == ""
    )
    noscript = (
        b'<noscript><meta http-equiv="refresh" content="0; url=/bez-js"></noscript>'
    )
    assert website.refresh(noscript, "http://a.pl/") == ""


def offered(
    body: str, url: str, names: tuple[str, ...] = (), unit: str = ""
) -> list[tuple[list[str], bool, bool]]:
    """The BIPs a page offers: (links, own, also walked)."""
    found = website.bips(page(body), url, "text/html", SHARED, names, unit)
    return [(b.links, b.own, b.also) for b in found]


def test_a_host_that_says_bip_outranks_a_themes_and_a_vendors_labels():
    # Czarnocin: the theme gives its session videos on esesja.tv the BIP's
    # label and alt, and links them first; its 4 were found on its BIP, none
    # from esesja.tv (11-18).
    czarnocin = (
        '<a href="https://esesja.tv/transmisja_na_zywo/1392/rada-gminy-w-czarnocinie'
        '.htm" target="_blank" aria-label="Łącze zewnętrzne do strony BiP"> <img '
        'alt="Logo Bip" src="https://czarnocin.com.pl/wp-content/themes/wp-realnet/'
        'images/ic-sesje-rady.svg" class="h-7"></a>'
        '<a href="https://bip.czarnocin.com.pl" target="_blank" aria-label="Łącze '
        'zewnętrzne do strony BiP"> <img alt="Logo Bip" class="h-6" src="https://'
        'czarnocin.com.pl/wp-content/themes/wp-realnet/images/bip-big-3-1.png"></a>'
    )
    assert links(MENU + czarnocin, "https://czarnocin.com.pl/") == [
        "https://bip.czarnocin.com.pl"
    ]
    # Gorzów Śląski: its BIP's logo, and in the footer the vendor's "Strony
    # www i Biuletyny Informacji Publicznej", which is no BIP at all.
    gorzow = (
        '<a href="http://bip.gorzowslaski.pl/"><img src="/assets/gfx/links/bip.svg" '
        'alt="Biuletyn Informacji Publicznej"></a>'
        '<a href="https://digitalholding.pl" target="_blank" rel="noopener" '
        'title="Digital Holding Sp. z o. o. Strony www i Biuletyny Informacji '
        'Publicznej">Digital Holding sp. z o.o.</a>'
    )
    assert [x[0] for x in offered(MENU + gorzow, "https://gorzowslaski.pl/")] == [
        ["http://bip.gorzowslaski.pl/"]
    ]
    # Otwock: its e-Urząd's button is a picture with alt "BIP" too.
    otwock = (
        '<a href="https://eurzad.otwock.pl/" target="_blank"><img class="eurzad_img"'
        ' src="https://otwock.pl/images/button-B.jpg" alt="BIP" /></a>'
        '<a href="https://bip.otwock.pl/" target="_blank"><img src="https://otwock'
        '.pl/images/ikony-top-solo-k-01-bip.svg" alt="BIP" /></a>'
    )
    assert links(otwock + MENU, "https://www.otwock.pl/") == ["https://bip.otwock.pl/"]


def test_another_host_counts_only_where_it_names_the_units_place():
    # Dzikowiec: a hidden "BIP" menu item left on onet.pl, the vendor's credit
    # "system BIP", and the website's own BIP pages, where its 3 were found.
    body = (
        '<a href="https://gminadzikowiec.pl/5070-urzad-gminy.html" title="menu BIP" '
        'role="menuitem"> BIP </a>'
        '<a href="https://onet.pl" title="menu BIP" role="menuitem"> BIP </a>'
        '<a href="https://pro3w.pl" target="_blank" title="Strony dla JST, system '
        'BIP, obsługa Rady Miasta i Gminy, System głosowań">PRO3W</a>'
    )
    names = ("Urząd Gminy Dzikowiec",)
    assert offered(MENU + body, "https://gminadzikowiec.pl/", names) == [
        (["https://gminadzikowiec.pl/5070-urzad-gminy.html"], True, False)
    ]
    # Budzyń's page on samorzad.gov.pl: powiat chodzieski's BIP for its legal
    # aid, a host alone that names another place, is none of Budzyń's.
    budzyn = (
        '<a href="https://bip4.wokiss.pl/chodziezp/bip/nieodplatna-pomoc-prawna1.'
        'html"><img src="/documents/baner.png" alt="Nieodpłatna pomoc prawna"></a>'
    )
    url = "https://samorzad.gov.pl/web/gmina-budzyn"
    assert offered(budzyn, url, ("Urząd Miasta i Gminy Budzyń",)) == []


def test_the_places_a_website_and_its_offices_name():
    dzikowiec = website.place_stems("gminadzikowiec.pl", ["Urząd Gminy Dzikowiec"])
    assert dzikowiec == {"dziko"}
    assert not website.names_place("onet.pl", dzikowiec)
    assert not website.names_place(
        "esesja.tv", website.place_stems("czarnocin.com.pl", [])
    )
    somianka = website.place_stems("somianka.pl", [])
    assert website.names_place("samorzad.gov.pl/web/gmina-somianka", somianka)
    # "w Nowym Sączu": four letters of a short word, none of a word many
    # places share.
    sacz = website.place_stems("nowosadecki.pl", ["Starostwo Powiatowe w Nowym Sączu"])
    assert sacz == {"nowos", "sacz"}
    assert website.names_place("bip.powiat.nowy-sacz.pl", sacz)
    assert not website.place_stems("", ["Urząd Gminy Wielka Wieś"])
    # A BIP under the website's own name, whatever it is called.
    assert website.same_site("bip.csw.pl", "csw.pl")
    assert website.same_site("bip.elk.gmina.pl", "elk.gmina.pl")
    assert not website.same_site("ugtr.bip.gov.pl", "trabkiw.ug.gov.pl")


def test_a_link_to_a_bips_page_about_itself_stands_for_its_first_page():
    # Ustroń links its BIP only as "Deklaracja Dostępności": its 5 were found
    # there, and none since that link was dropped (11-18).
    body = (
        '<a href="https://bip.ustron.pl/deklaracja-dostepnosci" >Deklaracja '
        "Dostępności</a>"
    )
    names = ("URZĄD MIASTA USTROŃ",)
    assert offered(MENU + body, "https://miasto.ustron.pl/", names) == [
        (["https://bip.ustron.pl/"], False, True)
    ]


def test_the_offices_other_bips_are_walked_too_never_other_bodies():
    # Trąbki Wielkie: two BIPs of the office's, under the same label, and the
    # utility's; its 4 were found on the one it links second (11-18).
    trabki = (
        '<a href="https://ugtr.ssdip.bip.gov.pl/rada-gminy/rada-gminy-trabki-wielkie'
        '.html">Rada Gminy</a>'
        '<a href="https://ugtr.ssdip.bip.gov.pl/oferty-pracy/aktualne-ogloszenia-o-'
        'prace.html">Oferty Pracy Urzędu Gminy na BIP</a>'
        '<a href="https://ugtr.bip.gov.pl/"><img src="/images/bip.png" alt="Biuletyn'
        ' Informacji Publicznej"></a>'
        '<a href="http://zgkimtrabki.bip.gov.pl/">ZGKiM</a>'
    )
    found = offered(
        trabki + MENU,
        "https://trabkiw.ug.gov.pl/",
        ("Urząd Gminy Trąbki Wielkie",),
        "220408",
    )
    assert [(links[0], also) for links, _, also in found] == [
        (
            "https://ugtr.ssdip.bip.gov.pl/oferty-pracy/aktualne-ogloszenia-o-prace.html",
            True,
        ),
        ("https://ugtr.bip.gov.pl/", True),
    ]
    # Hajnówka: its old BIPs, and the powiat's "st", which is another office.
    hajnowka = (
        '<a href="https://bip-ughajnowka.podlaskie.eu/"><img src="/bip.png" alt="BIP">'
        "</a>"
        '<a href="https://bip.ug.hajnowka.wrotapodlasia.pl/referendum/">Referendum</a>'
        '<a href="http://bip.st.hajnowka.wrotapodlasia.pl/bezplatna_pomoc_prawna/">'
        "Bezpłatna pomoc prawna</a>"
        '<a href="https://zuk.hajnowka.bip-gmina.pl/">Zakład Usług Komunalnych</a>'
        '<a href="https://przychodnia-hajnowka.bip.net.pl/">Przychodnia</a>'
    )
    found = offered(
        hajnowka + MENU,
        "https://www.gmina-hajnowka.pl/",
        ("Urząd Gminy Hajnówka",),
        "200506",
    )
    assert [(links[0], also) for links, _, also in found] == [
        ("https://bip-ughajnowka.podlaskie.eu/", True),
        ("https://bip.ug.hajnowka.wrotapodlasia.pl/referendum/", True),
        ("http://bip.st.hajnowka.wrotapodlasia.pl/bezplatna_pomoc_prawna/", False),
        ("https://zuk.hajnowka.bip-gmina.pl/", False),
        ("https://przychodnia-hajnowka.bip.net.pl/", False),
    ]


def test_an_archive_bip_is_walked_beside_the_current_one_never_first():
    # Stara Kamienica links its archives in words before its BIP's logo.
    body = (
        '<a href="https://starakamienica.archiwum.bip.net.pl/">Archiwalny BIP '
        "(2018-2021)</a>"
        '<a href="https://stara-kamienica.bipgmina.pl/">Archiwalny BIP (2008-2018)'
        "</a>"
        '<a href="https://starakamienica.bip.net.pl/"><img src="/img/bip.png" '
        'alt="BIP"></a>'
    )
    found = website.bips(
        page(body + MENU),
        "https://www.starakamienica.pl/",
        "text/html",
        SHARED,
        ["Urząd Gminy Stara Kamienica"],
        "020609",
    )
    assert [b.archive for b in found] == [True, True, False]
    assert _foreign(found) == [
        "https://starakamienica.bip.net.pl/",
        "https://starakamienica.archiwum.bip.net.pl/",
        "https://stara-kamienica.bipgmina.pl/",
    ]


# -- walks from a website --------------------------------------------------------


class Moved(Web):
    """A site some of whose addresses answer 302 to another."""

    def __init__(self, sites, moved: dict[str, str]) -> None:
        super().__init__(sites)
        self.moved = moved

    def fetch(self, url: str, timeout: float, user_agent: str) -> HttpResult:
        if url in self.moved:
            self.calls.append(url)
            return HttpResult(url, 302, "text/html", b"", location=self.moved[url])
        return super().fetch(url, timeout, user_agent)


def walk(
    tmp_path: Path,
    web: Web,
    seeds: dict[str, UnitSeed],
    rows: list[PersonRow],
    robots_allowed: Callable[[str], bool] = lambda url: True,
    sitemaps: bool = False,
) -> MemoryBipPeopleStore:
    store = MemoryBipPeopleStore()
    search = PeopleSearch(
        store,
        cast("BipQueue", FakeFrontier([])),
        LocalBundleStore(tmp_path / "b"),
        seeds,
        PeopleOptions(workers=1, sitemaps=sitemaps),
        fetch=web.fetch,
        robots_allowed=robots_allowed,
        limiter=HostTokenBucket(0),
        sleep=lambda s: None,
    )
    search.run(
        to_search(
            with_outcomes(rows, store.searched()),
            refresh=False,
            max_priority=None,
            limit=None,
        )
    )
    return store


def declarations(base: str, name: str) -> dict[str, tuple[int, str, bytes]]:
    """A BIP at ``base`` whose declarations page lists ``name``'s file."""
    return {
        f"{base}/oswiadczenia": html(
            "Oświadczenia majątkowe radnych",
            f'<a href="{base}/f/1.pdf">Oświadczenie majątkowe - {name} - 2024</a>',
        ),
        f"{base}/f/1.pdf": (200, "application/pdf", PDF + name.encode()),
    }


def test_a_splash_pages_bip_is_one_page_down(tmp_path):
    # www.ostrowmaz.pl: two doors, "Dla mieszkańca" leads to the BIP's logo.
    bip = "http://www.bip.ostrowmaz.pl/public"
    sites = {
        "https://www.ostrowmaz.pl": html(
            "Ostrów Mazowiecka",
            '<a href="/dla-mieszkanca" class="intro-text-box_icon1_btn" title="Dla '
            'mieszkańca"><img src="/bundles/images/intro/mieszkaniec.png"> Dla '
            "mieszkańca</a>"
            '<a href="/dla-biznesu-i-turystow" title="Dla biznesu i turystów"><img '
            'src="/bundles/images/intro/biznes.png"> Dla biznesu i turysty</a>',
        ),
        "https://www.ostrowmaz.pl/dla-mieszkanca": html(
            "Dla mieszkańca",
            '<a tabindex="1" href="http://www.bip.ostrowmaz.pl/public/" target="_blank'
            '"> <img src="/bundles/images/gfx/bip.png" alt="bip" /> </a>' + MENU,
        ),
        f"{bip}/": html(
            "BIP", f'<a href="{bip}/oswiadczenia">Oświadczenia majątkowe</a>'
        ),
        **declarations(bip, "Jan Nowak"),
    }
    web = Web(sites)
    seeds = {"u1": UnitSeed("u1", www_urls=["https://www.ostrowmaz.pl/"])}
    store = walk(tmp_path, web, seeds, [row("n", "u1", "Jan", "Nowak")])
    assert store.outcomes["n"].status == "found"
    assert store.units["u1"].roots == ["http://www.bip.ostrowmaz.pl/public/"]
    assert "https://www.ostrowmaz.pl/dla-biznesu-i-turystow" not in web.calls


def test_a_website_that_sends_the_browser_on_is_followed(tmp_path):
    # Somianka's website is a refresh to its pages on samorzad.gov.pl; the
    # walk keeps to them, not the portal's other units.
    own = "https://samorzad.gov.pl/web/gmina-somianka"
    sites = {
        "http://www.somianka.pl": (
            200,
            "text/html",
            f'<meta http-equiv="refresh" content="0;URL={own}">\n'.encode(),
        ),
        own: html(
            "Gmina Somianka",
            f'<a href="{own}/biuletyn-informacji-publicznej">Biuletyn Informacji '
            "Publicznej</a>",
        ),
        f"{own}/biuletyn-informacji-publicznej": html(
            "BIP",
            '<a href="https://samorzad.gov.pl/web/gmina-wyszkow/oswiadczenia">'
            "Oświadczenia majątkowe radnych gminy Wyszków</a>"
            f'<a href="{own}/oswiadczenia">Oświadczenia majątkowe</a>',
        ),
        **declarations(own, "Ewa Lis"),
    }
    web = Web(sites)
    seeds = {"u1": UnitSeed("u1", www_urls=["http://www.somianka.pl"])}
    store = walk(tmp_path, web, seeds, [row("l", "u1", "Ewa", "Lis")])
    assert store.outcomes["l"].status == "found"
    assert not any("gmina-wyszkow" in call for call in web.calls)


def test_a_bip_start_that_sends_the_browser_on_is_followed(tmp_path):
    bip = "https://u1.bip.example.pl"
    sites = {
        "https://bip.u1.pl": (
            200,
            "text/html",
            f'<html><head><meta http-equiv="refresh" content="0; url={bip}/">'
            "</head><body></body></html>".encode(),
        ),
        f"{bip}/": html(
            "BIP", f'<a href="{bip}/oswiadczenia">Oświadczenia majątkowe</a>'
        ),
        **declarations(bip, "Jan Nowak"),
    }
    seeds = {"u1": UnitSeed("u1", bip_urls=["https://bip.u1.pl"], scopes=["bip.u1.pl"])}
    store = walk(tmp_path, Web(sites), seeds, [row("n", "u1", "Jan", "Nowak")])
    assert store.outcomes["n"].status == "found"


def test_a_bip_that_does_not_answer_is_kept_not_one_another_page_links(tmp_path):
    # Radziłów: an election banner leads to the old Wrota Podlasia BIP, which
    # answers nothing; the website's own BIP page links the new one. Round 1
    # went on to whatever answered next, and that was another body's BIP as
    # often (11-13): the walk says unreachable, as it did before.
    old = (
        "https://bip-ugradzilow.wrotapodlasia.pl/aktualnosci_1/wybory-prezydenta-rp"
        "-2025/"
    )
    bip = "https://bip-ugradzilow.podlaskie.eu"
    sites = {
        "https://radzilow.pl": html(
            "Gmina Radziłów",
            '<a href="https://radzilow.pl/biuletyn-informacji-publicznej/">Biuletyn '
            f'Informacji Publicznej</a><a href="{old}" target="_blank"><img src='
            '"https://radzilow.pl/wp-content/uploads/2025/01/wybory-prezydent-2025.jpg"'
            ' alt="Wybory Prezydenta RP 2025"></a>',
        ),
        old: (0, "", b""),
        "https://radzilow.pl/biuletyn-informacji-publicznej": html(
            "Biuletyn Informacji Publicznej – Gmina Radziłów",
            f'<a href="{bip}">/https://bip-ugradzilow.podlaskie.eu/</a>',
        ),
        bip: html("BIP", f'<a href="{bip}/oswiadczenia">Oświadczenia majątkowe</a>'),
        **declarations(bip, "Grzegorz Chyliński"),
    }
    web = Web(sites)
    seeds = {"u1": UnitSeed("u1", www_urls=["https://radzilow.pl/"])}
    rows = [row("c", "u1", "Grzegorz", "Chyliński")]
    store = walk(tmp_path, web, seeds, rows)
    assert store.units["u1"].roots == [old]
    assert (store.outcomes["c"].status, store.outcomes["c"].reason) == (
        "not_found",
        "unreachable",
    )
    assert not any("podlaskie.eu" in call for call in web.calls)


def test_a_bip_that_keeps_the_crawler_out_is_kept_never_another_bodys(tmp_path):
    # Budzyń: its BIP's robots.txt says no to every crawler, and round 1 went on
    # to powiat chodzieski's BIP, the next its page links, and credited a
    # powiat councillor's declaration to a gmina councillor of the same surname
    # (11-13). The walk says robots, as it did before.
    own = "https://samorzad.gov.pl/web/gmina-budzyn"
    powiat = "https://bip4.wokiss.pl/chodziezp"
    sites = {
        "http://www.budzyn.pl": (
            200,
            "text/html",
            f'<meta http-equiv="refresh" content="0;URL={own}">'.encode(),
        ),
        own: html(
            "Gmina Budzyń",
            '<a href="https://bip.budzyn.pl/budzyn/">BIP Gminy Budzyń</a>'
            f'<a href="{powiat}/">BIP Starostwa Powiatowego w Chodzieży</a>',
        ),
        f"{powiat}/": html(
            "BIP Starostwa", f'<a href="{powiat}/oswiadczenia">Oświadczenia</a>'
        ),
        **declarations(powiat, "Krzysztof Kaczmarek"),
    }
    web = Web(sites)
    seeds = {
        "u1": UnitSeed(
            "u1", www_urls=["http://www.budzyn.pl"], names=["Urząd Gminy Budzyń"]
        )
    }
    rows = [row("k", "u1", "Krzysztof", "Kaczmarek")]
    store = walk(tmp_path, web, seeds, rows, lambda url: "bip.budzyn.pl" not in url)
    assert store.units["u1"].roots == ["https://bip.budzyn.pl/budzyn/"]
    assert (store.outcomes["k"].status, store.outcomes["k"].reason) == (
        "not_found",
        "robots",
    )
    assert not any("wokiss" in call for call in web.calls)


def test_a_bip_that_answers_an_error_is_kept_not_the_website(tmp_path):
    # Konopiska's BIP answered one 500, and round 1 walked its website instead
    # (17 found there before, 11-13): an error is for a later run to retry.
    bip = "https://www.bip.konopiska.akcessnet.net/"
    sites = {
        "https://www.konopiska.pl": html(
            "Gmina Konopiska",
            f'<a href="{bip}" class="d-block" data-bs-title="Przejdź do BIP"><svg '
            'class="svg-bip"></svg></a>'
            f'<a href="{bip}index.php?idg=3&amp;id=17&amp;x=68">Podatki</a>'
            '<a href="https://www.konopiska.pl/oswiadczenia">Oświadczenia majątkowe '
            "pracowników</a>",
        ),
        bip: (500, "text/html", b"<html>Internal Server Error</html>"),
        f"{bip}index.php?idg=3&id=17&x=68": (500, "text/html", b"<html></html>"),
    }
    web = Web(sites)
    seeds = {
        "u1": UnitSeed(
            "u1", www_urls=["https://www.konopiska.pl"], names=["Urząd Gminy Konopiska"]
        )
    }
    store = walk(tmp_path, web, seeds, [row("n", "u1", "Jan", "Nowak")])
    assert {host_of(r) for r in store.units["u1"].roots} == {
        "bip.konopiska.akcessnet.net"
    }
    assert (store.outcomes["n"].status, store.outcomes["n"].reason) == (
        "not_found",
        "unreachable",
    )
    assert "https://www.konopiska.pl/oswiadczenia" not in web.calls


def test_a_powiats_own_bip_is_kept_over_its_gminas_by_their_logos(tmp_path):
    # Powiat sierpecki's website: its BIP under a "bip logo" picture, its
    # gminas' BIPs under their coats of arms, and round 1 went on to
    # Szczutowo's when its own did not answer (11-13).
    bip = "http://www.sierpc.starostwo.gov.pl/"
    sites = {
        "https://powiat.sierpc.pl": html(
            "Powiat Sierpecki",
            f'<a href="{bip}"><img class="header-images" src="https://powiat.sierpc'
            '.pl/wp-content/themes/powiat.sierpc.pl/assets/images/bip_logo.png" '
            'alt="bip logo"></a>'
            '<a href="http://uggozdowo.bip.org.pl/"><img src="https://powiat.sierpc'
            '.pl/wp-content/themes/powiat.sierpc.pl/assets/images/gminy/Gozdowo.png"'
            ' alt=""></a>'
            '<a href="https://szczutowo.nowybip.pl/"><img src="https://powiat.sierpc'
            ".pl/wp-content/themes/powiat.sierpc.pl/assets/images/gminy/Szczutowo"
            '.png" alt=""></a>',
        ),
        bip: (0, "", b""),
        "https://szczutowo.nowybip.pl/": html(
            "BIP Szczutowo", '<a href="/oswiadczenia">Oświadczenia majątkowe</a>'
        ),
        **declarations("https://szczutowo.nowybip.pl", "Jan Nowak"),
    }
    web = Web(sites)
    seeds = {
        "u1": UnitSeed(
            "u1",
            www_urls=["https://powiat.sierpc.pl"],
            names=["Starostwo Powiatowe w Sierpcu"],
        )
    }
    store = walk(tmp_path, web, seeds, [row("n", "u1", "Jan", "Nowak")])
    assert store.units["u1"].roots == [bip]
    assert store.outcomes["n"].reason == "unreachable"
    assert not any("szczutowo" in c or "gozdowo" in c for c in web.calls)


def test_the_offices_other_bip_is_walked_beside_the_one_it_links_first(tmp_path):
    # Ustroń's "BiP" leads to its old BIP, which answers nothing; its 5 were
    # found on the new one, which its website links only as "Deklaracja
    # Dostępności" (11-18).
    old = "http://www.ustron.bip.info.pl/"
    bip = "https://bip.ustron.pl"
    sites = {
        "https://miasto.ustron.pl": html(
            "Urząd Miasta Ustroń",
            f'<a href="{bip}/deklaracja-dostepnosci" >Deklaracja Dostępności</a>'
            f'<a href="{old}" target="top">BiP</a>' + MENU,
        ),
        old: (0, "", b""),
        f"{bip}/": html(
            "BIP Ustroń", f'<a href="{bip}/oswiadczenia">Oświadczenia majątkowe</a>'
        ),
        **declarations(bip, "Jan Nowak"),
    }
    seeds = {
        "u1": UnitSeed(
            "u1", www_urls=["https://miasto.ustron.pl"], names=["URZĄD MIASTA USTROŃ"]
        )
    }
    store = walk(tmp_path, Web(sites), seeds, [row("n", "u1", "Jan", "Nowak")])
    assert store.units["u1"].roots == [old, f"{bip}/"]
    assert store.outcomes["n"].status == "found"


def test_each_start_hosts_sitemaps_are_read(tmp_path):
    # Ustroń's walk starts from its old BIP, which answers nothing, and its new
    # one, whose sitemap names its declarations' pages: only the first start's
    # were read, and the walk found 0 of 8 where it had found 5 (11-18).
    old = "http://www.ustron.bip.info.pl/"
    bip = "https://bip.ustron.pl"
    page = f"{bip}/artykul/28154-oswiadczenie-majatkowe-radny-pawel-waszek"
    sites = {
        "https://miasto.ustron.pl": html(
            "Urząd Miasta Ustroń",
            f'<a href="{bip}/deklaracja-dostepnosci">Deklaracja Dostępności</a>'
            f'<a href="{old}">BiP</a>' + MENU,
        ),
        old: (0, "", b""),
        f"{bip}/": html("BIP Ustroń", '<a href="/aktualnosci">Aktualności</a>'),
        f"{bip}/robots.txt": (200, "text/plain", f"Sitemap: {bip}/map.xml".encode()),
        f"{bip}/map.xml": (
            200,
            "application/xml",
            f"<urlset><url><loc>{page}</loc></url></urlset>".encode(),
        ),
        page: html(
            "Oświadczenie majątkowe - radny Paweł Waszek",
            f'<a href="{bip}/f/1.pdf">radny Paweł Waszek.pdf</a>',
        ),
        f"{bip}/f/1.pdf": (200, "application/pdf", PDF + b"waszek"),
    }
    web = Web(sites)
    seeds = {
        "u1": UnitSeed(
            "u1", www_urls=["https://miasto.ustron.pl"], names=["URZĄD MIASTA USTROŃ"]
        )
    }
    rows = [row("w", "u1", "Paweł", "Waszek")]
    store = walk(tmp_path, web, seeds, rows, sitemaps=True)
    assert store.units["u1"].roots == [old, f"{bip}/"]
    assert store.outcomes["w"].status == "found"
    assert f"{bip}/map.xml" in web.calls


def test_the_bip_the_websites_own_bip_page_leads_to_is_walked_too(tmp_path):
    # Bieżuń: its "Biuletyn Informacji Publicznej" page answers 302 to
    # bip.biezun.pl, where its 2024 declarations are; the link that says
    # www.bip.biezun.nv.pl is its old BIP's, which answers nothing (11-18).
    new = "https://bip.biezun.pl"
    old = "http://www.bip.biezun.nv.pl"
    own = "https://www.biezun.pl/5,biuletyn-informacji-publicznej"
    sites = {
        "https://www.biezun.pl": html(
            "Bieżuń",
            f'<a href="{own}">Biuletyn Informacji Publicznej</a>'
            f'<a href="{old}">www.bip.biezun.nv.pl</a>' + MENU,
        ),
        old: (0, "", b""),
        f"{new}/": html(
            "BIP Bieżuń", f'<a href="{new}/oswiadczenia">Oświadczenia majątkowe</a>'
        ),
        **declarations(new, "Barbara Rogowska"),
    }
    web = Moved(sites, {own: f"{new}/"})
    seeds = {
        "u1": UnitSeed(
            "u1",
            www_urls=["https://www.biezun.pl"],
            names=["Urząd Miasta i Gminy Bieżuń"],
        )
    }
    store = walk(tmp_path, web, seeds, [row("r", "u1", "Barbara", "Rogowska")])
    assert store.units["u1"].roots == [f"{new}/", old]
    assert store.outcomes["r"].status == "found"


def test_a_start_that_moved_to_a_shared_host_keeps_to_the_units_path(tmp_path):
    # Powiat nowosądecki's BIP answers 302 to its path on bip.malopolska.pl,
    # and the walk took the whole host in, ~100 units' BIPs: a namesake's
    # declaration in powiat limanowski's could be credited (11-18).
    own = "https://bip.malopolska.pl/nowosadecki"
    other = "https://bip.malopolska.pl/limanowski"
    sites = {
        "https://www.nowosadecki.pl": html(
            "Powiat Nowosądecki",
            '<a href="http://www.bip.powiat.nowy-sacz.pl/" title="Biuletyn Informacji'
            ' Publicznej"> Biuletyn Informacji Publicznej </a>' + MENU,
        ),
        own: html(
            "BIP Starostwa Powiatowego w Nowym Sączu",
            f'<a href="{own}/oswiadczenia">Oświadczenia majątkowe</a>'
            f'<a href="{other}/oswiadczenia">Oświadczenia majątkowe - Powiat '
            "Limanowski</a>",
        ),
        **declarations(own, "Jan Nowak"),
        **declarations(other, "Ewa Lis"),
    }
    web = Moved(sites, {"http://www.bip.powiat.nowy-sacz.pl/": own})
    seeds = {
        "u1": UnitSeed(
            "u1",
            www_urls=["https://www.nowosadecki.pl"],
            names=["Starostwo Powiatowe w Nowym Sączu"],
        ),
        "u2": UnitSeed("u2", bip_urls=[other], scopes=["bip.malopolska.pl/limanowski"]),
    }
    rows = [row("n", "u1", "Jan", "Nowak"), row("l", "u1", "Ewa", "Lis")]
    store = walk(tmp_path, web, seeds, rows)
    assert store.outcomes["n"].status == "found"
    assert store.outcomes["l"].status == "not_found"
    assert not any("limanowski" in call for call in web.calls)


def test_a_website_that_keeps_its_declarations_keeps_its_bip(tmp_path):
    # Burzenin's BIP is its website's /bip: the powiat's BIP it links there is
    # another unit's.
    sites = {
        "https://www.ugburzenin.pl": html(
            "Gmina Burzenin", '<a href="https://www.ugburzenin.pl/bip">BIP</a>'
        ),
        "https://www.ugburzenin.pl/bip": html(
            "Biuletyn Informacji Publicznej Gminy Burzenin",
            '<a href="/bip/oswiadczenia">Oświadczenia majątkowe</a>'
            '<a href="https://bip.powiat-sieradz.pl/">BIP Powiatu Sieradzkiego</a>',
        ),
        **declarations("https://www.ugburzenin.pl/bip", "Ewa Lis"),
    }
    web = Web(sites)
    seeds = {"u1": UnitSeed("u1", www_urls=["https://www.ugburzenin.pl"])}
    store = walk(tmp_path, web, seeds, [row("l", "u1", "Ewa", "Lis")])
    assert store.units["u1"].roots == ["https://www.ugburzenin.pl/bip"]
    assert store.outcomes["l"].status == "found"
    assert not any("powiat-sieradz" in call for call in web.calls)


def test_a_bip_section_of_the_website_that_lists_declarations_is_its_bip(tmp_path):
    # A website's /bip section, linked by a picture and the office's name,
    # lists its declarations: it is the BIP, not one it links elsewhere.
    own = "https://gminax.pl/bip"
    sites = {
        "https://gminax.pl": html(
            "Gmina X",
            f'<a href="{own}/"><img src="/images/herb.png" alt=""></a>'
            f'<a href="{own}/">Urząd Gminy X</a>' + MENU,
        ),
        f"{own}/": html(
            "BIP Gminy X",
            f'<a href="{own}/oswiadczenia">Oświadczenia majątkowe</a>'
            '<a href="https://gminax.e-bip.pl/">Biuletyn Informacji Publicznej</a>',
        ),
        **declarations(own, "Ewa Lis"),
    }
    web = Web(sites)
    seeds = {"u1": UnitSeed("u1", www_urls=["https://gminax.pl"])}
    store = walk(tmp_path, web, seeds, [row("l", "u1", "Ewa", "Lis")])
    assert store.units["u1"].roots == [f"{own}/"]
    assert store.outcomes["l"].status == "found"
    assert not any("e-bip.pl" in call for call in web.calls)


def test_an_archive_bip_is_never_the_one_a_website_starts_from(tmp_path):
    # Rybno: its /bip/ section links e-bip.pl as "Archiwum BIP", and round 1
    # walked that; the councillors' declarations are in the section, two
    # levels down (5 found from the website before, 11-18).
    own = "https://gminarybno.com/bip"
    sites = {
        "https://gminarybno.com": html(
            "Gmina Rybno",
            f'<a href="{own}/"><img src="/images/herb.png" alt=""></a>'
            f'<a href="{own}/">Urząd Gminy Rybno</a>' + MENU,
        ),
        f"{own}/": html(
            "Strona główna - Gmina Rybno",
            f'<a href="{own}/organy">Organy władzy samorządowej</a>'
            '<a href="http://e-bip.pl/Start/23334">Archiwum BIP</a>',
        ),
        f"{own}/organy": html(
            "Organy władzy samorządowej",
            f'<a href="{own}/oswiadczenia">Oświadczenia majątkowe</a>',
        ),
        **declarations(own, "Sylwia Feliga"),
    }
    web = Web(sites)
    seeds = {
        "u1": UnitSeed(
            "u1", www_urls=["https://gminarybno.com"], names=["Urząd Gminy Rybno"]
        )
    }
    store = walk(tmp_path, web, seeds, [row("f", "u1", "Sylwia", "Feliga")])
    assert store.units["u1"].roots == ["https://gminarybno.com"]
    assert store.outcomes["f"].status == "found"
    assert not any("e-bip.pl" in call for call in web.calls)


def test_a_link_that_says_bip_and_leads_off_the_website_is_its_bip(tmp_path):
    # Powiat kościański: the banner /blue.php?id=103 answers 302 to the
    # powiat's BIP on a host shared with other powiats.
    bip = "https://bip3.wokiss.pl/koscianp"
    sites = {
        "https://www.powiatkoscian.pl": html(
            "Powiat Kościański",
            MENU
            + '<a href="https://www.powiatkoscian.pl/blue.php?id=103"><img src="photos'
            '/gal/ic_103.svg" alt="Biuletyn Informacji Publicznej"></a>',
        ),
        f"{bip}/": html(
            "BIP Starostwa",
            f'<a href="{bip}/oswiadczenia">Oświadczenia majątkowe</a>'
            '<a href="https://bip3.wokiss.pl/chodziezp/oswiadczenia">Chodzież</a>',
        ),
        **declarations(bip, "Jan Nowak"),
    }
    web = Moved(sites, {"https://www.powiatkoscian.pl/blue.php?id=103": f"{bip}/"})
    seeds = {
        "u1": UnitSeed("u1", www_urls=["https://www.powiatkoscian.pl"]),
        "u2": UnitSeed(
            "u2",
            bip_urls=["https://bip3.wokiss.pl/chodziezp/"],
            scopes=["bip3.wokiss.pl/chodziezp"],
        ),
    }
    store = walk(tmp_path, web, seeds, [row("n", "u1", "Jan", "Nowak")])
    assert store.outcomes["n"].status == "found"
    assert store.units["u1"].roots == [f"{bip}/"]
    assert not any("chodziezp" in call for call in web.calls)
