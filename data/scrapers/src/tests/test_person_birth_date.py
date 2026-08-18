"""Normalising the birth date on its way into a person payload.

The column arrives in whatever shape the duckdb/pandas join left it, and it is
the field identity matching turns on: measured over the 106,020 people in
`people_krs_merged`, a name alone leaves 15.8% of them ambiguous, a name plus a
birth year 0.2%, a name plus the full date 0.02%.
"""

from datetime import date, datetime

import numpy as np
import pandas as pd
import pytest

from analysis.payloads.person import _iso_date


@pytest.mark.parametrize(
    "value,expected",
    [
        # What people_krs_merged.jsonl actually holds.
        ("1967-09-20", "1967-09-20"),
        # What survives a pandas round trip.
        (pd.Timestamp("1967-09-20"), "1967-09-20"),
        (pd.Timestamp("1967-09-20 00:00:00"), "1967-09-20"),
        (datetime(1967, 9, 20, 13, 45), "1967-09-20"),
        (date(1967, 9, 20), "1967-09-20"),
        # A timestamp that was written out as a string with its time still on.
        ("1967-09-20T00:00:00", "1967-09-20"),
        ("1967-09-20 00:00:00", "1967-09-20"),
    ],
)
def test_normalises_to_an_iso_date(value, expected):
    assert _iso_date(value) == expected


@pytest.mark.parametrize(
    "value",
    [
        None,
        pd.NaT,
        np.nan,
        float("nan"),
        "",
        "   ",
        "nie wiadomo",
        "1967",  # a year is not a date, and guessing a month would invent one
        "20-09-1967",  # the other way round; unparseable rather than wrong
    ],
)
def test_drops_what_is_not_a_date(value):
    # `pd.NaT` in particular: it is truthy, so a plain `if not value` keeps it
    # and the ingest then rejects the whole person.
    assert _iso_date(value) is None


def test_a_person_is_worth_storing_without_one():
    # 761 of the 6,115 person nodes resolve to no KRS row at all. Dropping the
    # date must not drop them.
    assert _iso_date(pd.NaT) is None
