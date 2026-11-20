"""`koryta_scrape_bip state` and `problems`: why a unit keeps the crawler out,
the state in the shared cache, and the listing read back from it."""

from __future__ import annotations

import csv
import json
from datetime import UTC, datetime
from types import SimpleNamespace

from jobs.bip_crawler import build_parser
from jobs.bip_crawler.state import (
    APP_SHELL,
    BROWSER_ONLY,
    NO_ADDRESS,
    NO_ANSWER,
    OPEN,
    REFUSED,
    ROBOTS,
    kind_of,
    probe_start,
    probe_units,
    problems,
    read_part,
    state_lines,
    stuck_units,
    write_state,
)
from scrapers.bip.units import UnitSeed
from scrapers.common.fetch import HttpResult
from scrapers.stores import PersonRow, UnitRow
from stores.bip_unit_probes import MemoryUnitProbeStore, StartProbe

CRAWLER = "KorytaBIPCrawler/0.1"
BROWSER = "Mozilla/5.0 (compatible; KorytaBIP/0.1)"
PAGE = b"<html><body>" + b"".join(b'<a href="/%d">x</a>' % i for i in range(9))
SHELL = b'<html><head><script src="/main.js"></script></head><body></body></html>'


def web(answers: dict[tuple[str, str], tuple[int, bytes, str]]):
    """A fetch answering (url, agent) as told; nothing for the rest."""

    def fetch(url: str, timeout: float, agent: str) -> HttpResult:
        status, body, error = answers.get((url, agent), (0, b"", "timed out"))
        return HttpResult(url, status, "text/html; charset=utf-8", body, error)

    return fetch


def probe(url: str, answers, allowed=lambda u: True) -> StartProbe:
    return probe_start(url, web(answers), CRAWLER, BROWSER, allowed)


def test_a_units_starts_say_why_the_crawler_stays_out() -> None:
    u = "https://bip.x.pl/"
    nothing = probe(u, {})
    assert nothing.crawler.startswith("no answer") and kind_of([nothing]) == NO_ANSWER
    both_403 = probe(u, {(u, CRAWLER): (403, b"", ""), (u, BROWSER): (403, b"", "")})
    assert kind_of([both_403]) == REFUSED
    browser = probe(u, {(u, CRAWLER): (403, b"", ""), (u, BROWSER): (200, PAGE, "")})
    assert (browser.crawler, browser.browser) == ("403", "200")
    assert kind_of([browser]) == BROWSER_ONLY
    # Gdynia: a script draws the page, whichever agent got it.
    gdynia = probe(u, {(u, CRAWLER): (403, b"", ""), (u, BROWSER): (200, SHELL, "")})
    assert gdynia.shell and kind_of([gdynia]) == APP_SHELL
    # A host the crawl asks as a browser (`identity.HOSTS`) is probed so too.
    listed = probe_start(
        u,
        web({(u, BROWSER): (200, PAGE, "")}),
        lambda host: BROWSER if host == "bip.x.pl" else CRAWLER,
        BROWSER,
        lambda url: True,
    )
    assert kind_of([listed]) == OPEN
    fine = probe(u, {(u, CRAWLER): (200, PAGE, ""), (u, BROWSER): (200, PAGE, "")})
    assert kind_of([fine]) == OPEN
    # One start that answers is enough to get in.
    assert kind_of([nothing, fine]) == OPEN
    kept = probe(u, {(u, CRAWLER): (200, PAGE, "")}, allowed=lambda url: False)
    assert (kept.crawler, kind_of([kept])) == (ROBOTS, ROBOTS)
    assert kind_of([]) == NO_ADDRESS
    # A host whose robots.txt does not answer is asked nothing more: no answer.
    silent = probe_start(
        u, web({}), CRAWLER, BROWSER, lambda url: False, unreachable=lambda url: True
    )
    assert silent.crawler.startswith("no answer") and kind_of([silent]) == NO_ANSWER


def person(
    key: str, unit: str, status: str = "not_found", reason: str = ""
) -> PersonRow:
    return PersonRow(
        key,
        unit,
        0,
        2024,
        "Jan",
        "Kowalski",
        {"unit_name": f"Gmina {unit}", "unit_level": "gmina"},
        status=status,
        reason=reason,
    )


PEOPLE = [
    person("a", "u-found", "found"),
    person("b", "u-found"),
    person("c", "u-down", reason="unreachable"),
    person("d", "u-one-page", reason="no_declarations"),
    person("e", "u-walked", reason="not_listed"),
    person("f", "u-never"),
]
UNITS = {
    "u-found": UnitRow("u-found", "searched", ["https://f.pl"], 300, 4),
    "u-down": UnitRow("u-down", "unreachable", ["https://d.pl"], 0, 0),
    "u-one-page": UnitRow("u-one-page", "searched", ["https://o.pl"], 1, 0),
    "u-walked": UnitRow("u-walked", "searched", ["https://w.pl"], 300, 2),
}


def test_only_units_nobody_was_found_in_whose_walk_did_not_get_in_are_probed():
    assert stuck_units(PEOPLE, UNITS) == ["u-down", "u-never", "u-one-page"]
    seeds = {
        "u-down": UnitSeed(
            "u-down", bip_urls=["https://d.pl"], www_urls=["https://www.d.pl"]
        ),
    }
    probed = probe_units(
        ["u-down", "u-never"], seeds, web({}), CRAWLER, BROWSER, lambda u: True
    )
    # The BIP's address alone: the walk reads the website only without one.
    assert [p.url for p in probed["u-down"]] == ["https://d.pl"]
    assert probed["u-never"] == []
    site_only = {"u-never": UnitSeed("u-never", www_urls=["https://www.n.pl"])}
    probed = probe_units(
        ["u-never"], site_only, web({}), CRAWLER, BROWSER, lambda u: True
    )
    assert [p.url for p in probed["u-never"]] == ["https://www.n.pl"]


def test_the_state_names_nobody_and_problems_reads_the_stuck_back() -> None:
    store = MemoryUnitProbeStore()
    store.record(
        "u-down",
        [StartProbe("https://d.pl", "no answer: timed out", "no answer: timed out")],
    )
    store.record("u-one-page", [StartProbe("https://o.pl", "403", "200", shell=True)])
    store.record("u-found", [StartProbe("https://f.pl", "403", "403")])
    lines = state_lines(PEOPLE, UNITS, store.probes())
    text = json.dumps(lines, ensure_ascii=False)
    assert "Kowalski" not in text and "Jan" not in text
    units = {x["unit"]: x for x in lines if x["type"] == "unit"}
    assert units["u-down"]["kind"] == NO_ANSWER
    assert units["u-one-page"]["kind"] == APP_SHELL
    assert units["u-walked"]["kind"] == ""  # never probed
    assert units["u-found"]["found"] == 1
    assert units["u-found"]["outcomes"] == {"found": 1, "not_found": 1}
    assert sum(x["type"] == "candidacy" for x in lines) == len(PEOPLE)

    written: dict[str, bytes] = {}

    def create_object(bucket, name, data, content_type):
        written[name] = data
        return f"gs://{bucket}/{name}"

    url = write_state(
        SimpleNamespace(create_object=create_object),  # type: ignore[arg-type]
        lines,
        datetime(2026, 11, 5, 18, 0, tzinfo=UTC),
    )
    [(name, part)] = written.items()
    assert name == "jobs/bip_crawler/state/date=2026-11-05/2026-11-05T180000Z.jsonl.gz"
    assert url.endswith(name)
    back = read_part(part)
    assert back == json.loads(json.dumps(lines))
    # A unit somebody was found in is nobody's problem, whatever its starts say.
    rows = problems(back)
    assert [(r["kind"], r["unit"]) for r in rows] == [
        (NO_ANSWER, "u-down"),
        (APP_SHELL, "u-one-page"),
    ]
    assert str(rows[0]["crawler"]).startswith("no answer")
    assert [r["unit"] for r in problems(back, [APP_SHELL])] == ["u-one-page"]


def test_problems_lists_a_part_on_disk_as_csv(tmp_path, capsys) -> None:
    store = MemoryUnitProbeStore()
    store.record(
        "u-down", [StartProbe("https://d.pl", "no answer: reset", "no answer: reset")]
    )
    part = tmp_path / "state.jsonl.gz"
    written: dict[str, bytes] = {}
    write_state(
        SimpleNamespace(  # type: ignore[arg-type]
            create_object=lambda b, n, d, c: (
                written.setdefault(n, d) and f"gs://{b}/{n}"
            )
        ),
        state_lines(PEOPLE, UNITS, store.probes()),
        datetime(2026, 11, 5, tzinfo=UTC),
    )
    part.write_bytes(next(iter(written.values())))
    out = tmp_path / "blocked.csv"
    args = build_parser().parse_args(
        ["problems", "--part", str(part), "--kind", "no_answer", "--csv", str(out)]
    )
    assert args.func(args) == 0
    [row] = list(csv.DictReader(out.open()))
    assert (row["kind"], row["unit"], row["start"]) == (
        NO_ANSWER,
        "u-down",
        "https://d.pl",
    )
    assert "no_answer: 1 units, 1 candidacies" in capsys.readouterr().out
    bad = build_parser().parse_args(["problems", "--part", str(part), "--kind", "nope"])
    assert bad.func(bad) == 2
