import pandas as pd

from scrapers.krs.updates import latest_changes

A, B = "0000000029", "0000000031"


def test_the_bulletin_gives_each_company_its_last_change():
    updates = pd.DataFrame(
        {"krs": [A, A, "31"], "date": ["2026-09-01", "2026-09-20", "2026-08-01"]}
    )
    assert latest_changes(updates) == {A: "2026-09-20", B: "2026-08-01"}
    assert latest_changes(pd.DataFrame(columns=["krs", "date"])) == {}


def test_a_cached_bulletin_reads_as_the_built_one():
    """Read back from disk, `date` is a Timestamp and the KRS a number."""
    updates = pd.DataFrame(
        {"krs": [29, 29], "date": pd.to_datetime(["2026-09-01", "2026-09-20"])}
    )
    assert latest_changes(updates) == {A: "2026-09-20"}
