"""One rejestr.io person, one KRS row, however the register spells them.

`create_people_table` groups by the name, and rejestr.io writes one person's
name the way each company's entry has it: with Polish letters and without,
under a maiden name and a married one, with the middle name and without. Every
spelling came out as a row of its own carrying the same register id, 87 ids in
the 2026-10-01 crawl, and `people_merged` then kept one row per name and birth
year - dropping the other row's posts from the person's page.

The people here are invented; the spellings are the kinds measured.
"""

import random
from types import SimpleNamespace

import duckdb
import pandas as pd
import pytest

from analysis.people import people_merged
from analysis.people_krs_merged import people_krs_merged

A, B, C, D = "0000000029", "0000000031", "0000000041", "0000000043"
BORN = "1970-02-08"


def post(
    id: str,
    first: str,
    last: str,
    second: str | None,
    krs: str,
    born: str = BORN,
    full_name: str | None = None,
) -> dict:
    """One post, as `PeopleKRS` gives it: one row per person per company.

    `second` is rejestr.io's `drugie_imiona`: a name, "" for a person it says
    has none, and None for an entry that does not say.
    """
    return {
        "id": id,
        "first_name": first,
        "last_name": last,
        "second_names": second,
        "full_name": full_name or f"{first} {last}",
        "birth_date": born,
        "employed_krs": krs,
        "employed_role": "Zarząd",
        "employed_start": "2020-01-10",
        "employed_end": None,
        "employed_for": "1.00",
    }


@pytest.fixture
def ctx():
    con = duckdb.connect()
    yield SimpleNamespace(con=con)
    con.close()


def merge(ctx, posts: list[dict]) -> pd.DataFrame:
    return people_krs_merged(ctx, pd.DataFrame(posts))


def companies(row) -> list[str]:
    return sorted(e["employed_krs"] for e in row["employment"])


def test_one_person_spelled_two_ways_is_one_row(ctx):
    """The ASCII copy of a surname and the original are one man.

    Before, each spelling grouped on its own and the two rows both carried
    register id 7.
    """
    merged = merge(
        ctx,
        [
            post("7", "Marcin", "Golański", "Jerzy", A),
            post("7", "Marcin", "Golanski", "Jerzy", B),
            post("7", "Marcin", "Golanski", "Jerzy", C),
        ],
    )

    assert len(merged) == 1
    row = merged.iloc[0]
    assert companies(row) == [A, B, C]
    assert list(row["rejestrio_id"]) == ["7"]
    # The entry typed without Polish letters is the copy, even outnumbering
    # the original two to one.
    assert row["last_name"] == "golański"


def test_a_namesake_keeps_his_own_row(ctx):
    """Two men, one name, one birth year, two middle names.

    The pattern behind most of the 87: the register leaves the second man's
    middle name out at one company, that entry fell in with every other
    Marcin Nowak born in 1972, and so the first man's row carried the second
    man's id and post. Given his own spelling, the entry stays with him.
    """
    merged = merge(
        ctx,
        [
            post("1", "Marcin", "Nowak", "Krzysztof", A, born="1972-03-25"),
            post("2", "Marcin", "Nowak", "Mikołaj", B, born="1972-08-29"),
            post("2", "Marcin", "Nowak", "Mikołaj", C, born="1972-08-29"),
            post("2", "Marcin", "Nowak", None, D, born="1972-08-29"),
        ],
    ).set_index("second_name")

    assert list(merged.loc["krzysztof", "rejestrio_id"]) == ["1"]
    assert companies(merged.loc["krzysztof"]) == [A]
    assert list(merged.loc["mikołaj", "rejestrio_id"]) == ["2"]
    assert companies(merged.loc["mikołaj"]) == [B, C, D]


def test_a_stated_absence_beats_a_middle_name_guessed_from_the_full_name(ctx):
    """An entry that does not say gets its middle name from `full_name`, by
    deleting the first name and the surname from it as substrings - which
    leaves Jan Janas with a middle name of "as". The entry that says he has
    none is the one to believe."""
    merged = merge(
        ctx,
        [
            post("3", "Jan", "Janas", "", A),
            post("3", "Jan", "Janas", None, B),
        ],
    )

    assert len(merged) == 1
    assert pd.isna(merged.iloc[0]["second_name"])
    assert companies(merged.iloc[0]) == [A, B]


def test_the_spelling_does_not_depend_on_row_order(ctx):
    """A maiden and a married name, each written once: nothing ranks one
    above the other, so the alphabet decides, and decides the same way
    whatever order the crawl hands the rows over in."""
    posts = [
        post("5", "Anna", "Rusiecka", "", A),
        post("5", "Anna", "Moskwa", "", B),
        post("6", "Ewa", "Wróbel", "", C),
        post("6", "Ewa", "Dąbrowska", "", D),
    ]
    spellings = set()
    for seed in range(4):
        shuffled = posts[:]
        random.Random(seed).shuffle(shuffled)
        merged = merge(ctx, shuffled).sort_values("first_name")
        spellings.add(tuple(merged["last_name"]))

    assert spellings == {("moskwa", "dąbrowska")}


def test_people_merged_keeps_every_post_of_a_person_spelled_two_ways(ctx):
    """The harm, end to end: `unique_krs` keeps one row per name and birth
    year, so of two rows for one man it dropped one along with its posts."""
    krs = merge(
        ctx,
        [
            post("9", "Piotr", "Kisiel", "Włodzimierz", A),
            post("9", "Piotr", "Kisiel", "Wlodzimierz", B),
        ],
    )

    result = people_merged(
        ctx,
        krs,
        pd.DataFrame(
            columns=[
                "first_name",
                "last_name",
                "birth_year",
                "birth_date",
                "full_name",
                "source",
                "is_polityk",
                "wiki_score",
            ]
        ),
        pd.DataFrame(
            columns=[
                "first_name",
                "last_name",
                "second_name",
                "birth_year",
                "full_name",
                "teryt_wojewodztwo",
                "teryt_powiat",
                "elections",
            ]
        ),
        pd.DataFrame(
            columns=[
                "first_name",
                "last_name",
                "tail_name",
                "rejestrio_id",
                "koryta_id",
                "full_name",
            ]
        ),
        pd.DataFrame(columns=["last_name", "teryt", "count"]),
        pd.DataFrame(columns=["first_name", "p"]),
    )

    assert len(result) == 1
    assert companies(result.iloc[0]) == [A, B]
