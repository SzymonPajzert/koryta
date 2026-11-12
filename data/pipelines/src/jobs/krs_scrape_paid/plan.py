"""What the paid job buys, in which order, and how much of it today.

Pure: it is handed the queue `ScrapeRejestrIO` built, the companies the free
odpis failed for, the public ones, rejestr.io's own count of each person's
connections, the names of what the crawl bucket already holds and the cap, and
decides. Nothing here makes a request.
"""

import typing
from collections.abc import Collection, Iterable, Mapping
from dataclasses import replace

from scrapers.krs.person_counts import PersonCount
from scrapers.krs.scrape import (
    REASON_HARDCODED,
    REASON_INTERESTING_PERSON,
    QueryType,
    RejestrIOQuery,
)

#: Everything the queue owes rejestr.io, as a hand run has always bought it.
SCOPE_ALL = "all"
#: What the night buys: only what the free sources cannot give.
SCOPE_FALLBACK = "fallback"
SCOPES = (SCOPE_ALL, SCOPE_FALLBACK)

#: The fewest connections, current and past, rejestr.io must count for a
#: person before their feed is bought, unless somebody named them (`named`).
#: Of the 599 people bought from 2026-10-06 to 11-06, the 47 counted under 3
#: cost 4.70 PLN and led to no new public company; the rest kept all 57 found
#: and all 154 people of interest, at 92% of the spend. Szymon's decision of
#: 11-12 (decide-how-the-paid-night-picks-person-feeds).
FLOOR = 3

#: Why a person is bought whatever rejestr.io counts: somebody asked for them
#: by name - a reader's vote, or the hardcoded list. A page put live is not
#: such an ask: about 120 a day went live in early November, more than the cap
#: buys, and those are what the count ranks.
NAMED = frozenset({REASON_INTERESTING_PERSON, REASON_HARDCODED})


def calls(queries: Iterable[RejestrIOQuery]) -> int:
    """The rejestr.io calls `queries` make: what is billed."""
    return sum(query.paid_calls() for query in queries)


def paid(queries: Iterable[RejestrIOQuery]) -> list[RejestrIOQuery]:
    """The queries with something to buy; the rest are the free scrape's."""
    return [query for query in queries if query.paid_calls()]


def fallback(
    queries: Iterable[RejestrIOQuery], failed: Collection[str]
) -> list[RejestrIOQuery]:
    """The person feeds, and the company feeds of the companies in `failed`.

    A person is in the queue only when somebody marked them interesting - a
    human's vote on the site, a page put live since `PUBLISHED_SINCE`, or the
    hardcoded list (`ScrapeRejestrIO.people_to_scrape`) - and which other
    companies a person sits in is nothing a free source says.

    A company is left out unless the free odpis was asked for and did not come
    (`failed`, from `KrsOdpisAttempts`). One the odpis job has not asked about
    yet is its to ask first, for free; one whose odpis came is told by it
    already, or has nothing rejestr.io would add.
    """
    return [
        query
        for query in queries
        if query.person is not None
        or (query.krs is not None and query.krs.id in failed)
    ]


def named(query: RejestrIOQuery) -> bool:
    """Whether somebody asked for this person by name (`NAMED`)."""
    return not NAMED.isdisjoint(query.reasons)


def counted(
    query: RejestrIOQuery, counts: Mapping[str, PersonCount]
) -> PersonCount | None:
    """rejestr.io's count for a person nobody named, None for a company,
    a named person or somebody no company feed we hold lists."""
    if query.person is None or named(query):
        return None
    return counts.get(str(query.person.id))


def above_the_floor(
    queries: Iterable[RejestrIOQuery], counts: Mapping[str, PersonCount]
) -> tuple[list[RejestrIOQuery], list[RejestrIOQuery]]:
    """The queries less the people counted under `FLOOR`, and those people.

    Nobody is left out for good: the queue owes them still. The count is as
    old as the newest company feed that lists the person - the median in the
    queue of 2026-11-06 was 78 days - and a newer one counts them again. The
    night buys few company feeds now, only those whose free odpis failed, so
    a newer one mostly comes from a hand run; a vote buys them whatever the
    count says.
    """
    kept: list[RejestrIOQuery] = []
    under: list[RejestrIOQuery] = []
    for query in queries:
        count = counted(query, counts)
        (under if count is not None and count.stated < FLOOR else kept).append(query)
    return kept, under


def counted_empty(query_type: QueryType, count: PersonCount) -> bool:
    """Whether the count says this feed of the person would list nothing: the
    current connections when it counts none current, the past ones when none
    past."""
    if query_type == QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_AKTUALNE:
        return count.aktualne == 0
    if query_type == QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_HISTORYCZNE:
        return count.przeszle == 0
    return False


def without_empty_feeds(
    queries: Iterable[RejestrIOQuery], counts: Mapping[str, PersonCount]
) -> tuple[list[RejestrIOQuery], list[RejestrIOQuery]]:
    """The queries less the person feeds the count says are empty, and those
    feeds, as queries of their own.

    rejestr.io bills an empty answer as any other: of the 79 such calls bought
    from 2026-10-06 to 11-06, 72 came back with nothing. A feed left here is
    owed still, and comes back with a count that says otherwise, as a person
    under the floor does (`above_the_floor`). A named person gets both, as
    before.
    """
    kept: list[RejestrIOQuery] = []
    empty: list[RejestrIOQuery] = []
    for query in queries:
        count = counted(query, counts)
        if count is None:
            kept.append(query)
            continue
        feeds = [q for q in query.queries if counted_empty(q, count)]
        if not feeds:
            kept.append(query)
            continue
        empty.append(replace(query, queries=feeds))
        rest = [q for q in query.queries if q not in feeds]
        if rest:
            kept.append(replace(query, queries=rest))
    return kept, empty


def order(
    queries: Iterable[RejestrIOQuery],
    public: Collection[str],
    counts: Mapping[str, PersonCount] | None = None,
) -> list[RejestrIOQuery]:
    """People first, then the companies the public owns, then the rest.

    People first: each was asked for by somebody. The ones somebody named
    (`named`) go first, then the rest by rejestr.io's own count of their
    connections (`RejestrIOPersonCounts`), highest first: the count is what a
    feed lists, and the companies it lists are what a purchase is for. Bought
    in that order, half of 2026-10-06..11-06's spend would have found 80% of
    the new public companies, against 53% for a random half; the queue's own
    order is by entry id. A person no company feed we hold lists, so with no
    count, goes before those with one: their feed is the only word on their
    companies, and they are few - 2 of the 814 queued on 2026-11-12.

    Then public companies, the ones a page is likeliest to show - the order the
    odpis job asks the graph in. The queue's own order stands within each, and
    between people the count does not tell apart.
    """
    counts = counts or {}

    def rank(query: RejestrIOQuery) -> tuple[int, ...]:
        if query.person is not None:
            if named(query):
                return (0, 0)
            count = counted(query, counts)
            return (0, 1) if count is None else (0, 2, -count.stated)
        return (1,) if query.krs is not None and query.krs.id in public else (2,)

    return sorted(queries, key=rank)


def within(
    queries: typing.Sequence[RejestrIOQuery], allowance: int
) -> tuple[list[RejestrIOQuery], list[RejestrIOQuery]]:
    """The queries whose calls fit in `allowance`, in order, and those left.

    A query is bought whole or not at all, so a company never has its current
    connections without the past ones, and the first that does not fit ends
    the list: what is left is exactly what tomorrow starts with.
    """
    taken = 0
    for index, query in enumerate(queries):
        taken += query.paid_calls()
        if taken > allowance:
            return list(queries[:index]), list(queries[index:])
    return list(queries), []


def bought_today(names: Iterable[str], day: str) -> int:
    """How many rejestr.io answers the crawl bucket holds from `day`.

    Every answer bought is stored under the day it was bought (`upload_result`),
    whichever run bought it, by hand or at night, so the bucket is the one
    count that a second run, or a run killed before it wrote its summary,
    cannot miss. The bucket keeps one answer per URL a day, and the queue never
    asks again for one it holds, so a name is a call.
    """
    suffix = f"/date={day}"
    return sum(1 for name in names if name.endswith(suffix))
