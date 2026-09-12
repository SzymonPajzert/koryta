from datetime import date

import pandas as pd

from scrapers.krs.scrape import (
    KRSScraped,
    QueryType,
    ScrapeRejestrIO,
    compute_refresh_cutoff_date,
    filter_paid_by_people_changes,
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
