"""The BIP an office's website links to (`website`), and a walk that starts
from the website: the snippets are the websites' own (11-13)."""

from __future__ import annotations

from pathlib import Path
from typing import cast

from jobs.bip_crawler import website
from jobs.bip_crawler.people import PeopleOptions, PeopleSearch
from jobs.bip_crawler.people_list import to_search
from jobs.bip_crawler.tests.test_bip import FakeFrontier
from jobs.bip_crawler.tests.test_people_mode_review import PDF, Web, html, row
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


def test_words_outweigh_a_picture():
    # Stopnica: both pictures' alt is "Logo Bip"; the council's video archive
    # says what it is in its aria-label.
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
    tmp_path: Path, web: Web, seeds: dict[str, UnitSeed], rows: list[PersonRow]
) -> MemoryBipPeopleStore:
    store = MemoryBipPeopleStore()
    search = PeopleSearch(
        store,
        cast("BipQueue", FakeFrontier([])),
        LocalBundleStore(tmp_path / "b"),
        seeds,
        PeopleOptions(workers=1, sitemaps=False),
        fetch=web.fetch,
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


def test_a_bip_that_does_not_answer_gives_way_to_the_one_the_websites_page_links(
    tmp_path,
):
    # Radziłów: an election banner leads to the old Wrota Podlasia BIP, which
    # answers nothing; the website's own BIP page links the new one.
    bip = "https://bip-ugradzilow.podlaskie.eu"
    sites = {
        "https://radzilow.pl": html(
            "Gmina Radziłów",
            '<a href="https://radzilow.pl/biuletyn-informacji-publicznej/">Biuletyn '
            "Informacji Publicznej</a>"
            '<a href="https://bip-ugradzilow.wrotapodlasia.pl/aktualnosci_1/wybory-'
            'prezydenta-rp-2025/" target="_blank"><img src="https://radzilow.pl/wp-'
            'content/uploads/2025/01/wybory-prezydent-2025.jpg" alt="Wybory '
            'Prezydenta RP 2025"></a>',
        ),
        "https://radzilow.pl/biuletyn-informacji-publicznej": html(
            "Biuletyn Informacji Publicznej – Gmina Radziłów",
            f'<a href="{bip}">/https://bip-ugradzilow.podlaskie.eu/</a>',
        ),
        bip: html("BIP", f'<a href="{bip}/oswiadczenia">Oświadczenia majątkowe</a>'),
        **declarations(bip, "Grzegorz Chyliński"),
    }
    seeds = {"u1": UnitSeed("u1", www_urls=["https://radzilow.pl/"])}
    rows = [row("c", "u1", "Grzegorz", "Chyliński")]
    store = walk(tmp_path, Web(sites), seeds, rows)
    assert store.units["u1"].roots == [bip]
    assert store.outcomes["c"].status == "found"


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
