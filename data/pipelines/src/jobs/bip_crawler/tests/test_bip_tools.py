"""The round's research tools: `walk --trace`, the exceptions a walk tries for
itself, `page` and `files` (`walk.py`, `inspect.py`)."""

from __future__ import annotations

import json

import pymupdf

from jobs.bip_crawler import build_parser, identity, main, robots_exceptions
from jobs.bip_crawler.identity import BROWSER_AGENT, Agents
from jobs.bip_crawler.inspect import page_lines
from jobs.bip_crawler.people import PeopleOptions, PeopleSearch
from jobs.bip_crawler.tests.test_people_mode_review import PDF, Web, html, row
from jobs.bip_crawler.tests.test_people_mode_review import search as walk
from jobs.bip_crawler.walk import (
    MemoryDocIndex,
    access,
    tried_agents,
    tried_exceptions,
    tried_robots,
)
from scrapers.bip.units import UnitSeed
from scrapers.common.ratelimit import HostTokenBucket
from scrapers.stores import PersonRow
from stores.bip_bundles import LocalBundleStore
from stores.bip_people import MemoryBipPeopleStore

SEEKER = [row("kot", "u7", "Iza", "Kot")]
SITE = {
    "https://u7.pl": html(
        "BIP",
        '<a href="/om">Oświadczenia majątkowe</a> <a href="/zakazane">Rada</a>'
        ' <a href="/zajete">Radni</a> <a href="/zamkniete">Kadencja</a>',
    ),
    "https://u7.pl/om": html(
        "Oświadczenia majątkowe radnych",
        '<a href="/f/kot.pdf">Oświadczenie majątkowe - Iza Kot - 2024</a>',
    ),
    "https://u7.pl/zajete": (429, "text/html", b"busy"),
    "https://u7.pl/zamkniete": (403, "text/html", b"<html>403</html>"),
    "https://u7.pl/f/kot.pdf": (200, "application/pdf", PDF + b"kot"),
}


def test_a_traced_walk_tells_each_page_and_what_kept_it_out(tmp_path):
    lines: list[str] = []
    store = MemoryBipPeopleStore()
    traced = PeopleSearch(
        store,
        MemoryDocIndex(),
        LocalBundleStore(tmp_path),
        {"u7": UnitSeed("u7", bip_urls=["https://u7.pl"], scopes=["u7.pl"])},
        PeopleOptions(sitemaps=False),
        fetch=Web(SITE).fetch,
        robots_allowed=lambda url: "/zakazane" not in url,
        limiter=HostTokenBucket(0),
        sleep=lambda s: None,
        trace=lines.append,
    )
    traced.run(SEEKER)
    assert store.outcomes["kot"].status == "found"
    assert lines[0] == (
        "u7 page 1 depth 0: +0 candidates (0 named), 0 declaration pages: https://u7.pl"
    )
    assert (
        "u7 page 2 depth 1 led: +1 candidates (1 named), 1 declaration pages: "
        "https://u7.pl/om"
    ) in lines
    assert "u7 robots: https://u7.pl/zakazane" in lines
    # "Not now" each time it is asked, the host paused; a refusal once.
    not_now = "u7 429: https://u7.pl/zajete, not now: u7.pl paused 30 s"
    assert lines.count(not_now) == 3
    assert "u7 403: https://u7.pl/zamkniete" in lines


def test_an_exception_lets_a_host_through_for_that_walk_only(tmp_path):
    shut = lambda url: False  # noqa: E731 - robots.txt says no to everything
    _, store, _, _ = walk(tmp_path, SITE, SEEKER, robots=shut, sitemaps=False)
    assert (store.outcomes["kot"].status, store.outcomes["kot"].reason) == (
        "not_found",
        "robots",
    )
    # As robots_exceptions.SITES would: the whole BIP.
    passed = tried_robots(shut, ["https://www.u7.pl/"], [])
    _, store, _, _ = walk(tmp_path, SITE, SEEKER, robots=passed, sitemaps=False)
    assert store.outcomes["kot"].status == "found"
    # As FILES would: its file links alone, not the pages that link them.
    files = tried_robots(shut, [], ["u7.pl"])
    assert files("https://u7.pl/f/kot.pdf") and not files("https://u7.pl/om")
    assert not passed("https://u8.pl/om")
    # Nothing is written into the lists a chunk reads.
    assert not robots_exceptions.passes("https://u7.pl/om")
    assert "u7.pl" not in robots_exceptions.SITES | robots_exceptions.FILES


def test_a_walk_asks_a_host_or_a_server_as_a_browser_when_told():
    servers = {"bip.x.pl": "10.0.0.1", "bip.hosted.pl": "10.0.0.7"}
    agents = Agents("Crawler/1", lambda host: servers.get(host, "10.0.0.9"))
    tried = tried_agents(agents, ["https://www.bip.x.pl/", "10.0.0.7"])
    assert tried("www.bip.x.pl") == BROWSER_AGENT
    assert tried("bip.hosted.pl") == BROWSER_AGENT  # its server was named
    assert tried("bip.other.pl") == "Crawler/1"
    assert tried_agents(agents, []) is agents
    assert "bip.x.pl" not in identity.HOSTS and "10.0.0.7" not in identity.SERVERS


def test_the_walk_flags_build_the_tried_access():
    args = build_parser().parse_args(
        ["walk", "020800", "--trace", "--as-browser", "bip.x.pl"]
        + ["--pass-robots", "bip.y.pl", "--pass-robots-files", "bip.z.pl"]
    )
    assert args.trace and args.as_browser == ["bip.x.pl"]
    assert tried_exceptions(args) == {
        "as_browser": ["bip.x.pl"],
        "pass_robots": ["bip.y.pl"],
        "pass_robots_files": ["bip.z.pl"],
    }
    agents, allowed, _ = access(args, "Crawler/1")
    # Neither asks the network: the tried hosts answer before robots.txt would.
    assert agents("bip.x.pl") == BROWSER_AGENT
    assert allowed("https://bip.y.pl/oswiadczenia")
    assert allowed("https://bip.z.pl/pliki/om.pdf")
    plain = build_parser().parse_args(["walk", "020800"])
    assert tried_exceptions(plain) == {} and not plain.trace


#: Sieradz's councillors' declarations for 2025 (bip.umsieradz.pl, 11-13), cut
#: down to its menu link, its heading and two of its files.
SIERADZ = (
    "<html><head><title>Oświadczenia majątkowe Radnych Rady Miejskiej za 2025 rok"
    " - BIP</title></head><body><ul><li class='li-item hasSeparator'> "
    '<a href="https://bip.umsieradz.pl/bipkod/008" title="Lewe menu: '
    "Oświadczenia&#x20;majątkowe\" class='span12' >Oświadczenia&#x20;majątkowe"
    "</a></li><li class='li-item'> "
    '<a href="https://bip.umsieradz.pl/bipkod/18463825" title="Lewe menu: Ochrona'
    "&#x20;danych&#x20;osobowych\" class='span12' >Ochrona&#x20;danych&#x20;"
    "osobowych</a></li></ul>"
    '<div class="article"><div class="article-title "> <h2>Oświadczenia majątkowe'
    " Radnych Rady Miejskiej za 2025 rok</h2> <hr/> </div>"
    '<div class="article-document-file" data-document-id="43729255"> <div '
    'class="row-fluid article-title"> <img src="https://bip.umsieradz.pl/'
    'bip-theme/images/file_system/small/pdf.png" alt="Plik pdf" /> <span '
    'class="span9 title"><a href="/res/serwisy/pliki/43729255?version=1.0" '
    'title="Chlebicz Krzysztof/ Identyfikator: 43729255" >Chlebicz Krzysztof</a>'
    '</span> <div class="span3 date"> 08&#8209;06&#8209;2026&nbsp;12:08:48 </div>'
    '</div></div><div class="article-document-file" data-document-id="43729214">'
    ' <div class="row-fluid article-title"> <span class="span9 title"><a '
    'href="/res/serwisy/pliki/43729214?version=1.0" title="Czapnik Andrzej/ '
    'Identyfikator: 43729214" >Czapnik Andrzej</a></span> <div class="span3 '
    'date"> 08&#8209;06&#8209;2026&nbsp;12:08:27 </div></div></div></div>'
    "</body></html>"
)


def test_page_shows_which_link_credits_whom_and_why_not(tmp_path):
    url = "https://bip.umsieradz.pl/bipkod/43726216"
    web = Web({url: (200, "text/html; charset=UTF-8", SIERADZ.encode())})
    search = PeopleSearch(
        MemoryBipPeopleStore(),
        MemoryDocIndex(),
        LocalBundleStore(tmp_path),
        {},
        PeopleOptions(),
        fetch=web.fetch,
        limiter=HostTokenBucket(0),
        sleep=lambda s: None,
    )
    rows = [
        PersonRow("k1", "101401", 1, 2024, "Krzysztof", "CHLEBICZ"),
        PersonRow("k2", "101401", 1, 2024, "Anna", "Nowak"),
    ]
    lines = page_lines(search, url, rows)
    assert lines[1] == (
        "title 'Oświadczenia majątkowe Radnych Rady Miejskiej za 2025 rok - BIP';"
        " a declarations page: yes; its links score +6 for it"
    )
    chlebicz = next(i for i, x in enumerate(lines) if "'Chlebicz Krzysztof'" in x)
    assert lines[chlebicz].startswith("file ")
    assert lines[chlebicz].endswith(
        "-> https://bip.umsieradz.pl/res/serwisy/pliki/43729255?version=1.0"
    )
    assert "heading 'Oświadczenia majątkowe Radnych" in lines[chlebicz]
    assert lines[chlebicz + 1].strip() == (
        "credits Krzysztof CHLEBICZ (2024), first name too: a declaration, score 6.5"
    )
    # Somebody nobody seeks: his file credits nobody.
    czapnik = next(i for i, x in enumerate(lines) if "'Czapnik Andrzej'" in x)
    assert not lines[czapnik + 1].strip().startswith(("credits", "unnamed"))
    menu = next(x for x in lines if "bipkod/008" in x)
    assert menu.startswith("follows")
    assert lines[-2:] == [
        "Krzysztof CHLEBICZ (2024): would download 1 file(s): "
        "https://bip.umsieradz.pl/res/serwisy/pliki/43729255?version=1.0",
        "Anna Nowak (2024): no link here names them",
    ]
    only = page_lines(search, url, rows, grep="czapnik")
    assert sum("->" in x for x in only) == 1


def _pdf(text: str) -> bytes:
    doc = pymupdf.open()
    doc.new_page().insert_text((50, 72), text, fontsize=10)
    return doc.tobytes()


def _scan() -> bytes:
    doc = pymupdf.open()
    page = doc.new_page()
    picture = pymupdf.Pixmap(pymupdf.csGRAY, pymupdf.IRect(0, 0, 60, 80), False)
    picture.clear_with(220)
    page.insert_image(page.rect, pixmap=picture)
    return doc.tobytes()


FORM = (
    "OSWIADCZENIE MAJATKOWE radnego gminy\n"
    "Ja, nizej podpisany(a), {name}\n"
    "(imiona i nazwisko oraz nazwisko rodowe)\n"
    "urodzony(a) 01.02.1970 w Lwowku Slaskim\n"
    "wedlug stanu na dzien 31.12.2024 r."
)
NOTICE = "Ogolna Klauzula informacyjna Urzedu Gminy i Miasta Lwowek Slaski\nRODO"


def test_files_says_whose_declaration_each_kept_file_is(tmp_path, capsys):
    bundles = LocalBundleStore(tmp_path)
    files = {
        "om.pdf": _pdf(FORM.format(name="Jan Kowalski")),
        "zona.pdf": _pdf(FORM.format(name="Anna Nowak")),
        "rodo.pdf": _pdf(NOTICE),
        "skan.pdf": _scan(),
    }
    docs = []
    for name, data in files.items():
        doc, _ = bundles.add(
            host="bip.x.pl",
            crawl_id="walk",
            url=f"https://bip.x.pl/{name}",
            data=data,
            content_type="application/pdf",
            filename=name,
            chain=[],
        )
        docs.append(
            {
                "url": doc.url,
                "status": "ok",
                "sha256": doc.sha256,
                "bundle": doc.bundle,
                "named": True,
                "score": 7.5,
                "anchor": f"Oświadczenie majątkowe {name}",
            }
        )
    bundles.flush()
    report = {
        "out": str(tmp_path),
        "candidacies": [
            {
                "key": "k1",
                "unit": "021203",
                "name": "Jan Kowalski",
                "first_name": "Jan",
                "last_name": "Kowalski",
                "election_year": 2024,
                "status": "found",
                "reason": "named",
                "docs": docs,
            }
        ],
    }
    saved = tmp_path / "report.json"
    saved.write_text(json.dumps(report), encoding="utf-8")
    assert main(["files", str(saved)]) == 0
    out = capsys.readouterr().out
    assert "page 1: declarant 'Jan Kowalski', theirs, as of 2024" in out
    assert "page 1: declarant 'Anna Nowak', NOT theirs, as of 2024" in out
    assert "page 1 names no declarant: 'Ogolna Klauzula informacyjna" in out
    assert out.count("never names Jan Kowalski in 1 page(s)") == 2
    assert "no text layer (a scan): page 1's top in" in out
    pictures = list((tmp_path / "files").glob("*.top.png"))
    assert len(pictures) == 1 and pictures[0].stat().st_size > 0
    assert len(list((tmp_path / "files").glob("*.pdf"))) == 4


def test_files_needs_a_walk_that_kept_them(tmp_path, capsys):
    saved = tmp_path / "report.json"
    saved.write_text(json.dumps({"candidacies": []}), encoding="utf-8")
    assert main(["files", str(saved)]) == 1
    assert "--out" in capsys.readouterr().out
