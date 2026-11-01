"""People mode: find named people's oświadczenia majątkowe on their units' BIPs.

``koryta_scrape_bip crawl --people-of-interest`` reads ``BipPeopleOfInterest``
(one row per won local candidacy), as the night built it last
(``people_list``), and, unit by unit, searches the BIP of the
office that serves the council: the gov.pl registry's address where it has
one, else the office's website from the dane.gov.pl catalogue and the "BIP"
link on it (``scrapers.bip.units``). Instead of the blind crawl's breadth-first
walk with one budget per host, each unit gets its own page budget and walks
the links most likely to lead to "oświadczenia majątkowe" first
(``scrapers.bip.people.link_score``), and only the files a link names one of
the unit's people in are downloaded - into the same bundles and ``bip_docs``
as the blind crawl's, so ``BipDocumentsParsed`` reads them too.

Every candidacy ends the run found (a file that a link names them in came
down), unconfirmed (only files that name nobody did: the OCR step decides), or
not_found with a reason, in ``bip_poi`` (``stores.bip_people``), which keeps
nothing of the candidacy but that, by its key:

- ``no_seed``: neither list has an office for the unit;
- ``unreachable``: no page of the unit's BIP answered (retried by default);
- ``robots``: robots.txt keeps the crawler out of where it starts;
- ``no_declarations``: no page read looked like a declarations page;
- ``not_listed``: declarations were found, none named the person, and the
  unit had no unnamed declaration file to look inside either;
- ``download_failed``: links named the person, and no file came down;
- ``timeout``: the run's time ran out during the walk (retried by default);
- ``budget``: the unit's own time (``--max-unit-minutes``) ran out;
- ``throttled``: the BIP kept answering "not now" (429, 503) and pages were
  left unread for it (retried by default);
- ``refused``: the BIP answers the crawler with a refusal dressed as a page
  (not retried by default: it says the same at any pace);
- ``error``: the unit's search failed unexpectedly (retried by default).

Politeness is the blind crawl's: robots.txt, one request per host per
``--rate`` seconds, the same User-Agent and fetch. Madkom's BIPs are read
through the API their pages are drawn from (``madkom``), FINN's registers
through the JSON-RPC calls of the e-Urząd app their pages embed (``finn``),
Wrota Lubelszczyzny's document lists through the JSON their pages are drawn
from (``wrota``), SISCO eDc's attachment tables through the call their pages'
script makes (``sisco``), BUK Softres's file buttons as links (``softres``),
other pages a script draws are rendered (``render``).
"""

from __future__ import annotations

import csv
import functools
import gzip
import hashlib
import heapq
import json
import logging
import re
import socket
import threading
import time
import zlib
from collections import Counter, defaultdict
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from urllib.parse import urljoin, urlsplit

from conductor import setup_context
from jobs.bip_crawler import finn, sisco, softres, wrota, zeto
from jobs.bip_crawler import render as rendering
from jobs.bip_crawler.identity import Agents
from jobs.bip_crawler.madkom import Madkom
from jobs.bip_crawler.people_list import (
    list_policy,
    outcomes,
    outcomes_by_year,
    read_list,
    to_search,
)
from scrapers.bip.classify import (
    filename_from_url,
    host_of,
    is_document_url,
    is_html,
    is_low_value_url,
    normalize_url,
)
from scrapers.bip.people import (
    ASSETS,
    DECLARATION,
    Candidate,
    Seeker,
    candidates,
    choose,
    fold,
    is_file_link,
    link_score,
    office_terms,
    same_file,
    satisfied,
    stem,
    url_words,
)
from scrapers.bip.registry import parse_subjects_xml
from scrapers.bip.units import UnitSeed, scope_of, terc_index, unit_seeds
from scrapers.common.fetch import HttpResult, Payload, http_get, http_post
from scrapers.common.links import LinkContext, extract_link_contexts
from scrapers.common.ratelimit import HostTokenBucket
from scrapers.krs.data import read_public_bodies_catalogue
from scrapers.map.teryt import read_terc
from scrapers.stores import (
    BipPeopleStore,
    BipQueue,
    PersonDocRow,
    PersonRow,
    UnitRow,
    with_outcomes,
)
from stores.bip_bundles import LocalBundleStore
from stores.bip_people import PostgresBipPeopleStore
from stores.web import robots_lines

logger = logging.getLogger(__name__)

#: A link with one of these extensions is a file, never a page to read.
_FILE = re.compile(
    r"\.(pdf|docx?|odt|rtf|xlsx?|ods|jpe?g|png|tiff?|zip|7z|rar)(?:$|[?#])", re.I
)
_BIP_LINK = re.compile(r"(?:^| )bip(?: |$)|biuletyn informacji publicznej")
_SITEMAP = re.compile(r"(?im)^\s*sitemap:\s*(\S+)")
#: The page_url of candidates the blind crawl's URLs gave (`--known-urls`).
KNOWN_URLS = "known-urls"
_LOC = re.compile(rb"<loc>\s*([^<\s]+)\s*</loc>")
#: Turns of its host's rate a render pays at most. A drawn page asks its host
#: for itself, its data calls and the scripts the browser has not fetched yet,
#: ~9-20 requests; one that keeps polling asks for as many as it polls in a
#: render's 30-60 seconds, and paid one a second those would hold a walk that
#: long, past the run's deadline. A host whose render asks more is not
#: rendered again.
RENDER_TURNS = 60


@dataclass
class PeopleOptions:
    #: Pages a unit's walk reads: ``pages_per_candidacy`` for each of its
    #: candidacies, never fewer than ``unit_pages`` nor more than
    #: ``max_unit_pages``. A sejmik or a city files thousands of declarations
    #: (staff, districts) beside the council's: 150 pages found 0 of Warsaw's 96.
    unit_pages: int = 150
    pages_per_candidacy: int = 15
    max_unit_pages: int = 1000
    #: Read the BIP's sitemaps (robots.txt "Sitemap:", else /sitemap.xml) for
    #: declaration pages and files before walking, at most this many files.
    sitemaps: bool = True
    max_sitemap_files: int = 10
    per_person: int = 3
    unnamed_cap: int = 3
    workers: int = 12
    max_depth: int = 6
    rate_interval_s: float = 1.0
    request_timeout_s: float = 15.0
    user_agent: str = "KorytaBIPCrawler/0.1 (+http://koryta.pl/crawler)"
    max_doc_bytes: int = 60_000_000
    #: Start no new unit after this many seconds (exit 75 when some are left).
    max_run_seconds: float | None = None
    #: A unit's walk stops after this many seconds, its candidacies left
    #: not_found:budget (not retried by default): a rendered BIP at its host's
    #: rate reads ~6 pages a minute, and a walk the run's deadline cut off
    #: started again from scratch every run.
    max_unit_seconds: float | None = 30 * 60
    #: Units searched at once on one start host. They share its rate, so a
    #: second one only halves both and keeps a worker waiting: 7 of
    #: bip.malopolska.pl's units ran at once on 10-30 and 5 hit the deadline.
    max_per_host: int = 1
    #: Units searched at once on one server, the address a start host resolves
    #: to (`server_of`). A hosting platform serves dozens of BIPs from one under
    #: their own names (bip.net.pl: 105 on 188.117.133.215 on 10-31), and the
    #: rate is a host's: twenty walks there asked it twenty times a second.
    max_per_server: int = 2


@dataclass
class UnitSearch:
    """What one unit's walk found."""

    unit: str
    roots: list[str] = field(default_factory=list)
    status: str = "searched"
    pages: int = 0
    pages_ok: int = 0
    declaration_pages: int = 0
    found: list[Candidate] = field(default_factory=list)
    #: Files the walk reached as links it could not tell from pages, kept so the
    #: download does not fetch them a second time.
    files: dict[str, HttpResult] = field(default_factory=dict)
    #: Links the walk read as pages (normalised): no file, whatever their
    #: ``?id=`` made candidates() think.
    read: set[str] = field(default_factory=set)
    #: FINN e-Urząd clients whose registers the walk has read (`finn`).
    eurzad: set[str] = field(default_factory=set)
    #: Wrota Lubelszczyzny's document lists the walk has read (`wrota`).
    lists: set[str] = field(default_factory=set)
    #: Register records and list documents the walk has opened, by person
    #: (`entries_to_open`): a council's lists come one a year or a person.
    opened: Counter[tuple[str, str]] = field(default_factory=Counter)


#: Hosts no unit's BIP lives on, though a unit's website may link to them.
_NOT_A_UNITS_BIP = frozenset(
    {"bip.gov.pl", "gov.pl", "epuap.gov.pl", "obywatel.gov.pl", "biznes.gov.pl"}
)
#: What `_get` answers instead of a response.
ROBOTS, UNREACHABLE, REFUSED = "robots", "unreachable", "refused"
#: A walk's end when its BIP kept saying "not now" and pages were left unread.
THROTTLED = "throttled"
#: Reasons a later run searches again by default: the BIP may answer next time.
#: no_seed too: a unit that gains a start (`UNIT_STARTS`) is searched then.
DEFAULT_RETRY = frozenset({"unreachable", "error", "timeout", "no_seed", THROTTLED})
#: Answers that mean "not now". The host is left alone `NOT_NOW_PAUSE_S`, then
#: asked again, `NOT_NOW_TRIES` times in all; a walk that meets
#: `NOT_NOW_IN_A_ROW` such pages in a row stops. trol.pl's nginx (77 BIPs)
#: and AkcessNet (26) answered 429 on 10-31; counted as pages read and never
#: asked again, they cost walks their declarations sections. AkcessNet's limit
#: lifted within 26 s of a client going quiet.
_NOT_NOW = frozenset({429, 503})
NOT_NOW_PAUSE_S = 30.0
NOT_NOW_TRIES = 3
NOT_NOW_IN_A_ROW = 3
#: Redirects followed for one request, each hop asked about in robots.txt.
MAX_HOPS = 10
#: What a declarations page's own links score above the rest: ZETO-RZESZÓW's
#: year and office subsections ("Za rok 2025") scored like any menu link, and
#: Żelazków read 116 pages of the council's session archive (each named the
#: council: +5) and not one year (10-31). Above the session pages' +5.
DECLARATIONS_BONUS = 6.0
#: A refusal of the crawler dressed as a page, the same at any pace (10-31):
#: SYSTEMDOBIP.PL's 80-byte "Zbyt dużo jednoczesnych połączeń do strony" with
#: HTTP 200 (E-LINE, 74 BIPs), on the crawler's User-Agent only, also after an
#: hour of silence. Read as a page with no links, it left their candidacies
#: no_declarations.
_REFUSAL = re.compile(r"zbyt duzo jednoczesnych polaczen")


@dataclass
class _Frontier:
    """A unit's pages to read, best first, kept to the unit's (host, path) scopes."""

    scopes: list[tuple[str, str]]
    heap: list[tuple[float, int, int, str]] = field(default_factory=list)
    seen: set[str] = field(default_factory=set)
    sequence: int = 0
    #: A queued page as it was linked, where normalize_url changed it.
    linked: dict[str, str] = field(default_factory=dict)

    def __bool__(self) -> bool:
        return bool(self.heap)

    def add(self, url: str, score: float, depth: int, linked: str = "") -> None:
        if self.has(url):
            return
        self.seen.add(_same_page(url))
        if linked and linked != url:
            self.linked[url] = linked
        heapq.heappush(self.heap, (-score, depth, self.sequence, url))
        self.sequence += 1

    def has(self, url: str) -> bool:
        return _same_page(url) in self.seen

    def pop(self) -> tuple[int, str]:
        _, depth, _, url = heapq.heappop(self.heap)
        return depth, url

    def adopt(self, host: str) -> None:
        if host and host not in {h for h, _ in self.scopes}:
            self.scopes.append((host, ""))

    def in_scope(self, url: str) -> bool:
        host, path = host_of(url), urlsplit(url).path.lower()
        return any(host == h and _under(path, p) for h, p in self.scopes)

    def follow(
        self,
        links: list[LinkContext],
        seekers: list[Seeker],
        depth: int,
        prefer: re.Pattern[str] | None = None,
        bonus: float = 0.0,
    ) -> None:
        """Queue a page's links to other pages; files are for the download.
        ``bonus`` lifts those a declarations page leads to, after the cut, so a
        section of tenders it links stays out (`DECLARATIONS_BONUS`)."""
        for link in links:
            target = normalize_url(link.url)
            if (
                self.has(target)
                or _is_file(target)
                or is_low_value_url(target)
                or not self.in_scope(target)
            ):
                continue
            score = link_score(link, seekers, depth, prefer)
            if score > -3:
                self.add(target, score + bonus, depth, link.url)


def _under(path: str, prefix: str) -> bool:
    """Whether ``path`` is ``prefix`` or below it: on bip.malopolska.pl /ugt is
    Tarnów's office (its pages /ugt,m,<id>,<slug>.html), /ugtomice another."""
    if not prefix or path == prefix or prefix.endswith("/"):
        return path.startswith(prefix)
    return path.startswith(prefix) and path[len(prefix)] in "/,"


def _same_page(url: str) -> str:
    """``url`` as the frontier tells pages apart: a host's home with or without
    its slash is one page (a start "https://x.pl" and a "Home" link to "/")."""
    return url[:-1] if url.endswith("/") and urlsplit(url).path == "/" else url


def _is_file(url: str) -> bool:
    return bool(_FILE.search(url)) or is_file_link(url)


def _refused(result: HttpResult) -> bool:
    """Whether an answer refuses the crawler though it looks like a page:
    `_REFUSAL`'s notice, or WebShield's bot check ("One moment, please...",
    10-31 on INTERmedi@'s office websites), which no pace gets past."""
    if not result.ok:
        return False
    head = result.content[:65536]
    if b"wsidchk" in head and b"One moment, please" in head:
        return True
    text = fold(head[:2048].decode("utf-8", "replace"))
    return len(result.content) < 2048 and bool(_REFUSAL.search(text))


def _app_shell(content: bytes, links: list[LinkContext]) -> bool:
    """Whether a page is drawn by a script: next to no links, and a script.

    Madkom's shell has two (Home, Calculators), bip.malopolska.pl's none."""
    return len(links) <= 5 and b"<script" in content[:200_000].lower()


def _declaration_like(url: str) -> bool:
    words = url_words(url)
    return bool(DECLARATION.search(words) or ASSETS.search(words))


#: BIP addresses checked by hand or by a verified search for units whose start
#: is missing or dead in both lists (the gov.pl registry, the catalogue): one row
#: a unit, ``unit,bip_url,declarations_url,checked,source,note``.
UNIT_STARTS = Path(__file__).with_name("unit_starts.csv")


def read_unit_starts(path: Path = UNIT_STARTS) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as rows:
        return [row for row in csv.DictReader(rows) if row.get("unit")]


def apply_unit_starts(seeds: dict[str, UnitSeed], starts: list[dict[str, str]]) -> int:
    """Put the checked addresses in place of what the lists had for those units,
    the declarations page first; return how many units changed."""
    shared = {
        scope.split("/", 1)[0]
        for seed in seeds.values()
        for scope in seed.scopes
        if "/" in scope
    } | {"samorzad.gov.pl"}
    for row in starts:
        urls = [
            u.strip() for u in (row.get("declarations_url"), row.get("bip_url")) if u
        ]
        urls = [u for u in dict.fromkeys(urls) if u]
        if not urls:
            continue
        seed = seeds.setdefault(row["unit"], UnitSeed(row["unit"]))
        seed.bip_urls = urls
        seed.scopes = sorted({scope_of(u, shared) for u in urls})
    return len(starts)


def load_known_urls(path: Path) -> dict[str, list[str]]:
    """Declaration-like URLs by host, from newline-delimited JSON rows with a
    ``url`` and maybe a ``category``: the blind crawl's ``BipUrlsClassified``
    output (300k such URLs on 2,127 hosts on 10-22)."""
    known: dict[str, list[str]] = defaultdict(list)
    with path.open(encoding="utf-8") as rows:
        for line in rows:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            url = str(row.get("url") or "")
            if url and (
                row.get("category") == "oswiadczenia" or _declaration_like(url)
            ):
                known[host_of(url)].append(url)
    return dict(known)


class PeopleSearch:
    def __init__(
        self,
        people_store: BipPeopleStore,
        bip_queue: BipQueue,
        bundles: LocalBundleStore,
        seeds: dict[str, UnitSeed],
        options: PeopleOptions,
        *,
        fetch: Callable[[str, float, str], HttpResult] | None = None,
        post: Callable[[str, Payload, float, str], HttpResult] | None = None,
        robots_allowed: Callable[[str], bool] = lambda url: True,
        robots_unreachable: Callable[[str], bool] = lambda url: False,
        limiter: HostTokenBucket | None = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
        known: dict[str, list[str]] | None = None,
        render: Callable[[str], rendering.Drawn] | None = None,
        unit_sizes: dict[str, int] | None = None,
        first_names: frozenset[str] = frozenset(),
        resolve: Callable[[str], str] = lambda host: host,
        agents: Callable[[str], str] | None = None,
    ) -> None:
        self.people_store = people_store
        self.bip_queue = bip_queue
        self.bundles = bundles
        self.seeds = seeds
        self.options = options
        #: Declaration-like URLs already known, by host (`load_known_urls`).
        self.known = known or {}
        #: Draws a JavaScript page as a browser would (`render.Renderer.render`).
        self.render = render
        #: Every candidacy a unit has, searched in this run or not: the budget's
        #: measure, so a retry of a big unit's few left gets a big unit's pages.
        self.unit_sizes = unit_sizes or {}
        #: Every candidacy's first name as a stem (`Seeker.first`), the whole
        #: list's: what tells "Michał Rzepka" from the Józef a unit seeks.
        self.first_names = first_names
        #: A host's server (`server_of`), by which `run` keeps walks apart.
        self.resolve = resolve
        #: The User-Agent a host is asked with (`identity`).
        self.agents = agents or Agents(options.user_agent, resolve)
        #: A host's sitemaps, read once a run: a shared platform's units share them.
        self._sitemaps: dict[str, list[str]] = {}
        self._sitemap_locks: dict[str, threading.Lock] = {}
        self.fetch = fetch or _one_hop
        self.post = post or http_post
        self.robots_allowed = robots_allowed
        self.robots_unreachable = robots_unreachable
        # No burst: the shared default lets a host take 60 requests at once, and
        # a walk opening with them drew 429s from AkcessNet after 8 (10-31).
        self.limiter = limiter or HostTokenBucket(
            options.rate_interval_s, burst_window_s=options.rate_interval_s
        )
        self.sleep = sleep
        self.clock = clock
        self.run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        self.crawl_id = f"{self.run_id}-people"
        self.timed_out = False
        self.deadline: float | None = None
        self.shared_hosts = {
            scope.split("/", 1)[0]
            for seed in seeds.values()
            for scope in seed.scopes
            if "/" in scope
        } | {"samorzad.gov.pl"}
        self._write_lock = threading.Lock()
        #: Madkom's BIPs, read through the API their pages are drawn from.
        self.madkom = Madkom(self._get, robots_allowed)
        #: FINN's registers, read through the e-Urząd app their pages embed.
        self.eurzad = finn.Eurzad(self._post)
        #: Wrota Lubelszczyzny's document lists, read through their JSON.
        self.wrota = wrota.Wrota(self._get)
        #: Whether e-Urząd's files are out of the crawler's reach (robots.txt),
        #: said once a run.
        self._eurzad_files_said = False
        #: Hosts whose render asked for more than `RENDER_TURNS` requests: their
        #: pages are read as their HTML for the rest of the run.
        self._render_off: set[str] = set()

    def _past_deadline(self) -> bool:
        return self.deadline is not None and self.clock() > self.deadline

    # -- one request -----------------------------------------------------------
    def _get(self, url: str, tries: int = NOT_NOW_TRIES) -> HttpResult | str:
        """robots.txt, the host's rate, then the fetch.

        ROBOTS when robots.txt keeps the crawler out, UNREACHABLE when the host
        did not even answer for its robots.txt (the cache denies those too),
        REFUSED when the answer refuses the crawler (`_refused`). A "not now"
        (`_NOT_NOW`) pauses the host, the last one too, so whatever asks it next
        waits as well; ``url`` is asked ``tries`` times, not past the deadline.
        Redirects are followed one hop at a time, `MAX_HOPS` at most.
        """
        for _ in range(MAX_HOPS + 1):
            if not self.robots_allowed(url):
                return UNREACHABLE if self.robots_unreachable(url) else ROBOTS
            result = self._ask(
                url,
                functools.partial(
                    self.fetch,
                    url,
                    self.options.request_timeout_s,
                    self.agents(host_of(url)),
                ),
                tries,
            )
            # A redirect is asked about too: AkcessNet's /admin goes to the
            # /admin/ its robots.txt disallows.
            if not (result.location and 300 <= result.status < 400):
                break
            url = urljoin(result.url, result.location)
        return REFUSED if _refused(result) else result

    def _post(self, url: str, payload: Payload) -> HttpResult | str:
        """An API call (`finn`, `sisco`), asked as `_get` asks for a page: robots.txt,
        which says the same of any method, the host's rate and its "not now"s;
        no redirect followed."""
        if not self.robots_allowed(url):
            return UNREACHABLE if self.robots_unreachable(url) else ROBOTS
        call = functools.partial(
            self.post,
            url,
            payload,
            self.options.request_timeout_s,
            self.agents(host_of(url)),
        )
        result = self._ask(url, call, NOT_NOW_TRIES)
        return REFUSED if _refused(result) else result

    def _ask(
        self, url: str, request: Callable[[], HttpResult], tries: int
    ) -> HttpResult:
        """``request`` in the host's turn; a "not now" (`_NOT_NOW`) pauses the
        host and asks again, ``tries`` times in all, not past the deadline."""
        host = host_of(url)
        for _ in range(max(1, tries)):
            self._wait_turn(host)
            result = request()
            if result.status not in _NOT_NOW:
                break
            self.limiter.pause(host, NOT_NOW_PAUSE_S)
            if self._past_deadline():
                break
        return result

    def _wait_turn(self, host: str) -> None:
        while not self.limiter.acquire(host):
            self.sleep(max(0.05, self.limiter.next_available_in(host)))

    def _get_page(self, url: str) -> HttpResult | str:
        """A page of the walk: on a Madkom BIP drawn from its API (`madkom`), at
        a call or two instead of a render's dozen; elsewhere fetched. A host's
        first page tells which it is."""
        if self.madkom.knows(url):
            if not self.robots_allowed(url):
                return UNREACHABLE if self.robots_unreachable(url) else ROBOTS
            page = self.madkom.page(url)
            return self._get(url) if page is None else page
        result = self._get(url)
        if isinstance(result, HttpResult) and result.ok:
            if self.madkom.probe(result):
                page = self.madkom.page(result.url)
                if page is not None:
                    return page
            elif (busy := self.madkom.busy(result.url)) is not None:
                return busy  # its API said "not now": the shell is no page yet
        return result

    @staticmethod
    def _is_page(result: HttpResult) -> bool:
        head = result.content[:400].lstrip().lower()
        return is_html(result.content_type) or head.startswith(
            (b"<!doctype html", b"<html")
        )

    # -- where a unit's walk starts --------------------------------------------
    def _roots(self, seed: UnitSeed) -> tuple[list[str], list[tuple[str, str]], str]:
        """Start pages, the (host, path prefix) scopes they allow, and why none."""
        if seed.bip_urls:
            return list(seed.bip_urls), [_split_scope(s) for s in seed.scopes], ""
        roots: list[str] = []
        reason = UNREACHABLE
        for www in seed.www_urls[:2]:
            result = self._get(www)
            if isinstance(result, str):
                reason = result
                continue
            if not result.ok or not self._is_page(result):
                continue
            _, links = extract_link_contexts(
                result.content, result.url, result.content_type
            )
            found = [
                link.url
                for link in links
                if host_of(link.url) not in _NOT_A_UNITS_BIP
                and (
                    _BIP_LINK.search(fold(link.anchor))
                    or "bip" in host_of(link.url).split(".")
                )
            ]
            # Some offices keep the BIP on the main site itself.
            roots.extend(dict.fromkeys(found or [result.url]))
        roots = roots[:3]
        scopes = [_split_scope(scope_of(r, self.shared_hosts)) for r in roots]
        return roots, scopes, "" if roots else reason

    def _budget(self, candidacies: int) -> int:
        """Pages a unit's walk may read (see `PeopleOptions.unit_pages`)."""
        wanted = self.options.pages_per_candidacy * candidacies
        return min(self.options.max_unit_pages, max(self.options.unit_pages, wanted))

    def _sitemap_urls(self, root: str) -> list[str]:
        """Declaration-like URLs in the sitemaps of ``root``'s host, read once a
        run however many units the host serves; each unit's scope picks its own."""
        host = host_of(root)
        with self._sitemap_locks.setdefault(host, threading.Lock()):
            if host in self._sitemaps:
                return self._sitemaps[host]
            urls, answered = self._read_sitemaps(root)
            if answered:  # one that said "not now" is the next unit's to read
                self._sitemaps[host] = urls
        return urls

    def _read_sitemaps(self, root: str) -> tuple[list[str], bool]:
        """Those robots.txt names, else /sitemap.xml; an index's declaration-like
        sitemaps first, at most `PeopleOptions.max_sitemap_files` files. And
        whether the host answered: False when one said "not now"."""
        parts = urlsplit(root)
        base = f"{parts.scheme}://{parts.netloc}"
        robots = self._get(base + "/robots.txt")
        todo: list[str] = []
        if isinstance(robots, HttpResult) and robots.ok:
            text = robots.content.decode("utf-8", "replace")
            todo = _SITEMAP.findall("\n".join(robots_lines(text)))
        todo = todo or [base + "/sitemap.xml"]
        seen: set[str] = set()
        found: list[str] = []
        while todo and len(seen) < self.options.max_sitemap_files:
            sitemap = todo.pop(0)
            if sitemap in seen:
                continue
            seen.add(sitemap)
            result = self._get(sitemap)
            if isinstance(result, HttpResult) and result.status in _NOT_NOW:
                return found, False
            if isinstance(result, str) or not result.ok:
                continue
            body = result.content
            if body[:2] == b"\x1f\x8b":
                try:
                    body = gzip.decompress(body)
                except (OSError, EOFError, zlib.error):
                    continue  # truncated or corrupt: as if unreadable
            locs = [m.decode("utf-8", "replace") for m in _LOC.findall(body)]
            if b"<sitemapindex" in body[:4000]:
                todo = sorted(locs, key=lambda u: not _declaration_like(u)) + todo
            else:
                found.extend(u for u in locs if _declaration_like(u))
        return found, True

    def _seed_known(
        self,
        out: UnitSearch,
        frontier: _Frontier,
        roots: list[str],
        seekers: list[Seeker],
        prefer: re.Pattern[str] | None,
    ) -> None:
        """Start from declaration URLs known before walking: the blind crawl's
        (``--known-urls``) and the sitemaps'. Their pages go to the head of the
        frontier; their files are candidates when the address names a seeker."""
        sources: list[tuple[str, list[str]]] = [
            (
                KNOWN_URLS,
                [u for h, _ in frontier.scopes for u in self.known.get(h, ())],
            )
        ]
        if self.options.sitemaps and roots:
            try:
                sources.append(("sitemap", self._sitemap_urls(roots[0])))
            except Exception:  # noqa: BLE001 - an optional step fails alone
                logger.warning("unit %s: sitemaps of %s failed", out.unit, roots[0])
        for source, urls in sources:
            files: list[LinkContext] = []
            for url in dict.fromkeys(urls):
                target = normalize_url(url)
                if not frontier.in_scope(target):
                    continue
                if _is_file(target):
                    if url == target or self.robots_allowed(url):
                        files.append(LinkContext(target, ""))
                elif is_document_url(target):
                    # A document by its address alone (?id=...): an attachment as
                    # often as a page, and its labelled link brings it anyway.
                    continue
                elif not frontier.has(target):
                    link = LinkContext(target, "")
                    score = 50 + link_score(link, seekers, 1, prefer)
                    frontier.add(target, score, 1, url)
            found = [
                c
                for c in candidates(
                    source, "", files, seekers, first_names=self.first_names
                )
                if c.key
            ]
            if source == KNOWN_URLS:
                # Addresses from an older crawl: a page found today ranks first.
                found = [replace(c, score=c.score - 0.5) for c in found]
            out.found.extend(found)

    # -- the walk ----------------------------------------------------------------
    def search_unit(
        self,
        unit: str,
        seekers: list[Seeker],
        prefer: re.Pattern[str] | None = None,
    ) -> UnitSearch:
        out = UnitSearch(unit)
        started = self.clock()
        seed = self.seeds.get(unit)
        if seed is None:
            out.status = "no_seed"
            return out
        roots, scopes, reason = self._roots(seed)
        out.roots = roots
        if not roots:
            out.status = reason
            return out
        frontier = _Frontier(scopes)
        for root in roots:
            frontier.add(normalize_url(root), 100.0, 0, root)
        self._seed_known(out, frontier, roots, seekers, prefer)
        budget = self._budget(max(len(seekers), self.unit_sizes.get(unit, 0)))
        self._walk(out, frontier, seekers, prefer, budget, started)
        return out

    def _walk(
        self,
        out: UnitSearch,
        frontier: _Frontier,
        seekers: list[Seeker],
        prefer: re.Pattern[str] | None,
        budget: int,
        started: float,
    ) -> None:
        """Read the frontier's pages best first, ``budget`` of them at most, and
        say in ``out.status`` how the walk ended."""
        blocked = down = requests = 0
        # Pages a "not now" kept from the walk, all told and in a row.
        unread = unread_in_a_row = 0
        stopped = False
        # Links that keep turning out to be files cost requests, not pages.
        while (
            frontier
            and out.pages < budget
            and requests < 2 * budget
            # The blind crawl's addresses may be gone: they never end a walk.
            and not satisfied(
                [c for c in out.found if c.page_url != KNOWN_URLS],
                seekers,
                self.options.per_person,
                out.files,
            )
        ):
            if self._past_deadline():
                out.status = "timeout"
                break
            if self._overtime(started):
                out.status = "budget"
                break
            depth, url = frontier.pop()
            if no := self._linked_no(frontier, url):
                blocked += no == ROBOTS
                down += no == UNREACHABLE
                continue
            result = self._get_page(url)
            if isinstance(result, str):
                if result == REFUSED:
                    out.status = REFUSED
                    break
                blocked += result == ROBOTS
                down += result == UNREACHABLE
                continue
            if result.status in _NOT_NOW:
                unread += 1
                unread_in_a_row += 1
                if unread_in_a_row >= NOT_NOW_IN_A_ROW:
                    stopped = True
                    break
                continue
            unread_in_a_row = 0
            requests += 1
            if not result.ok or len(result.content) > self.options.max_doc_bytes:
                down += result.status == 0
                out.pages += 1
                continue
            if not self._is_page(result):
                out.files[url] = result  # a file behind a page-like link
                continue
            out.read.add(url)
            self._read_page(out, result, depth, frontier, seekers, prefer)
        # A host that kept saying "not now" leaves the walk to a later run; a
        # page or two that never answer (a module down) settle nothing, or
        # every run would walk the unit again.
        kept_saying = (
            stopped
            or (unread and out.pages_ok == 0)
            or (unread >= NOT_NOW_IN_A_ROW and 10 * unread >= requests + unread)
        )
        if kept_saying and out.status in ("searched", "budget"):
            out.status = THROTTLED
        # Known URLs may find everybody before a page is asked for.
        tried = requests or blocked or down
        if out.pages_ok == 0 and out.status == "searched" and tried:
            only_robots = blocked and not down and requests == 0
            out.status = ROBOTS if only_robots else UNREACHABLE

    def _linked_no(self, frontier: _Frontier, url: str) -> str:
        """ROBOTS or UNREACHABLE when robots.txt says no to ``url`` as it was
        linked, "" otherwise: normalize_url sorts the query and drops a final
        slash, and AkcessNet's "Disallow: /index.php?job=rejestr" and "/admin/"
        passed that way."""
        linked = frontier.linked.get(url)
        if not linked or self.robots_allowed(linked):
            return ""
        return UNREACHABLE if self.robots_unreachable(linked) else ROBOTS

    def _read_page(
        self,
        out: UnitSearch,
        result: HttpResult,
        depth: int,
        frontier: _Frontier,
        seekers: list[Seeker],
        prefer: re.Pattern[str] | None = None,
    ) -> None:
        out.pages += 1
        out.pages_ok += 1
        if depth == 0:
            # A start page that redirected elsewhere brings its host into scope.
            frontier.adopt(host_of(result.url))
        title, links = extract_link_contexts(
            result.content, result.url, result.content_type
        )
        # Files offered as form buttons, under the position's name (`softres`).
        links = links + softres.files(result.content, result.url)
        # A persons list's files, each under its person (`wrota.persons`).
        if owners := wrota.persons(result.content, result.url):
            links = [
                replace(x, row=owners[x.url]) if x.url in owners else x for x in links
            ]
        # A declarations page only its breadcrumb says is one: its files carry
        # the breadcrumb, not its title, so it lends nobody a name (`zeto`).
        if (where := zeto.trail(result.content)) and DECLARATION.search(fold(where)):
            links = [
                replace(x, heading=f"{x.heading} | {where}".lstrip(" |"))
                if is_file_link(x.url)
                else x
                for x in links
            ]
        follow = links
        if (
            self.render is not None
            # A Madkom page the API does not draw (a form, a calculator) has
            # nothing a render would show.
            and not self.madkom.knows(result.url)
            and host_of(result.url) not in self._render_off
            and _app_shell(result.content, links)
        ):
            drawn = self._drawn(result.url)
            if drawn.ok and self._is_page(drawn):
                drawn_title, drawn_links = extract_link_contexts(
                    drawn.content, drawn.url, drawn.content_type
                )
                if normalize_url(drawn.url) == normalize_url(result.url):
                    # The script drew this very page: its links, then the shell's.
                    shown = {link.url for link in drawn_links}
                    links = drawn_links + [x for x in links if x.url not in shown]
                    title, follow = drawn_title or title, links
                else:
                    # The script went elsewhere: what it drew counts there.
                    out.found.extend(
                        candidates(
                            drawn.url,
                            drawn_title,
                            drawn_links,
                            seekers,
                            first_names=self.first_names,
                        )
                    )
                    follow = links + drawn_links
        folded_title = fold(title)
        if DECLARATION.search(folded_title) or ASSETS.search(folded_title):
            out.declaration_pages += 1
        out.found.extend(
            candidates(result.url, title, links, seekers, first_names=self.first_names)
        )
        self._read_eurzad(out, result, seekers, prefer)
        self._read_wrota(out, result, seekers, prefer)
        self._read_sisco(out, result, title, seekers)
        if depth < self.options.max_depth:
            says = DECLARATION.search(folded_title + " " + fold(where))
            bonus = DECLARATIONS_BONUS if says else 0.0
            frontier.follow(follow, seekers, depth + 1, prefer, bonus)

    def _read_eurzad(
        self,
        out: UnitSearch,
        page: HttpResult,
        seekers: list[Seeker],
        prefer: re.Pattern[str] | None,
    ) -> None:
        """The declaration registers of the e-Urząd clients ``page`` embeds or
        links, each read once a walk as a page of its own (`finn`). Not while
        robots.txt keeps the crawler from e-Urząd's files: nothing read there
        would come down."""
        for client in finn.clients(page.content, page.url):
            if client in out.eurzad:
                continue
            out.eurzad.add(client)
            if not self.robots_allowed(finn.FILES):
                with self._write_lock:
                    said, self._eurzad_files_said = self._eurzad_files_said, True
                if not said:
                    logger.warning(
                        "%s: robots.txt keeps the crawler from e-Urząd's files; "
                        "its registers are not read",
                        finn.FILES,
                    )
                continue
            registers = self.eurzad.registers(
                client,
                seekers,
                prefer,
                self.first_names,
                self.options.per_person,
                out.opened,
            )
            for register in registers:
                out.declaration_pages += 1
                out.found.extend(
                    candidates(
                        register.url,
                        register.name,
                        list(register.links),
                        seekers,
                        first_names=self.first_names,
                    )
                )

    def _read_wrota(
        self,
        out: UnitSearch,
        page: HttpResult,
        seekers: list[Seeker],
        prefer: re.Pattern[str] | None,
    ) -> None:
        """The documents of the Wrota Lubelszczyzny declarations list ``page``
        is, those that may be the seekers', each as a page of its own (`wrota`);
        a list once a walk."""
        listing = wrota.document_list(page.content, page.url)
        if listing is None or not listing.declarations or listing.source in out.lists:
            return
        out.lists.add(listing.source)
        out.declaration_pages += 1
        for document in self.wrota.documents(
            listing,
            seekers,
            prefer,
            self.first_names,
            self.options.per_person,
            out.opened,
        ):
            out.found.extend(
                candidates(
                    document.url,
                    document.title,
                    list(document.links),
                    seekers,
                    first_names=self.first_names,
                )
            )

    def _read_sisco(
        self, out: UnitSearch, page: HttpResult, title: str, seekers: list[Seeker]
    ) -> None:
        """The attachments a SISCO eDc declarations page draws into an empty
        table, read through its script's call (`sisco`)."""
        links = sisco.attachments(page, title, self._post)
        if links is None:
            return
        folded = fold(title)
        if not (DECLARATION.search(folded) or ASSETS.search(folded)):
            out.declaration_pages += 1  # its breadcrumb says so, not its title
        out.found.extend(
            candidates(page.url, title, links, seekers, first_names=self.first_names)
        )

    def _drawn(self, url: str) -> HttpResult:
        """``url`` rendered, paid for as the requests it made: a turn of the
        host's rate for the page, and one for each of its own scripts and calls,
        `RENDER_TURNS` at most and none once the run is past its deadline."""
        assert self.render is not None
        host = host_of(url)
        self._wait_turn(host)
        drawn, asked = self.render(url)
        if asked > RENDER_TURNS:
            self._render_off.add(host)
            logger.warning(
                "%s: a render asked its host %d times; no more renders there",
                url,
                asked,
            )
        for _ in range(min(asked, RENDER_TURNS)):
            if self._past_deadline():
                break
            self._wait_turn(host)
        return drawn

    # -- downloads -----------------------------------------------------------------
    def _download(
        self,
        url: str,
        page_url: str,
        fetched: HttpResult | None = None,
        tries: int = NOT_NOW_TRIES,
    ) -> tuple[str, str, str]:
        """(status, sha256, bundle) of one file, stored as the blind crawl stores."""
        result = fetched if fetched is not None else self._get(url, tries)
        if isinstance(result, str):
            return result, "", ""
        if result.error:
            return "error", "", ""
        if not result.ok:
            return f"http {result.status}", "", ""
        if len(result.content) > self.options.max_doc_bytes:
            return "too_large", "", ""
        if not result.content or self._is_page(result):
            return "html", "", ""
        digest = hashlib.sha256(result.content).hexdigest()
        with self._write_lock:
            known = self.bip_queue.doc_bundle(digest)
            if known is not None and self.bundles.blob_exists(known):
                return "ok", digest, known
            doc, _ = self.bundles.add(
                host=host_of(url),
                crawl_id=self.crawl_id,
                url=url,
                data=result.content,
                content_type=result.content_type,
                filename=filename_from_url(url),
                chain=[page_url, url],
            )
            self.bip_queue.record_docs([doc], self.crawl_id)
        return "ok", digest, doc.bundle

    # -- a unit, start to end ------------------------------------------------------
    def _unit(self, unit: str, rows: list[PersonRow]) -> dict[str, str] | None:
        """Search one unit and record every candidacy's outcome; None if it is
        past the deadline before it starts (its candidacies stay pending)."""
        if self._past_deadline():
            return None
        try:
            return self._search_and_record(unit, rows)
        except Exception:  # noqa: BLE001 - one unit's surprise is not the run's
            logger.exception("unit %s failed", unit)
            with self._write_lock:
                for r in rows:
                    self.people_store.record_person(
                        r.key, "not_found", "error", 0, self.run_id
                    )
                self.people_store.record_unit(UnitRow(unit, "error"), self.run_id)
            return {r.key: "not_found:error" for r in rows}

    def _search_and_record(self, unit: str, rows: list[PersonRow]) -> dict[str, str]:
        seekers = [
            Seeker.of(
                r.key,
                r.first_name,
                r.last_name,
                str(r.person.get("middle_name") or ""),
            )
            for r in rows
        ]
        prefer = office_terms(
            (str(r.person.get("office") or "") for r in rows),
            (str(r.person.get("unit_name") or "") for r in rows),
        )
        search = self.search_unit(unit, seekers, prefer)
        # A link the walk read as a page is no file: Grójec's year pages name the
        # councillor in full, the PDF on each only by its surname, and choose()
        # would take the pages for the first name.
        files = [c for c in search.found if normalize_url(c.url) not in search.read]
        picks = choose(
            files, seekers, self.options.per_person, self.options.unnamed_cap
        )
        named_urls = {(c.key, c.url) for c in search.found if c.key}
        downloaded: dict[str, tuple[str, str, str]] = {}
        hosts: set[str] = set()
        doc_rows: list[PersonDocRow] = []
        # Files a "not now" kept back, by host, in a row: past NOT_NOW_IN_A_ROW
        # the rest of that host's wait for a later run. A walk the host
        # throttled asks each file once.
        not_now: Counter[str] = Counter()
        tries = 1 if search.status == THROTTLED else NOT_NOW_TRIES
        for key, chosen in picks.items():
            for c in chosen:
                once = same_file(c.url)  # http and https, www. or not: one file
                if once not in downloaded:
                    host = host_of(c.url)
                    if not_now[host] >= NOT_NOW_IN_A_ROW:
                        downloaded[once] = ("http 429", "", "")
                    else:
                        cached = search.files.get(normalize_url(c.url))
                        downloaded[once] = self._download(
                            c.url, c.page_url, cached, tries
                        )
                        said = downloaded[once][0]
                        not_now[host] = (
                            not_now[host] + 1
                            if said in {f"http {s}" for s in _NOT_NOW}
                            else 0
                        )
                    hosts.add(host)
                status, sha, bundle = downloaded[once]
                doc_rows.append(
                    PersonDocRow(
                        key,
                        c.url,
                        status,
                        sha,
                        bundle,
                        (key, c.url) in named_urls,
                        c.first_name,
                        c.score,
                        c.anchor,
                        c.context,
                        c.page_url,
                    )
                )
        for host in hosts:
            # Seal the bundle now, as the blind crawl does when a host is done:
            # thousands of open bundles would run out of file descriptors.
            self.bundles.close_host(host)
        outcomes: dict[str, str] = {}
        with self._write_lock:
            self.people_store.record_person_docs(doc_rows, self.run_id)
            for r in rows:
                status, reason, ok = _outcome(r.key, doc_rows, search)
                self.people_store.record_person(r.key, status, reason, ok, self.run_id)
                outcomes[r.key] = status if status == "found" else f"{status}:{reason}"
            self.people_store.record_unit(
                UnitRow(
                    unit,
                    search.status,
                    search.roots,
                    search.pages,
                    search.declaration_pages,
                ),
                self.run_id,
            )
        logger.info("unit %s: %d pages, %s", unit, search.pages, outcomes)
        return outcomes

    def _overtime(self, started: float) -> bool:
        limit = self.options.max_unit_seconds
        return limit is not None and self.clock() - started > limit

    def _unit_host(self, unit: str, *, as_written: bool = False) -> str:
        """The host a unit's walk starts on: units that share it share its rate."""
        seed = self.seeds.get(unit)
        urls = (seed.bip_urls or seed.www_urls) if seed else []
        if not urls:
            return unit
        if as_written:
            return (urlsplit(urls[0]).hostname or "").lower() or host_of(urls[0])
        return host_of(urls[0])

    def run(self, rows: list[PersonRow]) -> dict[str, int]:
        """Search every unit ``rows`` name, most wanted first, at most
        `PeopleOptions.max_per_host` at once on one host and
        `PeopleOptions.max_per_server` on one server; counts of outcomes."""
        by_unit: dict[str, list[PersonRow]] = defaultdict(list)
        for r in rows:
            by_unit[r.unit].append(r)
        waiting = sorted(
            by_unit,
            key=lambda u: (min(r.priority for r in by_unit[u]), -len(by_unit[u]), u),
        )
        if self.options.max_run_seconds is not None:
            self.deadline = self.clock() + self.options.max_run_seconds
        hosts = {unit: self._unit_host(unit) for unit in waiting}
        # Resolved as written: host_of drops a www. some hosts have no address without.
        written = {
            self._unit_host(u): self._unit_host(u, as_written=True) for u in waiting
        }
        with ThreadPoolExecutor(max_workers=32) as lookups:
            names = sorted(set(hosts.values()))
            found = lookups.map(self.resolve, [written[n] for n in names])
            servers = dict(zip(names, found, strict=True))
        busy: Counter[str] = Counter()
        on_server: Counter[str] = Counter()
        limit = max(1, self.options.max_per_host)
        server_limit = max(1, self.options.max_per_server)
        counts: dict[str, int] = defaultdict(int)
        with ThreadPoolExecutor(max_workers=self.options.workers) as pool:
            running: dict[Future[dict[str, str] | None], str] = {}
            while waiting or running:
                if waiting and self._past_deadline():
                    waiting.clear()  # left pending for the next run
                    self.timed_out = True
                while waiting and len(running) < self.options.workers:
                    free = next(
                        (
                            i
                            for i, u in enumerate(waiting)
                            if busy[hosts[u]] < limit
                            and on_server[servers[hosts[u]]] < server_limit
                        ),
                        None,
                    )
                    if free is None:
                        break  # every waiting unit's host is busy: wait for one
                    unit = waiting.pop(free)
                    busy[hosts[unit]] += 1
                    on_server[servers[hosts[unit]]] += 1
                    running[pool.submit(self._unit, unit, by_unit[unit])] = unit
                if not running:
                    break
                done, _ = wait(running, return_when=FIRST_COMPLETED)
                for future in done:
                    host = hosts[running.pop(future)]
                    busy[host] -= 1
                    on_server[servers[host]] -= 1
                    outcomes = future.result()
                    if outcomes is None:
                        self.timed_out = True
                        continue
                    for outcome in outcomes.values():
                        counts[outcome] += 1
                        self.timed_out |= outcome.endswith(":timeout")
        self.bundles.flush()
        return dict(sorted(counts.items()))


def _one_hop(url: str, timeout: float, user_agent: str) -> HttpResult:
    """A GET whose redirect `PeopleSearch._get` follows, robots.txt asked first."""
    return http_get(url, timeout, user_agent, follow=False)


def server_of(host: str) -> str:
    """The address ``host`` resolves to, or ``host`` itself when it does not."""
    try:
        info = socket.getaddrinfo(host, 443, socket.AF_INET, socket.SOCK_STREAM)
    except (OSError, UnicodeError):
        return host
    return str(info[0][4][0]) if info else host


def _split_scope(scope: str) -> tuple[str, str]:
    host, _, path = scope.partition("/")
    return host, "/" + path if path else ""


def _outcome(
    key: str, docs: list[PersonDocRow], search: UnitSearch
) -> tuple[str, str, int]:
    """(status, reason, files down) of one candidacy after its unit's search."""
    mine = [d for d in docs if d.key == key]
    ok = [d for d in mine if d.status == "ok"]
    if any(d.named for d in ok):
        return "found", "named", len(ok)
    if ok:
        # Only files that name nobody: the OCR step has to find the person in
        # them before this counts.
        return "unconfirmed", "unnamed", len(ok)
    if search.status != "searched":
        return "not_found", search.status, 0
    if mine:
        statuses = {d.status for d in mine}
        if statuses == {REFUSED}:
            return "not_found", REFUSED, 0
        if statuses & {f"http {status}" for status in _NOT_NOW}:
            return "not_found", THROTTLED, 0
        return "not_found", "download_failed", 0
    if search.declaration_pages == 0 and not any(
        c.declaration_like for c in search.found
    ):
        return "not_found", "no_declarations", 0
    return "not_found", "not_listed", 0


def run_people_mode(
    args,  # the crawl command's argparse.Namespace
    pg,  # PostgresClient
    bip_queue: BipQueue,
    bundles: LocalBundleStore,
    robots_allowed: Callable[[str], bool],
    robots_unreachable: Callable[[str], bool] = lambda url: False,
    agents: Callable[[str], str] | None = None,
) -> int:
    """`koryta_scrape_bip crawl --people-of-interest`: read the list, search, report."""
    # The package imports this module, so its helpers come in at call time.
    from jobs.bip_crawler import (  # noqa: PLC0415
        EXIT_TRY_LATER,
        USER_AGENT,
        registry_xml,
    )

    ctx, _ = setup_context(policy=list_policy())
    people = read_list(ctx)
    store = PostgresBipPeopleStore(pg)
    rows = with_outcomes(people, store.searched())
    pending = sum(r.status == "pending" for r in rows)
    retry = frozenset(r.strip() for r in args.poi_retry.split(",") if r.strip())
    todo = to_search(
        rows,
        refresh=args.poi_refresh,
        max_priority=args.poi_max_priority,
        limit=args.poi_limit,
        retry=retry,
        retry_before=args.poi_retry_before,
    )
    if args.poi_units is not None:
        todo = [r for r in todo if r.unit in args.poi_units]
    print(
        f"people of interest: {len(people):,} candidacies ({pending:,} pending); "
        f"{len(todo):,} to search in {len({r.unit for r in todo}):,} units",
        flush=True,
    )
    xml, source = registry_xml(args.xml_cache, refresh=args.refresh_registry)
    seeds = unit_seeds(
        parse_subjects_xml(xml),
        read_public_bodies_catalogue(ctx),
        terc_index(read_terc(ctx)),
    )
    checked = apply_unit_starts(seeds, read_unit_starts())
    print(
        f"unit starts: {len(seeds):,} units (registry from {source}; "
        f"{checked:,} from {UNIT_STARTS.name})",
        flush=True,
    )
    options = PeopleOptions(
        unit_pages=args.unit_pages,
        pages_per_candidacy=args.pages_per_candidacy,
        max_unit_pages=args.max_unit_pages,
        sitemaps=not args.no_sitemaps,
        per_person=args.per_person,
        workers=args.workers,
        rate_interval_s=args.rate,
        user_agent=USER_AGENT,
        max_run_seconds=args.max_minutes * 60 if args.max_minutes else None,
        max_unit_seconds=args.max_unit_minutes * 60 if args.max_unit_minutes else None,
        max_per_host=args.max_per_host,
        max_per_server=args.max_per_server,
    )
    known = load_known_urls(Path(args.known_urls)) if args.known_urls else {}
    if known:
        print(
            f"known declaration URLs: {sum(map(len, known.values())):,} "
            f"on {len(known):,} hosts",
            flush=True,
        )
    renderer, how = None, "read as their HTML"
    if not args.no_render and args.render_workers > 0 and rendering.available():
        try:
            renderer = rendering.Renderer(USER_AGENT, workers=args.render_workers)
            how = "rendered in headless Chromium"
        except rendering.RendererDown as exc:
            how = f"read as their HTML (no browser started: {exc})"
    print(f"JavaScript pages: {how}", flush=True)
    search = PeopleSearch(
        store,
        bip_queue,
        bundles,
        seeds,
        options,
        robots_allowed=robots_allowed,
        robots_unreachable=robots_unreachable,
        known=known,
        render=renderer.render if renderer else None,
        unit_sizes=Counter(p.unit for p in people),
        first_names=frozenset(
            stem(p.first_name, min_a=4) for p in people if p.first_name
        ),
        resolve=server_of,
        agents=agents,
    )
    try:
        counts = search.run(todo)
    finally:
        if renderer:
            renderer.close()
    now = with_outcomes(people, store.searched())
    summary = {
        "this_run": counts,
        "all_candidacies": outcomes(now),
        # 2014's declarations are mostly past BIP's six years: this shows how many
        "by_election_year": outcomes_by_year(now),
    }
    print(json.dumps(summary, indent=2))
    return EXIT_TRY_LATER if search.timed_out else 0
