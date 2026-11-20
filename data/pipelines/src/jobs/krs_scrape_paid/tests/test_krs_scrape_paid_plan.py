"""What the paid job picks, in which order, and how much of it fits a day."""

from entities.company import KRS
from entities.person import RejestrIOKey
from jobs.krs_scrape_paid import plan
from scrapers.krs.person_counts import PersonCount
from scrapers.krs.scrape import (
    PEOPLE_QUERIES,
    REASON_HARDCODED,
    REASON_INTERESTING_PERSON,
    REASON_PUBLISHED_PERSON,
    QueryType,
    RejestrIOQuery,
)

FEEDS = [
    QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE,
    QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_HISTORYCZNE,
]
CURRENT, PAST = PEOPLE_QUERIES


def company(krs: str, *queries: QueryType) -> RejestrIOQuery:
    return RejestrIOQuery(krs=KRS(krs), queries=list(queries or FEEDS))


def person(
    id: str, *queries: QueryType, reason: str = REASON_PUBLISHED_PERSON
) -> RejestrIOQuery:
    return RejestrIOQuery(
        person=RejestrIOKey(id),
        queries=list(queries or PEOPLE_QUERIES),
        reasons=[reason],
    )


def counts(**stated: tuple[int, int]) -> dict[str, PersonCount]:
    """rejestr.io's counts by person id, each given as (current, past)."""
    return {
        id: PersonCount(id, current, 1, past, counted_on="2026-08-20", krs="1")
        for id, (current, past) in stated.items()
    }


def subjects(queries) -> list[str]:
    return [query.subject_id for query in queries]


def test_the_fallback_keeps_the_people_and_the_companies_the_odpis_failed_for():
    queue = [company("0000000001"), company("0000000002"), person("7")]

    picked = plan.fallback(queue, failed={"0000000002"})

    assert subjects(picked) == ["0000000002", "7"]


def test_people_first_then_public_companies_and_the_queues_order_within_each():
    queue = [
        company("0000000003"),
        company("0000000001"),
        person("9"),
        company("0000000002"),
        person("8"),
    ]

    ordered = plan.order(queue, public={"0000000002", "0000000001"})

    assert subjects(ordered) == ["9", "8", "0000000001", "0000000002", "0000000003"]


def test_only_whole_queries_fit_and_the_first_that_does_not_ends_the_day():
    queue = [
        person("7"),
        company("0000000001"),
        company("0000000002", QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE),
    ]

    taken, left = plan.within(queue, allowance=3)

    assert subjects(taken) == ["7"]
    assert subjects(left) == ["0000000001", "0000000002"]
    assert plan.within(queue, allowance=5) == (queue, [])
    assert plan.within(queue, allowance=0) == ([], queue)


def test_the_free_queries_are_not_the_paid_jobs():
    free = company("0000000001", QueryType.API_KRS_ODPIS_AKTUALNY_P)
    mixed = company("0000000002", QueryType.API_KRS_ODPIS_AKTUALNY_P, *FEEDS)

    assert plan.paid([free, mixed]) == [mixed]
    assert plan.calls([free, mixed]) == 2


def test_what_was_bought_today_is_read_off_the_names_in_the_bucket():
    names = [
        "hostname=rejestr.io/api/v2/org/0000000001/krs-powiazania/aktualnosc_aktualne/date=2026-10-06",
        "hostname=rejestr.io/api/v2/osoby/7/krs-powiazania/aktualnosc_historyczne/date=2026-10-06",
        "hostname=rejestr.io/api/v2/org/0000000001/krs-powiazania/aktualnosc_aktualne/date=2026-10-05",
    ]

    assert plan.bought_today(names, "2026-10-06") == 2
    assert plan.bought_today(names, "2026-10-07") == 0


def test_nobody_counted_under_the_floor_is_bought_unless_somebody_named_them():
    queue = [
        person("low"),
        person("enough"),
        person("voted", reason=REASON_INTERESTING_PERSON),
        person("listed", reason=REASON_HARDCODED),
        person("uncounted"),
        company("0000000001"),
    ]
    stated = counts(low=(1, 1), enough=(1, 2), voted=(0, 1), listed=(1, 0))

    kept, under = plan.above_the_floor(queue, stated)

    assert plan.FLOOR == 3
    assert subjects(kept) == [
        "enough",
        "voted",
        "listed",
        "uncounted",
        "0000000001",
    ]
    assert subjects(under) == ["low"]


def test_a_feed_counted_empty_is_not_bought_and_is_said_to_be_left():
    queue = [
        person("past_only"),
        person("current_only"),
        person("both"),
        person("one_left", PAST),
        person("voted", reason=REASON_INTERESTING_PERSON),
        person("uncounted"),
        company("0000000001"),
    ]
    stated = counts(
        past_only=(0, 5),
        current_only=(4, 0),
        both=(2, 3),
        one_left=(3, 0),
        voted=(0, 9),
    )

    kept, empty = plan.without_empty_feeds(queue, stated)

    assert [(q.subject_id, q.queries) for q in kept] == [
        ("past_only", [PAST]),
        ("current_only", [CURRENT]),
        ("both", [CURRENT, PAST]),
        # A vote buys both feeds, whatever the count says.
        ("voted", [CURRENT, PAST]),
        ("uncounted", [CURRENT, PAST]),
        ("0000000001", FEEDS),
    ]
    assert [(q.subject_id, q.queries) for q in empty] == [
        ("past_only", [CURRENT]),
        ("current_only", [PAST]),
        ("one_left", [PAST]),
    ]
    assert plan.calls(empty) == 3
    # What is left carries the reasons it was queued for, as the rest do.
    assert empty[0].reasons == [REASON_PUBLISHED_PERSON]


def test_the_named_then_the_uncounted_then_the_highest_count_first():
    queue = [
        company("0000000002"),
        person("five"),
        person("twelve"),
        person("uncounted"),
        company("0000000001"),
        person("voted", reason=REASON_INTERESTING_PERSON),
        person("also_five"),
        person("listed", reason=REASON_HARDCODED),
    ]
    stated = counts(
        five=(2, 3), twelve=(0, 12), also_five=(5, 0), voted=(0, 1), listed=(1, 0)
    )

    ordered = plan.order(queue, public={"0000000001"}, counts=stated)

    assert subjects(ordered) == [
        "voted",
        "listed",
        "uncounted",
        "twelve",
        # A tie keeps the queue's order.
        "five",
        "also_five",
        "0000000001",
        "0000000002",
    ]
