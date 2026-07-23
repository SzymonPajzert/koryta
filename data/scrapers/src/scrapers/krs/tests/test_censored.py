"""Tests for KRSCensoredPeople change detection and pre-filter."""

import pandas as pd

from scrapers.krs.censored import KRSCensoredPeople, hash_people_set

KRS_1 = "0000000001"
KRS_2 = "0000000002"
KRS_3 = "0000000003"


# ─── hash_people_set ──────────────────────────────────────


def test_hash_people_set_deterministic():
    people = {("Kowalski", "Jan", "", "12345", "wspolnik")}
    assert hash_people_set(people) == hash_people_set(people)


def test_hash_people_set_order_independent():
    a = {("A", "B", "", "", "r1"), ("C", "D", "", "", "r2")}
    b = {("C", "D", "", "", "r2"), ("A", "B", "", "", "r1")}
    assert hash_people_set(a) == hash_people_set(b)


def test_hash_people_set_different_sets():
    a = {("Kowalski", "Jan", "", "12345", "wspolnik")}
    b = {("Nowak", "Anna", "", "67890", "wspolnik")}
    assert hash_people_set(a) != hash_people_set(b)


# ─── krs_with_people_changes ────────────────────────────────


class FakeContext:
    """Minimal stand-in for Context."""


def _row(krs, date, h, n=3):
    return {
        "krs": krs,
        "date": date,
        "people_hash": h,
        "n_people": n,
    }


def make_pipeline(rows):
    """Build a KRSCensoredPeople with stubbed read_or_process."""
    df = pd.DataFrame(rows)
    pipeline = KRSCensoredPeople()
    pipeline.read_or_process = lambda _ctx: df  # type: ignore[assignment]
    return pipeline


def test_single_snapshot_included():
    """One snapshot → included (first-time scrape)."""
    pipeline = make_pipeline([_row(KRS_1, "2026-03-01", "aaa")])
    result = pipeline.krs_with_people_changes(FakeContext())

    assert result[KRS_1] == "2026-03-01"


def test_two_snapshots_same_hash_excluded():
    """Two identical snapshots → no change → excluded."""
    pipeline = make_pipeline([
        _row(KRS_1, "2026-01-01", "aaa"),
        _row(KRS_1, "2026-06-01", "aaa"),
    ])
    result = pipeline.krs_with_people_changes(FakeContext())

    assert KRS_1 not in result


def test_two_snapshots_different_hash_included():
    """Two different snapshots → change detected."""
    pipeline = make_pipeline([
        _row(KRS_1, "2026-01-01", "aaa"),
        _row(KRS_1, "2026-06-01", "bbb"),
    ])
    result = pipeline.krs_with_people_changes(FakeContext())

    assert result[KRS_1] == "2026-06-01"


def test_change_date_is_most_recent_change():
    """Multiple changes → report the most recent date."""
    pipeline = make_pipeline([
        _row(KRS_1, "2026-01-01", "aaa"),
        _row(KRS_1, "2026-03-01", "bbb"),
        _row(KRS_1, "2026-06-01", "ccc"),
    ])
    result = pipeline.krs_with_people_changes(FakeContext())

    # Most recent change is bbb→ccc at 2026-06-01
    assert result[KRS_1] == "2026-06-01"


def test_stale_change_not_reported_as_latest():
    """Change in March but no change since → reports March.

    This is the key scenario: people changed months ago (Jan→Mar),
    but the latest two snapshots (Mar, Jul) are identical. The
    reported change_date is March, which allows the pre-filter
    to exclude this KRS if already scraped after March.
    """
    pipeline = make_pipeline([
        _row(KRS_1, "2026-01-01", "aaa"),
        _row(KRS_1, "2026-03-01", "bbb"),
        _row(KRS_1, "2026-07-01", "bbb"),
    ])
    result = pipeline.krs_with_people_changes(FakeContext())

    assert result[KRS_1] == "2026-03-01"


# ─── Pre-filter integration ────────────────────────────────
#
# Tests verify that date comparison correctly excludes stale
# changes (already handled by a prior rejestr.io scrape).


def has_recent_change(row, changed_krs):
    """Extracted from KRSNeedsRefresh.process for testability."""
    krs = row["krs"]
    if krs not in changed_krs:
        return False
    return changed_krs[krs] > row["date"]


def test_prefilter_excludes_stale_change():
    """Change from March excluded if already scraped in April.

    Timeline:
    - Jan: api-krs hash "aaa"
    - Mar: api-krs hash "bbb" (change_date = Mar)
    - Apr: rejestr.io scraped (last_scrape = Apr)
    - Jul: bulletin update

    change_date (Mar) <= last_scrape (Apr) → EXCLUDED.
    """
    changed = {KRS_1: "2026-03-01"}
    row = pd.Series({"krs": KRS_1, "date": "2026-04-15"})

    assert not has_recent_change(row, changed)


def test_prefilter_includes_fresh_change():
    """Change from June included if last scrape was April.

    change_date (Jun) > last_scrape (Apr) → INCLUDED.
    """
    changed = {KRS_1: "2026-06-01"}
    row = pd.Series({"krs": KRS_1, "date": "2026-04-15"})

    assert has_recent_change(row, changed)


def test_prefilter_excludes_unknown_krs():
    """KRS not in changed_krs → excluded."""
    row = pd.Series({"krs": KRS_3, "date": "2026-04-15"})

    assert not has_recent_change(row, {})


def test_prefilter_includes_first_time_scrape():
    """First-time KRS (snapshot May, scraped Jan) → included."""
    changed = {KRS_1: "2026-05-01"}
    row = pd.Series({"krs": KRS_1, "date": "2026-01-15"})

    assert has_recent_change(row, changed)


def test_prefilter_same_day_excluded():
    """change_date == last_scrape → excluded (already captured)."""
    changed = {KRS_1: "2026-04-15"}
    row = pd.Series({"krs": KRS_1, "date": "2026-04-15"})

    assert not has_recent_change(row, changed)


# ─── Full pipeline scenario (end-to-end) ─────────────────


def test_full_prefilter_scenario():
    """Apply pre-filter to a needs_refresh DataFrame.

    Three KRS entries flagged by bulletin, but only KRS_2 has a
    people change newer than its last rejestr.io scrape.
    """
    method = "rejestrio_org_krs_powiazania_aktualne"
    needs_refresh = pd.DataFrame([
        {
            "krs": KRS_1, "method": method,
            "date": "2026-04-15",
            "update_date": "2026-07-01",
        },
        {
            "krs": KRS_2, "method": method,
            "date": "2026-04-15",
            "update_date": "2026-07-01",
        },
        {
            "krs": KRS_3, "method": method,
            "date": "2026-04-15",
            "update_date": "2026-07-01",
        },
    ])

    # KRS_1: change in March (stale, scraped in April)
    # KRS_2: change in June (fresh, after April scrape)
    # KRS_3: no api-krs data
    changed = {
        KRS_1: "2026-03-01",
        KRS_2: "2026-06-01",
    }

    filtered = needs_refresh[
        needs_refresh.apply(
            lambda row: has_recent_change(row, changed),
            axis=1,
        )
    ]

    assert len(filtered) == 1
    assert filtered.iloc[0]["krs"] == KRS_2
