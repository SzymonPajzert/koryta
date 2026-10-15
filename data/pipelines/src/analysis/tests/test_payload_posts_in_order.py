"""A person's payload lists their posts in one order, whatever order the row
has them in (`_extract_companies`).

The row's `employment` is a duckdb `list` aggregate, which a rebuild hands over
in another order; the night tells a payload it has sent from a new one by its
hash (`jobs.people_import.payload_hash`).
"""

import itertools

import pandas as pd

from analysis.payloads.person import _extract_companies
from entities.composite import Company

ONE, TWO = "0000000001", "0000000002"


def post(krs: str, role: str | None, start: str | None, end: str | None = None):
    return {
        "employed_krs": krs,
        "employed_role": role,
        "employed_start": start,
        "employed_end": end,
    }


ROWS = [
    post(TWO, "Zarząd", "2023-05-16"),
    post(ONE, "Rada Nadzorcza", "2019-01-09", "2023-06-12"),
    post(TWO, "Zarząd", None),
    post(ONE, "Rada Nadzorcza", "2016-03-01", "2019-01-08"),
    post(ONE, None, "2020-01-01"),
    post(ONE, "Zarząd", "2016-03-01"),
]


def posts(rows) -> list[Company]:
    return _extract_companies(pd.Series({"employment": list(rows)}))


def test_the_posts_come_out_in_one_order_whatever_order_the_row_has():
    first = posts(ROWS)

    assert all(posts(order) == first for order in itertools.permutations(ROWS))


def test_by_company_role_start_and_end_a_missing_one_first():
    assert [(p.krs, p.role, p.start) for p in posts(ROWS)] == [
        (ONE, None, "2020-01-01"),
        (ONE, "Rada Nadzorcza", "2016-03-01"),
        (ONE, "Rada Nadzorcza", "2019-01-09"),
        (ONE, "Zarząd", "2016-03-01"),
        (TWO, "Zarząd", None),
        (TWO, "Zarząd", "2023-05-16"),
    ]


def test_of_a_spell_stated_twice_one_row_is_kept_whatever_the_order():
    """`one_row_per_spell` keeps the first row of a spell. Sorted first, that
    is the same row every night, not whichever the aggregate handed over
    first - here the start as a string rather than as a Timestamp, as
    `test_a_row_is_collapsed_as_extract_writes_it` has them."""
    rows = [
        post(ONE, "Zarząd", "2015-08-28", "2015-08-28"),
        {
            **post(ONE, "Zarząd", None, "2017-10-11"),
            "employed_start": pd.Timestamp("2015-08-28"),
        },
    ]

    kept = [Company(krs=ONE, role="Zarząd", start="2015-08-28", end="2017-10-11")]
    assert posts(rows) == posts(rows[::-1]) == kept
