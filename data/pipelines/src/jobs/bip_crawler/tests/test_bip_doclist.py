"""Zabrze's BIP: a document list a Vue component draws from JSON, each document
a page of its own under the person it is about."""

from __future__ import annotations

import json

from jobs.bip_crawler.doclist import attachments, links, lists
from jobs.bip_crawler.tests.test_people_mode_review import PDF, html, row, search
from scrapers.common.fetch import HttpResult

HOST = "https://u1.pl"
SOURCE = f"{HOST}/api/v1/document-list/636"


def component(source: str = SOURCE, title: str = "Skład Rady Miejskiej") -> str:
    config = json.dumps({"buttons": [], "title": title, "loadURL": source})
    return '<v-document-list :config="' + config.replace('"', "&quot;") + '">'


#: /api/v1/document-list/636, two of its 29 rows.
ROWS = {
    "data": [
        {
            "doc_id": 17843,
            "dscrpt": "Grzegorz Olejniczak",
            "dscrpa": "Przewodniczący RM",
            "visble": True,
        },
        {
            "doc_id": 17839,
            "dscrpt": "Janusz Bieniek",
            "dscrpa": "Radny RM",
            "visble": True,
        },
        {"doc_id": 1, "dscrpt": "Ukryty", "dscrpa": "", "visble": False},
    ]
}


def answer(body: object, status: int = 200) -> HttpResult:
    return HttpResult(SOURCE, status, "application/json", json.dumps(body).encode())


def test_a_lists_rows_are_links_under_their_subject() -> None:
    page = html("Skład Rady Miejskiej", component())[2]
    assert lists(page, f"{HOST}/rm/sklad_2024") == [(SOURCE, "Skład Rady Miejskiej")]
    asked: list[str] = []

    def get(url: str) -> HttpResult:
        asked.append(url)
        return answer(ROWS)

    first, second = links(page, f"{HOST}/rm/sklad_2024", get)
    assert asked == [SOURCE]
    assert first.url == f"{HOST}/doc/17843"
    assert first.anchor == "Grzegorz Olejniczak"
    assert first.row == "Grzegorz Olejniczak | Przewodniczący RM"
    assert first.heading == "Skład Rady Miejskiej"
    assert second.url == f"{HOST}/doc/17839"


def test_a_list_that_does_not_answer_or_lies_elsewhere_gives_nothing() -> None:
    page = html("x", component())[2]
    assert links(page, f"{HOST}/rm", lambda url: "robots") == []
    assert links(page, f"{HOST}/rm", lambda url: answer({}, 500)) == []
    elsewhere = html("x", component("https://other.pl/api/v1/document-list/1"))[2]
    assert links(elsewhere, f"{HOST}/rm", lambda url: answer(ROWS)) == []
    assert (
        links(b"<html><body>no list</body></html>", HOST, lambda url: answer(ROWS))
        == []
    )


def test_the_walk_reaches_a_councillors_files_through_the_list(tmp_path) -> None:
    sites = {
        HOST: html("BIP", '<a href="/rm/sklad_2024">Skład Rady Miejskiej</a>'),
        f"{HOST}/rm/sklad_2024": html("Skład Rady Miejskiej", component()),
        SOURCE: (200, "application/json", json.dumps(ROWS).encode()),
        f"{HOST}/doc/17839": html(
            "Janusz Bieniek - BIP Urzędu Miejskiego w Zabrzu",
            '<a href="/attachment/101871">Oświadczenie majątkowe za rok 2024</a>'
            '<a href="/attachment/101873">Informacja o danych osobowych</a>',
        ),
        f"{HOST}/attachment/101871": (200, "application/pdf", PDF + b"1"),
        f"{HOST}/attachment/101873": (200, "application/pdf", PDF + b"2"),
    }
    _, store, _, _ = search(
        tmp_path, sites, [row("b", "u1", "Janusz", "Bieniek")], sitemaps=False
    )
    assert store.outcomes["b"].status == "found"
    assert {d.url for d in store.person_docs("b") if d.status == "ok"} == {
        f"{HOST}/attachment/101871"
    }


def card(ident: int, label: str) -> str:
    return (
        f'<div id="old{ident}" data-keyval="old{ident}" data-clsnam="ATTACHMENT">'
        f'<div class="flex"><div class="flex items-center">{label}</div>'
        f'<div><a href="/attachment/{ident}">Pobierz załącznik</a></div></div></div>'
    )


def test_a_documents_file_card_lends_its_link_the_label() -> None:
    page = html("Janusz Bieniek - BIP", card(101710, "Oświadczenie za rok 2025"))[2]
    rows = attachments(page, f"{HOST}/doc/17839")
    assert rows[f"{HOST}/attachment/101710"].startswith("Oświadczenie za rok 2025")
    assert attachments(b"<html><a href='/attachment/1'>x</a></html>", HOST) == {}


def test_the_walk_takes_a_card_labelled_file_as_a_declaration(tmp_path) -> None:
    sites = {
        HOST: html("BIP", f'<a href="{HOST}/doc/17839">Janusz Bieniek</a>'),
        f"{HOST}/doc/17839": html(
            "Janusz Bieniek - BIP Urzędu Miejskiego w Zabrzu",
            "<h3>Załączniki</h3>" + card(101710, "Oświadczenie majątkowe za rok 2025"),
        ),
        f"{HOST}/attachment/101710": (200, "application/pdf", PDF + b"1"),
    }
    _, store, _, _ = search(
        tmp_path, sites, [row("b", "u1", "Janusz", "Bieniek")], sitemaps=False
    )
    assert store.outcomes["b"].status == "found"
