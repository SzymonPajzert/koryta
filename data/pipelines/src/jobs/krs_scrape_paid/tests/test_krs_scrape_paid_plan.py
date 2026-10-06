"""What the paid job picks, in which order, and how much of it fits a day."""

from entities.company import KRS
from entities.person import RejestrIOKey
from jobs.krs_scrape_paid import plan
from scrapers.krs.scrape import PEOPLE_QUERIES, QueryType, RejestrIOQuery

FEEDS = [
    QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE,
    QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_HISTORYCZNE,
]


def company(krs: str, *queries: QueryType) -> RejestrIOQuery:
    return RejestrIOQuery(krs=KRS(krs), queries=list(queries or FEEDS))


def person(id: str, *queries: QueryType) -> RejestrIOQuery:
    return RejestrIOQuery(
        person=RejestrIOKey(id), queries=list(queries or PEOPLE_QUERIES)
    )


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
