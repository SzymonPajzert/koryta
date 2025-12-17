from datetime import datetime

import pandas as pd

from analysis.utils import (
    EXPECTED_SCORE,
    OLD_EMPLOYMENT_END,
    RECENT_EMPLOYMENT_START,
    filter_local_good,
)


def test_filter_local_good_handles_timestamps():
    recent_ts = pd.Timestamp("2024-11-01").value // 10**6  # ms
    old_ts = pd.Timestamp("2019-01-01").value // 10**6

    # Make sure it won't change in the meantime
    assert (
        recent_ts
        > datetime.combine(RECENT_EMPLOYMENT_START, datetime.min.time()).timestamp()
        * 1000
    )
    assert (
        old_ts
        < datetime.combine(OLD_EMPLOYMENT_END, datetime.min.time()).timestamp() * 1000
    )

    # One entry that should be kept (recent enough, score high enough, not too old)
    # Another that fails one criteria.

    data = [
        {
            "krs_name": "Keep Me",
            "pkw_name": "Keep Me PKW",
            "wiki_name": "Keep Me Wiki",
            "overall_score": EXPECTED_SCORE + 5,
            "first_employed": recent_ts,
            "last_employed": pd.Timestamp("2025-01-01").value // 10**6,  # Not too old
            "employment": [],
            "teryt_wojewodztwo": ["10"],
            "unique_chance": 0.0,
        },
        {
            "krs_name": "Discard Me (Old)",
            "pkw_name": None,
            "wiki_name": None,
            "overall_score": EXPECTED_SCORE + 5,
            "first_employed": old_ts,
            "last_employed": old_ts,  # Too old ( < 2020)
            "employment": [],
            "teryt_wojewodztwo": ["10"],
            "unique_chance": 0.0,
        },
    ]

    df = pd.DataFrame(data)

    result = filter_local_good(df, filter_region=None)
    assert len(result) == 1
    assert result.iloc[0]["krs_name"] == "Keep Me"


def test_filter_local_good_handles_pandas_timestamps():
    data = [
        {
            "krs_name": "Keep Me TS",
            "pkw_name": None,
            "wiki_name": "Wiki",
            "overall_score": EXPECTED_SCORE + 5,
            "first_employed": pd.Timestamp("2024-12-01"),
            "last_employed": pd.Timestamp("2025-01-01"),
            "employment": [],
            "teryt_wojewodztwo": ["10"],
            "unique_chance": 0.0,
        }
    ]
    df = pd.DataFrame(data)
    result = filter_local_good(df, filter_region=None)
    assert len(result) == 1
    assert result.iloc[0]["krs_name"] == "Keep Me TS"
