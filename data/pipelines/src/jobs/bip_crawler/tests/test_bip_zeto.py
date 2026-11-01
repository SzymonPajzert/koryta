"""ZETO-RZESZÓW's BIPs: attachments that are files, print and font toggles that
are the page itself, and a breadcrumb that says what a page holds."""

from __future__ import annotations

from jobs.bip_crawler.tests.test_people_mode_review import PDF, html, row, search
from jobs.bip_crawler.zeto import trail
from scrapers.bip.classify import is_document_url, is_low_value_url, normalize_url

HOST = "https://u1.pl"
LOCATOR = (
    '<ul id="trescLokator"><li><a href="./">Strona główna</a></li>'
    '<li><a href="./?c=mdTresc-cmPokaz-10">Oświadczenia majątkowe</a></li>'
    '<li><a href="./?c=mdTresc-cmPokaz-251">2025 rok</a></li>'
    '<li><a href="./?c=mdTresc-cmPokaz-262">Rada Powiatu</a></li></ul>'
)
TITLE = "Biuletyn Informacji Publicznej Starostwo Powiatowe w Tarnobrzegu"
FILES = f"{HOST}/fck_pliki/2026/OM_za_2025/rada"


def test_a_breadcrumb_says_where_a_page_stands() -> None:
    assert trail(LOCATOR.encode()) == (
        "Oświadczenia majątkowe > 2025 rok > Rada Powiatu"
    )
    assert trail('<ul id="menu"><li>Oświadczenia majątkowe</li></ul>'.encode()) == ""


def test_an_attachment_is_a_file_and_a_print_or_font_toggle_the_page() -> None:
    page = "https://bip.domaradz.pl/?c=mdTresc-cmPokaz-506"
    assert is_document_url(
        "https://bip.domaradz.pl/?c=mdPliki-cmPobierz-6977-TWFyY2luIFRhcmFidcWCYS5wZGY="
    )
    assert normalize_url(page + "&printtype=pdf") == normalize_url(page)
    assert normalize_url("https://bip.domaradz.pl/?font_size=plus") == (
        "https://bip.domaradz.pl/"
    )
    assert is_low_value_url(page + "&printXML=true")
    assert is_low_value_url("https://bip.domaradz.pl/?c=mdRejestr-cmTresc-506")
    assert not is_low_value_url(page)


def test_a_page_its_breadcrumb_alone_calls_declarations_names_its_files(
    tmp_path,
) -> None:
    # Tarnobrzeski: "plik w formacie pdf" in a row naming the councillor, the
    # page titled with the office's name alone.
    body = LOCATOR + (
        "<table><tr><td>Gruszka Wojciech</td>"
        f'<td><a href="{FILES}/W_Gruszka_za_2025.pdf">plik w formacie pdf</a></td>'
        "</tr><tr><td>Kowalska Anna</td>"
        f'<td><a href="{FILES}/A_Kowalska_za_2025.pdf">plik w formacie pdf</a></td>'
        "</tr></table>"
    )
    sites = {
        HOST: html(TITLE, '<a href="/?c=mdTresc-cmPokaz-262">Rada Powiatu</a>'),
        f"{HOST}/?c=mdTresc-cmPokaz-262": html(TITLE, body),
        f"{FILES}/W_Gruszka_za_2025.pdf": (200, "application/pdf", PDF + b"g"),
        f"{FILES}/A_Kowalska_za_2025.pdf": (200, "application/pdf", PDF + b"k"),
    }
    _, store, web, _ = search(
        tmp_path,
        sites,
        [row("g", "u1", "Wojciech", "Gruszka"), row("n", "u1", "Jan", "Nowak")],
        sitemaps=False,
    )
    assert store.outcomes["g"].status == "found"
    # The title says nothing of declarations: Kowalska's file is nobody's
    # to hand to Nowak.
    assert store.outcomes["n"].status == "not_found"
    assert f"{FILES}/A_Kowalska_za_2025.pdf" not in web.calls


def test_an_attachment_comes_down_as_the_file_it_is(tmp_path) -> None:
    # Krościenko Wyżne: the page's "Załączniki:", each named by its councillor.
    attachment = "?c=mdPliki-cmPobierz-11451-Qm9yZWsgSmFuLnBkZg=="
    sites = {
        HOST: html(
            "BIP",
            '<a href="/?c=mdTresc-cmPokaz-1364">Oświadczenia majątkowe za 2024 rok</a>',
        ),
        f"{HOST}/?c=mdTresc-cmPokaz-1364": html(
            "Oświadczenia majątkowe za 2024 rok - Biuletyn Informacji Publicznej",
            "<h1>Załączniki:</h1>"
            f'<p><a href="./{attachment}">Borek Jan</a> 1.37 MB</p>',
        ),
        f"{HOST}/{attachment}": (200, "application/pdf", PDF + b"b"),
    }
    _, store, _, _ = search(
        tmp_path, sites, [row("b", "u1", "Jan", "Borek")], sitemaps=False
    )
    assert store.outcomes["b"].status == "found"


def test_a_breadcrumb_of_property_for_sale_makes_no_declarations(tmp_path) -> None:
    sale = LOCATOR.replace("Oświadczenia majątkowe", "Sprzedaż majątku")
    body = sale + (
        f'<p>Jan Nowak <a href="{FILES}/J_Nowak_wykaz.pdf">plik w formacie pdf</a></p>'
    )
    sites = {
        HOST: html(TITLE, '<a href="/?c=mdTresc-cmPokaz-262">Rada Powiatu</a>'),
        f"{HOST}/?c=mdTresc-cmPokaz-262": html(TITLE, body),
        f"{FILES}/J_Nowak_wykaz.pdf": (200, "application/pdf", PDF + b"n"),
    }
    _, store, _, _ = search(
        tmp_path, sites, [row("n", "u1", "Jan", "Nowak")], sitemaps=False
    )
    assert store.outcomes["n"].status == "not_found"
