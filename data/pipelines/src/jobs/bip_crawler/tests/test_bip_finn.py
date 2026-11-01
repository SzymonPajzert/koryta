"""FINN's BIPs: the councils' declarations read from the e-Urząd registers
their pages embed, over the app's own JSON-RPC calls."""

from __future__ import annotations

import json
import logging
from typing import Any

import pytest

from jobs.bip_crawler.finn import FILES, MAX_PAGES, Eurzad, clients
from jobs.bip_crawler.tests.test_people_mode_review import PDF, Web, html, row, search
from scrapers.bip.people import UNNAMED_ENTRIES, Seeker, candidates, office_terms
from scrapers.common.fetch import HttpResult

CLIENT = "pzwodzislawsl"
APP = f"https://eurzad.finn.pl/{CLIENT}"
COUNCIL = {"symbol": "WOZ.2124R", "nazwa": "Rejestr oświadczeń majątkowych radnych"}
STAFF = {
    "symbol": "WOZ.2124P",
    "nazwa": "Rejestr oświadczeń majątkowych pracowników starostwa",
}
#: The register page of bip.powiatwodzislawski.pl, its iframe as FINN writes it.
IFRAME = (
    '<iframe id="embeddedIframe" src="https&#x3a;&#x2f;&#x2f;eurzad&#x2e;finn'
    "&#x2e;pl&#x2f;pzwodzislawsl&#x2f;&#x23;&#x21;&#x2f;rejestry&#x2f;WOZ.2124R"
    '&#x2f;10&#x2f;1&#x2f;default&#x2f;_"></iframe>'
)


def record(ident: int, subject: str, year: int = 2025, **extra: Any) -> dict:
    return {
        "id": ident,
        "temat": subject,
        "dataW": f"{year}-06-01T00:00:00.000",
        "aktZal": 1,
        **extra,
    }


class App:
    """e-Urząd for one client: its registers, their records, the records' files
    (each record one, named by its subject unless ``files`` says otherwise)."""

    def __init__(
        self,
        registers: list[dict],
        records: dict[str, list[dict]],
        files: dict[int, list[dict]] | None = None,
        pages: int = 1,
    ) -> None:
        self.registers = registers
        self.records = records
        self.files = files or {}
        self.pages = pages
        self.calls: list[tuple[int, list[str]]] = []

    def post(
        self, url: str, payload: dict[str, Any], timeout: float = 15.0, ua: str = ""
    ) -> HttpResult:
        route = int(url.rsplit("routeRejestryServiceManager", 1)[1])
        assert url.startswith(APP + "/rpc/")
        assert payload["method"] == f"/rpc/routeRejestryServiceManager{route}"
        params = payload["params"]
        self.calls.append((route, params))
        result: Any
        if route == 0:
            result = self.registers
        elif route == 1:
            symbol, page = json.loads(params[0]), int(params[2])
            mine = self.records.get(symbol, [])
            half = (len(mine) + 1) // 2 if self.pages == 2 else len(mine)
            lista = mine[:half] if page == 1 else mine[half:]
            result = {"lista": lista, "liczbaStron": self.pages}
        else:
            ident = int(params[0])
            subject = next(
                r["temat"]
                for rs in self.records.values()
                for r in rs
                if r["id"] == ident
            )
            names = self.files.get(
                ident, [{"id": ident * 10, "nazwa": subject + ".pdf"}]
            )
            result = {"id": ident, "temat": subject, "zalaczniki": names}
        body = json.dumps({"id": 1, "result": json.dumps(result)}).encode()
        return HttpResult(url, 200, "application/json", body)

    def opened(self) -> list[int]:
        return [int(params[0]) for route, params in self.calls if route == 2]


def read(app: App, seekers: list[Seeker], prefer=None, first_names=frozenset()) -> list:
    eurzad = Eurzad(app.post)
    return eurzad.registers(CLIENT, seekers, prefer, first_names, per_person=3)


WALA = Seeker.of("wala", "Robert", "Wala")
PIOTROWSKA = Seeker.of("piotrowska", "Anna", "Piotrowska")


def test_a_page_names_its_clients_however_it_spells_their_address() -> None:
    assert clients(IFRAME.encode(), "https://bip.powiatwodzislawski.pl/rejestr") == [
        CLIENT
    ]
    linked = b'<a href="https://eurzad.finn.pl/pzkalisz/?color=red#!/rejestry">x</a>'
    assert clients(linked, "https://bip.x.pl") == ["pzkalisz"]
    assert clients(b"<html>e-Urz\xc4\x85d</html>", "https://bip.x.pl") == []
    assert clients(b"", "https://eurzad.finn.pl/gmradomsko/#!/rejestry") == [
        "gmradomsko"
    ]


def test_only_the_registers_of_asset_declarations_are_read() -> None:
    registers = [
        {"symbol": "RURP", "nazwa": "Uchwały Rady Powiatu"},
        COUNCIL,
        STAFF,
        {"symbol": "Ooskz", "nazwa": "Oświadczenia o stanie kontroli zarządczej"},
    ]
    app = App(registers, {})
    eurzad = Eurzad(app.post)
    assert eurzad.declarations(CLIENT) == [COUNCIL, STAFF]
    assert eurzad.declarations(CLIENT) == [COUNCIL, STAFF]
    assert app.calls == [(0, [])]


def test_an_app_that_does_not_answer_is_asked_again_by_a_later_walk() -> None:
    answers = [HttpResult(APP, 503, "", b""), HttpResult(APP, 200, "", b"{")]
    eurzad = Eurzad(lambda url, payload: answers.pop(0) if answers else "robots")
    assert eurzad.declarations(CLIENT) is None
    assert eurzad.declarations(CLIENT) is None  # not JSON
    assert eurzad.registers(CLIENT, [WALA]) == []  # robots.txt
    assert answers == []


def test_a_register_is_read_page_by_page_newest_first() -> None:
    records = [
        record(1, "Robert Wala - oświadczenie majątkowe za 2023 r.", 2024),
        record(2, "Robert Wala - oświadczenie majątkowe za 2024 r.", 2025),
        record(3, "Robert Wala - korekta", 2026, aktZal=0),
        record(4, "Robert Wala - oświadczenie majątkowe za 2025 r.", 2026),
    ]
    app = App([COUNCIL], {COUNCIL["symbol"]: records}, pages=2)
    eurzad = Eurzad(app.post)
    assert [r["id"] for r in eurzad.records(CLIENT, COUNCIL["symbol"])] == [4, 2, 1]
    assert app.calls == [
        (1, ['"WOZ.2124R"', "1000", "1", '"DEFAULT"', "{}"]),
        (1, ['"WOZ.2124R"', "1000", "2", '"DEFAULT"', "{}"]),
    ]


def test_a_register_of_ever_more_pages_is_read_so_far() -> None:
    asked: list[str] = []

    def post(url: str, payload: dict[str, Any]) -> HttpResult:
        asked.append(payload["params"][2])
        result = {"lista": [record(len(asked), "Wala")], "liczbaStron": 99}
        body = json.dumps({"id": 1, "result": json.dumps(result)}).encode()
        return HttpResult(url, 200, "application/json", body)

    assert len(Eurzad(post).records(CLIENT, "X")) == MAX_PAGES
    assert asked == [str(page) for page in range(1, MAX_PAGES + 1)]


def test_a_seekers_newest_three_records_are_opened() -> None:
    records = [
        record(year, f"Robert Wala - oświadczenie majątkowe za {year} r.", year)
        for year in range(2020, 2026)
    ] + [record(30, "Oświadczenie majątkowe za 2025 rok radnej Anny Piotrowskiej.")]
    app = App([COUNCIL], {COUNCIL["symbol"]: records})
    (register,) = read(app, [WALA, PIOTROWSKA])
    assert sorted(app.opened()) == [30, 2023, 2024, 2025]
    assert register.name == COUNCIL["nazwa"]
    assert register.url == f"{APP}/#!/rejestry/WOZ.2124R/10/1/default/_"
    link = next(x for x in register.links if x.row.endswith("Piotrowskiej."))
    assert link.url == f"{APP}/server/pobierz_rejestry_zalacznik/300"
    found = candidates(register.url, register.name, list(register.links), [PIOTROWSKA])
    assert [(c.key, c.first_name, c.declaration_like) for c in found] == [
        ("piotrowska", True, True)
    ]


def test_the_councils_registers_come_before_the_staffs() -> None:
    council = [
        record(100 + i, f"Robert Wala - radny - oświadczenie za {y} r.", y)
        for i, y in enumerate((2022, 2023, 2024))
    ]
    staff = [
        record(9, "Robert Wala - dyrektor szkoły - oświadczenie za 2025 r.", 2026),
        record(8, "Oświadczenie majątkowe Starosty Mariusza Adamczyka", 2026),
    ]
    app = App([STAFF, COUNCIL], {"WOZ.2124R": council, "WOZ.2124P": staff})
    starosta = Seeker.of("starosta", "Mariusz", "Adamczyk")
    read(app, [WALA, starosta], office_terms(["Rada powiatu", "Starosta"]))
    # The councillor's three are the council's; the starosta stands among the
    # staff, named in full.
    assert sorted(app.opened()) == [8, 100, 101, 102]


def test_two_terms_registers_are_read_newest_first_as_one() -> None:
    old = {"symbol": "ROR", "nazwa": "Rejestr oświadczeń majatkowych radnych 2018-2023"}
    new = {
        "symbol": "RORVII",
        "nazwa": "Rejestr oświadczeń majątkowych radnych 2024-2029",
    }
    records = {
        "ROR": [
            record(y, f"Robert Wala - oświadczenie za {y} r.", y)
            for y in (2019, 2020, 2021)
        ],
        "RORVII": [
            record(y, f"Robert Wala - oświadczenie za {y} r.", y) for y in (2024, 2025)
        ],
    }
    app = App([old, new], records)
    read(app, [WALA], office_terms(["Rada powiatu"]))
    assert sorted(app.opened()) == [2021, 2024, 2025]


def test_a_surname_alone_is_read_in_the_councils_registers_for_whom_nothing_names() -> (
    None
):
    kowalczyk = Seeker.of("kowalczyk", "Jan", "Kowalczyk")
    zajac = Seeker.of("zajac", "Piotr", "Zając")
    council = [
        record(1, "Robert Wala - oświadczenie majątkowe za 2025 r."),
        record(2, "Wala - korekta oświadczenia", 2026),
        record(3, "Oświadczenie majątkowe - Kowalczyk"),
    ]
    staff = [record(4, "Zając - oświadczenie majątkowe za 2025 r.")]
    app = App([COUNCIL, STAFF], {"WOZ.2124R": council, "WOZ.2124P": staff})
    read(app, [WALA, kowalczyk, zajac], office_terms(["Rada powiatu"]))
    # Wala's first name is in a subject; Kowalczyk's surname alone, in the
    # council's register; Zając's surname alone among the staff is as likely
    # a namesake's.
    assert sorted(app.opened()) == [1, 3]


def test_a_namesakes_record_is_left_closed() -> None:
    # Robert Wala of the 2024 council is not Eugeniusz of the 2014 one; a
    # subject with the surname alone may be either.
    eugeniusz = Seeker.of("ewala", "Eugeniusz", "Wala")
    council = [
        record(
            1, "Robert Wala - Radny Powiatu Wodzisławskiego - oświadczenie majątkowe"
        ),
        record(2, "Wala - oświadczenie majątkowe za 2018 r.", 2019),
        record(3, "Oświadczenie majątkowe za rok 2020 - Wala M.", 2021),
    ]
    app = App([COUNCIL], {"WOZ.2124R": council})
    first_names = frozenset({"robert", "eugeniusz"})
    read(app, [eugeniusz], office_terms(["Rada powiatu"]), first_names)
    assert app.opened() == [2]


def test_a_few_records_that_name_nobody_are_read_in_the_councils_registers() -> None:
    nobody = "Oświadczenie majątkowe na zakończenie V kadencji Rady Powiatu"
    council = [record(i, nobody, 2018) for i in range(1, UNNAMED_ENTRIES + 3)] + [
        record(50, "Oświadczenie o stanie majątkowym za 2023 r. - Jacek Jarco")
    ]
    staff = [record(60, "Oświadczenie majątkowe pracownika", 2026)]
    names = {i: [{"id": i * 10, "nazwa": f"skan{i}.pdf"}] for i in range(1, 9)}
    app = App([COUNCIL, STAFF], {"WOZ.2124R": council, "WOZ.2124P": staff}, names)
    (register, _) = read(app, [WALA], office_terms(["Rada powiatu"]))
    assert len(app.opened()) == UNNAMED_ENTRIES
    assert 50 not in app.opened() and 60 not in app.opened()
    # Files that name nobody, on a declarations register: the OCR step's.
    found = candidates(register.url, register.name, list(register.links), [WALA])
    assert {c.key for c in found} == {""}


def test_without_the_seekers_offices_a_register_of_councillors_is_the_councils() -> (
    None
):
    staff = {"symbol": "OM-UM", "nazwa": "Oświadczenia majątkowe pracowników UM"}
    app = App(
        [staff, COUNCIL],
        {
            "OM-UM": [record(1, "Wala - oświadczenie majątkowe")],
            "WOZ.2124R": [record(2, "Wala - oświadczenie majątkowe", 2024)],
        },
    )
    read(app, [WALA])
    assert app.opened() == [2]


# -- the walk ------------------------------------------------------------------
STORE = "https://res.finn.pl/eurzad/447/1/1113346/oswiadczenie.pdf"


class Finn(Web):
    """A FINN BIP and e-Urząd: a file's address answers 303 to the store."""

    def fetch(self, url: str, timeout: float, user_agent: str) -> HttpResult:
        if "/server/pobierz_rejestry_zalacznik/" in url:
            self.calls.append(url)
            return HttpResult(url, 303, "", b"", location=STORE)
        return super().fetch(url, timeout, user_agent)


def bip(app_link: str = "") -> dict:
    return {
        "https://u1.pl": html(
            "BIP Starostwo Powiatowe",
            '<a href="/rejestr">Rejestr oświadczeń majątkowych radnych</a>' + app_link,
        ),
        "https://u1.pl/rejestr": html(
            "Rejestr oświadczeń majątkowych radnych Powiatu - BIP", IFRAME
        ),
        STORE: (200, "binary/octet-stream", PDF + b"wala"),
    }


def councillors() -> App:
    return App(
        [COUNCIL],
        {
            "WOZ.2124R": [
                record(
                    1113346,
                    "Robert Wala - Radny Powiatu Wodzisławskiego - "
                    "oświadczenie majątkowe za 2025 r.",
                )
            ]
        },
        {
            1113346: [
                {"id": 1230681, "nazwa": "oświadczenie majątkowe radny Robert Wala.pdf"}
            ]
        },
    )


def test_the_walk_finds_a_councillor_in_the_register_its_page_embeds(tmp_path) -> None:
    app = councillors()
    # The start page links the app too: its registers are read once a walk.
    menu = f'<a href="{APP}/#!/">e-Urząd</a>'
    _, store, web, _ = search(
        tmp_path,
        {},
        [row("wala", "u1", "Robert", "Wala")],
        web=Finn(bip(menu)),
        post=app.post,
        sitemaps=False,
    )
    assert store.people["wala"].status == "found"
    (doc,) = store.person_docs("wala")
    assert doc.status == "ok"
    assert doc.url == f"{APP}/server/pobierz_rejestry_zalacznik/1230681"
    assert doc.page_url == f"{APP}/#!/rejestry/WOZ.2124R/10/1/default/_"
    assert [route for route, _ in app.calls] == [0, 1, 2]
    assert STORE in web.calls
    # The register page, and the register it embeds: once, though two pages
    # name the app.
    assert store.units["u1"].declaration_pages == 2


class Busy(App):
    """An app that answers "not now" to its first ``times`` calls."""

    def __init__(self, *args: Any, times: int = 1) -> None:
        super().__init__(*args)
        self.times = times

    def post(
        self, url: str, payload: dict[str, Any], timeout: float = 15.0, ua: str = ""
    ) -> HttpResult:
        if self.times > 0:
            self.times -= 1
            self.calls.append((-1, payload["params"]))
            return HttpResult(url, 429, "text/html", b"busy")
        return super().post(url, payload, timeout, ua)


def test_an_app_that_says_not_now_is_asked_again(tmp_path) -> None:
    app = councillors()
    busy = Busy(app.registers, app.records, app.files)
    _, store, _, _ = search(
        tmp_path,
        {},
        [row("wala", "u1", "Robert", "Wala")],
        web=Finn(bip()),
        post=busy.post,
        sitemaps=False,
    )
    assert store.people["wala"].status == "found"
    assert [route for route, _ in busy.calls] == [-1, 0, 1, 2]


def test_robots_txt_is_asked_about_the_apps_calls(tmp_path) -> None:
    app = councillors()
    _, store, _, _ = search(
        tmp_path,
        {},
        [row("wala", "u1", "Robert", "Wala")],
        web=Finn(bip()),
        post=app.post,
        robots=lambda url: not url.startswith("https://eurzad.finn.pl/"),
        sitemaps=False,
    )
    assert app.calls == []
    assert store.people["wala"].status == "not_found"


def test_no_register_is_read_while_robots_txt_keeps_the_crawler_from_the_files(
    tmp_path, caplog: pytest.LogCaptureFixture
) -> None:
    app = councillors()
    caplog.set_level(logging.WARNING)
    _, store, _, _ = search(
        tmp_path,
        {},
        [row("wala", "u1", "Robert", "Wala"), row("lis", "u2", "Ewa", "Lis")],
        web=Finn({**bip(), **{u.replace("u1", "u2"): v for u, v in bip().items()}}),
        post=app.post,
        robots=lambda url: not url.startswith("https://res.finn.pl/"),
        sitemaps=False,
    )
    assert app.calls == []
    assert store.people["wala"].status == "not_found"
    said = [r for r in caplog.records if "e-Urząd's files" in r.getMessage()]
    assert len(said) == 1
    assert FILES.startswith("https://res.finn.pl/")
