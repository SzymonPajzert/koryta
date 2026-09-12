import argparse
import json
import typing
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from enum import Enum
from functools import cached_property

import pandas as pd
from tqdm import tqdm

from analysis.extract import is_public
from analysis.interesting import Companies
from analysis.people import PeopleMerged
from entities.company import KRS
from entities.person import RejestrIOKey
from scrapers.koryta.download import KorytaPeople, KorytaVotes
from scrapers.krs.censored import KRSCensoredPeople
from scrapers.krs.columns import normalise
from scrapers.krs.coverage import PersonFeedCoverage, RejestrIOCoverage
from scrapers.krs.data import CompaniesHardcoded, PeopleRejestrIOHardcoded
from scrapers.krs.graph import CompanyGraph
from scrapers.krs.list import CompaniesKRS, PeopleKRS
from scrapers.krs.people_parsing import is_not_found
from scrapers.krs.updates import KRSUpdates
from scrapers.stores import (
    CloudStorage,
    Context,
    Pipeline,
    iterate_pipeline_dict,
)
from scrapers.stores.file import DownloadableFile


class QueryType(Enum):
    API_KRS_ODPIS_AKTUALNY_P = "api_krs_odpis_aktualny_p"
    API_KRS_ODPIS_AKTUALNY_S = "api_krs_odpis_aktualny_s"
    REJESTRIO_ORG = "rejestrio_org"
    REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE = "rejestrio_org_krs_powiazania_aktualne"
    REJESTRIO_ORG_KRS_POWIAZANIA_HISTORYCZNE = (
        "rejestrio_org_krs_powiazania_historyczne"
    )
    REJESTRIO_OSOBY_KRS_POWIAZANIA_AKTUALNE = "rejestrio_osoby_krs_powiazania_aktualne"
    REJESTRIO_OSOBY_KRS_POWIAZANIA_HISTORYCZNE = (
        "rejestrio_osoby_krs_powiazania_historyczne"
    )


#: Why a query is in the list, which is the only thing that explains the bill.
#: A KRS reaches `save_org_connections` through one of several doors and the
#: query itself does not say which, so `cost_breakdown` cannot group by
#: anything but this.
REASON_HARDCODED = "hardcoded"
REASON_PERSON_FEED = "person_feed"
REASON_OWNED = "owned"
REASON_REFRESH = "refresh"
REASON_MISSING_NAME = "missing_name"
REASON_MISSING_REGISTER_ENTRY = "missing_register_entry"
REASON_INTERESTING_PERSON = "interesting_person"
#: A query whose caller recorded nothing. Reported rather than dropped, so the
#: rows of the breakdown always add up to what is about to be spent.
REASON_UNRECORDED = "unrecorded"

#: Which reason a query is filed under when it carries several, most specific
#: first. A refresh outranks every discovery reason: the company is on file
#: either way, and what is being bought is the newer copy.
REASON_PRECEDENCE = (
    REASON_REFRESH,
    REASON_HARDCODED,
    REASON_PERSON_FEED,
    REASON_OWNED,
    REASON_MISSING_NAME,
    REASON_MISSING_REGISTER_ENTRY,
    REASON_INTERESTING_PERSON,
    REASON_UNRECORDED,
)


@dataclass
class RejestrIOQuery:
    krs: KRS | None = None
    person: RejestrIOKey | None = None
    queries: list[QueryType] = field(default_factory=lambda: [])
    #: Why this query exists, in the words of `REASON_PRECEDENCE`. Carried on
    #: the query rather than worked out again later, because by the time the
    #: bill is printed the sources that chose the company are gone.
    reasons: list[str] = field(default_factory=lambda: [])

    def __post_init__(self):
        if self.krs is None and self.person is None:
            raise ValueError("Either krs or person must be provided")
        # TODO add a check that if you list KRS connections, you need to provide a KRS

    def cost(self) -> float:
        """Calculate the cost of this query based on which APIs it will call."""
        calls = [q for q in self.queries if q.value.startswith("rejestrio")]
        return len(calls) * 0.05

    def paid_calls(self) -> int:
        """How many rejestr.io calls this query is, which is what is billed."""
        return len([q for q in self.queries if q.value.startswith("rejestrio")])

    @property
    def primary_reason(self) -> str:
        """The one reason this query is filed under in the breakdown.

        A company can arrive through more than one door - owned by a starter
        and named in a person's feed - and a row per reason would add up to
        more than the bill. `REASON_PRECEDENCE` picks one, so the report
        totals what is about to be spent.
        """
        for reason in REASON_PRECEDENCE:
            if reason in self.reasons:
                return reason
        return REASON_UNRECORDED

    def urls(self, only_free=False) -> typing.Iterable[str]:
        if QueryType.API_KRS_ODPIS_AKTUALNY_P in self.queries:
            assert self.krs is not None
            yield f"https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/{self.krs}?rejestr=P&format=json"
        if QueryType.API_KRS_ODPIS_AKTUALNY_S in self.queries:
            assert self.krs is not None
            yield f"https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/{self.krs}?rejestr=S&format=json"
        if QueryType.REJESTRIO_ORG in self.queries and not only_free:
            assert self.krs is not None
            yield f"https://rejestr.io/api/v2/org/{self.krs}"

        if not only_free:
            if QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE in self.queries:
                assert self.krs is not None
                yield f"https://rejestr.io/api/v2/org/{self.krs}/krs-powiazania?aktualnosc=aktualne"
            if QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_HISTORYCZNE in self.queries:
                assert self.krs is not None
                yield f"https://rejestr.io/api/v2/org/{self.krs}/krs-powiazania?aktualnosc=historyczne"
            if QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_AKTUALNE in self.queries:
                assert self.person is not None
                yield f"https://rejestr.io/api/v2/osoby/{self.person.id}/krs-powiazania?aktualnosc=aktualne"
            if QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_HISTORYCZNE in self.queries:
                assert self.person is not None
                yield f"https://rejestr.io/api/v2/osoby/{self.person.id}/krs-powiazania?aktualnosc=historyczne"


class KRSSet:
    """
    Represents a set of KRS entries, merging and handling duplicates.
    """

    def __init__(self, initial_entries: typing.Optional[typing.Iterable[KRS]] = None):
        self.entries: dict[str, KRS] = {}
        if initial_entries:
            for krs in initial_entries:
                self.add(krs)

    def add(self, krs: KRS):
        """Adds a KRS entry to the set or merges if the same ID already exists."""
        if krs.id in self.entries:
            self.entries[krs.id] = self.entries[krs.id].merge(krs)
        else:
            self.entries[krs.id] = krs

    def __or__(self, other: "KRSSet") -> "KRSSet":
        """Returns a new KRSSet containing the union of both sets."""
        result = KRSSet(self.entries.values())
        for entry in other.entries.values():
            result.add(entry)
        return result

    def __sub__(self, other: "KRSSet") -> "KRSSet":
        """Returns a new KRSSet containing differences between the sets."""
        result = KRSSet()
        for id, entry in self.entries.items():
            if id not in other.entries:
                result.add(entry)
        return result

    def __iter__(self):
        return iter(self.entries.values())

    def __len__(self):
        return len(self.entries)

    def __getitem__(self, key: str):
        return self.entries[key]

    def __contains__(self, key: str):
        return key in self.entries


def api_krs_register(url: str) -> QueryType:
    """Which register an api-krs OdpisAktualny query asked for.

    A company is in one register and not the other, so both are asked and one
    answers 404. Recording both as the P query left the S query looking
    unasked, so `save_org_connections` re-issued it for every company on every
    run - and stored another empty object each time.

    The oldest blobs carry no ``?rejestr=`` at all, from before the parameter
    was sent; P is what those were.
    """
    return (
        QueryType.API_KRS_ODPIS_AKTUALNY_S
        if "rejestr=S" in url
        else QueryType.API_KRS_ODPIS_AKTUALNY_P
    )


@dataclass
class KRSScraped:
    krs: str
    method: QueryType
    date: str
    #: This is the newest response for its (krs, register) and the register
    #: answered that the company is not in it. Only ever set from a body that
    #: said so: a crawl that did not come back leaves it False, because that
    #: says nothing about the company and is worth repeating.
    not_found: bool = False

    @staticmethod
    def parse(url: str) -> typing.Optional["KRSScraped"]:
        date = url.split("/date=", 1)[1].split("/", 1)[0]

        if "rejestr.io" in url and "org/" in url:
            krs = url.split("org/", 1)[1].split("/", 1)[0]
            if "aktualnosc_aktualne" in url:
                return KRSScraped(
                    krs, QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE, date
                )
            elif "aktualnosc_historyczne" in url:
                return KRSScraped(
                    krs, QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_HISTORYCZNE, date
                )
            else:
                return KRSScraped(krs, QueryType.REJESTRIO_ORG, date)
        elif "api-krs.ms.gov.pl" in url:
            if "Biuletyn" in url:
                return None
            krs = url.split("OdpisAktualny/", 1)[1].split("/", 1)[0]
            return KRSScraped(krs, api_krs_register(url), date)
        else:
            return None


#: Anything longer than this is a register entry, so there is nothing to
#: check by opening it. A 404 body is 168 bytes and the shortest entry in the
#: crawl is 1,784, which leaves the bound a lot of room to be wrong in.
NOT_FOUND_SIZE_BOUND = 1024

#: The two free queries, the only ones a 404 can come back from.
API_KRS_METHODS = (
    QueryType.API_KRS_ODPIS_AKTUALNY_P,
    QueryType.API_KRS_ODPIS_AKTUALNY_S,
)


def _read_json(ctx: Context, blob_ref: DownloadableFile):
    """A stored response as parsed JSON, or None if there is nothing to read."""
    try:
        content = ctx.io.read_data(blob_ref).read_string()
    except Exception as e:
        print(f"Could not read {blob_ref.url}: {e}")
        return None
    if not content:
        return None
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return None


# TODO spread the usage of this function
def enum_dict_factory(data):
    """Converts enum fields to their underlying value."""
    result = []
    for key, value in data:
        if isinstance(value, Enum):
            result.append((key, value.value))
        else:
            result.append((key, value))
    return dict(result)


class KRSAlreadyScraped(Pipeline):
    filename = "krs_already_scraped"
    dtype = {"krs": str}

    def process(self, ctx: Context):
        """Lists krs numbers along with the method and the date it was ran on.

        A crawl that failed is stored as a zero-byte object rather than not
        stored at all (see `scraper.scrape_krs_free`), so the object existing
        is not the same as the query having been answered. Counting those as
        scraped left 1,052 api-krs subjects - 402 companies with nothing from
        either register - looking done and never retried.

        Told apart by the size the listing already carries, so no body is read
        here. A reference whose size is unknown is kept: unknown is not empty.
        """
        output = []
        success, fail, empty = 0, 0, 0
        # The newest response for each (krs, register), which is the only one
        # whose answer still stands.
        newest: dict[tuple[str, QueryType], tuple[KRSScraped, DownloadableFile]] = {}

        for prefix in ("hostname=rejestr.io", "hostname=api-krs.ms.gov.pl"):
            for blob_name in tqdm(ctx.io.list_files(CloudStorage(prefix=prefix))):
                assert isinstance(blob_name, DownloadableFile)
                if blob_name.size == 0:
                    empty += 1
                    continue
                r = KRSScraped.parse(blob_name.url)
                if r:
                    success += 1
                    output.append(r)
                    if r.method in API_KRS_METHODS:
                        seen = newest.get((r.krs, r.method))
                        if seen is None or r.date >= seen[0].date:
                            newest[(r.krs, r.method)] = (r, blob_name)
                else:
                    fail += 1
            print(f"{prefix}: success {success}, fail {fail}, failed crawls {empty}")

        self._mark_not_found(ctx, newest)

        return pd.DataFrame.from_records(
            [asdict(r, dict_factory=enum_dict_factory) for r in output]
        )

    def _mark_not_found(
        self,
        ctx: Context,
        newest: dict[tuple[str, QueryType], tuple[KRSScraped, "DownloadableFile"]],
    ) -> None:
        """Flag the newest response per register that was a 404.

        Read rather than inferred, because it is used to stop asking: a
        company that is genuinely absent from a register stays absent, and
        acting on a guess would be to stop asking about a company we do hold.

        Only the small ones are opened. A 404 body is 168 bytes, every one of
        the 4,152 in the crawl; the smallest register entry is 1,784, so the
        listing's own size picks out every candidate and nothing else. A
        reference whose size is unknown is opened too - unknown is not small,
        but it is not big either, and only a listing that carries sizes can
        say which.
        """
        candidates = [
            (scraped, ref)
            for scraped, ref in newest.values()
            if ref.size is None or ref.size <= NOT_FOUND_SIZE_BOUND
        ]
        for scraped, ref in tqdm(candidates, desc="Reading the short api-krs bodies"):
            scraped.not_found = is_not_found(_read_json(ctx, ref))
        settled = sum(scraped.not_found for scraped, _ in candidates)
        print(
            f"Registers that answered 404: {settled} "
            f"(read {len(candidates)} of {len(newest)} newest responses)"
        )

    def latest_scrapes(self, ctx: Context):
        """The most recent response for each (krs, method), as it came back.

        The whole row rather than the maximum of each column: `not_found` is
        the answer the register gave on one date, and maximising it would
        carry a 404 forward past a later response that did find the company.
        """
        df = normalise(self.read_or_process(ctx), "date")
        return (
            df.sort_values("date")
            .drop_duplicates(subset=["krs", "method"], keep="last")
            .reset_index(drop=True)
        )


# The results from analysis/update_rate suggest 4 days is enough for 90% success rate
# of the propagation.
SKIP_WORK_DAYS = 4


def compute_refresh_cutoff_date(today: date, skip_days: int) -> str:
    """Compute a cutoff date by skipping `skip_days` business days back from `today`.

    Only weekdays (Mon-Fri) are counted. The returned date is the last
    skipped day (i.e. everything strictly before this date should be
    included).

    Example: if today is Saturday 2026-07-18 and skip_days is 2, the
    function skips Friday (1) and Thursday (2), returning "2026-07-16".
    """
    current = today
    skipped = 0
    while skipped < skip_days:
        current -= timedelta(days=1)
        if current.weekday() < 5:  # Monday=0 … Friday=4
            skipped += 1
    return current.isoformat()


#: The api-krs pair, which costs nothing. Everything else a needs-refresh
#: frame can name is a rejestr.io call, and `RejestrIOQuery.cost` bills it.
FREE_METHODS = (
    QueryType.API_KRS_ODPIS_AKTUALNY_P.value,
    QueryType.API_KRS_ODPIS_AKTUALNY_S.value,
)


#: The paid rejestr.io calls a company needs re-issued once its stored
#: connections are known to be out of date. The api-krs pair is free and
#: re-fetched every run anyway.
ORG_CONNECTION_METHODS = (
    QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE.value,
    QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_HISTORYCZNE.value,
)


def filter_paid_by_people_changes(
    needs_refresh: pd.DataFrame, changed_krs: dict[str, str]
) -> pd.DataFrame:
    """Hold back the paid queries whose company's people have not moved.

    The censored people api-krs serves are the free evidence that a company
    changed hands, and buying a rejestr.io response without them is buying
    the response already on file. So the paid queries wait for that evidence.

    The free api-krs queries in the same frame must not, and used to: the
    only thing that can produce the evidence is a fresh api-krs snapshot,
    which is exactly what those rows would fetch. A company whose snapshot
    predates the change it is being asked about could therefore never be
    asked again - TOMASZOWSKIE TBS (0000095675) last read the register on
    2026-06-20, appointed a supervisor on 2026-08-11 with the bulletin
    saying so, and stayed frozen because the 2026-06-20 snapshot naturally
    said nothing about somebody appointed two months later.

    They have already passed the bulletin's own test - the register moved
    since we last looked - which is the whole of what a free query needs.
    """
    if needs_refresh.empty:
        return needs_refresh

    def has_recent_change(row):
        krs = row["krs"]
        if krs not in changed_krs:
            return False
        change_date = changed_krs[krs]
        last_scrape = row["date"]
        return change_date > last_scrape

    # Named by what is free rather than by what is billed, so a rejestr.io
    # method added later is held back by default rather than escaping.
    free = needs_refresh["method"].isin(FREE_METHODS)
    return needs_refresh[free | needs_refresh.apply(has_recent_change, axis=1)]


class KRSNeedsRefresh(Pipeline):
    filename = "krs_needs_refresh"
    dtype = {"krs": str}

    already_scraped: KRSAlreadyScraped
    updates: KRSUpdates
    censored_people: KRSCensoredPeople
    coverage: RejestrIOCoverage

    @property
    def refresh_cutoff_date(self) -> str:
        return compute_refresh_cutoff_date(date.today(), SKIP_WORK_DAYS)

    def stale_coverage(self, ctx) -> pd.DataFrame:
        """Companies whose stored rejestr.io response is missing somebody.

        The bulletin path below only fires on a *new* change, so a response
        fetched before rejestr.io caught up with an old one would never be
        corrected. RejestrIOCoverage finds those by comparing the response
        against the censored people api-krs served at the same time, and holds
        each one back for a backoff so a company rejestr.io has no record of
        is not re-bought every run.
        """
        due = self.coverage.krs_to_rescrape(ctx)
        if not due:
            return pd.DataFrame(columns=["krs", "method", "date", "update_date"])

        scraped = self.already_scraped.latest_scrapes(ctx)
        rows = scraped[
            scraped["krs"].isin(due) & scraped["method"].isin(ORG_CONNECTION_METHODS)
        ].copy()
        # The scrape that came back short is what dates the refresh: it is the
        # observation that made this company stale.
        rows["update_date"] = rows["date"]
        print(f"Stale rejestr.io responses: {len(rows)} queries over {len(due)} KRS")
        return rows

    def process(self, ctx):
        """Every query a company is owed, from three sources that disagree.

        The bulletin says a company's entry moved since we last looked. That
        alone justifies the free api-krs pair, and `filter_paid_by_people_-
        changes` lets those through; the paid rejestr.io calls wait until the
        censored people api-krs serves have actually moved, because otherwise
        we are buying the response already on file.

        `stale_coverage` adds paid calls that pass no such test, and should
        not have to: those companies hold a response that provably disagrees
        with the register, which is stronger evidence than a change the
        censored list has yet to show. The whole point of it is the response
        that was wrong when it was bought - nothing further has to happen to
        that company for the copy we hold to be wrong.
        """

        latest_scrapes = self.already_scraped.latest_scrapes(ctx)

        updates_df = normalise(self.updates.read_or_process(ctx), "date")
        if updates_df.empty:
            return self.stale_coverage(ctx)

        latest_updates = updates_df.groupby(["krs"]).aggregate("max").reset_index()
        latest_updates = latest_updates.rename(columns={"date": "update_date"})

        merged = pd.merge(latest_scrapes, latest_updates, on="krs", how="inner")
        needs_refresh = merged[
            (merged["update_date"] > merged["date"])
            & (merged["update_date"] < self.refresh_cutoff_date)
        ]

        changed_krs = self.censored_people.krs_with_people_changes(ctx)
        before_count = len(needs_refresh)
        needs_refresh = filter_paid_by_people_changes(needs_refresh, changed_krs)
        print(
            f"Censored people pre-filter: {before_count} → "
            f"{len(needs_refresh)} KRS entries"
        )

        needs_refresh = pd.concat(
            [needs_refresh, self.stale_coverage(ctx)], ignore_index=True
        ).drop_duplicates(subset=["krs", "method"], keep="first")

        return needs_refresh.sort_values(by=["update_date"], ascending=False)


PEOPLE_QUERIES = [
    QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_AKTUALNE,
    QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_HISTORYCZNE,
]

# How upload_result spells each person endpoint in the blob path: the
# ?aktualnosc= query parameter is folded into the path before the upload.
OSOBY_QUERY_BY_PATH = {
    "aktualnosc_aktualne": QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_AKTUALNE,
    "aktualnosc_historyczne": QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_HISTORYCZNE,
}


def get_osoby_scraped(
    ctx: Context, stale: typing.Collection[str] = ()
) -> dict[str, set[QueryType]]:
    """Person endpoints that already have a response worth keeping.

    Keyed by the rejestr.io person id as a string, the spelling RejestrIOKey
    uses. A person is otherwise fetched once and never refreshed, because the
    KRS bulletin covers companies and there is no equivalent feed of "this
    person's connections changed".

    But there is a free signal, and this used to say there was not: every
    organisation inside a person feed carries rejestr.io's own count of how
    many times the register has written to that company's entry, and api-krs
    publishes the same count. `PersonFeedCoverage` compares them, and the
    people it finds were bought while rejestr.io was behind are dropped here
    so their queries are issued again.
    """
    osoby_scraped: dict[str, set[QueryType]] = {}
    for blob_name in ctx.io.list_files(CloudStorage(prefix="hostname=rejestr.io")):
        assert isinstance(blob_name, DownloadableFile)
        split = blob_name.url.split("/osoby/", 1)
        if len(split) < 2 or "krs-powiazania" not in blob_name.url:
            # Anything else under /osoby/ is not an endpoint we pay for here.
            continue

        person_id = split[1].split("/", 1)[0]
        if person_id in stale:
            # Held, so save_org_connections asks for them again.
            continue
        for path_marker, query in OSOBY_QUERY_BY_PATH.items():
            if path_marker in blob_name.url:
                osoby_scraped.setdefault(person_id, set()).add(query)
                break
        else:
            # Left loud on purpose: a person endpoint we fail to recognise here
            # is one we go on paying for, run after run.
            raise ValueError(f"Unknown url: {blob_name.url}")

    return osoby_scraped


def series_to_list(s: pd.Series) -> list[str]:
    return s.tolist()


def settled_registers(already_scraped_krs: pd.DataFrame) -> dict[str, set[QueryType]]:
    """Register queries a company has already been given the answer to.

    A KRS entry lives in a register, and the other one answers 404. That is
    not a gap to be filled by asking again: the register has said what it
    knows, and it will say the same next run. So the query is dropped for
    good rather than re-issued whenever something else about the company
    moves.

    What this gives up: an association that later registers as an
    entrepreneur gains an entry in a register that had answered 404 for it,
    and nothing here will go back and look. It is rare, and the alternative
    is a query per company per run for as long as the crawl exists.
    """
    if "not_found" not in already_scraped_krs.columns:
        # An output written before the column existed. Nothing is settled,
        # which is what the code did before it.
        return {}
    settled: dict[str, set[QueryType]] = {}
    answered = already_scraped_krs[
        already_scraped_krs["not_found"].fillna(False).astype(bool)
    ]
    for krs, method in zip(answered["krs"], answered["method"]):
        settled.setdefault(str(krs), set()).add(QueryType(method))
    return settled


def save_org_connections(
    already_scraped_krs: pd.DataFrame,
    needs_refresh_krs: pd.DataFrame,
    already_scraped_people: dict[str, set[QueryType]],
    connections: typing.Iterable[KRS],
    names: typing.Iterable[KRS],
    people: typing.Iterable[RejestrIOKey],
    company_reasons: dict[str, set[str]] | None = None,
    person_reasons: dict[str, set[str]] | None = None,
) -> typing.Iterable[RejestrIOQuery]:
    """Every query owed, each carrying why it is owed.

    The reasons come from the caller because that is where they are known:
    this function is handed four sets of subjects and nothing that says which
    door any of them came through. Passing none leaves the queries unexplained
    rather than unissued - `cost_breakdown` files those under
    `REASON_UNRECORDED` so the bill still adds up.
    """
    company_reasons = company_reasons or {}
    person_reasons = person_reasons or {}
    con_list = list(connections)
    con_refresh = needs_refresh_krs["krs"].unique().tolist()
    refresh_ids = set(str(krs) for krs in con_refresh)
    # Join KRS ids with the ones that needs a refresh.
    connections = set(con_list) | set(KRS(krs) for krs in con_refresh)

    names = list(names)
    people = list(people)

    print(
        f"len(connections): {len(con_list)} + {len(con_refresh)} = {len(connections)}"
    )
    print(f"len(names): {len(names)}")
    print(f"len(people): {len(people)}")

    print(f"\n\nalready_scraped_krs ({len(already_scraped_krs)}):")
    print(already_scraped_krs.head())
    print(already_scraped_krs[["method", "date"]].value_counts())
    print("Matching 0000062694")
    print(already_scraped_krs[already_scraped_krs["krs"] == "0000062694"])

    print(f"\n\nneeds_refresh_krs ({len(needs_refresh_krs)}):")
    print(needs_refresh_krs.head())
    print("Matching 0000062694")
    print(needs_refresh_krs[needs_refresh_krs["krs"] == "0000062694"])
    print(f"Nulls: {needs_refresh_krs['date'].isnull().sum()}")
    print(needs_refresh_krs["date"].value_counts())
    print(f"Nulls: {needs_refresh_krs['update_date'].isnull().sum()}")
    print(needs_refresh_krs["update_date"].value_counts())

    # Remove needs refresh from already_scraped_krs, since we need to update them.
    already_scraped = (
        pd.merge(
            already_scraped_krs[["krs", "method"]],
            needs_refresh_krs[["krs", "method"]],
            on=["krs", "method"],
            how="outer",
            indicator=True,
        )
        .query("_merge != 'both'")
        .drop("_merge", axis=1)
        .reset_index(drop=True)
        .groupby("krs")
        .aggregate(series_to_list)
    )

    print(f"\n\nalready_scraped ({len(already_scraped)}):")
    print(already_scraped.head())

    settled = settled_registers(already_scraped_krs)
    print(f"Registers already answered 404: {sum(len(s) for s in settled.values())}")

    for krs in connections:
        connections_methods: list[QueryType] = [
            QueryType(q) for q in already_scraped["method"].get(krs.id, [])
        ]
        answered = settled.get(krs.id, set())
        reasons = set(company_reasons.get(krs.id, set()))
        if krs.id in refresh_ids:
            reasons.add(REASON_REFRESH)
        query = RejestrIOQuery(
            krs=krs,
            queries=[
                q
                for q in [
                    QueryType.API_KRS_ODPIS_AKTUALNY_P,
                    QueryType.API_KRS_ODPIS_AKTUALNY_S,
                    QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE,
                    QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_HISTORYCZNE,
                ]
                if q not in connections_methods and q not in answered
            ],
            reasons=sorted(reasons),
        )
        if len(list(query.urls())) > 0:
            # If there's nothing to query, don't send it
            yield query

    for krs in names:
        # This loop asks regardless of what has been asked before - the name
        # is still missing - but a register that has answered still has
        # nothing more to say.
        answered = settled.get(krs.id, set())
        queries = [q for q in API_KRS_METHODS if q not in answered]
        if queries:
            yield RejestrIOQuery(
                krs=krs,
                queries=queries,
                reasons=sorted(company_reasons.get(krs.id, set())),
            )

    people_to_fetch = 0
    for person in people:
        # str(): the ids read out of a pipeline come back as whatever pandas
        # made of the column, and the keys here are always strings.
        people_methods = already_scraped_people.get(str(person.id), set())
        query = RejestrIOQuery(
            person=person,
            queries=[q for q in PEOPLE_QUERIES if q not in people_methods],
            reasons=sorted(
                person_reasons.get(str(person.id), {REASON_INTERESTING_PERSON})
            ),
        )
        if len(list(query.urls())) > 0:
            people_to_fetch += 1
            yield query

    print(f"People: {len(people)} of interest, {people_to_fetch} not yet scraped")


def public_krs_ids(companies: pd.DataFrame) -> set[str]:
    """The KRS ids the register puts in public hands, for the cost report.

    Missing column reads as "nobody", not as "everybody": the split is there
    to say how much of a bill is spent on the companies the site is about, and
    a frame built before `CompaniesKRS` wrote `is_public` cannot answer that.
    """
    if "krs" not in companies.columns or "is_public" not in companies.columns:
        print(
            "WARNING: no is_public column on the company data, so the cost "
            "breakdown cannot split public from private."
        )
        return set()
    public = companies.loc[is_public(companies["is_public"]), "krs"]
    return set(str(krs).zfill(10) for krs in public)


def cost_breakdown(
    queries: typing.Iterable[RejestrIOQuery],
    public_krs: set[str] | None = None,
) -> str:
    """What is about to be spent, grouped by why each query exists.

    A total is not a decision. The run buys connections for companies nobody
    has asked about yet, re-buys them for companies whose entry moved, and
    buys person feeds - and those are worth different amounts depending on the
    week. Printed before the confirmation prompt so the answer to "press enter
    to spend 53 PLN" is informed by which of those the 53 PLN is.

    One row per query, filed under `primary_reason`, so the rows total the
    bill. The public count is companies `CompaniesKRS` marks as publicly
    owned; a person feed has no company and never counts towards it.
    """
    public_krs = public_krs or set()
    tally: dict[str, dict[str, float]] = {}
    free_only = 0
    for query in queries:
        calls = query.paid_calls()
        if calls == 0:
            free_only += 1
            continue
        row = tally.setdefault(
            query.primary_reason,
            {"subjects": 0, "public": 0, "calls": 0, "cost": 0.0},
        )
        row["subjects"] += 1
        row["calls"] += calls
        row["cost"] += query.cost()
        if query.krs is not None and query.krs.id in public_krs:
            row["public"] += 1

    lines = [
        "",
        "Paid rejestr.io calls, by why the subject is in the queue:",
        "",
        f"  {'reason':<24}{'subjects':>10}{'public':>9}{'calls':>8}{'PLN':>10}",
    ]
    order = sorted(tally, key=lambda reason: -tally[reason]["cost"])
    for reason in order:
        row = tally[reason]
        lines.append(
            f"  {reason:<24}{int(row['subjects']):>10}{int(row['public']):>9}"
            f"{int(row['calls']):>8}{row['cost']:>10.2f}"
        )
    total = (
        {
            key: sum(row[key] for row in tally.values())
            for key in ("subjects", "public", "calls", "cost")
        }
        if tally
        else {"subjects": 0, "public": 0, "calls": 0, "cost": 0.0}
    )
    lines.append(
        f"  {'TOTAL':<24}{int(total['subjects']):>10}{int(total['public']):>9}"
        f"{int(total['calls']):>8}{total['cost']:>10.2f}"
    )
    lines.append("")
    lines.append(
        f"  {free_only} of the queries carry no paid call (free api-krs only)."
    )
    lines.append("")
    return "\n".join(lines)


class ScrapeRejestrIO(Pipeline[RejestrIOQuery]):
    filename = "scrape_rejestr_io"

    hardcoded_companies: CompaniesHardcoded
    companies: CompaniesKRS
    already_scraped: KRSAlreadyScraped
    needs_refresh: KRSNeedsRefresh
    companies_all: Companies
    hardcoded_people: PeopleRejestrIOHardcoded
    people: PeopleKRS
    people_all: PeopleMerged
    koryta_votes: KorytaVotes
    koryta_people: KorytaPeople
    person_coverage: PersonFeedCoverage

    #: Why each company is in the queue, keyed by KRS id, and why each person
    #: is. Filled by `companies_to_scrape` and `people_to_scrape`, read by
    #: `process` on its way to the query that gets paid for.
    company_reasons: dict[str, set[str]]
    person_reasons: dict[str, set[str]]

    @property
    def output_class(self):
        return RejestrIOQuery

    @cached_property
    def args(self):
        parser = argparse.ArgumentParser(description="I'll add docs here")
        parser.add_argument(
            "--only_krs",
            dest="only_krs",
            default="",
            help="only show children of this KRS",
        )
        parser.add_argument(
            "--children",
            dest="children",
            default=True,
            help="If False, don't scrape children of the companies",
        )
        args, _ = parser.parse_known_args()

        return args

    def series_to_set(self, series) -> KRSSet:
        return KRSSet(KRS(krs) for krs in series.tolist())

    def _record_reason(self, krs_id: str, reason: str) -> None:
        """Note one reason a company is in the queue. A company can have several."""
        self.company_reasons.setdefault(krs_id, set()).add(reason)

    def already_scraped_companies(self, ctx: Context) -> KRSSet:
        """Companies whose rejestr.io connections are already in the bucket.

        Only the two krs-powiazania calls count as having scraped a company,
        because they are the only ones that put people on it. This used to be
        every KRS with any blob at all, and the free api-krs register entry is
        a blob: a company first met in somebody's person feed was subtracted
        from the queue as soon as `scrape_krs_free` fetched its odpis, so the
        paid call that would have given it people was never issued. `scrape_krs`
        reprocesses this pipeline between its two phases, so phase 1 could
        disqualify a company before phase 2 read the list - and permanently,
        since the odpis stays in the bucket and every later run drops it again.

        KRS 0001243843 (LUBELSKIE KOLEJE, owned by wojewodztwo lubelskie) is
        one of those: named in a person feed crawled 2026-08-24, odpis fetched
        2026-08-27, no connections ever. It has no row in `person_krs`, so
        `PeoplePayloads --krs 0001243843` has nobody to emit - while the
        register entry we do hold masks every name it lists.

        Letting these back in buys nothing twice: `save_org_connections`
        filters per method, so a company that already has its odpis is asked
        only for the rejestr.io calls it is missing.
        """
        scraped = self.already_scraped.read_or_process(ctx)
        if scraped is None or scraped.empty:
            return KRSSet()
        connections = scraped[scraped["method"].isin(ORG_CONNECTION_METHODS)]
        return KRSSet(KRS(id=str(krs).zfill(10)) for krs in connections["krs"].unique())

    def companies_to_scrape(self, ctx: Context) -> KRSSet:
        """The companies worth a rejestr.io query, and why each one is here.

        The why goes on `self.company_reasons` rather than into the return
        value, which stays the set every caller already expects. It is what
        the cost breakdown groups by: a KRS on its own cannot say whether it
        was bought because somebody curated it, because an interesting person
        turned out to sit on its board, or because something else owns it.
        """
        self.company_reasons = {}
        self.hardcoded_companies.process(ctx)
        already_scraped = self.already_scraped_companies(ctx)

        starters = KRSSet(self.hardcoded_companies.all_companies_krs.values())
        for krs in starters:
            self._record_reason(krs.id, REASON_HARDCODED)

        for blob_name, blob in ctx.io.read_many(
            CloudStorage(prefix="hostname=rejestr.io")
        ):
            if "osoby" in blob_name and "krs-powiazania" in blob_name:
                try:
                    data = json.loads(blob.read_string())
                    for item in data:
                        if isinstance(item, dict) and item.get("typ") == "organizacja":
                            krs_num = item.get("numery", {}).get("krs")
                            if krs_num:
                                starters.add(KRS(id=str(krs_num).zfill(10)))
                                self._record_reason(
                                    str(krs_num).zfill(10), REASON_PERSON_FEED
                                )
                except Exception as e:
                    print(f"Error parsing {blob_name}: {e}")

        print("Starters: ", starters)

        graph = CompanyGraph()

        if self.args.children:
            children = KRSSet(
                KRS(krs) for krs in graph.all_descendants(set(s.id for s in starters))
            )
            for krs in children:
                self._record_reason(krs.id, REASON_OWNED)
        else:
            children = starters

        to_scrape = (starters | children) - already_scraped
        print(f"Starters: {len(starters)} {get_head(starters, 10)}")
        print(
            f"Already scraped: {len(already_scraped)} {get_head(already_scraped, 10)}"
        )
        print(f"To scrape: {len(to_scrape)} {get_head(to_scrape, 10)}")

        return to_scrape

    def companies_without_register_entry(self, ctx: Context) -> KRSSet:
        """Companies we hold rejestr.io connections for and no api-krs entry.

        `companies_to_scrape` subtracts every company that has any blob at all,
        so a company first met through a rejestr.io response - the usual way,
        since that is how the graph is walked - never gets asked for its
        register entry. 1,993 of the 8,301 companies on file are in that state.

        Nothing can check those. `RejestrIOCoverage` compares a rejestr.io
        response against what the register said, and for these there is no what
        the register said, so however stale the response is it will never show.
        Asking costs nothing: these go out through the free channel, which
        `scrape_krs_free` issues and `RejestrIOQuery.cost` prices at zero. The
        reverse - buying rejestr.io connections for every company we happen to
        have a register entry for - is 1,642 companies and 164 PLN, and is a
        decision rather than a repair.
        """
        scraped = self.already_scraped.latest_scrapes(ctx)
        if scraped.empty:
            return KRSSet()
        method = scraped["method"].astype(str)
        from_rejestrio = set(scraped.loc[method.str.startswith("rejestrio_org"), "krs"])
        from_register = set(scraped.loc[method.str.startswith("api_krs"), "krs"])
        missing = from_rejestrio - from_register
        print(f"Companies with connections but no register entry: {len(missing)}")
        return KRSSet(KRS(id=str(krs).zfill(10)) for krs in missing)

    def companies_without_names(self, ctx: Context) -> KRSSet:
        encountered_companies = self.series_to_set(
            self.people.read_or_process(ctx)["employed_krs"]
        )
        results = KRSSet()
        companies = {
            c["krs"]: c
            for c in iterate_pipeline_dict(self.companies_all.read_or_process(ctx))
        }
        for c in encountered_companies:
            company = companies.get(c.id, None)
            if company is None:
                results.add(c)
                continue
            if company["name"] is None:
                results.add(c)

        return results

    def people_to_scrape(self, ctx: Context) -> set[RejestrIOKey]:
        self.person_reasons = {}
        scraped_people = set(
            RejestrIOKey(id=person_id)
            for person_id in self.hardcoded_people.read_or_process(ctx)["id"].to_list()
        )
        for person in scraped_people:
            self.person_reasons.setdefault(str(person.id), set()).add(REASON_HARDCODED)

        koryta_votes_df = self.koryta_votes.read_or_process(ctx)
        koryta_people_df = self.koryta_people.read_or_process(ctx)

        koryta_id_to_name = dict(
            zip(koryta_people_df["id"], koryta_people_df["full_name"])
        )

        # TODO this matching rejestr.io to names logic is duplicated
        # We should merge it in one of the pipelines
        interesting_names = set()
        for _, row in koryta_votes_df.iterrows():
            person_koryta_id = row.get("person_koryta_id")
            if not person_koryta_id or person_koryta_id == "":
                continue
            interesting = row.get("interesting", 0)
            if interesting > 0:
                name = koryta_id_to_name.get(str(person_koryta_id))
                if name:
                    interesting_names.add(name)

        people_merged_df = self.people_all.read_or_process(ctx)
        for _, row in people_merged_df.iterrows():
            koryta_name = row.get("koryta_name")
            if koryta_name in interesting_names:
                rejestr_ids = row.get("rejestrio_id", [])
                if len(rejestr_ids) > 0:
                    scraped_people.add(RejestrIOKey(id=str(rejestr_ids[0])))
                    self.person_reasons.setdefault(str(rejestr_ids[0]), set()).add(
                        REASON_INTERESTING_PERSON
                    )

        people_krs_df = self.people.read_or_process(ctx)
        for _, row in people_krs_df.iterrows():
            full_name = row.get("full_name")
            if full_name in interesting_names:
                rejestrio_id = row.get("id")
                if rejestrio_id:
                    scraped_people.add(RejestrIOKey(id=str(rejestrio_id)))
                    self.person_reasons.setdefault(str(rejestrio_id), set()).add(
                        REASON_INTERESTING_PERSON
                    )

        print(f"People to scrape: {len(scraped_people)} {get_head(scraped_people, 10)}")
        return scraped_people

    def process(self, ctx: Context):
        # Each source is named before the call rather than inline, so the
        # reason it stands for can be recorded against the companies it
        # chose. Same order as before: `companies_to_scrape` resets the
        # reasons, and the rest add to them.
        connections = self.companies_to_scrape(ctx)
        missing_names = self.companies_without_names(ctx)
        for krs in missing_names:
            self._record_reason(krs.id, REASON_MISSING_NAME)
        missing_entries = self.companies_without_register_entry(ctx)
        for krs in missing_entries:
            self._record_reason(krs.id, REASON_MISSING_REGISTER_ENTRY)
        people = self.people_to_scrape(ctx)

        for url in save_org_connections(
            already_scraped_krs=self.already_scraped.latest_scrapes(ctx),
            needs_refresh_krs=self.needs_refresh.read_or_process(ctx),
            already_scraped_people=get_osoby_scraped(
                ctx, self.person_coverage.people_to_refetch(ctx)
            ),
            connections=connections,
            names=missing_names | missing_entries,
            people=people,
            company_reasons=self.company_reasons,
            person_reasons=self.person_reasons,
        ):
            ctx.io.output_entity(url)


def get_head(s: typing.Iterable[KRS | RejestrIOKey], n: int):
    return sorted(list(s), key=lambda x: x.id)[:n]
