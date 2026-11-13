"""People mode: more of the links out of a declarations section lead to
declarations pages (`people._Frontier.follow`) - an article under a month in
roman numerals, a "Name - Office" label, the next page of a paged list, and a
name in a menu that says declarations, wherever the walk meets it (11-13)."""

from __future__ import annotations

from jobs.bip_crawler import people as people_mode
from jobs.bip_crawler.people import DECLARATIONS_BONUS
from jobs.bip_crawler.tests.test_people_mode_review import PDF, html, row, search
from scrapers.bip.people import Seeker, named_by_label
from scrapers.common.links import LinkContext

# Grudziądz (Alfa TV): a councillor's page lists one article per declaration,
# each with the one file.
_ARTICLES = """
<h1 class="h3 my-3 my-md-4">CZEPEK Marek Józef</h1>
<h2 class="h4 my-3 my-md-4">Lista artykułów</h2>
<table class="table table-striped lista_artykuly"><thead><tr><th>Tytuł</th>
<th style="width: 25%">Data publikacji</th></tr></thead><tbody>
<tr><td><a href="/artykul/iii-2026-roczne">III 2026 - roczne</td>
<td>2026-07-10 06:23:42</td></tr>
<tr><td><a href="/artykul/ii-2024-2-miesiace-przed-koncem-10">II 2024 - 2 miesiące
przed końcem</td><td>2024-04-22 12:03:02</td></tr>
</tbody></table>
<a href="/artykul/strategia-rozwoju-miasta-grudziadz-na-lata-2024-2035">Strategia
Rozwoju Miasta Grudziądz na lata 2024-2035</a>
"""


def _article(title: str, file: str, label: str) -> tuple[int, str, bytes]:
    return html(
        f"{title} | BIP - Urząd Miejski w Grudziądzu",
        f'<h1 class="h3 my-3 my-md-4">{title}</h1>'
        '<h2 class="h4 my-3 my-md-4">Załączniki do pobrania</h2>'
        '<table class="table table-striped"><thead><tr><th>Plik</th><th>Nazwa</th>'
        "<th>Data dodania</th><th>Pobrań</th></tr></thead><tbody><tr><td></td><td>"
        f'<a href="{file}" class="download" download="">{label}</a></td>'
        "<td>2026-07-10 06:23:43</td><td>53</td></tr></tbody></table>",
    )


def test_a_month_in_roman_numerals_and_a_year_is_a_declarations_part():
    frontier = people_mode._Frontier([("x.pl", "")])
    links = [
        LinkContext("https://x.pl/artykul/iii-2026-roczne", "III 2026 - roczne"),
        LinkContext("https://x.pl/artykul/iv-2026", "IV 2026"),
        LinkContext("https://x.pl/artykul/v-2024", "V 2024 objęcie funkcji"),
        LinkContext(
            "https://x.pl/artykul/strategia",
            "Strategia Rozwoju Miasta Grudziądz na lata 2024-2035",
        ),
        LinkContext("https://x.pl/artykul/mix-2024", "Mix 2024"),
    ]
    frontier.follow(links, [], 2, None, DECLARATIONS_BONUS)
    assert frontier.declared == {
        "https://x.pl/artykul/iii-2026-roczne",
        "https://x.pl/artykul/iv-2026",
        "https://x.pl/artykul/v-2024",
    }


def test_a_persons_articles_under_roman_months_give_declaration_files(tmp_path):
    # Grudziądz (11-13): only the "V 2024 - początek kadencji" articles were
    # declarations pages ("kadencji"); the file of "III 2026 - roczne" names
    # Marek Józef Czepek and says nothing of a declaration.
    sites = {
        "https://u1.pl": html(
            "BIP", '<a href="/artykul/radni">Oświadczenia majątkowe radnych</a>'
        ),
        "https://u1.pl/artykul/radni": html(
            "Radni | BIP - Urząd Miejski w Grudziądzu",
            '<a href="/artykul/czepek-marek-jozef-3">CZEPEK Marek Józef</a>',
        ),
        "https://u1.pl/artykul/czepek-marek-jozef-3": html(
            "CZEPEK Marek Józef | BIP - Urząd Miejski w Grudziądzu", _ARTICLES
        ),
        "https://u1.pl/artykul/iii-2026-roczne": _article(
            "III 2026 - roczne",
            "/pliki/grudziadz/zalaczniki/31731/marek-jozef-czepek-iii-2026-roczne.pdf",
            "marek jozef czepek III 2026 roczne (PDF, 6.63 MB)",
        ),
        "https://u1.pl/artykul/ii-2024-2-miesiace-przed-koncem-10": _article(
            "II 2024 - 2 miesiące przed końcem",
            "/pliki/grudziadz/zalaczniki/28100/marek_jozef_czepek_ii_2024_2mpk.pdf",
            "22 04 2024 12 10 01 marek jozef czepek ii 2024 2mpk (PDF, 1.1 MB)",
        ),
        "https://u1.pl/pliki/grudziadz/zalaczniki/31731/"
        "marek-jozef-czepek-iii-2026-roczne.pdf": (200, "application/pdf", PDF + b"1"),
        "https://u1.pl/pliki/grudziadz/zalaczniki/28100/"
        "marek_jozef_czepek_ii_2024_2mpk.pdf": (200, "application/pdf", PDF + b"2"),
    }
    _, store, _, _ = search(
        tmp_path, sites, [row("c", "u1", "Marek", "CZEPEK")], sitemaps=False
    )
    assert store.outcomes["c"].status == "found"
    assert {d.url.rsplit("/", 1)[1] for d in store.person_docs("c")} == {
        "marek-jozef-czepek-iii-2026-roczne.pdf",
        "marek_jozef_czepek_ii_2024_2mpk.pdf",
    }


def test_a_name_before_a_spaced_dash_and_an_office_is_a_name():
    lakwa = Seeker.of("l", "Henryk", "LAKWA")
    wysdak = Seeker.of("w", "Krzysztof", "WYSDAK")
    seekers = [lakwa, wysdak]

    def named(label: str) -> set[tuple[str, str]]:
        return named_by_label(LinkContext("https://x.pl/1", label), seekers)

    assert named("Lakwa Henryk - Przewodniczący Zarządu Powiatu") == {lakwa.name}
    assert named("Wysdak Krzysztof - były Członek Zarządu") == {wysdak.name}
    assert named("Lakwa Henryk | Starosta Opolski") == {lakwa.name}
    # The office first, the name after it, as before: the whole label.
    assert named("Radny - Henryk Lakwa") == {lakwa.name}
    # A surname alone, or a dash inside a word, names nobody.
    assert named("Lakwa - Przewodniczący Zarządu Powiatu") == set()
    assert named("Lakwa Henryk-Przewodniczący Zarządu Powiatu Opolskiego") == set()


def test_a_name_and_office_label_on_a_declarations_page_lends_its_page():
    lakwa = Seeker.of("l", "Henryk", "LAKWA")
    frontier = people_mode._Frontier([("bip.powiatopolski.pl", "")])
    page = "https://bip.powiatopolski.pl/1277/lakwa-henryk-przewodniczacy.html"
    other = "https://bip.powiatopolski.pl/1302/gryc-antoni-radny-powiatu.html"
    links = [
        LinkContext(page, "Lakwa Henryk - Przewodniczący Zarządu Powiatu"),
        LinkContext(other, "Gryc Antoni - Radny Powiatu"),
    ]
    frontier.follow(links, [lakwa], 2, None, DECLARATIONS_BONUS)
    assert frontier.lenders == {page: lakwa.name}
    assert frontier.declared == {page}


#: Powiat opolski's councillors' list (SkyCMS), on the test unit's host.
_LIST = "https://u1.pl/2553/radni-powiatu.html"


def _pager(current: int) -> str:
    """SkyCMS's pager, as powiat opolski's councillors' list draws it."""
    steps = [
        f'<li><a href="?Page={n}" class="button paginationButton_{n}" '
        f'aria-label="Strona {n}">{n}</a></li>'
        for n in range(1, 4)
        if n != current
    ]
    if current < 3:
        steps.append(
            f'<li><a href="?Page={current + 1}" class="button next" '
            'aria-label="Następna strona">Następna</a></li>'
        )
    return (
        '<div class="paginationRow"><div class="totalResult">Liczba wyników: '
        '<b>34</b></div><nav aria-label="Paginacja"><ul class="pagination">'
        + "".join(steps)
        + "</ul></nav></div>"
    )


def _people(*people: tuple[str, str]) -> str:
    return (
        '<ul class="pageOnPage">'
        + "".join(
            '<li class="pageOnPageElement"><div class="pageOnPageContent">'
            f'<h2 class="pageOnPageHeader"><a href="{href}">{label}</a></h2>'
            "</div></li>"
            for href, label in people
        )
        + "</ul>"
    )


def test_the_next_page_of_a_declared_list_is_declared_a_calendar_day_is_not():
    frontier = people_mode._Frontier([("u1.pl", "")])
    links = [
        LinkContext(f"{_LIST}?Page=2", "2"),
        LinkContext(f"{_LIST}?Page=3", "Następna"),
        LinkContext("https://u1.pl/kalendarz/2026-11-12", "12"),
        LinkContext(f"{_LIST}?day=12", "12"),
        LinkContext(f"{_LIST}?Page=4", "Władze Powiatu"),
    ]
    frontier.follow(links, [], 2, None, DECLARATIONS_BONUS, _LIST)
    assert frontier.declared == {f"{_LIST}?Page=2", f"{_LIST}?Page=3"}
    # Off a declarations page a pager is just a pager.
    elsewhere = people_mode._Frontier([("u1.pl", "")])
    elsewhere.follow(links, [], 2, None, 0.0, _LIST)
    assert elsewhere.declared == set()


def test_a_councillor_on_a_later_page_of_a_declared_list_is_found(tmp_path):
    # Powiat opolski (11-13): "Oświadczenia Radnych Powiatu" leads to the
    # councillors six to a page, ?Page=1 to 6, the later ones titled "Radni
    # Powiatu - strona 2"; the person pages say nothing of declarations and
    # their files ("Henryk Lakwa za 2024 r. złożone do 30.04.2025 r") neither.
    lakwa = "https://u1.pl/1277/lakwa-henryk-przewodniczacy-zarzadu-powiatu.html"
    file = (
        "https://u1.pl/download/attachment/40595/"
        "henryk-lakwa-za-2024-r-zlozone-do-30042025-r.pdf?v=1748426715"
    )
    sites = {
        "https://u1.pl": html(
            "Strona główna BIP",
            '<ul><li><a href="/menu">Oświadczenia majątkowe</a><ul>'
            f'<li><a href="{_LIST}">Oświadczenia Radnych Powiatu</a></li>'
            "</ul></li></ul>",
        ),
        _LIST: html(
            "Radni Powiatu - Starostwo Powiatowe w Opolu",
            _people(("/1302/gryc-antoni-radny-powiatu.html", "Gryc Antoni - Radny"))
            + _pager(1),
        ),
        f"{_LIST}?Page=2": html(
            "Radni Powiatu - strona 2 - Starostwo Powiatowe w Opolu",
            _people((lakwa, "Lakwa Henryk - Przewodniczący Zarządu Powiatu"))
            + _pager(2),
        ),
        lakwa: html(
            "Lakwa Henryk - Przewodniczący Zarządu Powiatu",
            f'<a href="{file}">Henryk Lakwa za 2024 r. złożone do 30.04.2025 r '
            "(PDF | 178,92KB)</a>",
        ),
        file: (200, "application/pdf", PDF + b"1"),
    }
    _, store, _, _ = search(
        tmp_path, sites, [row("l", "u1", "Henryk", "LAKWA")], sitemaps=False
    )
    assert store.outcomes["l"].status == "found"
    assert [d.url for d in store.person_docs("l")] == [file]


def test_a_name_in_a_declarations_menu_lends_its_page_from_any_page():
    # Czeladź (11-13): every page's menu has "Oświadczenia majątkowe" >
    # "Zbigniew Szaleniec"; the walk met it first on the home page.
    szaleniec = Seeker.of("s", "Zbigniew", "SZALENIEC")
    page = "https://bip.czeladz.pl/oswiadczenia_majatkowe/zbigniew_szaleniec.html"
    council = "https://bip.czeladz.pl/rada_miejska/zbigniew_szaleniec.html"
    frontier = people_mode._Frontier([("bip.czeladz.pl", "")])
    links = [
        LinkContext(page, "Zbigniew Szaleniec", path="Oświadczenia majątkowe"),
        LinkContext(council, "Zbigniew Szaleniec", path="Rada Miejska > Radni"),
    ]
    frontier.follow(links, [szaleniec], 1)
    assert frontier.lenders == {page: szaleniec.name}
    assert frontier.declared == {page}


def test_a_declarations_menus_person_page_gives_them_its_files(tmp_path):
    # Czeladź (11-13): the page is titled "Oświadczenie majątkowe" alone and
    # its files "Oświadczenie Majątkowe za 2025 rok": nobody's but the menu's.
    menu = (
        '<li class="menu-m-roz"><a href="/oswiadczenia_majatkowe/index.html#tresc">'
        "Oświadczenia majątkowe</a><ul>"
        '<li><a href="https://u1.pl/oswiadczenia_majatkowe/stefania-lazar1.html" '
        'title="Link do strony: Stefania Lazar">Stefania Lazar</a></li>'
        '<li><a href="https://u1.pl/oswiadczenia_majatkowe/zbigniew_szaleniec.html" '
        'title="Link do strony: Zbigniew Szaleniec">Zbigniew Szaleniec</a></li>'
        "</ul></li>"
    )
    files = "".join(
        f'<tr><td><img src="pics/ico1/format_pdf.gif" alt="ikona"/></td><td>'
        f'<a href="https://u1.pl/download/{n}.pdf" target="DownloadWin">{label}</a>'
        f'<div>zobacz: <a href="main/rejestr_zmian/_plik/{n}.html">rejestr zmian '
        "pliku</a>, ilość pobrań: <b>182</b></div></td><td>2026-08-24 09:01:56<br />"
        "Kubasik-Janicka Milena - Wydział Organizacyjno - Administracyjny</td>"
        "<td>195.86KB</td></tr>"
        for n, label in (
            (7060, "Oświadczenie Majątkowe za 2025 rok"),
            (6159, "Oświadczenie Majątkowe z 2025r."),
        )
    )
    sites = {
        "https://u1.pl": html("Strona główna BIP", f"<ul>{menu}</ul>"),
        "https://u1.pl/oswiadczenia_majatkowe/index.html": html(
            "Oświadczenia majątkowe", f"<ul>{menu}</ul>"
        ),
        "https://u1.pl/oswiadczenia_majatkowe/zbigniew_szaleniec.html": html(
            "Oświadczenie majątkowe - Biuletyn Informacji Publicznej",
            f'<ul>{menu}</ul><h1 id="content">Oświadczenie majątkowe</h1>'
            f'<table class="pobierz pliki2">{files}</table>',
        ),
        "https://u1.pl/download/7060.pdf": (200, "application/pdf", PDF + b"1"),
        "https://u1.pl/download/6159.pdf": (200, "application/pdf", PDF + b"2"),
    }
    _, store, _, _ = search(
        tmp_path, sites, [row("s", "u1", "Zbigniew", "SZALENIEC")], sitemaps=False
    )
    assert store.outcomes["s"].status == "found"
    assert {d.url for d in store.person_docs("s")} == {
        "https://u1.pl/download/7060.pdf",
        "https://u1.pl/download/6159.pdf",
    }
