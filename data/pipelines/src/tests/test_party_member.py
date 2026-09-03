"""What survives on its way from PKW's membership question to a candidacy.

PKW asks every candidate whether they belong to a party and publishes the
answer verbatim. 45,942 of the 1,947,995 rows in `person_pkw` carry a usable
one - 30,292 naming a party, 15,650 saying they belong to none - and the rest
of what the column holds has to be thrown away rather than shown.
"""

import numpy as np
import pandas as pd
import pytest

from analysis.payloads.person import _party_member


@pytest.mark.parametrize(
    "value,expected",
    [
        # The two shapes that are the point of the field.
        (
            "członek partii politycznej: Prawo i Sprawiedliwość",
            "członek partii politycznej: Prawo i Sprawiedliwość",
        ),
        ("nie należy do partii politycznej", "nie należy do partii politycznej"),
        # A bare party name is 34.8% of the answers.
        ("Polskie Stronnictwo Ludowe", "Polskie Stronnictwo Ludowe"),
        # Kept as written, in whatever case PKW used: normalising the 1,084
        # spellings is what this field deliberately does not do.
        ("członek partii SLD", "członek partii SLD"),
        ("  członek partii Ruch Palikota  ", "członek partii Ruch Palikota"),
    ],
)
def test_keeps_what_the_candidate_said(value, expected):
    assert _party_member(value) == expected


@pytest.mark.parametrize(
    "value",
    [
        None,
        # A missing value after a jsonl round trip. NaN is truthy, so a plain
        # `if value` writes the string "nan" onto the edge.
        np.nan,
        float("nan"),
        pd.NA if hasattr(pd, "NA") else None,
        "",
        "   ",
        "nan",
    ],
)
def test_drops_an_absence(value):
    assert _party_member(value) is None


@pytest.mark.parametrize("value", ["1", "2", "31", "314", "-1"])
def test_drops_the_1997_party_id(value):
    # The Sejm 1997 workbook's "Id partii" is an integer key into a table PKW
    # never published. `headers.py` stops mapping it onto this field, but the
    # artifacts already written hold 6,432 of them.
    assert _party_member(value) is None


@pytest.mark.parametrize(
    "value",
    [
        "popierany przez Komitet Obywatelski",
        "Popierany przez NSZZ Solidarność",
    ],
)
def test_drops_an_endorsement(value):
    # 840 rows answer with who backed them, which is the opposite claim to
    # belonging to something. Printing it under "declared membership" would put
    # words in the candidate's mouth.
    assert _party_member(value) is None
