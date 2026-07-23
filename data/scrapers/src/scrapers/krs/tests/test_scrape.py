from datetime import date

from scrapers.krs.scrape import KRSScraped, QueryType, compute_refresh_cutoff_date


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
