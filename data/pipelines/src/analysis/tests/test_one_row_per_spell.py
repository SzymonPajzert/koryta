"""One payload row per spell of employment: `one_row_per_spell`.

The cases are the two people every people plan from 2026-10-06 to 2026-10-10
carried twice: the Polskie LNG board from 2015-08-28, once more with an end on
that same day.
"""

import pandas as pd

from analysis.payloads.person import _extract_companies, one_row_per_spell
from entities.composite import Company

LNG = "0000345690"


def spell(end=None, *, role="Zarząd", start="2015-08-28", krs=LNG) -> Company:
    return Company(krs=krs, role=role, start=start, end=end)


def test_a_spell_stated_twice_is_sent_once_with_the_later_end():
    """Robert Marian Soszyński, who left the board on 2016-03-14."""
    rows = [spell("2015-08-28"), spell("2016-03-14")]

    assert one_row_per_spell(rows) == [spell("2016-03-14")]
    assert one_row_per_spell(rows[::-1]) == [spell("2016-03-14")]


def test_an_end_wins_over_none():
    """The register lists a current job with no end, so a row that has one
    says more about the same spell."""
    assert one_row_per_spell([spell(), spell("2017-10-11")]) == [spell("2017-10-11")]
    assert one_row_per_spell([spell("2017-10-11"), spell()]) == [spell("2017-10-11")]


def test_another_role_start_or_company_is_another_spell():
    rows = [
        spell("2015-08-28", role="Rada Nadzorcza", start="2009-12-31"),
        spell("2015-08-28"),
        spell("2017-10-11", start="2016-01-01"),
        spell(krs="0000000001"),
    ]

    assert one_row_per_spell(rows) == rows


def test_the_kept_row_stays_where_the_spell_first_came():
    other = spell(role="Rada Nadzorcza", start="2009-12-31")
    rows = [spell("2015-08-28"), other, spell("2017-10-11")]

    assert one_row_per_spell(rows) == [spell("2017-10-11"), other]


def test_two_undated_rows_of_one_role_are_one_spell():
    """The ingest reads both as one identity, a null `start_date`, and would
    store the second as a second copy of it."""
    rows = [spell("2010-01-01", start=None), spell("2012-01-01", start=None)]

    assert one_row_per_spell(rows) == [spell("2012-01-01", start=None)]


def test_an_undated_row_stays_beside_a_dated_one():
    """`employed` is not enrichable: a missing start is not the dated spell."""
    rows = [spell("2016-03-14"), spell(start=None)]

    assert one_row_per_spell(rows) == rows


def test_a_row_is_collapsed_as_extract_writes_it():
    """Off the `employment` column, where a start may arrive as a Timestamp."""
    row = pd.Series(
        {
            "employment": [
                {
                    "employed_krs": LNG,
                    "employed_role": "Zarząd",
                    "employed_start": "2015-08-28",
                    "employed_end": "2015-08-28",
                },
                {
                    "employed_krs": LNG,
                    "employed_role": "Zarząd",
                    "employed_start": pd.Timestamp("2015-08-28"),
                    "employed_end": "2017-10-11",
                },
            ]
        }
    )

    assert _extract_companies(row) == [spell("2017-10-11")]
