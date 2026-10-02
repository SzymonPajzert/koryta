from datetime import date

import pandas as pd

from entities.company import KRS
from entities.person import RejestrIOKey
from scrapers.krs.scrape import (
    ORG_CONNECTION_METHODS,
    REASON_INTERESTING_PERSON,
    REASON_MISSING_NAME,
    REASON_OWNED,
    REASON_PERSON_FEED,
    REASON_PUBLIC_OWNER,
    REASON_REFRESH,
    REASON_UNRECORDED,
    KRSScraped,
    QueryType,
    RejestrIOQuery,
    ScrapeRejestrIO,
    compute_refresh_cutoff_date,
    cost_breakdown,
    filter_paid_by_people_changes,
    leave_to_the_odpis,
    save_org_connections,
    told_by_the_odpis,
)


def test_krs_scraped_parse_api_krs():
    url1 = "gs://koryta-pl-crawled/hostname=api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000952604/date=2026-02-13"
    result1 = KRSScraped.parse(url1)
    assert result1 is not None
    assert result1.krs == "0000952604"
    assert result1.date == "2026-02-13"
    assert result1.method == QueryType.API_KRS_ODPIS_AKTUALNY_P

    url2 = "gs://koryta-pl-crawled/hostname=api-krs.ms.gov.pl/date=2025-10-26/api/krs/OdpisAktualny/0000024375"
    result2 = KRSScraped.parse(url2)
    assert result2 is not None
    assert result2.krs == "0000024375"
    assert result2.date == "2025-10-26"
    assert result2.method == QueryType.API_KRS_ODPIS_AKTUALNY_P


def test_cutoff_from_saturday_skip_2():
    """Saturday: skip Fri + Thu → Thursday."""
    assert compute_refresh_cutoff_date(date(2026, 7, 18), 2) == "2026-07-16"


def test_cutoff_from_sunday_skip_2():
    """Sunday: skip Fri + Thu → Thursday."""
    assert compute_refresh_cutoff_date(date(2026, 7, 19), 2) == "2026-07-16"


def test_cutoff_from_wednesday_skip_2():
    """Wednesday: skip Tue + Mon → Monday."""
    assert compute_refresh_cutoff_date(date(2026, 7, 15), 2) == "2026-07-13"


def test_cutoff_from_monday_skip_2():
    """Monday: skip Fri + Thu (jumps over weekend) → Thursday."""
    assert compute_refresh_cutoff_date(date(2026, 7, 13), 2) == "2026-07-09"


def test_cutoff_from_tuesday_skip_1():
    """Tuesday: skip Mon → Monday."""
    assert compute_refresh_cutoff_date(date(2026, 7, 14), 1) == "2026-07-13"


def test_cutoff_skip_0():
    """Skipping 0 days returns today's date."""
    assert compute_refresh_cutoff_date(date(2026, 7, 18), 0) == "2026-07-18"


def test_cutoff_from_friday_skip_5():
    """Friday: skip 5 work days → previous Friday."""
    assert compute_refresh_cutoff_date(date(2026, 7, 17), 5) == "2026-07-10"


def test_cutoff_from_monday_skip_1():
    """Monday: skip Fri (jumps over weekend) → Friday."""
    assert compute_refresh_cutoff_date(date(2026, 7, 13), 1) == "2026-07-10"


def _rows(*rows):
    return pd.DataFrame(rows, columns=["krs", "method", "date", "update_date"])


PAID = QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE.value
FREE = QueryType.API_KRS_ODPIS_AKTUALNY_P.value


def test_paid_query_waits_for_evidence_the_people_moved():
    kept = filter_paid_by_people_changes(
        _rows(("0000000001", PAID, "2026-07-01", "2026-08-11")),
        {"0000000001": "2026-07-20"},
    )
    assert list(kept["krs"]) == ["0000000001"]


def test_paid_query_is_held_back_without_it():
    kept = filter_paid_by_people_changes(
        _rows(("0000000001", PAID, "2026-07-01", "2026-08-11")),
        {"0000000001": "2026-05-27"},
    )
    assert kept.empty


def test_free_query_does_not_wait_for_evidence_only_it_can_produce():
    """0000095675: the snapshot that would show the change is the one asked for.

    Its last register read is 2026-06-20 and its supervisor was appointed on
    2026-08-11. Gating the free read on a people change the register has not
    been re-read to see left it frozen, and the person never reached
    PeopleKRS.
    """
    kept = filter_paid_by_people_changes(
        _rows(("0000095675", FREE, "2026-06-20", "2026-08-11")),
        {"0000095675": "2026-05-27"},
    )
    assert list(kept["krs"]) == ["0000095675"]


def test_free_query_runs_for_a_company_with_no_snapshots_at_all():
    kept = filter_paid_by_people_changes(
        _rows(("0000000002", FREE, "2026-06-20", "2026-08-11")), {}
    )
    assert list(kept["method"]) == [FREE]


def test_an_empty_frame_survives_the_filter():
    assert filter_paid_by_people_changes(_rows(), {}).empty


def test_the_org_lookup_is_billed_too_and_still_waits():
    """`rejestrio_org` is not one of the connection queries, but it is bought.

    Exempting the free queries by naming the paid ones would have let this
    one through: `ORG_CONNECTION_METHODS` covers the two krs-powiazania
    calls and nothing else.
    """
    kept = filter_paid_by_people_changes(
        _rows(
            (
                "0000000001",
                QueryType.REJESTRIO_ORG.value,
                "2026-07-01",
                "2026-08-11",
            )
        ),
        {"0000000001": "2026-05-27"},
    )
    assert kept.empty


def _scraped(*rows: tuple[str, str]) -> pd.DataFrame:
    return pd.DataFrame(
        [{"krs": krs, "method": method, "date": "2026-08-27"} for krs, method in rows]
    )


class _StubScraped:
    """Stands in for the KRSAlreadyScraped dependency, which lists the bucket."""

    def __init__(self, df: pd.DataFrame):
        self.df = df

    def read_or_process(self, ctx):
        return self.df


def _with_scraped(df: pd.DataFrame) -> ScrapeRejestrIO:
    scraper = ScrapeRejestrIO()
    # Through __dict__ because that is where `Pipeline.__init__` puts a source,
    # and the stub is not a KRSAlreadyScraped.
    scraper.__dict__["already_scraped"] = _StubScraped(df)
    return scraper


def test_the_free_register_entry_does_not_count_as_scraped():
    """The api-krs odpis says nothing about who works there.

    Counting it left a company discovered in a person's feed subtracted from
    the queue the moment `scrape_krs_free` fetched its entry, so the paid call
    that would have given it people was never issued - and never would be,
    since the odpis stays in the bucket. KRS 0001243843 sat in exactly that
    state with no row in `person_krs`.
    """
    scraper = _with_scraped(
        _scraped(("0001243843", QueryType.API_KRS_ODPIS_AKTUALNY_P.value))
    )

    assert len(scraper.already_scraped_companies(None)) == 0


def test_a_company_with_its_connections_stays_out_of_the_queue():
    scraper = _with_scraped(
        _scraped(
            ("0000607833", QueryType.API_KRS_ODPIS_AKTUALNY_P.value),
            ("0000607833", QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE.value),
        )
    )

    assert "0000607833" in scraper.already_scraped_companies(None)


def test_the_org_lookup_is_not_a_connections_call():
    """`rejestrio_org` is bought, but it is the company's own entry.

    It carries no connections, so a company that has only that one still has
    nobody on it and is still worth the krs-powiazania pair.
    """
    scraper = _with_scraped(_scraped(("0000000001", QueryType.REJESTRIO_ORG.value)))

    assert len(scraper.already_scraped_companies(None)) == 0


def test_a_krs_read_as_a_number_is_padded_back():
    scraper = _with_scraped(
        _scraped(("4324", QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE.value))
    )

    assert "0000004324" in scraper.already_scraped_companies(None)


def test_refresh_outranks_the_reason_the_company_was_discovered():
    """Both are true, and only one of them is what the money buys."""
    query = RejestrIOQuery(
        krs=KRS("0000000110"),
        queries=[QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE],
        reasons=[REASON_OWNED, REASON_PERSON_FEED, REASON_REFRESH],
    )

    assert query.primary_reason == REASON_REFRESH


def test_a_query_nobody_explained_is_still_counted():
    query = RejestrIOQuery(
        krs=KRS("0000000110"),
        queries=[QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE],
    )

    assert query.primary_reason == REASON_UNRECORDED


def test_the_breakdown_rows_add_up_to_the_bill():
    """A company with two reasons is one row, or the report overstates.

    The number under it is what the run is about to spend, so it has to be the
    same number the confirmation prompt prints.
    """
    queries = [
        RejestrIOQuery(
            krs=KRS("0001243843"),
            queries=[
                QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE,
                QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_HISTORYCZNE,
            ],
            reasons=[REASON_OWNED, REASON_PERSON_FEED],
        ),
        RejestrIOQuery(
            krs=KRS("0000000110"),
            queries=[QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE],
            reasons=[REASON_REFRESH],
        ),
        # Free only: no rejestr.io call, so nothing to attribute.
        RejestrIOQuery(
            krs=KRS("0000000111"),
            queries=[QueryType.API_KRS_ODPIS_AKTUALNY_P],
            reasons=[REASON_MISSING_NAME],
        ),
    ]

    report = cost_breakdown(queries, public_krs={"0001243843"})
    total = [line for line in report.splitlines() if "TOTAL" in line][0]

    assert total.split() == ["TOTAL", "2", "1", "3", "0.15"]
    assert f"{sum(q.cost() for q in queries):.2f}" == "0.15"
    assert "1 of the queries carry no paid call" in report


def test_the_breakdown_files_a_person_feed_under_its_own_reason():
    report = cost_breakdown(
        [
            RejestrIOQuery(
                person=RejestrIOKey(id="808738"),
                queries=[QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_AKTUALNE],
                reasons=[REASON_INTERESTING_PERSON],
            )
        ],
        public_krs=set(),
    )
    row = [line for line in report.splitlines() if REASON_INTERESTING_PERSON in line][0]

    # A person has no company, so it never counts towards the public column.
    assert row.split() == [REASON_INTERESTING_PERSON, "1", "0", "1", "0.05"]


def test_the_reason_the_caller_recorded_reaches_the_query():
    queries = list(
        save_org_connections(
            already_scraped_krs=pd.DataFrame(columns=["krs", "method", "date"]),
            needs_refresh_krs=pd.DataFrame(
                columns=["krs", "method", "date", "update_date"]
            ),
            already_scraped_people={},
            connections=[KRS("0001243843")],
            names=[],
            people=[],
            company_reasons={"0001243843": {REASON_PERSON_FEED}},
        )
    )

    assert [query.reasons for query in queries] == [[REASON_PERSON_FEED]]


def test_a_company_due_a_refresh_says_so():
    """The refresh is decided here, so it is recorded here.

    Nothing upstream knows about it: `companies_to_scrape` only says how the
    company was found, and the same company can be both found and stale.
    """
    krs, method = "0000000110", ORG_CONNECTION_METHODS[0]
    queries = list(
        save_org_connections(
            already_scraped_krs=pd.DataFrame(
                [{"krs": krs, "method": method, "date": "2026-07-01"}]
            ),
            needs_refresh_krs=pd.DataFrame(
                [
                    {
                        "krs": krs,
                        "method": method,
                        "date": "2026-07-01",
                        "update_date": "2026-08-01",
                    }
                ]
            ),
            already_scraped_people={},
            connections=[],
            names=[],
            people=[],
            company_reasons={krs: {REASON_OWNED}},
        )
    )

    assert [query.reasons for query in queries] == [[REASON_OWNED, REASON_REFRESH]]
    assert queries[0].primary_reason == REASON_REFRESH


class _Frame:
    """Stands in for a pipeline source by handing back a fixed frame."""

    def __init__(self, df: pd.DataFrame):
        self.df = df

    def read_or_process(self, ctx):
        return self.df


class _NoSeeds:
    all_companies_krs: dict = {}

    def process(self, ctx):
        pass


class _NoPersonFeeds:
    """A context whose bucket holds no person feeds."""

    class io:
        @staticmethod
        def read_many(ref):
            return []


def _queue(companies=None, by_register=None, scraped=None):
    scraper = ScrapeRejestrIO()
    scraper.__dict__["hardcoded_companies"] = _NoSeeds()
    scraper.__dict__["already_scraped"] = _StubScraped(
        scraped if scraped is not None else _scraped()
    )
    scraper.__dict__["companies"] = _Frame(
        companies
        if companies is not None
        else pd.DataFrame(columns=["krs", "is_public"])
    )
    scraper.__dict__["public_by_register"] = _Frame(
        by_register if by_register is not None else pd.DataFrame(columns=["krs"])
    )
    return scraper, scraper.companies_to_scrape(_NoPersonFeeds())  # type: ignore[arg-type]


def test_a_company_only_the_register_knows_is_queued():
    """Pomorski Fundusz Pożyczkowy: no seed, no feed, no KRS-numbered owner."""
    scraper, queue = _queue(by_register=pd.DataFrame({"krs": ["0000225512"]}))

    assert "0000225512" in queue
    assert scraper.company_reasons["0000225512"] == {REASON_PUBLIC_OWNER}


def test_a_public_subsidiary_known_only_from_a_feed_is_queued():
    """The ownership door used to walk an empty graph and add nothing.

    ENEA ELEKTROWNIA POŁANIEC is in the crawl only because a parent's feed
    lists it, and `CompaniesKRS` carried the parent's public ownership down to
    it. A private company beside it stays out.
    """
    scraper, queue = _queue(
        companies=pd.DataFrame(
            {"krs": ["0001251428", "0000010120"], "is_public": [True, False]}
        )
    )

    assert "0001251428" in queue
    assert "0000010120" not in queue
    assert REASON_OWNED in scraper.company_reasons["0001251428"]


def test_a_public_company_with_its_connections_is_not_bought_again():
    _, queue = _queue(
        companies=pd.DataFrame({"krs": ["0001251428"], "is_public": [True]}),
        scraped=_scraped(
            ("0001251428", QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE.value)
        ),
    )

    assert "0001251428" not in queue


# ------------------------------------------------ what the odpis tells for free
AKTUALNE = QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE
HISTORYCZNE = QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_HISTORYCZNE


def test_an_odpis_tells_until_the_bulletin_names_the_company_again():
    odpis_on = "2026-09-24"
    told = told_by_the_odpis(
        {
            "0000000029": odpis_on,
            "0000000031": odpis_on,
            "0000000041": odpis_on,
            "0000000043": odpis_on,
        },
        {
            "0000000029": "2026-09-23",  # before the odpis: in it
            "0000000031": odpis_on,  # the same day: maybe after the fetch
            "0000000041": "2026-09-30",  # since
            "0000000099": "2026-09-01",  # no odpis at all
        },
    )
    # 0000000043 the bulletin never named: nothing has moved since the odpis.
    assert told == {"0000000029", "0000000043"}


def test_the_odpis_takes_the_company_feeds_and_nothing_else():
    """The free api-krs pair and the person feeds are no odpis's to replace."""
    told, untold = "0000000029", "0000000031"
    paid_only = "0000000041"
    queries = [
        RejestrIOQuery(
            krs=KRS(told),
            queries=[QueryType.API_KRS_ODPIS_AKTUALNY_P, AKTUALNE, HISTORYCZNE],
            reasons=[REASON_REFRESH],
        ),
        RejestrIOQuery(
            krs=KRS(paid_only), queries=[AKTUALNE, HISTORYCZNE], reasons=[REASON_OWNED]
        ),
        RejestrIOQuery(krs=KRS(untold), queries=[AKTUALNE], reasons=[REASON_OWNED]),
        RejestrIOQuery(
            person=RejestrIOKey(id="808738"),
            queries=[QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_AKTUALNE],
        ),
    ]

    kept = list(leave_to_the_odpis(queries, {told, paid_only}))

    assert [(q.subject_id, q.queries, q.reasons) for q in kept] == [
        (told, [QueryType.API_KRS_ODPIS_AKTUALNY_P], [REASON_REFRESH]),
        (untold, [AKTUALNE], [REASON_OWNED]),
        ("808738", [QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_AKTUALNE], []),
    ]
    assert sum(q.cost() for q in kept) == 0.10


def test_the_queue_reads_what_the_site_takes_from_an_odpis():
    """Off `PeopleKRSCombined`'s rows, against a bulletin read back from disk."""
    scraper = ScrapeRejestrIO()
    scraper.__dict__["people_combined"] = _Frame(
        pd.DataFrame(
            {
                "employed_krs": ["0000000029", "0000000031", "0000000041"],
                "crawled_on": ["2026-10-02", "2026-10-02", "2026-09-01"],
                "source": ["odpis", "odpis", "rejestr.io"],
            }
        )
    )
    scraper.__dict__["updates"] = _Frame(
        pd.DataFrame(
            {"krs": [29, 31], "date": pd.to_datetime(["2026-09-30", "2026-10-02"])}
        )
    )

    assert scraper.companies_told_by_the_odpis(None) == {"0000000029"}  # type: ignore[arg-type]
