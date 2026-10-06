"""What the paid job buys, in which order, and how much of it today.

Pure: it is handed the queue `ScrapeRejestrIO` built, the companies the free
odpis failed for, the public ones, the names of what the crawl bucket already
holds and the cap, and decides. Nothing here makes a request.
"""

import typing
from collections.abc import Collection, Iterable

from scrapers.krs.scrape import RejestrIOQuery

#: Everything the queue owes rejestr.io, as a hand run has always bought it.
SCOPE_ALL = "all"
#: What the night buys: only what the free sources cannot give.
SCOPE_FALLBACK = "fallback"
SCOPES = (SCOPE_ALL, SCOPE_FALLBACK)


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
    human's vote on the site, or the hardcoded list
    (`ScrapeRejestrIO.people_to_scrape`) - and which other companies a person
    sits in is nothing a free source says.

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


def order(
    queries: Iterable[RejestrIOQuery], public: Collection[str]
) -> list[RejestrIOQuery]:
    """People first, then the companies the public owns, then the rest.

    People first: each was asked for by somebody, and there are a few a day.
    Then public companies, the ones a page is likeliest to show - the order the
    odpis job asks the graph in. The queue's own order stands within each.
    """

    def rank(query: RejestrIOQuery) -> int:
        if query.person is not None:
            return 0
        return 1 if query.krs is not None and query.krs.id in public else 2

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
