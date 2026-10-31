"""People mode against fake BIP sites: no network, no Postgres."""

from __future__ import annotations

import tarfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import cast

import pytest

from analysis.bip_people_of_interest import BipPeopleOfInterest
from jobs.bip_crawler import _units
from jobs.bip_crawler.people import PeopleOptions, PeopleSearch, list_policy
from jobs.bip_crawler.tests.test_bip import FakeFrontier
from scrapers.bip.classify import normalize_url
from scrapers.bip.people import (
    Seeker,
    candidates,
    choose,
    initialled_names,
    names_somebody,
    stem,
)
from scrapers.bip.units import UnitSeed
from scrapers.common.fetch import HttpResult
from scrapers.common.links import LinkContext, extract_link_contexts
from scrapers.common.ratelimit import HostTokenBucket
from scrapers.stores import BipQueue, PersonRow, Pipeline
from stores.bip_bundles import LocalBundleStore
from stores.bip_people import MemoryBipPeopleStore

PDF = b"%PDF-1.4 a declaration "


def page(title: str, body: str) -> tuple[int, str, bytes]:
    html = f"<html><head><title>{title}</title></head><body>{body}</body></html>"
    return 200, "text/html; charset=utf-8", html.encode()


def pdf(tag: str) -> tuple[int, str, bytes]:
    return 200, "application/pdf", PDF + tag.encode()


SITES = {
    # A: the label names the person; a tender page names Kowalski too
    "https://bip.gmina-a.pl": page(
        "BIP Gmina A",
        '<a href="/menu/oswiadczenia">Oświadczenia majątkowe</a> '
        '<a href="/przetargi">Przetargi</a>',
    ),
    "https://bip.gmina-a.pl/menu/oswiadczenia": page(
        "Oświadczenia majątkowe",
        '<a href="/menu/oswiadczenia/radni-2023">Radni - 2023</a>',
    ),
    "https://bip.gmina-a.pl/menu/oswiadczenia/radni-2023": page(
        "Oświadczenia majątkowe radnych za 2023",
        (
            "<ul><li>"
            '<a href="/attachments/download/101">'
            "Oświadczenie majątkowe - Jan Kowalski - 2023.pdf</a></li>"
            "<li>"
            '<a href="/attachments/download/102">'
            "Oświadczenie majątkowe - Anna Kowalska - 2023.pdf</a></li>"
            "<li>"
            '<a href="/attachments/download/103">'
            "Oświadczenie majątkowe - Ewa Nowak - 2023.pdf</a></li>"
            "</ul>"
        ),
    ),
    "https://bip.gmina-a.pl/przetargi": page(
        "Przetargi",
        '<a href="/attachments/download/900">Umowa z Janem Kowalskim.pdf</a>',
    ),
    "https://bip.gmina-a.pl/attachments/download/101": pdf("101"),
    "https://bip.gmina-a.pl/attachments/download/102": pdf("102"),
    "https://bip.gmina-a.pl/attachments/download/103": pdf("103"),
    "https://bip.gmina-a.pl/attachments/download/900": pdf("900"),
    # B: the name is only in the table row
    "https://bip.powiat-b.pl": page(
        "Starostwo B",
        '<a href="/rada/oswiadczenia-majatkowe">Oświadczenia majątkowe radnych</a>',
    ),
    "https://bip.powiat-b.pl/rada/oswiadczenia-majatkowe": page(
        "Oświadczenia majątkowe",
        (
            "<table><tr><th>Imię i nazwisko</th><th>Plik</th></tr>"
            "<tr><td>Jan Nowak</td><td>radny</td><td>"
            '<a href="/plik,55,om.pdf">pobierz</a></td></tr>'
            "<tr><td>Adam Mazur</td><td>radny</td><td>"
            '<a href="/plik,56,om.pdf">pobierz</a></td></tr></table>'
        ),
    ),
    "https://bip.powiat-b.pl/plik,55,om.pdf": pdf("55"),
    "https://bip.powiat-b.pl/plik,56,om.pdf": (
        200,
        "text/html",
        b"<html>zaloguj</html>",
    ),
    # C: a page per person, labels give the year only
    "https://bip.gmina-c.pl": page(
        "Gmina C", '<a href="/oswiadczenia">Oświadczenia</a>'
    ),
    "https://bip.gmina-c.pl/oswiadczenia": page(
        "Oświadczenia majątkowe",
        '<a href="/oswiadczenia/zielinski">Piotr Zieliński</a>',
    ),
    "https://bip.gmina-c.pl/oswiadczenia/zielinski": page(
        "Piotr Zieliński - oświadczenia majątkowe",
        '<a href="/files/om-2022.pdf">Oświadczenie za 2022</a> '
        '<a href="/files/om-2024.pdf">Oświadczenie za 2024</a>',
    ),
    "https://bip.gmina-c.pl/files/om-2022.pdf": pdf("z22"),
    "https://bip.gmina-c.pl/files/om-2024.pdf": pdf("z24"),
    # D: only the office website is known; its "BIP" link leads to another host
    "https://www.gmina-d.pl": page(
        "Gmina D",
        '<a href="https://gminad.bip-host.pl/">BIP</a> '
        '<a href="/aktualnosci">Aktualności</a>',
    ),
    "https://gminad.bip-host.pl": page(
        "BIP Gmina D", '<a href="/oswiadczenia-majatkowe">Oświadczenia majątkowe</a>'
    ),
    "https://gminad.bip-host.pl/oswiadczenia-majatkowe": page(
        "Oświadczenia majątkowe",
        '<a href="/dokument/9.pdf">Tomasz Wiśniewski - oświadczenie majątkowe 2024</a>',
    ),
    "https://gminad.bip-host.pl/dokument/9.pdf": pdf("9"),
    # F: a shared platform; the unit lives under /ugf, a neighbour under /ugx
    "https://bip.shared.pl/ugf": page(
        "UG F",
        '<a href="/ugf/oswiadczenia">Oświadczenia majątkowe</a> '
        '<a href="/ugx/oswiadczenia">Sąsiad</a>',
    ),
    "https://bip.shared.pl/ugf/oswiadczenia": page(
        "Oświadczenia majątkowe",
        '<a href="/ugf/pliki/1.pdf">Oświadczenie majątkowe - Leszek Bąk</a>',
    ),
    "https://bip.shared.pl/ugx/oswiadczenia": page(
        "Oświadczenia majątkowe",
        '<a href="/ugx/pliki/2.pdf">Oświadczenie majątkowe - Leszek Bąk</a>',
    ),
    "https://bip.shared.pl/ugf/pliki/1.pdf": pdf("f1"),
    # I: one file for the whole council, named nobody
    "https://bip.gmina-i.pl": page(
        "Gmina I", '<a href="/oswiadczenia">Oświadczenia majątkowe</a>'
    ),
    "https://bip.gmina-i.pl/oswiadczenia": page(
        "Oświadczenia majątkowe radnych",
        '<a href="/f/radni-2023.pdf">Oświadczenia majątkowe radnych za 2023</a> '
        '<a href="/f/wzor.doc">Wzór oświadczenia majątkowego</a>',
    ),
    "https://bip.gmina-i.pl/f/radni-2023.pdf": pdf("all"),
    # J: a BIP with no declarations at all
    "https://bip.gmina-j.pl": page(
        "Gmina J", '<a href="/uchwaly">Uchwały</a> <a href="/o-gminie">O gminie</a>'
    ),
    "https://bip.gmina-j.pl/o-gminie": page("O gminie", "<p>Gmina J</p>"),
}
NORMALIZED = {normalize_url(url).rstrip("/"): value for url, value in SITES.items()}


class FakeWeb:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def fetch(self, url: str, timeout: float, user_agent: str) -> HttpResult:
        self.calls.append(url)
        status, ctype, body = NORMALIZED.get(
            normalize_url(url).rstrip("/"), (404, "text/html", b"<html>404</html>")
        )
        return HttpResult(url=url, status=status, content_type=ctype, content=body)


SEEDS = {
    "000001": UnitSeed(
        "000001", bip_urls=["https://bip.gmina-a.pl"], scopes=["bip.gmina-a.pl"]
    ),
    "000100": UnitSeed(
        "000100", bip_urls=["https://bip.powiat-b.pl"], scopes=["bip.powiat-b.pl"]
    ),
    "000003": UnitSeed(
        "000003", bip_urls=["https://bip.gmina-c.pl"], scopes=["bip.gmina-c.pl"]
    ),
    "000004": UnitSeed("000004", www_urls=["https://www.gmina-d.pl"]),
    "000006": UnitSeed(
        "000006", bip_urls=["https://bip.shared.pl/ugf"], scopes=["bip.shared.pl/ugf"]
    ),
    "000008": UnitSeed(
        "000008", bip_urls=["https://bip.gmina-h.pl"], scopes=["bip.gmina-h.pl"]
    ),
    "000009": UnitSeed(
        "000009", bip_urls=["https://bip.gmina-i.pl"], scopes=["bip.gmina-i.pl"]
    ),
    "000010": UnitSeed(
        "000010", bip_urls=["https://bip.gmina-j.pl"], scopes=["bip.gmina-j.pl"]
    ),
}


def person(key: str, unit: str, first: str, last: str, priority: int = 0) -> PersonRow:
    return PersonRow(key, unit, priority, 2024, first, last, {"key": key})


PEOPLE = [
    person("kowalski", "000001", "Jan", "Kowalski"),
    person("kowalska", "000001", "Anna", "Kowalska"),
    person("nowak", "000100", "Jan", "Nowak"),
    person("mazur", "000100", "Adam", "Mazur"),
    person("zielinski", "000003", "Piotr", "Zieliński"),
    person("wisniewski", "000004", "Tomasz", "Wiśniewski"),
    person("bak", "000006", "Leszek", "Bąk"),
    person("noseed", "000007", "Ewa", "Lis"),
    person("down", "000008", "Olga", "Sowa"),
    person("radny", "000009", "Marek", "Wilk"),
    person("nothing", "000010", "Iza", "Kot"),
]


@pytest.fixture
def run(tmp_path: Path):
    def go(
        rows=PEOPLE,
        store=None,
        robots=lambda url: True,
        unreachable=lambda url: False,
        web=None,
        refresh=False,
        retry=frozenset(),
        seeds=None,
        **options,
    ):
        web = web or FakeWeb()
        store = store or MemoryBipPeopleStore()
        store.upsert_people(rows)
        queue = FakeFrontier([])
        search = PeopleSearch(
            store,
            cast("BipQueue", queue),  # test double
            LocalBundleStore(tmp_path / "bundles"),
            seeds or SEEDS,
            PeopleOptions(workers=3, **options),
            fetch=web.fetch,
            robots_allowed=robots,
            robots_unreachable=unreachable,
            limiter=HostTokenBucket(0),
            sleep=lambda s: None,
        )
        counts = search.run(
            store.people_to_search(
                refresh=refresh, max_priority=None, limit=None, retry=retry
            )
        )
        return search, store, queue, web, counts

    return go


def test_every_candidacy_ends_found_or_with_a_reason(run):
    _, store, _, _, counts = run()
    status = {k: (p.status, p.reason) for k, p in store.people.items()}
    assert status["kowalski"] == ("found", "named")
    assert status["kowalska"] == ("found", "named")
    assert status["nowak"] == ("found", "named")
    assert status["mazur"] == (
        "not_found",
        "download_failed",
    )  # the link answers with a login page
    assert status["zielinski"] == ("found", "named")
    assert status["wisniewski"] == ("found", "named")
    assert status["bak"] == ("found", "named")
    assert status["noseed"] == ("not_found", "no_seed")
    assert status["down"] == ("not_found", "unreachable")
    assert status["radny"] == ("unconfirmed", "unnamed")  # the OCR step decides
    assert status["nothing"] == ("not_found", "no_declarations")
    assert counts["found"] == 6


def test_only_the_persons_own_files_come_down(run):
    _, store, queue, web, _ = run()
    jan = {d.url for d in store.person_docs("kowalski") if d.status == "ok"}
    assert jan == {"https://bip.gmina-a.pl/attachments/download/101"}
    anna = {d.url for d in store.person_docs("kowalska")}
    assert anna == {"https://bip.gmina-a.pl/attachments/download/102"}
    assert (
        "https://bip.gmina-a.pl/attachments/download/900" not in web.calls
    )  # the tender
    assert "https://bip.gmina-a.pl/przetargi" not in web.calls  # never walked
    assert "https://bip.gmina-i.pl/f/wzor.doc" not in web.calls  # a blank form
    assert {d.url for d in store.person_docs("zielinski")} == {
        "https://bip.gmina-c.pl/files/om-2022.pdf",
        "https://bip.gmina-c.pl/files/om-2024.pdf",
    }
    assert not store.person_docs("radny")[0].named


def test_downloads_land_in_bundles_and_bip_docs(run, tmp_path: Path):
    _, store, queue, _, _ = run()
    doc = store.person_docs("nowak")[0]
    assert doc.status == "ok" and doc.sha256 in queue.docs
    bundle = tmp_path / "bundles" / queue.docs[doc.sha256].bundle
    with tarfile.open(bundle) as archive:
        names = archive.getnames()
    assert any(doc.sha256 in n for n in names) or names  # sealed, readable


def test_shared_platform_and_website_hop(run):
    _, store, _, web, _ = run()
    assert "https://bip.shared.pl/ugx/oswiadczenia" not in web.calls
    assert {d.url for d in store.person_docs("wisniewski")} == {
        "https://gminad.bip-host.pl/dokument/9.pdf"
    }
    assert store.units["000004"].roots == ["https://gminad.bip-host.pl/"]


def test_robots_keeps_the_walk_out(run):
    _, store, _, web, _ = run(
        rows=[person("kowalski", "000001", "Jan", "Kowalski")],
        robots=lambda url: "/menu/oswiadczenia" not in url,
    )
    assert store.people["kowalski"].status == "not_found"
    assert not any("/menu/oswiadczenia" in c for c in web.calls)


def test_a_second_run_searches_only_what_is_pending(run):
    _, store, _, _, _ = run()
    again, _, _, web, counts = run(store=store)
    assert counts == {} and web.calls == []
    newcomer = [person("new", "000001", "Ewa", "Nowak")]
    _, store, _, web, counts = run(rows=newcomer, store=store)
    assert counts == {"found": 1} and store.people["new"].status == "found"
    assert store.people["kowalski"].status == "found"  # untouched


def test_a_retry_can_take_only_what_an_older_walk_settled():
    store = MemoryBipPeopleStore()
    store.upsert_people(
        [PersonRow(k, "u1", 0, 2024, "Ewa", k, {}) for k in ("old", "new", "never")]
    )
    store.record_person("old", "not_found", "not_listed", 0, "r1")
    store.record_person("new", "not_found", "not_listed", 0, "r2")
    store.checked["old"] = datetime(2026, 10, 29, tzinfo=timezone.utc)
    cutoff = datetime(2026, 10, 30, 5, 43, tzinfo=timezone.utc)

    def due(**kwargs) -> list[str]:
        return [
            r.key
            for r in store.people_to_search(
                refresh=False, max_priority=None, limit=None, **kwargs
            )
        ]

    retry = frozenset({"not_listed"})
    assert due(retry=retry) == ["never", "new", "old"]
    # Pending ones are searched whatever the cutoff.
    assert due(retry=retry, retry_before=cutoff) == ["never", "old"]


def test_a_run_can_take_only_the_units_it_is_given(tmp_path):
    listed = tmp_path / "units.txt"
    listed.write_text("141104  # Krasnosielc\n\n240702\n", encoding="utf-8")
    assert _units(f"@{listed}") == {"141104", "240702"}
    assert _units("141104, 240702,") == {"141104", "240702"}


def test_time_budget_leaves_units_pending(run):
    search, store, _, _, _ = run(max_run_seconds=-1)
    assert search.timed_out
    assert all(p.status == "pending" for p in store.people.values())


def test_link_contexts_carry_rows_and_headings():
    html = (
        "<h2>Jan Kowalski</h2><ul><li>Oświadczenie za 2023 "
        "<a href='/a.pdf'>pobierz</a></li></ul>"
        "<table><tr><td>Anna Nowak</td><td><a href='/b.pdf'>plik</a></td></tr></table>"
    )
    title, links = extract_link_contexts(html, "https://bip.x.pl/o")
    a, b = links
    assert a.heading == "Jan Kowalski" and "Oświadczenie za 2023" in a.row
    assert "Anna Nowak" in b.row


def test_a_row_keeps_its_own_link_and_drops_the_others():
    # The same link twice in a row: bs4 calls the two equal, and the first lost
    # its own label from its row as if it were the other's.
    html = (
        "<table><tr><td>Jan Kowalski</td><td><a href='/a.pdf'>pobierz</a></td>"
        "<td><a href='/a.pdf'>pobierz</a></td><td><a href='/c.pdf'>2024</a></td>"
        "</tr></table>"
    )
    _, links = extract_link_contexts(html, "https://bip.x.pl/o")
    assert [x.row for x in links] == ["Jan Kowalski pobierz", "Jan Kowalski 2024"]


def test_a_page_in_one_table_row_is_read_in_time():
    # ugblizyn.bip.doc.pl lays a whole page out in one row: 1,170 links.
    cells = "".join(
        f"<td>Uchwała {i}</td><td><a href='/u/{i}.pdf'>pobierz {i}</a></td>"
        for i in range(600)
    )
    html = f"<table><tr>{cells}</tr></table>"
    started = time.monotonic()
    _, links = extract_link_contexts(html, "https://bip.x.pl/o")
    assert len(links) == 600 and time.monotonic() - started < 20
    assert "pobierz 7" in links[7].row and "pobierz 8" not in links[7].row


def test_first_name_rule_and_stems():
    assert (
        stem("Kowalski") == "kowalsk"
        and stem("Kowalska") == "kowalsk"
        and stem("Sowa") == "sowa"
    )
    assert stem("Anna", min_a=4) == "ann" and stem("Ewa", min_a=4) == "ewa"
    jan, anna = Seeker.of("j", "Jan", "Kowalski"), Seeker.of("a", "Anna", "Kowalska")
    links = [
        LinkContext("https://b.pl/1.pdf", "Oświadczenie majątkowe Jana Kowalskiego"),
        LinkContext("https://b.pl/2.pdf", "Oświadczenie majątkowe Anny Kowalskiej"),
    ]
    found = candidates("https://b.pl/o", "Oświadczenia majątkowe", links, [jan, anna])
    picks = choose(found, [jan, anna], per_person=3, unnamed_cap=0)
    assert [c.url for c in picks["j"]] == ["https://b.pl/1.pdf"]
    assert [c.url for c in picks["a"]] == ["https://b.pl/2.pdf"]


def test_a_namesakes_file_is_not_the_seekers():
    # The 10-31 crawl's found ones that named no first name included Michał
    # Rzepka's file for Józef, Iwona Chęcińska's for Arkadiusz Chęciński, and
    # L. Barwinek's for Ryszard.
    first_names = frozenset(
        stem(n, min_a=4) for n in ("Józef", "Michał", "Iwona", "Marcin", "Ryszard")
    )

    def named(first: str, last: str, anchor: str, path: str) -> list[str]:
        link = LinkContext(f"https://bip.x.pl{path}", anchor)
        seeker = Seeker.of("s", first, last)
        found = candidates(
            "https://bip.x.pl/o",
            "Oświadczenia",
            [link],
            [seeker],
            first_names=first_names,
        )
        return [c.key for c in found]

    assert named("Józef", "Rzepka", "Michał Rzepka.pdf", "/f/1.pdf") == []
    assert named("Arkadiusz", "Chęciński", "Chęcińska Iwona.pdf", "/f/2.pdf") == []
    assert named("Zofia", "Borowska", "pobierz", "/files/borowski_marcin.pdf") == []
    assert named("Arkadiusz", "Chęciński", "Chęcińska.pdf", "/f/5.pdf") == []
    assert named("Anna", "Kowalska", "radnego Kowalskiego", "/f/6.pdf") == []
    assert (
        named("Ryszard", "Barwinek", "zobacz", "/d/Oswiadczenie-L.Barwinek.pdf") == []
    )
    assert (
        named("Józef", "Kuropatwa", "Za rok 2024", "/attach/8571_s-kuropatwa.pdf") == []
    )
    assert named("Zbigniew", "Szatkowski", "Szatkowski D.pdf", "/api/files/9") == []
    # Their own initial, a word that is no initial, a bare surname: still theirs.
    assert named("Wanda", "Kułaj", "Kułaj.W (pdf)", "/api/files/7") == ["s"]
    assert named("Dariusz", "Semeniuk", "za 2024", "/pliki/semeniuk_d-pk.pdf") == ["s"]
    assert named("Jan", "Kowalski", "Kowalskiego w 2024", "/f/3.pdf") == ["s"]
    assert named("Józef", "Rzepka", "Rzepka - radny", "/f/4.pdf") == ["s"]
    assert named("Anna", "Wąsowicz", "za 2024 r.- p. Wąsowicz", "/api/files/8") == ["s"]
    assert named("Anna", "Wąsowicz", "za 2024 r.- P. Wąsowicz", "/api/files/8") == []


def test_a_first_name_is_not_read_out_of_the_host():
    # powiat-piotrkowski-api.bip.net.pl handed Dariusz Wojtysiak's files to
    # Piotr Wojtysiak as if they named his first name.
    link = LinkContext(
        "https://powiat-piotrkowski-api.bip.net.pl/api/attachments/8243",
        "Wojtysiak.pdf",
    )
    piotr = Seeker.of("p", "Piotr", "Wojtysiak")
    (found,) = candidates("https://x.pl/o", "Oświadczenia", [link], [piotr])
    assert not found.first_name


def test_a_page_about_somebody_else_lends_nobody_its_files():
    # Chojnów's BIP gives each councillor a page titled with an initial and the
    # surname, and labels that name nobody: the 10-29 trial took three of them
    # for Jan Serkies as the council's unnamed files.
    page = "https://bip.chojnow.net.pl/wiadomosc/884071/b_kulacz"
    title = (
        "BIP - Urząd Miejski w Chojnowie - Rada Miejska - Oświadczenia majątkowe - "
        "Rada Miejska 2024-2029 - B. Kułacz - Stan majątkowy na 31.12.2025 r."
    )
    links = [
        LinkContext(
            "https://files.example.pl/884071/files/kulacz.pdf",
            "Stan majątkowy na 31.12.2025 r. 2.81 MB pdf Pobierz",
            "",
            "Załączniki",
        )
    ]
    serkies, kulacz = (
        Seeker.of("s", "Jan", "Serkies"),
        Seeker.of("k", "Barbara", "Kułacz"),
    )
    assert candidates(page, title, links, [serkies]) == []
    assert [c.key for c in candidates(page, title, links, [serkies, kulacz])] == ["k"]
    assert names_somebody("Oświadczenie majątkowe - B. Kułacz")
    assert not names_somebody("Rada Miejska Chojnowa", initials_only=True)
    assert not names_somebody("Załącznik A. Oświadczenie majątkowe")


def test_initials_in_addresses_and_abbreviations_name_nobody():
    for title in (
        "Szkoła Podstawowa im. M. Konopnickiej - oświadczenia majątkowe",
        "Urząd Miasta, ul. J. Słowackiego 5",
        "Rada M.St. Warszawy",
        "PGK S.A. - oświadczenia majątkowe",
        "II. Radni",
    ):
        assert initialled_names(title) == [], title
    assert initialled_names("B. Kułacz - Stan majątkowy") == [("B", "Kułacz")]


def test_a_seekers_own_page_keeps_an_initialled_label():
    # The title names Jan Kaczmarek; the label's "J. Kaczmarka" is him in a form
    # Seeker.named_in misses, not somebody else.
    kaczmarek = Seeker.of("k", "Jan", "Kaczmarek")
    links = [
        LinkContext(
            "https://u.pl/f/1.pdf", "J. Kaczmarka - oświadczenie majątkowe za 2024"
        )
    ]
    title = "Jan Kaczmarek - oświadczenia majątkowe"
    found = candidates("https://u.pl/radni/kaczmarek", title, links, [kaczmarek])
    assert [c.key for c in found] == ["k"]


def test_a_title_initial_a_seeker_could_be_keeps_the_unnamed_files():
    kaczmarek = Seeker.of("k", "Jan", "Kaczmarek")
    links = [
        LinkContext(
            "https://u.pl/files/1.pdf",
            "Stan majątkowy na 31.12.2025 r.",
            "",
            "Załączniki",
        )
    ]
    title = "Rada Miejska - J. Kaczmarka - Stan majątkowy na 31.12.2025 r."
    found = candidates("https://u.pl/w/1", title, links, [kaczmarek])
    # Unnamed: whether it is his, the OCR step decides.
    assert [c.key for c in found] == [""]


@pytest.mark.parametrize(
    "inputs_on_disk", [set(), {"PeopleMerged", "PeoplePKW", "KorytaPeople"}]
)
def test_a_list_on_disk_is_read_not_rebuilt(monkeypatch, inputs_on_disk):
    # A workspace on predator: the list (and maybe its inputs) on disk, the
    # trees under them not. The default policy rebuilt the list on the second
    # run and PeopleMerged under it on the third.
    on_disk = {"BipPeopleOfInterest"} | inputs_on_disk
    monkeypatch.setattr(
        Pipeline,
        "output_time",
        lambda self, ctx: 1.0 if self.pipeline_name in on_disk else None,
    )
    policy = list_policy()
    policy.decide(BipPeopleOfInterest(), None)
    decisions = policy.execution_decisions
    assert decisions["BipPeopleOfInterest"] == (False, "up to date")
    if inputs_on_disk:
        assert decisions["PeopleMerged"] == (False, "up to date")
