"""People mode: find named people's oświadczenia majątkowe on their units' BIPs.

``koryta_scrape_bip crawl --people-of-interest`` reads ``BipPeopleOfInterest``
(one row per won local candidacy) and, unit by unit, searches the BIP of the
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
not_found with a reason, in ``bip_poi`` (``stores.bip_people``):

- ``no_seed``: neither list has an office for the unit;
- ``unreachable``: no page of the unit's BIP answered (retried by default);
- ``robots``: robots.txt keeps the crawler out of where it starts;
- ``no_declarations``: no page read looked like a declarations page;
- ``not_listed``: declarations were found, none named the person, and the
  unit had no unnamed declaration file to look inside either;
- ``download_failed``: links named the person, and no file came down;
- ``timeout``: the run's time ran out during the walk (retried by default);
- ``error``: the unit's search failed unexpectedly (retried by default).

Politeness is the blind crawl's: robots.txt, one request per host per
``--rate`` seconds, the same User-Agent and fetch.
"""

from __future__ import annotations

import hashlib
import heapq
import json
import logging
import re
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Callable
from urllib.parse import urlsplit

from analysis.bip_people_of_interest import BipPeopleOfInterest
from conductor import setup_context
from entities.bip import BipPersonOfInterest
from scrapers.bip.classify import (
    filename_from_url,
    host_of,
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
    satisfied,
)
from scrapers.bip.registry import parse_subjects_xml
from scrapers.bip.units import UnitSeed, scope_of, terc_index, unit_seeds
from scrapers.common.fetch import HttpResult, http_get
from scrapers.common.links import LinkContext, extract_link_contexts
from scrapers.common.ratelimit import HostTokenBucket
from scrapers.krs.data import read_public_bodies_catalogue
from scrapers.map.teryt import read_terc
from scrapers.stores import (
    BipPeopleStore,
    BipQueue,
    PersonDocRow,
    PersonRow,
    ProcessPolicy,
    UnitRow,
)
from stores.bip_bundles import LocalBundleStore
from stores.bip_people import PostgresBipPeopleStore

logger = logging.getLogger(__name__)

#: A link with one of these extensions is a file, never a page to read.
_FILE = re.compile(
    r"\.(pdf|docx?|odt|rtf|xlsx?|ods|jpe?g|png|tiff?|zip|7z|rar)(?:$|[?#])", re.I
)
_BIP_LINK = re.compile(r"(?:^| )bip(?: |$)|biuletyn informacji publicznej")


@dataclass
class PeopleOptions:
    unit_pages: int = 150
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


def person_row(person: BipPersonOfInterest) -> PersonRow:
    return PersonRow(
        key=person.key,
        unit=person.teryt,
        priority=person.priority,
        election_year=person.election_year,
        first_name=person.first_name,
        last_name=person.last_name,
        person=asdict(person),
    )


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


#: Hosts no unit's BIP lives on, though a unit's website may link to them.
_NOT_A_UNITS_BIP = frozenset(
    {"bip.gov.pl", "gov.pl", "epuap.gov.pl", "obywatel.gov.pl", "biznes.gov.pl"}
)
#: What `_get` answers instead of a response.
ROBOTS, UNREACHABLE = "robots", "unreachable"
#: Reasons a later run searches again by default: the BIP may answer next time.
DEFAULT_RETRY = frozenset({"unreachable", "error", "timeout"})
#: Read as they are on disk, else restored from the shared cache: the night
#: builds the list, the crawler never rebuilds it. Unpinned, a workspace with
#: the list but not every tree under its inputs took it for stale: the second
#: run rebuilt the list, the third PeopleMerged as well, and each went up to
#: the shared cache.
PINNED = frozenset({"BipPeopleOfInterest", "PeopleMerged"})


def list_policy() -> ProcessPolicy:
    return ProcessPolicy(set(), exclude_refresh=set(PINNED))


@dataclass
class _Frontier:
    """A unit's pages to read, best first, kept to the unit's (host, path) scopes."""

    scopes: list[tuple[str, str]]
    heap: list[tuple[float, int, int, str]] = field(default_factory=list)
    seen: set[str] = field(default_factory=set)
    sequence: int = 0

    def __bool__(self) -> bool:
        return bool(self.heap)

    def add(self, url: str, score: float, depth: int) -> None:
        if url in self.seen:
            return
        self.seen.add(url)
        heapq.heappush(self.heap, (-score, depth, self.sequence, url))
        self.sequence += 1

    def pop(self) -> tuple[int, str]:
        _, depth, _, url = heapq.heappop(self.heap)
        return depth, url

    def adopt(self, host: str) -> None:
        if host and host not in {h for h, _ in self.scopes}:
            self.scopes.append((host, ""))

    def in_scope(self, url: str) -> bool:
        host, path = host_of(url), urlsplit(url).path.lower()
        return any(host == h and (not p or path.startswith(p)) for h, p in self.scopes)

    def follow(
        self, links: list[LinkContext], seekers: list[Seeker], depth: int
    ) -> None:
        """Queue a page's links to other pages; files are for the download."""
        for link in links:
            target = normalize_url(link.url)
            if (
                target in self.seen
                or _FILE.search(target)
                or is_file_link(target)
                or is_low_value_url(target)
                or not self.in_scope(target)
            ):
                continue
            score = link_score(link, seekers, depth)
            if score > -3:
                self.add(target, score, depth)


class PeopleSearch:
    def __init__(
        self,
        people_store: BipPeopleStore,
        bip_queue: BipQueue,
        bundles: LocalBundleStore,
        seeds: dict[str, UnitSeed],
        options: PeopleOptions,
        *,
        fetch: Callable[[str, float, str], HttpResult] = http_get,
        robots_allowed: Callable[[str], bool] = lambda url: True,
        robots_unreachable: Callable[[str], bool] = lambda url: False,
        limiter: HostTokenBucket | None = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.people_store = people_store
        self.bip_queue = bip_queue
        self.bundles = bundles
        self.seeds = seeds
        self.options = options
        self.fetch = fetch
        self.robots_allowed = robots_allowed
        self.robots_unreachable = robots_unreachable
        self.limiter = limiter or HostTokenBucket(options.rate_interval_s)
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

    def _past_deadline(self) -> bool:
        return self.deadline is not None and self.clock() > self.deadline

    # -- one request -----------------------------------------------------------
    def _get(self, url: str) -> HttpResult | str:
        """robots.txt, the host's rate, then the fetch.

        ROBOTS when robots.txt keeps the crawler out, UNREACHABLE when the host
        did not even answer for its robots.txt (the cache denies those too).
        """
        if not self.robots_allowed(url):
            return UNREACHABLE if self.robots_unreachable(url) else ROBOTS
        host = host_of(url)
        while not self.limiter.acquire(host):
            self.sleep(max(0.05, self.limiter.next_available_in(host)))
        return self.fetch(url, self.options.request_timeout_s, self.options.user_agent)

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

    # -- the walk ----------------------------------------------------------------
    def search_unit(self, unit: str, seekers: list[Seeker]) -> UnitSearch:
        out = UnitSearch(unit)
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
            frontier.add(normalize_url(root), 100.0, 0)
        blocked = down = requests = 0
        budget = self.options.unit_pages
        # Links that keep turning out to be files cost requests, not pages.
        while frontier and out.pages < budget and requests < 2 * budget:
            if self._past_deadline():
                out.status = "timeout"
                break
            depth, url = frontier.pop()
            result = self._get(url)
            if isinstance(result, str):
                blocked += result == ROBOTS
                down += result == UNREACHABLE
                continue
            requests += 1
            if not result.ok or len(result.content) > self.options.max_doc_bytes:
                down += result.status == 0
                out.pages += 1
                continue
            if not self._is_page(result):
                out.files[url] = result  # a file behind a page-like link
                continue
            self._read_page(out, result, depth, frontier, seekers)
            if satisfied(out.found, seekers, self.options.per_person):
                break
        if out.pages_ok == 0 and out.status == "searched":
            only_robots = blocked and not down and requests == 0
            out.status = ROBOTS if only_robots else UNREACHABLE
        return out

    def _read_page(
        self,
        out: UnitSearch,
        result: HttpResult,
        depth: int,
        frontier: _Frontier,
        seekers: list[Seeker],
    ) -> None:
        out.pages += 1
        out.pages_ok += 1
        if depth == 0:
            # A start page that redirected elsewhere brings its host into scope.
            frontier.adopt(host_of(result.url))
        title, links = extract_link_contexts(
            result.content, result.url, result.content_type
        )
        folded_title = fold(title)
        if DECLARATION.search(folded_title) or ASSETS.search(folded_title):
            out.declaration_pages += 1
        out.found.extend(candidates(result.url, title, links, seekers))
        if depth < self.options.max_depth:
            frontier.follow(links, seekers, depth + 1)

    # -- downloads -----------------------------------------------------------------
    def _download(
        self, url: str, page_url: str, fetched: HttpResult | None = None
    ) -> tuple[str, str, str]:
        """(status, sha256, bundle) of one file, stored as the blind crawl stores."""
        result = fetched if fetched is not None else self._get(url)
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
        seekers = [Seeker.of(r.key, r.first_name, r.last_name) for r in rows]
        search = self.search_unit(unit, seekers)
        picks = choose(
            search.found, seekers, self.options.per_person, self.options.unnamed_cap
        )
        named_urls = {(c.key, c.url) for c in search.found if c.key}
        downloaded: dict[str, tuple[str, str, str]] = {}
        doc_rows: list[PersonDocRow] = []
        for key, chosen in picks.items():
            for c in chosen:
                if c.url not in downloaded:
                    cached = search.files.get(normalize_url(c.url))
                    downloaded[c.url] = self._download(c.url, c.page_url, cached)
                status, sha, bundle = downloaded[c.url]
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
        for host in {host_of(url) for url in downloaded}:
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

    def run(self, rows: list[PersonRow]) -> dict[str, int]:
        """Search every unit ``rows`` name, most wanted first; counts of outcomes."""
        by_unit: dict[str, list[PersonRow]] = defaultdict(list)
        for r in rows:
            by_unit[r.unit].append(r)
        order = sorted(
            by_unit,
            key=lambda u: (min(r.priority for r in by_unit[u]), -len(by_unit[u]), u),
        )
        if self.options.max_run_seconds is not None:
            self.deadline = self.clock() + self.options.max_run_seconds
        counts: dict[str, int] = defaultdict(int)
        with ThreadPoolExecutor(max_workers=self.options.workers) as pool:
            futures = [pool.submit(self._unit, unit, by_unit[unit]) for unit in order]
            for future in as_completed(futures):
                outcomes = future.result()
                if outcomes is None:
                    self.timed_out = True
                    continue
                for outcome in outcomes.values():
                    counts[outcome] += 1
                    self.timed_out |= outcome.endswith(":timeout")
        self.bundles.flush()
        return dict(sorted(counts.items()))


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
) -> int:
    """`koryta_scrape_bip crawl --people-of-interest`: read the list, search, report."""
    # The package imports this module, so its helpers come in at call time.
    from jobs.bip_crawler import (  # noqa: PLC0415
        EXIT_TRY_LATER,
        USER_AGENT,
        registry_xml,
    )

    ctx, _ = setup_context(policy=list_policy())
    people = list(BipPeopleOfInterest().read_or_process_list(ctx))
    store = PostgresBipPeopleStore(pg)
    new = store.upsert_people([person_row(p) for p in people])
    retry = frozenset(r.strip() for r in args.poi_retry.split(",") if r.strip())
    todo = store.people_to_search(
        refresh=args.poi_refresh,
        max_priority=args.poi_max_priority,
        limit=args.poi_limit,
        retry=retry,
    )
    print(
        f"people of interest: {len(people):,} candidacies ({new:,} new); "
        f"{len(todo):,} to search in {len({r.unit for r in todo}):,} units",
        flush=True,
    )
    xml, source = registry_xml(args.xml_cache, refresh=args.refresh_registry)
    seeds = unit_seeds(
        parse_subjects_xml(xml),
        read_public_bodies_catalogue(ctx),
        terc_index(read_terc(ctx)),
    )
    print(f"unit starts: {len(seeds):,} units (registry from {source})", flush=True)
    options = PeopleOptions(
        unit_pages=args.unit_pages,
        per_person=args.per_person,
        workers=args.workers,
        rate_interval_s=args.rate,
        user_agent=USER_AGENT,
        max_run_seconds=args.max_minutes * 60 if args.max_minutes else None,
    )
    search = PeopleSearch(
        store,
        bip_queue,
        bundles,
        seeds,
        options,
        robots_allowed=robots_allowed,
        robots_unreachable=robots_unreachable,
    )
    counts = search.run(todo)
    summary = {
        "this_run": counts,
        "all_candidacies": store.outcomes(),
        # 2014's declarations are mostly past BIP's six years: this shows how many
        "by_election_year": store.outcomes_by_year(),
    }
    print(json.dumps(summary, indent=2))
    return EXIT_TRY_LATER if search.timed_out else 0
