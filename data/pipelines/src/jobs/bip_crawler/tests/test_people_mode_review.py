"""People mode: the cases the 10-29 review found, one test each."""

from __future__ import annotations

from pathlib import Path
from typing import cast

import pytest

from jobs.bip_crawler import single_crawler
from jobs.bip_crawler.people import PeopleOptions, PeopleSearch
from jobs.bip_crawler.tests.test_bip import FakeFrontier
from scrapers.bip.classify import normalize_url
from scrapers.bip.people import Seeker, candidates, choose, names_somebody
from scrapers.bip.units import UnitSeed
from scrapers.common.fetch import HttpResult
from scrapers.common.links import LinkContext, extract_link_contexts
from scrapers.common.ratelimit import HostTokenBucket
from scrapers.stores import BipQueue, PersonDocRow, PersonRow
from stores.bip_bundles import LocalBundleStore
from stores.bip_people import MemoryBipPeopleStore

PDF = b"%PDF-1.4 "


def html(title: str, body: str, charset: str = "utf-8") -> tuple[int, str, bytes]:
    page = f"<html><head><title>{title}</title></head><body>{body}</body></html>"
    return 200, f"text/html; charset={charset}", page.encode(charset)


class Web:
    def __init__(self, sites: dict[str, tuple[int, str, bytes]]) -> None:
        self.sites = {normalize_url(u).rstrip("/"): v for u, v in sites.items()}
        self.calls: list[str] = []

    def fetch(self, url: str, timeout: float, user_agent: str) -> HttpResult:
        self.calls.append(url)
        if self.sites.get("*down*") and "down" in url:
            return HttpResult(url, 0, "", b"", "connection refused")
        status, ctype, body = self.sites.get(
            normalize_url(url).rstrip("/"), (404, "text/html", b"<html></html>")
        )
        return HttpResult(url=url, status=status, content_type=ctype, content=body)


def search(
    tmp_path: Path,
    sites,
    rows,
    *,
    store=None,
    unreachable=lambda u: False,
    robots=None,
    **options,
):
    web = Web(sites)
    store = store or MemoryBipPeopleStore()
    store.upsert_people(rows)
    seeds = {
        r.unit: UnitSeed(
            r.unit, bip_urls=[f"https://{r.unit}.pl"], scopes=[f"{r.unit}.pl"]
        )
        for r in rows
    }
    people = PeopleSearch(
        store,
        cast("BipQueue", FakeFrontier([])),
        LocalBundleStore(tmp_path / "b"),
        seeds,
        PeopleOptions(workers=2, **options),
        fetch=web.fetch,
        robots_allowed=robots or (lambda u: not unreachable(u)),
        robots_unreachable=unreachable,
        limiter=HostTokenBucket(0),
        sleep=lambda s: None,
    )
    retry = options.pop("retry", frozenset()) if "retry" in options else frozenset()
    counts = people.run(
        store.people_to_search(
            refresh=False, max_priority=None, limit=None, retry=retry
        )
    )
    return people, store, web, counts


def row(key: str, unit: str, first: str, last: str) -> PersonRow:
    return PersonRow(key, unit, 0, 2024, first, last, {"key": key})


def test_files_naming_somebody_else_are_nobody_elses_unnamed_files(tmp_path):
    sites = {
        "https://u1.pl": html("BIP", '<a href="/om">Oświadczenia majątkowe</a>'),
        "https://u1.pl/om": html(
            "Oświadczenia majątkowe radnych",
            '<a href="/f/1.pdf">Oświadczenie majątkowe - Piotr Zieliński - 2023</a>'
            '<a href="/f/2.pdf">Oświadczenie majątkowe - Adam Mazur - 2023</a>',
        ),
        "https://u1.pl/f/1.pdf": (200, "application/pdf", PDF + b"1"),
        "https://u1.pl/f/2.pdf": (200, "application/pdf", PDF + b"2"),
    }
    _, store, web, _ = search(tmp_path, sites, [row("wilk", "u1", "Marek", "Wilk")])
    assert store.people["wilk"].status == "not_found"
    assert store.person_docs("wilk") == []
    assert not any(c.endswith(".pdf") for c in web.calls)


def test_a_management_control_statement_is_no_unnamed_declaration():
    links = [
        LinkContext(
            "https://u.pl/k.pdf", "Oświadczenie o stanie kontroli zarządczej za 2023"
        )
    ]
    found = candidates(
        "https://u.pl/o", "Oświadczenia", links, [Seeker.of("w", "Marek", "Wilk")]
    )
    assert found == []


def test_menu_links_with_an_id_query_are_not_files():
    seeker = Seeker.of("w", "Marek", "Wilk")
    links = [
        LinkContext("https://u.pl/index.php?id=1", "Strona główna"),
        LinkContext("https://u.pl/index.php?id=2", "Rada Gminy"),
        LinkContext(
            "https://u.pl/pliki/radni-2023.pdf", "Oświadczenia majątkowe radnych 2023"
        ),
    ]
    found = candidates("https://u.pl/o", "Oświadczenia majątkowe", links, [seeker])
    assert [c.url for c in found] == ["https://u.pl/pliki/radni-2023.pdf"]


def test_headings_and_paragraphs_give_each_link_its_own_person():
    page = (
        "<h1>Oświadczenia majątkowe radnych za 2023</h1>"
        "<h2>Jan Kowalski</h2><a href='/k.pdf'>oświadczenie za 2023</a>"
        "<h2>Anna Nowak</h2><a href='/n.pdf'>oświadczenie za 2023</a>"
        "<p><a href='/a.pdf'>Jan Kowalski</a><br>"
        "<a href='/b.pdf'>Piotr Zieliński</a></p>"
    )
    title, links = extract_link_contexts(page, "https://u.pl/")
    jan = Seeker.of("j", "Jan", "Kowalski")
    picks = choose(candidates("https://u.pl/", title, links, [jan]), [jan], 4, 0)
    assert sorted(c.url for c in picks["j"]) == [
        "https://u.pl/a.pdf",
        "https://u.pl/k.pdf",
    ]


def test_names_match_with_endings_not_as_prefixes():
    nowak, jan = Seeker.of("n", "Adam", "Nowak"), Seeker.of("j", "Jan", "Wilk")
    assert nowak.named_in("oswiadczenie adama nowaka")[0]
    assert not nowak.named_in("oswiadczenie adama nowakowskiego")[0]
    assert jan.named_in("jana wilka") == (True, True)
    assert jan.named_in("janiny wilk") == (True, False)


def test_names_somebody():
    assert names_somebody("Oświadczenie majątkowe - Piotr Zieliński")
    assert names_somebody("JAN KOWALSKI 2023")
    assert not names_somebody("Oświadczenia Majątkowe Radnych Za Rok 2023")
    assert not names_somebody("pobierz")


def test_pages_in_cp1250_are_read(tmp_path):
    sites = {
        "https://u1.pl": html(
            "BIP", '<a href="/om">Oświadczenia majątkowe</a>', "cp1250"
        ),
        "https://u1.pl/om": html(
            "Oświadczenia majątkowe",
            '<a href="/f/1.pdf">Oświadczenie majątkowe - Tomasz Wiśniewski</a>',
            "cp1250",
        ),
        "https://u1.pl/f/1.pdf": (200, "application/pdf", PDF + b"w"),
    }
    _, store, _, _ = search(tmp_path, sites, [row("w", "u1", "Tomasz", "Wiśniewski")])
    assert store.people["w"].status == "found"


def test_files_without_extension_are_not_walked_and_come_down_once(tmp_path):
    files = "".join(
        f'<a href="/api/files/{n}">Oświadczenie majątkowe radnego {n}</a>'
        for n in range(40)
    )
    sites = {
        "https://u1.pl": html(
            "BIP",
            '<a href="/rada">Oświadczenia majątkowe radnych</a> '
            '<a href="/wojt">Oświadczenia majątkowe wójta</a>',
        ),
        "https://u1.pl/rada": html("Oświadczenia majątkowe radnych", files),
        "https://u1.pl/wojt": html(
            "Oświadczenia majątkowe wójta",
            '<a href="/api/files/99">Anna Nowak - oświadczenie majątkowe</a>',
        ),
        **{
            f"https://u1.pl/api/files/{n}": (200, "application/pdf", PDF + bytes([n]))
            for n in range(100)
        },
    }
    _, store, web, _ = search(
        tmp_path, sites, [row("a", "u1", "Anna", "Nowak")], unit_pages=10
    )
    assert store.people["a"].status == "found"
    assert web.calls.count("https://u1.pl/api/files/99") == 1
    assert sum("/api/files/" in c for c in web.calls) == 1


def test_a_reelected_persons_two_candidacies_both_get_their_page(tmp_path):
    sites = {
        "https://u1.pl": html("BIP", '<a href="/om">Oświadczenia majątkowe</a>'),
        "https://u1.pl/om": html(
            "Oświadczenia majątkowe", '<a href="/om/z">Piotr Zieliński</a>'
        ),
        "https://u1.pl/om/z": html(
            "Piotr Zieliński - oświadczenia majątkowe",
            '<a href="/f/22.pdf">za 2022</a>',
        ),
        "https://u1.pl/f/22.pdf": (200, "application/pdf", PDF + b"z"),
    }
    rows = [
        row("z2018", "u1", "Piotr", "Zieliński"),
        row("z2024", "u1", "Piotr", "Zieliński"),
    ]
    _, store, _, _ = search(tmp_path, sites, rows)
    assert {store.people[k].status for k in ("z2018", "z2024")} == {"found"}
    assert all(d.named for k in ("z2018", "z2024") for d in store.person_docs(k))


def test_an_unreachable_host_is_unreachable_not_robots(tmp_path):
    _, store, _, _ = search(
        tmp_path, {}, [row("x", "down1", "Ewa", "Lis")], unreachable=lambda u: True
    )
    assert (store.people["x"].status, store.people["x"].reason) == (
        "not_found",
        "unreachable",
    )


def test_a_retry_never_undoes_a_find():
    store = MemoryBipPeopleStore()
    store.upsert_people([row("lis", "u1", "Ewa", "Lis")])
    store.record_person("lis", "found", "named", 1, "run1")
    store.record_person_docs(
        [PersonDocRow("lis", "https://u1.pl/f/1.pdf", "ok", "abc")], "run1"
    )
    # --poi-refresh searches it again, and this time the BIP is down
    store.record_person("lis", "not_found", "unreachable", 0, "run2")
    store.record_person_docs(
        [PersonDocRow("lis", "https://u1.pl/f/1.pdf", "http 500")], "run2"
    )
    assert (store.people["lis"].status, store.people["lis"].docs) == ("found", 1)
    assert store.person_docs("lis")[0].status == "ok"


def test_one_failing_unit_does_not_end_the_run(tmp_path, monkeypatch):
    sites = {
        "https://u1.pl": html("BIP", '<a href="/om">Oświadczenia majątkowe</a>'),
        "https://u1.pl/om": html(
            "Oświadczenia majątkowe",
            '<a href="/f/1.pdf">Ewa Lis - oświadczenie majątkowe</a>',
        ),
        "https://u1.pl/f/1.pdf": (200, "application/pdf", PDF + b"l"),
    }
    original = PeopleSearch.search_unit

    def flaky(self, unit, seekers, *args, **kwargs):
        if unit == "u2":
            raise RuntimeError("boom")
        return original(self, unit, seekers, *args, **kwargs)

    monkeypatch.setattr(PeopleSearch, "search_unit", flaky)
    _, store, _, counts = search(
        tmp_path, sites, [row("lis", "u1", "Ewa", "Lis"), row("x", "u2", "Jan", "Kot")]
    )
    assert store.people["lis"].status == "found"
    assert (store.people["x"].status, store.people["x"].reason) == (
        "not_found",
        "error",
    )
    assert (
        store.people_to_search(
            refresh=False, max_priority=None, limit=None, retry=frozenset({"error"})
        )[0].key
        == "x"
    )


def test_the_time_budget_stops_walks_and_leaves_units_pending(tmp_path):
    # Each look at the clock moves it 5 s; the budget is 12 s: the scheduler's
    # look (5) and u1's start (10) fit in it, u1's walk (20) does not.
    ticks = iter(range(0, 10_000, 5))
    sites = {"https://u1.pl": html("BIP", '<a href="/a">Oświadczenia majątkowe</a>')}
    store = MemoryBipPeopleStore()
    store.upsert_people([row("a", "u1", "Ewa", "Lis"), row("b", "u2", "Jan", "Kot")])
    seeds = {
        u: UnitSeed(u, bip_urls=[f"https://{u}.pl"], scopes=[f"{u}.pl"])
        for u in ("u1", "u2")
    }
    people = PeopleSearch(
        store,
        cast("BipQueue", FakeFrontier([])),
        LocalBundleStore(tmp_path / "b"),
        seeds,
        PeopleOptions(workers=1, max_run_seconds=12),
        fetch=Web(sites).fetch,
        limiter=HostTokenBucket(0),
        sleep=lambda s: None,
        clock=lambda: next(ticks),
    )
    people.run(store.people_to_search(refresh=False, max_priority=None, limit=None))
    assert people.timed_out
    # u1 started in time and its walk ran out of it; u2 never started
    assert (store.people["a"].status, store.people["a"].reason) == (
        "not_found",
        "timeout",
    )
    assert store.people["b"].status == "pending"


def test_one_crawler_per_out(tmp_path):
    with single_crawler(tmp_path), pytest.raises(SystemExit):
        with single_crawler(tmp_path):
            pass


def test_outcomes_by_election_year():
    store = MemoryBipPeopleStore()
    store.upsert_people(
        [
            PersonRow("a", "u1", 0, 2014, "Ewa", "Lis", {}),
            PersonRow("b", "u1", 0, 2014, "Jan", "Kot", {}),
            PersonRow("c", "u1", 0, 2024, "Ola", "Mak", {}),
        ]
    )
    store.record_person("a", "not_found", "not_listed", 0, "r")
    store.record_person("c", "found", "named", 1, "r")
    assert store.outcomes_by_year() == {
        2014: {"not_found:not_listed": 1, "pending": 1},
        2024: {"found": 1},
    }
