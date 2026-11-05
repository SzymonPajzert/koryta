"""Poznań's councillors: a page each, the name in a field, the files under
"Oświadczenia majątkowe" labelled "Pobierz dokument (PDF)"."""

from __future__ import annotations

from jobs.bip_crawler.person_page import name
from jobs.bip_crawler.tests.test_people_mode_review import (
    PDF,
    Web,
    html,
    row,
    search,
)
from scrapers.bip.people import Seeker, candidates, is_file_link
from scrapers.common.fetch import HttpResult
from scrapers.common.links import LinkContext

HOST = "https://u1.pl"
FILES = f"{HOST}/public/bip/zalaczniki.html?co=show&amp;lz_id="


def card(person: str) -> str:
    return (
        "<h3>Kadencja Rady Miasta Poznania</h3><p>2024-2029</p>"
        f'<div class="row"><img src="/x.jpg" alt="{person}" />'
        f"<div><h3>Imię, nazwisko</h3><p>\n{person}\n</p>"
        "<h3>Kontakt</h3><p>Tel. 600 000 000</p></div></div>"
    )


def files(*idents: int) -> str:
    return (
        "<h3>Oświadczenia majątkowe</h3><ul>"
        + "".join(
            f"<li>Oświadczenie majątkowe za {2022 + i} r. "
            f'<a href="{FILES}{ident}">Pobierz dokument (PDF)</a></li>'
            for i, ident in enumerate(idents)
        )
        + "</ul>"
    )


def test_the_one_name_field_is_the_pages_person() -> None:
    page = html("Radny/Radna Miasta Poznania", card("Przemysław Alexandrowicz"))[2]
    assert name(page) == "Przemysław Alexandrowicz"
    assert name(
        html("x", "<dl><dt>Imię i nazwisko:</dt><dd>Anna Nowak</dd></dl>")[2]
    ) == ("Anna Nowak")
    # A list of people is nobody's page; a page without the field neither.
    both = card("Anna Nowak") + card("Jan Kowalski")
    assert name(html("Radni", both)[2]) == ""
    assert name(html("Radni", "<h3>Kontakt</h3><p>Anna Nowak</p>")[2]) == ""
    long = "<h3>Imię, nazwisko</h3><p>" + "słowo " * 12 + "</p>"
    assert name(html("x", long)[2]) == ""


def test_poznans_attachment_is_a_file() -> None:
    assert is_file_link(f"{HOST}/public/bip/zalaczniki.html?co=show&lz_id=12017")
    assert not is_file_link(f"{HOST}/public/bip/zalaczniki.html?co=list")


def test_the_walk_takes_a_councillors_files_from_his_page(tmp_path) -> None:
    person = f"{HOST}/bip/radni/przemyslaw-alexandrowicz,20273/"
    other = f"{HOST}/bip/radni/anna-nowak,20274/"
    sites = {
        HOST: html(
            "Radni Miasta Poznania",
            f'<a href="{person}">Przemysław Alexandrowicz</a>'
            f'<a href="{other}">Anna Nowak</a>',
        ),
        person: html(
            "Radny/Radna Miasta Poznania",
            card("Przemysław Alexandrowicz") + files(12017, 13939),
        ),
        other: html("Radny/Radna Miasta Poznania", card("Anna Nowak") + files(9)),
        f"{HOST}/public/bip/zalaczniki.html?co=show&lz_id=12017": (
            200,
            "application/pdf",
            PDF + b"1",
        ),
        f"{HOST}/public/bip/zalaczniki.html?co=show&lz_id=13939": (
            200,
            "application/pdf",
            PDF + b"2",
        ),
        f"{HOST}/public/bip/zalaczniki.html?co=show&lz_id=9": (
            200,
            "application/pdf",
            PDF + b"3",
        ),
    }
    _, store, _, _ = search(
        tmp_path,
        sites,
        [row("a", "u1", "Przemysław", "Alexandrowicz")],
        sitemaps=False,
    )
    assert store.outcomes["a"].status == "found"
    assert {d.url for d in store.person_docs("a") if d.status == "ok"} == {
        f"{HOST}/public/bip/zalaczniki.html?co=show&lz_id=12017",
        f"{HOST}/public/bip/zalaczniki.html?co=show&lz_id=13939",
    }


class SlashWeb(Web):
    """Poznań's server: a councillor's address without its final slash is the
    councillors' list."""

    def __init__(self, sites, lists_at: dict[str, str]) -> None:
        super().__init__(sites)
        self.lists_at = lists_at

    def fetch(self, url: str, timeout: float, user_agent: str) -> HttpResult:
        if url in self.lists_at:
            self.calls.append(url)
            return super().fetch(self.lists_at[url], timeout, user_agent)
        return super().fetch(url, timeout, user_agent)


def test_a_page_is_asked_for_with_the_final_slash_it_was_linked_with(tmp_path):
    person = f"{HOST}/bip/radni/przemyslaw-alexandrowicz,20273/"
    pdf = f"{HOST}/public/bip/zalaczniki.html?co=show&lz_id=12017"
    listing = html(
        "Radni Miasta Poznania", f'<a href="{person}">Przemysław Alexandrowicz</a>'
    )
    sites = {
        HOST: listing,
        person: html(
            "Radny/Radna Miasta Poznania",
            card("Przemysław Alexandrowicz") + files(12017),
        ),
        pdf: (200, "application/pdf", PDF + b"1"),
    }
    web = SlashWeb(sites, {person.rstrip("/"): HOST})
    _, store, web, _ = search(
        tmp_path,
        sites,
        [row("a", "u1", "Przemysław", "Alexandrowicz")],
        web=web,
        sitemaps=False,
    )
    assert person in web.calls
    assert person.rstrip("/") not in web.calls
    assert store.outcomes["a"].status == "found"


#: Tychy's councillor page: the name split in a table, the BIP's own title.
TYCHY = (
    "<h1>Oświadczenia majątkowe </h1><table><thead><tr><th colspan='2'>"
    "Oświadczenie majątkowe</th></tr></thead><tr><th>Imię</th><td> Maciej</td></tr>"
    "<tr><th>Nazwisko</th><td> Blada</td></tr>"
    "<tr><th>Pełniona funkcja</th><td> Radny Miasta Tychy</td></tr>"
    "<tr><th>Załączniki</th><td><ul><li><div><span>oświadczenie majątkowe za rok"
    " 2025</span><span> [ <a"
    " href='/index.php?action=PobierzPlik&amp;d=1&amp;id=514193'>"
    " Pobierz</a> ]</span></div></li></ul></td></tr></table>"
)


def test_a_name_split_in_first_and_last_fields_is_the_pages_person() -> None:
    assert name(html("BIP Urzędu Miasta Tychy", TYCHY)[2]) == "Maciej Blada"
    assert is_file_link(f"{HOST}/index.php?action=PobierzPlik&d=1&id=514193")
    assert not is_file_link(f"{HOST}/index.php?action=PobierzPliki")
    # Olsztyn's attachments read as pages by their address.
    sha = "e586bedfb9decf57268a6aae91bb1b1b5c7cb5c9"
    assert is_file_link(f"{HOST}/attachment/informacja/23871/{sha}.html")
    assert not is_file_link(f"{HOST}/806/klonowski-pawel-radny-rady-miasta.html")
    assert is_file_link(f"{HOST}/downloadFile/16799")  # powiat przeworski


def test_the_walk_takes_tychys_file_under_the_split_name(tmp_path) -> None:
    person = f"{HOST}/oswiadczenia-majatkowe/12491"
    sites = {
        HOST: html("BIP", f'<a href="{person}">Blada Maciej - Radny Miasta Tychy</a>'),
        person: html("Biuletyn Informacji Publicznej Urzędu Miasta Tychy", TYCHY),
        f"{HOST}/index.php?action=PobierzPlik&d=1&id=514193": (
            200,
            "application/pdf",
            PDF + b"1",
        ),
    }
    _, store, _, _ = search(
        tmp_path, sites, [row("b", "u1", "Maciej", "Blada")], sitemaps=False
    )
    assert store.outcomes["b"].status == "found"


def test_a_folder_named_like_a_form_does_not_make_a_declaration_one() -> None:
    sha = "e586bedfb9decf57268a6aae91bb1b1b5c7cb5c9"
    seekers = [Seeker.of("k", "Paweł", "Klonowski")]
    declaration = LinkContext(
        f"{HOST}/attachment/informacja/23871/{sha}.html",
        "Oświadczenie majatkowe za 2025 rok Klonowski Paweł",
    )
    form = LinkContext(f"{HOST}/pliki/wzor_oswiadczenia.pdf", "Pobierz Klonowski Paweł")
    found = candidates(
        f"{HOST}/806/x.html", "Klonowski Paweł", [declaration, form], seekers
    )
    assert [c.url for c in found] == [declaration.url]
