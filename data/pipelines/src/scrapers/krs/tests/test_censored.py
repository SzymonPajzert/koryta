"""Tests for KRSCensoredPeople change detection and pre-filter."""

import json

import pandas as pd
import pytest

from scrapers.krs.censored import (
    KRSCensoredPeople,
    StaleOutputError,
    hash_people_set,
)
from scrapers.krs.people_parsing import CensoredPerson
from scrapers.stores import Context, ProcessPolicy
from scrapers.test_tree import MockIO, MockNLP, MockRejestrIO, MockUtils, MockWeb

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
    pipeline = make_pipeline(
        [
            _row(KRS_1, "2026-01-01", "aaa"),
            _row(KRS_1, "2026-06-01", "aaa"),
        ]
    )
    result = pipeline.krs_with_people_changes(FakeContext())

    assert KRS_1 not in result


def test_two_snapshots_different_hash_included():
    """Two different snapshots → change detected."""
    pipeline = make_pipeline(
        [
            _row(KRS_1, "2026-01-01", "aaa"),
            _row(KRS_1, "2026-06-01", "bbb"),
        ]
    )
    result = pipeline.krs_with_people_changes(FakeContext())

    assert result[KRS_1] == "2026-06-01"


def test_change_date_is_most_recent_change():
    """Multiple changes → report the most recent date."""
    pipeline = make_pipeline(
        [
            _row(KRS_1, "2026-01-01", "aaa"),
            _row(KRS_1, "2026-03-01", "bbb"),
            _row(KRS_1, "2026-06-01", "ccc"),
        ]
    )
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
    pipeline = make_pipeline(
        [
            _row(KRS_1, "2026-01-01", "aaa"),
            _row(KRS_1, "2026-03-01", "bbb"),
            _row(KRS_1, "2026-07-01", "bbb"),
        ]
    )
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
    needs_refresh = pd.DataFrame(
        [
            {
                "krs": KRS_1,
                "method": method,
                "date": "2026-04-15",
                "update_date": "2026-07-01",
            },
            {
                "krs": KRS_2,
                "method": method,
                "date": "2026-04-15",
                "update_date": "2026-07-01",
            },
            {
                "krs": KRS_3,
                "method": method,
                "date": "2026-04-15",
                "update_date": "2026-07-01",
            },
        ]
    )

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


# ─── process: one row per KRS per day ──────────────────────
#
# A KRS is asked for against both registers, and the one it is not in answers
# with a 404 body. That body parses as JSON, so it used to become a second row
# for the same day holding nobody - which reads as the whole board resigning
# and being reappointed, on every company, on every crawl.

BUCKET = "gs://koryta-pl-crawled"

NOT_FOUND = {"title": "Not Found", "status": 404}


def board(*surnames):
    return {
        "odpis": {
            "naglowekA": {"numerKRS": KRS_1},
            "dane": {
                "dzial2": {
                    "organNadzoru": [
                        {
                            "sklad": [
                                {
                                    "nazwisko": {"nazwiskoICzlon": s},
                                    "imiona": {"imie": "J***"},
                                    "identyfikator": {"pesel": "7**********"},
                                }
                                for s in surnames
                            ]
                        }
                    ]
                }
            },
        }
    }


class OdpisFile:
    def __init__(self, body):
        self.body = body

    def read_string(self) -> str:
        return self.body if isinstance(self.body, str) else json.dumps(self.body)


class OdpisIO(MockIO):
    def __init__(self, blobs: dict[str, object]):
        self.blobs = blobs

    def read_many(self, path):
        for name, body in self.blobs.items():
            yield f"{BUCKET}/{name}", OdpisFile(body)


def odpis_blob(krs: str, register: str, day: str) -> str:
    return (
        f"hostname=api-krs.ms.gov.pl/api/krs/OdpisAktualny/{krs}"
        f"/?rejestr={register}/date={day}"
    )


def run_process(blobs):
    ctx = Context(
        io=OdpisIO(blobs),
        rejestr_io=MockRejestrIO(),
        con=None,  # type: ignore[arg-type]
        utils=MockUtils(),
        web=MockWeb(),
        nlp=MockNLP(),
        refresh_policy=ProcessPolicy.with_default(),
    )
    return KRSCensoredPeople().process(ctx)


def test_the_404_from_the_other_register_is_not_a_snapshot():
    df = run_process(
        {
            odpis_blob(KRS_1, "P", "2026-07-18"): board("K*****", "N****"),
            odpis_blob(KRS_1, "S", "2026-07-18"): NOT_FOUND,
        }
    )

    assert len(df) == 1
    assert df.iloc[0]["n_people"] == 2


def test_a_crawl_stored_as_an_empty_object_is_not_a_snapshot():
    df = run_process(
        {
            odpis_blob(KRS_1, "P", "2026-07-18"): board("K*****"),
            odpis_blob(KRS_1, "S", "2026-07-18"): "",
        }
    )

    assert len(df) == 1


def test_a_day_with_no_readable_odpis_produces_no_row():
    df = run_process({odpis_blob(KRS_1, "S", "2026-07-18"): NOT_FOUND})

    assert df.empty


def test_the_people_survive_into_the_output():
    df = run_process({odpis_blob(KRS_1, "P", "2026-07-18"): board("K*****")})

    people = [CensoredPerson.from_row(r) for r in df.iloc[0]["people"]]

    assert [p.surname for p in people] == [("K*****",)]


def test_snapshots_reads_the_people_back():
    pipeline = make_pipeline(
        [
            {
                "krs": KRS_1,
                "date": "2026-07-18",
                "people_hash": "aaa",
                "n_people": 1,
                "people": [
                    ["K*****|S******", "J***", "", "7**********", "", "nadzor: "]
                ],
            }
        ]
    )

    people = pipeline.snapshots(FakeContext())[KRS_1]["2026-07-18"]

    assert people[0].surname == ("K*****", "S******")
    assert people[0].role == "nadzor: "


def test_a_section_the_register_adds_is_carried_into_the_output():
    """So a people-bearing key nobody has taught the parser fails a test."""
    grown = board("K*****")
    grown["odpis"]["dane"]["dzial2"]["radaInwestorow"] = [
        {"nazwisko": {"nazwiskoICzlon": "N*****"}, "imiona": {"imie": "A***"}}
    ]

    df = run_process({odpis_blob(KRS_1, "P", "2026-07-18"): grown})

    assert df.iloc[0]["unread_paths"] == ["dzial2.radaInwestorow[]"]


def test_a_response_we_fully_understand_carries_no_unread_path():
    df = run_process({odpis_blob(KRS_1, "P", "2026-07-18"): board("K*****")})

    assert df.iloc[0]["unread_paths"] == []


def test_a_cached_output_with_duplicate_rows_is_deduplicated_on_read():
    """A file written before process keyed by (krs, date) still holds them."""
    pipeline = make_pipeline(
        [
            {"krs": KRS_1, "date": "2026-07-18", "people_hash": "aaa", "n_people": 3},
            {"krs": KRS_1, "date": "2026-07-18", "people_hash": "empty", "n_people": 0},
            {"krs": KRS_1, "date": "2026-07-19", "people_hash": "aaa", "n_people": 3},
        ]
    )

    assert KRS_1 not in pipeline.krs_with_people_changes(FakeContext())


def test_a_cached_output_without_the_people_column_fails_loudly():
    """Silently it would report rejestr.io's coverage as perfect everywhere."""
    pipeline = make_pipeline(
        [{"krs": KRS_1, "date": "2026-07-18", "people_hash": "aaa", "n_people": 3}]
    )

    with pytest.raises(StaleOutputError):
        pipeline.snapshots(FakeContext())
