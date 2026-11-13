"""Łódź's declarations app (TYPO3 EdgeFinancialDisclosure): ~2,600 people 20 a
page in alphabetical order, searched by surname through a GET form whose
hidden fields the app signs; each person a page with a table of their files.
And its list of the people obliged to file, which is nobody's declaration, and
two people the app lists side by side whose double surnames share a part.

The markup is bip.uml.lodz.pl's own (11-13), cut down to what matters.
"""

from __future__ import annotations

from urllib.parse import parse_qsl, urlsplit

from jobs.bip_crawler.edge import LAST_NAME, search_links
from jobs.bip_crawler.tests.test_people_mode_review import PDF, html, row, search
from scrapers.bip.people import Seeker, candidates, declarants, named_by_label
from scrapers.common.links import LinkContext, extract_link_contexts

HOST = "https://u1.pl"
APP = f"{HOST}/samorzad/oswiadczenia-majatkowe/wyszukiwarka-oswiadczen-majatkowych/"
TITLE = "Wyszukiwarka oświadczeń majątkowych: BIP ŁÓDŹ"
P = "tx_edgefinancialdisclosure_person"
UTF8 = "text/html; charset=utf-8"


def form(signed: str = "YTowOnt95b1b1cfe3f5faa2d0a6c5278e7be77ab312b41c3") -> str:
    """The app's form: the signed hidden fields, the surname, a position and a
    year, each select's first option every one."""
    return (
        '<form method="get" action="#financial-disclosure-results"><div>'
        f'<input type="hidden" name="{P}[__referrer][@extension]" '
        'value="EdgeFinancialDisclosure" />'
        f'<input type="hidden" name="{P}[__referrer][@action]" value="list" />'
        f'<input type="hidden" name="{P}[__referrer][arguments]" value="{signed}" />'
        f'<input type="hidden" name="{P}[__trustedProperties]" value="'
        "{&quot;personDemand&quot;:{&quot;lastName&quot;:1,&quot;financialDisclosure"
        'ForPosition&quot;:1,&quot;financialDisclosureFromYear&quot;:1}}2c446dd5" />'
        '</div><div class="fieldset-group">'
        '<label for="person-demand-last-name">Nazwisko</label>'
        '<input class="form-control" id="person-demand-last-name" type="text" '
        f'name="{P}[personDemand][lastName]" value="" /></div>'
        '<select id="person-demand-position" '
        f'name="{P}[personDemand][financialDisclosureForPosition]">'
        '<option value="0">Wszystkie stanowiska</option>'
        '<option value="1">Prezydent</option><option value="3">Radny(a)</option>'
        "</select>"
        f'<select id="person-demand-year" name="{P}[personDemand]'
        '[financialDisclosureFromYear]"><option value="0">Wszystkie lata</option>'
        '<option value="2026">2026</option></select>'
        '<input class="btn" type="submit" value="Szukaj" /></form>'
    )


def person_url(person: int) -> str:
    return (
        f"{APP}?{P}%5Baction%5D=show&{P}%5Bcontroller%5D=Person"
        f"&{P}%5Bperson%5D={person}&cHash=h{person}"
    )


def person_item(person: int, name: str, post: str) -> str:
    """One person on the app's list, under their post."""
    return (
        '<div class="article-item article-item--gold article-item--type-0"><div>'
        f'<p class="article-item__date"><span>{post}</span></p>'
        '<h3 class="article-item__title"><span class="article-item__catindicator '
        f'icon icon-stop"></span><a href="{person_url(person).replace("&", "&amp;")}"'
        f">{name}</a></h3></div></div>"
    )


#: The menu down the side of every page: a <div> in <main>, beside the content.
MENU = (
    '<div class="col-3 col-12--phone aside"><div class="aside-container">'
    '<div class="section-header"><span><a href="/">BIULETYN INFORMACJI PUBLICZNEJ'
    '</a></span></div><ul class="aside-nav list-unstyled">'
    '<li class="aside-nav__has-subnav"><a href="/urzad-miasta/">Urząd Miasta</a>'
    '<ul class="aside-nav__subnav list-unstyled"><li><a href="/urzad-miasta/'
    'statut-urzedu-miasta-lodzi/">Statut Urzędu Miasta Łodzi</a></li><li><a href="'
    f'{HOST}/files/bip/public/BIP_SS/OU_schemat_20260101_20260102.pdf" '
    'target="_blank">Schemat organizacyjny Urzędu Miasta Łodzi</a></li></ul></li>'
    "</ul></div></div>"
)


def page(content: str) -> str:
    """A page of Łódź's BIP: the header, the menu, the content."""
    return (
        '<header class="box--fluid"><div class="box"><div class="row nav-bip">'
        '<div class="col-6 col-12--phone col-7--tablet nav"><ul class="nav-site '
        'list-inline" id="accessible-aside-nav"><li><a href="/ostatnio-dodane/">'
        "Ostatnio dodane</a></li></ul></div></div></div></header>"
        '<main id="accessible-body" class="box"><div class="row">'
        f'{MENU}<div class="col-9 col-12--phone main-section">'
        f'<div class="tx-edge-financial-disclosure">{content}</div></div></div></main>'
    )


def table(name: str, files: list[tuple[str, str]]) -> str:
    """A person's page: their name, born, and a table of their files."""
    rows = "".join(
        f"<tr><td>2026</td><td>29.04.2026</td><td>Radny(a)</td><td>"
        f'<a href="{url}" target="_blank" class="financial-disclosure--attachment'
        f'--link">{label}</a></td><td class="financial-disclosure--single--table--'
        'infocol">Wprowadził: Małgorzata Wójcik / BBI (06.05.2026 14:23)</td></tr>'
        for url, label in files
    )
    return (
        f"<h2>{name} (ur. 24.05.1970)</h2>"
        '<table class="financial-disclosure--single--table"><thead><tr>'
        "<th>Rok złożenia</th><th>Data dokumentu</th><th>Stanowisko</th>"
        f"<th>Załącznik</th><th>Informacje</th></tr></thead><tbody>{rows}"
        "</tbody></table>"
    )


def test_one_search_a_seeker_by_the_longest_part_of_the_surname_as_listed():
    seekers = [
        Seeker.of("z", "Elżbieta", "ŻURAW", "Małgorzata"),
        Seeker.of("m", "Małgorzata", "MOSKWA-WODNICKA"),
        Seeker.of("h", "Hanna", "ZDANOWSKA", "Elżbieta"),
        # The president and a councillor: one person, one search.
        Seeker.of("h2", "Hanna", "ZDANOWSKA", "Elżbieta"),
    ]
    links = search_links(html(TITLE, page(form()))[2], APP, seekers)
    # The surname alone: a list of people answers, no one person's page.
    assert [x.anchor for x in links] == ["ŻURAW", "WODNICKA", "ZDANOWSKA"]
    first = urlsplit(links[0].url)
    assert f"{first.scheme}://{first.netloc}{first.path}" == APP
    query = dict(parse_qsl(first.query))
    # Diacritics kept: the app finds "Żuraw" by "ŻURAW", nobody by "zuraw".
    assert query[f"{P}{LAST_NAME}"] == "ŻURAW"
    assert query[f"{P}[__referrer][arguments]"] == (
        "YTowOnt95b1b1cfe3f5faa2d0a6c5278e7be77ab312b41c3"
    )
    assert query[f"{P}[__trustedProperties]"].startswith('{"personDemand":')
    assert query[f"{P}[personDemand][financialDisclosureForPosition]"] == "0"
    assert query[f"{P}[personDemand][financialDisclosureFromYear]"] == "0"
    # "Moskwa-Wodnicka" on the list, whichever way the parts are joined.
    second = dict(parse_qsl(urlsplit(links[1].url).query))
    assert second[f"{P}{LAST_NAME}"] == "WODNICKA"


def test_no_search_from_the_apps_answers_nor_from_other_forms():
    seekers = [Seeker.of("w", "Mateusz", "WALASEK", "Jan")]
    answer = f"{APP}?{P}%5BpersonDemand%5D%5BlastName%5D=WALASEK"
    # Each answer signs its own request: searching from it would ask anew.
    assert search_links(html(TITLE, page(form("other")))[2], answer, seekers) == []
    site_search = (
        '<form method="get" id="tx-solr-search-form-pi-search" action="/wyszukiwanie/"'
        ' accept-charset="utf-8"><input id="searchInput" type="search" '
        'name="tx_solr[q]" value="" /></form>'
    )
    assert search_links(html(TITLE, page(site_search))[2], APP, seekers) == []


def test_the_walk_finds_a_seeker_through_the_apps_search(tmp_path):
    seeker = Seeker.of("w", "Mateusz", "WALASEK", "Jan")
    (query,) = search_links(html(TITLE, page(form()))[2], APP, [seeker])
    files = f"{HOST}/files/bip/public"
    sites = {
        HOST: html("BIP", f'<a href="{APP}">Wyszukiwarka oświadczeń majątkowych</a>'),
        # The list's first page: people far from the seeker.
        APP: html(
            TITLE,
            page(form() + person_item(2376, "Abramowicz Anna", "Szpital Miejski")),
        ),
        query.url: html(
            TITLE,
            page(form("answer") + person_item(1907, "Walasek Mateusz", "Radny(a)")),
        ),
        person_url(1907): html(
            TITLE,
            page(
                table(
                    "Walasek Mateusz",
                    [
                        (
                            f"{files}/BIP_MW_26/walasek_mateusz_2026.pdf",
                            "walasek_mateusz_2026.pdf",
                        ),
                        (
                            f"{files}/BIP_SS_21/walasek_mateusz_u_200528.pdf",
                            "Korekta ośw. 28.05.2020",
                        ),
                    ],
                )
            ),
        ),
        f"{files}/BIP_MW_26/walasek_mateusz_2026.pdf": (200, "application/pdf", PDF),
        f"{files}/BIP_SS_21/walasek_mateusz_u_200528.pdf": (
            200,
            "application/pdf",
            PDF + b"2",
        ),
        f"{files}/BIP_SS/OU_schemat_20260101_20260102.pdf": (
            200,
            "application/pdf",
            PDF + b"3",
        ),
    }
    _, store, _, _ = search(
        tmp_path, sites, [row("w", "u1", "Mateusz", "WALASEK")], per_person=3
    )
    assert store.outcomes["w"].status == "found"
    # The menu's organisation chart stands on the person's page too: not theirs.
    assert {d.url for d in store.person_docs("w")} == {
        f"{files}/BIP_MW_26/walasek_mateusz_2026.pdf",
        f"{files}/BIP_SS_21/walasek_mateusz_u_200528.pdf",
    }


def test_the_menu_down_the_side_is_the_frame():
    """Every page carries "Urząd Miasta > Schemat organizacyjny Urzędu Miasta
    Łodzi" (a PDF) in a ``<div class="aside">`` of its ``<main>``: a page lent
    to a seeker lent it too, and a declarations page made it everybody's
    unnamed declaration (11-13)."""
    walasek = Seeker.of("w", "Mateusz", "WALASEK", "Jan")
    own = f"{HOST}/files/bip/public/BIP_SS_21/walasek_mateusz_u_200528.pdf"
    body = page(table("Walasek Mateusz", [(own, "Korekta ośw. 28.05.2020")]))
    title, links = extract_link_contexts(html(TITLE, body)[2], person_url(1907), UTF8)
    framed = {x.url.rsplit("/", 1)[-1]: x.frame for x in links if ".pdf" in x.url}
    assert framed == {
        "OU_schemat_20260101_20260102.pdf": True,
        "walasek_mateusz_u_200528.pdf": False,
    }
    lent = candidates(person_url(1907), title, links, [walasek], lender=walasek.name)
    assert [c.url for c in lent] == [own]
    menu_only = [x for x in links if "schemat" in x.url]
    assert (
        candidates(person_url(1907), title, menu_only, [walasek], declared=True) == []
    )


def test_a_list_of_those_obliged_to_file_is_nobodys_declaration():
    seeker = Seeker.of("m", "Krzysztof", "MAKOWSKI", "Michał")
    url = (
        f"{HOST}/samorzad/oswiadczenia-majatkowe/"
        "lista-osob-zobowiazanych-do-skladania-oswiadczen-majatkowych/"
    )
    files = f"{HOST}/files/bip/public"
    links = [
        LinkContext(
            f"{files}/BIP_SS_26/BZK_lista_091126_20261112.pdf",
            "Stan na dzień 09.11.2026 r. [.pdf]",
            "Stan na dzień 09.11.2026 r. [.pdf] 1 MB",
        ),
        LinkContext(
            f"{files}/BIP_VG_26/BZK_lista_osob_zobowiazanych_20261006_20261007.pdf",
            "Stan na dzień 6.10.2026 r. [.pdf]",
            "Stan na dzień 6.10.2026 r. [.pdf] 715 KB",
        ),
    ]
    title = "Lista osób zobowiązanych do składania oświadczeń majątkowych: BIP ŁÓDŹ"
    assert candidates(url, title, links, [seeker], declared=True) == []
    # A file that says so is nobody's on a declarations page too.
    om = f"{HOST}/samorzad/oswiadczenia-majatkowe/"
    assert candidates(om, "Oświadczenia majątkowe", links[1:], [seeker]) == []
    wykaz = LinkContext(f"{HOST}/w.pdf", "Wykaz osób obowiązanych do złożenia")
    assert candidates(om, "Oświadczenia majątkowe", [wykaz], [seeker]) == []


def test_another_persons_double_surname_is_not_the_seekers():
    """The app lists Góralczyk - Niewiadomska Małgorzata (MOPS) beside the
    councillor Niewiadomska-Cudak Małgorzata: the walk took two of the
    other's files for the councillor's (11-13)."""
    councillor = Seeker.of("n", "Małgorzata", "NIEWIADOMSKA-CUDAK", "Krystyna")
    # Her search's answer lends the other's page nobody.
    other = LinkContext(person_url(519), "Góralczyk - Niewiadomska Małgorzata")
    own = LinkContext(person_url(1285), "Niewiadomska-Cudak Małgorzata")
    assert named_by_label(other, [councillor]) == set()
    assert named_by_label(own, [councillor]) == {councillor.name}
    said = LinkContext(
        person_url(519), "Oświadczenie Góralczyk-Niewiadomska Małgorzata"
    )
    assert declarants(said, [councillor]) == set()
    files = f"{HOST}/files/bip/public"
    links = [
        LinkContext(
            f"{files}/BIP_MW_24/niewiadomska_cudak_malgorzata_240429.pdf",
            "niewiadomska_cudak_malgorzata_240429.pdf",
        ),
        LinkContext(
            f"{files}/BIP_SS_24/niewiadomska-cudak_malgorzata__2024.pdf",
            "Korekta ośw. 29.04.2024",
        ),
        LinkContext(
            f"{files}/BIP_MW_26/goralczyk-niewiadomska_malgorzata_260423.pdf",
            "goralczyk-niewiadomska_malgorzata_260423.pdf",
        ),
        LinkContext(f"{files}/BIP_SS_24/x.pdf", "Góralczyk - Niewiadomska Małgorzata"),
    ]
    found = candidates(APP, TITLE, links, [councillor])
    assert [c.url.rsplit("/", 1)[-1] for c in found if c.key == "n"] == [
        "niewiadomska_cudak_malgorzata_240429.pdf",
        "niewiadomska-cudak_malgorzata__2024.pdf",
    ]
    # Hyphens that part a slug's every word join no surname.
    slugs = [
        LinkContext(f"{HOST}/oswiadczenia/2024/malgorzata-niewiadomska.pdf", "2024"),
        LinkContext(
            f"{HOST}/pliki/oswiadczenie-majatkowe-malgorzata-niewiadomska-2025.pdf",
            "Oświadczenie majątkowe",
        ),
    ]
    kept = candidates(
        f"{HOST}/om", "Oświadczenia majątkowe radnych", slugs, [councillor]
    )
    assert [c.key for c in kept] == ["n", "n"]
    # A seeker of one surname keeps a second: Bartosiak files as
    # Bartosiak-Sikorzyńska.
    single = Seeker.of("b", "Małgorzata", "BARTOSIAK")
    married = [
        LinkContext(
            f"{files}/BIP_SS_24/bartosiak-sikorzynska_malgorzata_2024.pdf",
            "bartosiak-sikorzynska_malgorzata_2024.pdf",
        )
    ]
    assert [c.key for c in candidates(APP, TITLE, married, [single])] == ["b"]
