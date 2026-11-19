"""ZETO Lublin's e-zeto BIPs: a list's further pages behind buttons, one address
a page, a seeker's documents under their names, and a councillor's own page
read before the menu's declarations tree. The markup is Żółkiewka's, powiat
świdnicki's and powiat bolesławiecki's (11-13)."""

from __future__ import annotations

from jobs.bip_crawler.ezeto import documents, pager
from jobs.bip_crawler.tests.test_people_mode_review import PDF, html, row, search
from scrapers.bip.classify import normalize_url
from scrapers.bip.people import Seeker

HOST = "https://u1.pl"
#: Where a pager's button names the list: Żółkiewka's 2018-2023 term (mnu6, 122).
LIST = "%26value%255B0%255D%3Dmnu6%26value%255B1%255D%3D122"
PLACE = (
    "%26param%255Bwartosc%255D%255B0%255D%3Dmnu6"
    "%26param%255Bwartosc%255D%255B1%255D%3D122"
)
FUNCTION = "%26param%255Bfunkcja%255D%3Dselectsite"
ORDER = (
    "%26param%255Bsortuj%255D%255Bkierunek%255D%3DDESC"
    "%26param%255Bsortuj%255D%255Bsort1%255D%3Ddatad"
    "%26param%255Bsortuj%255D%255Bsort2%255D%3Dnumer"
    "%26param%255Bsortuj%255D%255Bsort3%255D%3Dnazwa"
)
TITLE = "Oświadczenia majątkowe kadencja 2018-2023"


def name(page: int, bt: int, first: bool = True) -> str:
    """A pager button's name: param[0] counts from 0. The first page's buttons
    name the list's place before its function, the next pages' after it."""
    middle = PLACE + FUNCTION if first else FUNCTION + PLACE
    return (
        f"type%3D4%26name%3Dbt{bt}%26func%3DdispNaviBar{LIST}{middle}{ORDER}"
        f"%26param%255B0%255D%3D{page}"
    )


def button(value: str, page: int, bt: int, title: str = "Wybierz stronę:") -> str:
    return (
        f'<input type="submit" value="{value}" name="{name(page, bt)}"  '
        f'class="btn btn-default btn-sm"    title="{title}">'
    )


#: Over and under the list's first page: pages 2 to 8, the next eight, the last.
PAGER = (
    '<div class="text-center">Wybierz stronę: <div class="btn-group" role="group">'
    '<div class="btn btn-sm disabled">1</div>'
    + button("2", 1, 1)
    + button("3", 2, 3)
    + button(">", 8, 15, "Kolejne 8")
    + button(">>", 11, 17, "Ostatnia strona")
    + "</div> (1 z 12)</div>"
)
#: The sort form's button beside it: no page.
SORT = (
    '<input type="submit" value="sortuj" name="type%3D4%26name%3Dbt3%26func%3D'
    f'sorterActionSites{FUNCTION}{PLACE}"  class="btn btn-default btn-sm"    '
    'title="Sortuj wg zadanego kryterium">'
)
#: The list as its menu and its section link it.
LIST_URL = (
    f"{HOST}/index.php?type%3D4%26name%3Dbt3%26func%3Dselectsite"
    "%26value%255B0%255D%3Dmnu6%26value%255B1%255D%3D122"
)
FILES = f"{HOST}/bip/44_ugzolkiewka/fckeditor/file/Wladze/Rada"


def item(label: str, file: str, document: int) -> str:
    """A list's document, its file linked over its record."""
    return (
        '<section><div><h2><a class="bip-link internal-link" target="_blank" '
        f'href="{file}" download><i aria-hidden="true" class="fa fa-file-pdf-o"></i>'
        f"{label}<span class='file-info'>(pdf,251.34kB)</span></a></h2><div></div>"
        '<div class="row"><div class="col-sm-8">Data publikacji: 2024.05.06 '
        '14:02:10, brak zmian</div><div class="col-sm-4"><p class="text-right">'
        f'<a title="szczegóły dokumentu: {label}" class="showmore" href="index.php?'
        f'type%3D4%26name%3Dbt29%26func%3Dselectsite%26value%255B0%255D%3D{document}">'
        "przejdź do dokumentu</a></p></div></div></div></section>"
    )


def test_a_pager_button_is_a_link_to_the_page_it_opens() -> None:
    links = pager((SORT + PAGER).encode(), LIST_URL, TITLE)
    assert [x.anchor for x in links] == [f"{TITLE} strona {n}" for n in (2, 3, 9, 12)]
    assert links[0].url == f"{HOST}/index.php?{name(1, 1)}"
    # The first page, "<<" (param[0] -1) or "1", is the list's own address.
    later = button("<<", -1, 1, "Pierwsza strona") + button("1", 0, 3)
    links = pager((later + button("11", 10, 5)).encode(), LIST_URL)
    assert [x.anchor for x in links] == ["strona 11"]
    assert pager(b'<input type="submit" value="szukaj" name="q">', LIST_URL) == []


def test_an_e_zeto_page_has_one_address_and_other_pages_keep_theirs() -> None:
    bip = "https://bip.powiatboleslawiecki.pl"
    # A councillor (mnu55, 12) as the menu, the term's list and a breadcrumb
    # link him, and as normalize_url once read the list's: "...=", the home page.
    one = (
        f"{bip}/index.php?func%3Dselectsite%26type%3D4"
        "%26value%255B0%255D%3Dmnu55%26value%255B1%255D%3D12"
    )
    encoded = (
        f"{bip}/index.php?type%3D4%26name%3Dbt31%26func%3Dselectsite"
        "%26value%255B0%255D%3Dmnu55%26value%255B1%255D%3D12"
    )
    for linked in (
        f"{bip}/index.php?type=4&amp;name=bt782&amp;func=selectsite"
        "&amp;value%5B0%5D=mnu55&amp;value%5B1%5D=12",
        f"{bip}/index.php?type=4&func=selectsite&value%5B0%5D=mnu55&value%5B1%5D=12",
        encoded,
        encoded + "=",
        encoded.replace("bt31", "vb")
        + "%26value%255B2%255D%3Dselectsite%26value%255B3%255D%3D0"
        "%26value%255B4%255D%3D0",
    ):
        assert normalize_url(linked) == one
    assert normalize_url(one) == one
    # A list's second page from the first page's buttons and from the third's,
    # encoded whole: decoded, the server answers with its home page.
    second = normalize_url(f"{HOST}/index.php?{name(1, 1)}")
    assert second == normalize_url(f"{HOST}/index.php?{name(1, 3, first=False)}")
    assert second.startswith(f"{HOST}/index.php?func%3DdispNaviBar%26param%255B0%255D")
    assert normalize_url(second) == second
    # The breadcrumb's list hands its three arguments on to its buttons.
    trail = "".join(
        f"%26param%255Bwartosc%255D%255B{i}%255D%3D{value}"
        for i, value in ((2, "selectsite"), (3, "0"), (4, "0"))
    )
    crumbs = name(1, 1).replace(PLACE, PLACE + trail)
    assert normalize_url(f"{HOST}/index.php?{crumbs}") == second
    # Its other functions, and any other platform's index.php, keep theirs.
    help_page = f"{bip}/index.php?type%3D4%26name%3Dbt54%26func%3DdisplayHelp"
    assert "name%3Dbt54" in normalize_url(help_page)
    assert normalize_url("https://bip.x.pl/index.php?id=12&func=selectsite") == (
        "https://bip.x.pl/index.php?func=selectsite&id=12"
    )
    assert normalize_url("https://x.akcessnet.net/index.php?idg=4&id=375&x=13") == (
        "https://x.akcessnet.net/index.php?id=375&idg=4&x=13"
    )


def test_the_walk_reads_a_lists_further_pages_at_one_address(tmp_path) -> None:
    # Żółkiewka: the chairman's declarations stand on pages 2, 5 and 10 of 12.
    sites = {
        HOST: html("Dane urzędu", f'<a href="{LIST_URL}">{TITLE}</a>'),
        LIST_URL: html(
            TITLE,
            PAGER
            + item(
                "Oświadczenie majątkowe radnego Jana Bobla złożone według stanu na "
                "dzień 31 grudnia 2023 r.",
                f"{FILES}/Bobel_Jan.pdf",
                5937,
            ),
        ),
        f"{HOST}/index.php?{name(1, 1)}": html(
            TITLE,
            item(
                "Oświadczenie majątkowe Przewodniczącego Rady Gminy Mariana Kani za "
                "2022 r.",
                f"{FILES}/Kania_Marian.pdf",
                5680,
            ),
        ),
        f"{FILES}/Kania_Marian.pdf": (200, "application/pdf", PDF + b"k"),
    }
    _, store, web, _ = search(
        tmp_path, sites, [row("k", "u1", "Marian", "Kania")], sitemaps=False
    )
    assert store.outcomes["k"].status == "found"
    second = normalize_url(f"{HOST}/index.php?{name(1, 1)}")
    assert second in web.calls
    assert not any("func=dispNaviBar" in call for call in web.calls)


def test_a_lists_further_pages_are_declarations_when_it_is(tmp_path) -> None:
    # Powiat świdnicki's council for 2024 is titled "Rada Powiatu" and fills 10
    # pages; a link saying declarations led to its first.
    council = "Rada Powiatu"
    sites = {
        HOST: html("BIP", f'<a href="{LIST_URL}">Oświadczenia majątkowe 2024</a>'),
        LIST_URL: html(council, PAGER),
        f"{HOST}/index.php?{name(1, 1)}": html(
            council,
            item("Oświadczenie majątkowe za 2023 rok", f"{FILES}/2023.pdf", 16141),
        ),
        f"{FILES}/2023.pdf": (200, "application/pdf", PDF + b"u"),
    }
    _, store, _, _ = search(
        tmp_path, sites, [row("n", "u1", "Jan", "Nowak")], sitemaps=False
    )
    # A file that names nobody on a declarations list: the OCR step's to read.
    assert store.outcomes["n"].status == "unconfirmed"


def test_a_lists_further_pages_are_the_seekers_its_first_is(tmp_path) -> None:
    # A link saying one seeker's declarations led to a list titled for nobody:
    # its next page's files are theirs too.
    sites = {
        HOST: html(
            "BIP", f'<a href="{LIST_URL}">Oświadczenia majątkowe - Marian Kania</a>'
        ),
        LIST_URL: html("Dokumenty", PAGER),
        f"{HOST}/index.php?{name(1, 1)}": html(
            "Dokumenty", item("za 2021 rok", f"{FILES}/2021.pdf", 4931)
        ),
        f"{FILES}/2021.pdf": (200, "application/pdf", PDF + b"m"),
    }
    _, store, _, _ = search(
        tmp_path, sites, [row("k", "u1", "Marian", "Kania")], sitemaps=False
    )
    assert store.outcomes["k"].status == "found"


def record(name: str, number: str, document: int) -> str:
    """Powiat świdnicki's list item: a document of several files, its name in
    the heading, its number in bold, a details link that says only that."""
    return (
        f"<section><div><h2>{name}</h2><div>numer: <b>{number}</b></div>"
        '<div class="row"><div class="col-sm-8">Data publikacji: 2024.09.18 '
        '14:51:05, brak zmian</div><div class="col-sm-4"><p class="text-right">'
        f'<a title="szczegóły dokumentu: {name}" class="showmore" href="index.php?'
        f'type%3D4%26name%3Dbt29%26func%3Dselectsite%26value%255B0%255D%3D{document}">'
        "przejdź do dokumentu</a></p></div></div></div></section>"
    )


COUNCIL = "Rada Powiatu"
SOLTYS = "Krzysztof Sołtys. Oświadczenie majątkowe za 2023 rok"
#: The 2024 council's list (mnu8, 202), beside the menu every page carries.
DECLARATIONS = (
    '<ul class="nav navbar-nav"><li class="dropdown-submenu"><a href="index.php?'
    'type=4&amp;name=bt60&amp;func=selectsite&amp;value%5B0%5D=mnu8&amp;value%5B1%5D=1"'
    ' class="dropdown-toggle">Oświadczenia majątkowe</a><ul class="dropdown-menu">'
    '<li><a href="index.php?type=4&amp;name=bt61&amp;func=selectsite&amp;value%5B0%5D'
    '=mnu8&amp;value%5B1%5D=2">Wzory oświadczeń majątkowych do pobrania</a></li>'
    '<li><a href="index.php?type=4&amp;name=bt62&amp;func=selectsite&amp;value%5B0%5D'
    '=mnu8&amp;value%5B1%5D=200">Rok 2025</a></li></ul></li></ul>'
)
COUNCIL_LIST = (
    DECLARATIONS
    + record(
        "Agata Kalafut. Oświadczenie majątkowe na początek kadencji",
        "BRZ.0033.80.2024",
        15955,
    )
    + record(SOLTYS, "BRZ.0033.41.2024", 16141)
)
SOLTYS_FILE = (
    f"{HOST}/app/mainScripts/download.php?names=00000001712825_1"
    "&mimes=application%2Fpdf&ext=.PDF&oldname=krzysztof.soltys.PDF"
)
#: His document's page: the file under "dokument:".
SOLTYS_PAGE = (
    f"<section><h1>{SOLTYS}</h1><hr><div><table>"
    f"<tr><td>nazwa:</td><td> {SOLTYS} </td></tr>"
    '<tr><td>dokument:</td><td> <ul class="documents"><li><a aria-label="pobierz '
    'plik krzysztof.soltys.PDF" href="'
    + SOLTYS_FILE.removeprefix(f"{HOST}/").replace("&", "&amp;")
    + '" class="buttonNoFrame" target="_blank">krzysztof.soltys.PDF</a>'
    "&nbsp;(pdf,&nbsp;625.61kB)</li></ul></td></tr></table></div></section>"
)


def test_a_seekers_document_goes_under_its_name() -> None:
    url = f"{HOST}/index.php?type=4&func=selectsite&value%5B0%5D=mnu8&value%5B1%5D=202"
    seekers = [Seeker.of("s", "Krzysztof", "SOŁTYS", "Bronisław")]
    named = documents(COUNCIL_LIST.encode(), url, seekers)
    details = (
        f"{HOST}/index.php?type%3D4%26name%3Dbt29%26func%3Dselectsite"
        "%26value%255B0%255D%3D16141"
    )
    # Not Kalafut's, whom nobody seeks.
    assert named == {details: SOLTYS}
    # A councillor's own page links each file itself: its details add nothing.
    own = item(SOLTYS, f"{FILES}/Soltys_Krzysztof.pdf", 16141)
    assert documents(own.encode(), url, seekers) == {}


def test_the_walk_opens_a_seekers_document_before_the_menu(tmp_path) -> None:
    # Powiat świdnicki: its details links ranked last of the list's 167 links,
    # and a walk of 119 pages opened none (11-13). Two pages: the list, his.
    sites = {
        HOST: html(COUNCIL, COUNCIL_LIST),
        f"{HOST}/index.php?type=4&func=selectsite&value%5B0%5D=16141": html(
            SOLTYS, SOLTYS_PAGE
        ),
        SOLTYS_FILE: (200, "application/pdf", PDF + b"s"),
    }
    _, store, web, _ = search(
        tmp_path,
        sites,
        [row("s", "u1", "Krzysztof", "SOŁTYS")],
        sitemaps=False,
        unit_pages=2,
        pages_per_candidacy=1,
        max_unit_pages=2,
    )
    assert store.outcomes["s"].status == "found"
    assert not any("mnu8" in call for call in web.calls)


#: Powiat bolesławiecki's left menu: the councils' terms with their councillors,
#: then an "OŚWIADCZENIA MAJĄTKOWE" tree of officials and offices.
MENU = (
    '<div aria-label="menu z lewej strony" class="col-sm-2 col-xs-6 menu-left '
    'sidebar-offcanvas-left hidden-print" role="navigation">'
    '<ul class="nav navbar-nav"><li class="dropdown-submenu"><a href="index.php?'
    'type=4&amp;name=bt770&amp;func=selectsite&amp;value%5B0%5D=mnu55&amp;value%5B1%5D=3">'
    'VI kadencja</a><ul class="dropdown-menu"><li><a href="index.php?type=4&amp;'
    'name=bt782&amp;func=selectsite&amp;value%5B0%5D=mnu55&amp;value%5B1%5D=12">'
    "Jacek Łuczkowski</a></li></ul></li></ul>"
    '<ul class="nav navbar-nav"><li class="dropdown-submenu"><a href="index.php?'
    'type=4&amp;name=bt831&amp;func=selectsite&amp;value%5B0%5D=mnu12&amp;value%5B1%5D=1"'
    ' class="dropdown-toggle"><b>OŚWIADCZENIA MAJĄTKOWE</b></a></li></ul>'
    '<ul class="nav navbar-nav"><li class="dropdown-submenu"><a href="index.php?'
    'type=4&amp;name=bt863&amp;func=selectsite&amp;value%5B0%5D=mnu77&amp;value%5B1%5D=1"'
    ' class="dropdown-toggle">Jednostki Organizacyjne Powiatu</a>'
    '<ul class="dropdown-menu"><li class="dropdown-submenu"><a href="index.php?type=4'
    '&amp;name=bt887&amp;func=selectsite&amp;value%5B0%5D=mnu77&amp;value%5B1%5D=74">'
    "Powiatowe Centrum Pomocy Rodzinie w Bolesławcu</a>"
    '<ul class="dropdown-menu"><li><a href="index.php?type=4&amp;name=bt889&amp;'
    'func=selectsite&amp;value%5B0%5D=mnu77&amp;value%5B1%5D=76">'
    "Osoby upoważnione przez Starostę</a></li></ul></li></ul></li></ul></div>"
)
#: The VI term's list, the councillor once more.
TERM = (
    '<div class="container-fluid main-content" id="TRESC" role="main">'
    '<h1>VI kadencja</h1><hr><ul class="bip-menulist"><li><a href="index.php?'
    "type%3D4%26name%3Dbt31%26func%3Dselectsite%26value%255B0%255D%3Dmnu55"
    '%26value%255B1%255D%3D12" class="menubt_02"> Jacek Łuczkowski</a></li></ul></div>'
)
YEARS = (2021, 2022, 2023)
OWN = f"{HOST}/bip/318_spboleslawiec/fckeditor/file/Oswiadczenia/VI kadencja"


def test_a_councillors_own_page_is_read_before_the_menus_declarations(
    tmp_path,
) -> None:
    # The tree scored up to 9.5 and his name 5.5: the walk read 29 pages and
    # never opened his (11-13). Two pages: the term's, then his.
    his = f"{HOST}/index.php?type=4&func=selectsite&value%5B0%5D=mnu55&value%5B1%5D=12"
    sites = {
        HOST: html("VI kadencja", MENU + TERM),
        his: html(
            "Jacek Łuczkowski",
            MENU
            + "".join(
                item(
                    f"Jacek Łuczkowski - oświadczenie majątkowe za rok {year}",
                    f"{OWN}/{year}/Luczkowski_Jacek_{year}.pdf",
                    6000 + year,
                )
                for year in YEARS
            ),
        ),
        **{
            f"{OWN}/{year}/Luczkowski_Jacek_{year}.pdf": (
                200,
                "application/pdf",
                PDF + str(year).encode(),
            )
            for year in YEARS
        },
    }
    _, store, web, _ = search(
        tmp_path,
        sites,
        [row("l", "u1", "Jacek", "ŁUCZKOWSKI")],
        sitemaps=False,
        unit_pages=2,
        pages_per_candidacy=1,
        max_unit_pages=2,
    )
    assert store.outcomes["l"].status == "found"
    assert not any("mnu12" in call or "mnu77" in call for call in web.calls)
