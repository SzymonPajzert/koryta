"""SISCO eDc's BIPs: a page's attachments read through the call its script
makes for its empty table."""

from __future__ import annotations

import base64
import json
from typing import Any

from jobs.bip_crawler.sisco import ENGINE, attachments, form, tables, trail
from jobs.bip_crawler.tests.test_people_mode_review import PDF, html, row, search
from scrapers.bip.people import Seeker, candidates
from scrapers.common.fetch import HttpResult, Payload

HOST = "https://u1.pl"
FILES = f"{HOST}/uploaded_files/serwis_files/attachments/bip/1569"
CONFIG = {
    "typeOfUse": "websiteFileList",
    "tableHeaderArr": [{"data": "Lp"}, {"data": "Nazwa"}, {"data": "Opis"}],
    "stateSave": True,
    "pageData": {"pageId": "1569", "pageUrl": None},
    "sqlData": {"uid": "1569", "name": "bipzalaczniki"},
    "extraData": {"lngStr": "pl", "listTyp": "bipAttachments"},
}
#: The page's other table, its child pages.
CHILDREN = {"typeOfUse": "websitePageChildLinkList", "tableHeaderArr": []}


def script(table: str, config: dict[str, Any]) -> str:
    packed = base64.b64encode(json.dumps({"dataTableCfg": config}).encode()).decode()
    return f'<script>$("#{table}").edDatatables("{packed}");</script>'


def page(*sections: str) -> str:
    """Brzeg's year page: the breadcrumb, the empty tables and their script."""
    items = "".join(
        f'<li><a href="/d,{i}">{s}</a></li>' for i, s in enumerate(sections)
    )
    return (
        f'<ol class="breadcrumb"><li><a href="/">Strona domowa</a></li>{items}</ol>'
        '<table id="pageChildLinkList-5"></table><table id="fileList-1569"></table>'
        + script("pageChildLinkList-5", CHILDREN)
        + script("fileList-1569", CONFIG)
    )


COUNCIL = (
    "Dokumenty BIP",
    "Rada Miejska Brzegu",
    "oświadczenia majątkowe radnych",
    "kadencja 2024-2029",
    "rok 2024",
)
TITLE = "Gmina Brzeg - Biuletyn Informacji PublicznejDokumenty BIP"


def answer(*files: tuple[str, str, str | None]) -> bytes:
    data = [
        {
            "Lp": str(i),
            "Nazwa": f'<a href="/uploaded_files/serwis_files/attachments/bip/1569/'
            f'{name}" title="{label}" download="{label}.pdf">{label}</a>',
            "Opis": about,
        }
        for i, (name, label, about) in enumerate(files, 1)
    ]
    body = {"draw": 0, "recordsTotal": len(data), "data": data}
    return b"\xef\xbb\xbf" + json.dumps(body).encode()


ROWS = answer(
    ("e7552c96bad2d725.pdf", "Andrzej Witkowski", None),
    ("f05175e3f6c77985.pdf", "Bożena Szczęsna", "Oświadczenie majątkowe za 2023 r."),
)


class Engine:
    def __init__(self, body: bytes = ROWS, status: int = 200) -> None:
        self.body, self.status = body, status
        self.calls: list[tuple[str, Payload]] = []

    def post(
        self, url: str, payload: Payload, timeout: float = 15.0, ua: str = ""
    ) -> HttpResult:
        self.calls.append((url, payload))
        return HttpResult(url, self.status, "text/html; charset=UTF-8", self.body)


def fetched(content: str, url: str = f"{HOST}/dokumenty,5_1569") -> HttpResult:
    return HttpResult(url, 200, "text/html", content.encode())


def test_a_tables_configuration_comes_out_of_its_script() -> None:
    content = page(*COUNCIL).encode()
    assert tables(content) == [("fileList-1569", CONFIG)]
    assert trail(content) == list(COUNCIL)
    assert tables(b"<html><table id='fileList-1'></table></html>") == []


def test_the_call_sends_the_pages_own_configuration() -> None:
    fields = form("fileList-1569", CONFIG)
    for field in (
        ("draw", "1"),
        ("columns[1][data]", "Nazwa"),
        ("columns[1][search][regex]", "false"),
        ("start", "0"),
        ("length", "-1"),
        ("uniqueID", "fileList-1569"),
        ("options[tableHeaderArr][2][data]", "Opis"),
        ("options[stateSave]", "true"),
        ("options[pageData][pageUrl]", ""),
        ("options[sqlData][name]", "bipzalaczniki"),
        ("srv_inc", "1"),
    ):
        assert field in fields, field


def test_a_declarations_pages_rows_become_its_files() -> None:
    engine = Engine()
    links = attachments(fetched(page(*COUNCIL)), TITLE, engine.post)
    assert links is not None
    ((url, sent),) = engine.calls
    assert url == HOST + ENGINE and sent == form("fileList-1569", CONFIG)
    first, second = links
    assert first.url == f"{FILES}/e7552c96bad2d725.pdf"
    assert (first.anchor, first.row) == ("Andrzej Witkowski", "Andrzej Witkowski")
    assert second.row == "Bożena Szczęsna Oświadczenie majątkowe za 2023 r."
    assert first.heading == (
        "Rada Miejska Brzegu > oświadczenia majątkowe radnych > kadencja 2024-2029"
        " > rok 2024"
    )
    witkowski = Seeker.of("w", "Andrzej", "Witkowski")
    (found,) = candidates(f"{HOST}/dokumenty,5_1569", TITLE, links, [witkowski])
    assert found.key == "w" and found.first_name and found.declaration_like


def test_a_page_of_property_for_sale_is_not_asked() -> None:
    # Kaliska: "Sprzedaż majątku" lists sale and lease notices.
    engine = Engine()
    sale = page("Dokumenty BIP", "Sprzedaż majątku", "2025")
    assert attachments(fetched(sale), TITLE, engine.post) is None
    assert engine.calls == []
    assert attachments(fetched("<html>no tables</html>"), TITLE, engine.post) is None


def test_a_call_that_gives_no_rows_gives_no_files() -> None:
    for engine in (Engine(status=500), Engine(b"<html>Access denied.</html>")):
        assert attachments(fetched(page(*COUNCIL)), TITLE, engine.post) == []
    robots = attachments(fetched(page(*COUNCIL)), TITLE, lambda url, sent: "robots")
    assert robots == []


def test_the_walk_reads_a_declarations_pages_attachments(tmp_path) -> None:
    file = (
        f"{HOST}/uploaded_files/serwis_files/attachments/bip/1569/e7552c96bad2d725.pdf"
    )
    sites = {
        HOST: html(TITLE, '<a href="/dokumenty,5_1569">Rok 2024</a>'),
        f"{HOST}/dokumenty,5_1569": html(TITLE, page(*COUNCIL)),
        file: (200, "application/pdf", PDF + b"w"),
    }
    engine = Engine()
    _, store, _, _ = search(
        tmp_path,
        sites,
        [row("w", "u1", "Andrzej", "Witkowski")],
        post=engine.post,
        sitemaps=False,
    )
    assert store.outcomes["w"].status == "found"
    (doc,) = store.person_docs("w")
    assert doc.url == file and doc.page_url == f"{HOST}/dokumenty,5_1569"
    assert len(engine.calls) == 1
    assert store.units["u1"].declaration_pages == 1
