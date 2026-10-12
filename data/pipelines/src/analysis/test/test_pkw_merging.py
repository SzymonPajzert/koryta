import typing
from types import SimpleNamespace

import duckdb
import pandas as pd
import pytest

from analysis.payloads.site import LOCAL_OFFICES as READ_BY_THE_SITE
from analysis.people_pkw_merged import drop_contradictory_candidacies, people_pkw_merged
from analysis.utils.tables import create_people_table
from scrapers.pkw.offices import LOCAL_OFFICES
from scrapers.stores import Context


@pytest.fixture
def con():
    con = duckdb.connect()
    return con


def test_pkw_merging_donald_tusk(con):
    # Setup raw data
    # Scenario:
    # 1. Donald Tusk (no second name), birth_year 1957
    # 2. Donald Franciszek Tusk, birth_year 1957
    # 3. Donald Tusk, birth_year 1957 (duplicate entry from another election)
    # 4. Donald Tusk, birth_year NULL (maybe missing data)

    data = [
        ("donald", "tusk", None, "donald tusk", 1957, "PO", 2007),
        ("donald", "tusk", "franciszek", "donald franciszek tusk", 1957, "PO", 2011),
        ("donald", "tusk", None, "donald tusk", 1957, "KO", 2019),
        ("donald", "tusk", None, "donald tusk", None, "KLD", 1991),
    ]

    df = pd.DataFrame(  # noqa: F841
        data,
        columns=[
            "first_name",
            "last_name",
            "second_name",
            "full_name",
            "birth_year",
            "party",
            "election_year",
        ],
    )

    # Create raw table
    con.execute("CREATE TABLE people_pkw_merged_raw AS SELECT * FROM df")

    # Run merging logic
    create_people_table(
        con,
        "people_pkw_merged",
        to_list=["full_name"],
        flatten_list=[],  # simplified for test
        elections={
            "party": "party",
            "election_year": "election_year",
        },
    )

    result = con.execute("SELECT * FROM people_pkw_merged").df()
    print("\nResult DataFrame:")
    print(result[["first_name", "last_name", "second_name", "birth_year", "full_name"]])

    # Assertions
    donalds = result[result["last_name"] == "tusk"]

    # Check if 1957s merged
    donalds_1957 = donalds[donalds["birth_year"] == 1957]
    assert len(donalds_1957) == 1, (
        f"Expected 1 Donald Tusk 1957, got {len(donalds_1957)}"
    )

    row = donalds_1957.iloc[0]
    assert row["second_name"] == "franciszek"

    assert len(donalds) == 1, f"Expected 1 Donald Tusk total, got {len(donalds)}"

    assert "elections" in row
    elections = row["elections"]
    assert len(elections) >= 3  # 1991, 2007, 2011, 2019 -> 4 records.
    # If 1991 (NULL birth_year) didn't merge, we might have fewer.


def test_teresa_zieba_merging(con):
    # Create a table with Teresa Zięba records having close birth years
    con.execute(
        """
        CREATE OR REPLACE TABLE people_pkw_merged_raw AS
        SELECT * FROM (VALUES
            ('teresa', 'zięba', 'teresa', 'zięba',
                1958, 'ZIĘBA Teresa', 'teresa', 'zięba'),
            ('teresa', 'zięba', 'teresa', 'zięba',
                1959, 'ZIĘBA Teresa', 'teresa', 'zięba')
        ) AS t(first_name, last_name, full_name, second_name,
            birth_year, source_name, base_first_name, base_last_name)
        """
    )

    # Run the merging logic
    create_people_table(con, "people_pkw_merged", any_vals=["source_name"])

    # Check the result
    df = con.execute("SELECT * FROM people_pkw_merged").df()
    print(df)

    # Verify that we have exactly one record for Teresa Zięba
    assert len(df) == 1, f"Expected 1 record, found {len(df)}"
    # The birth year should be one of them (likely the MAX, 1959)
    assert df.iloc[0]["birth_year"] in [1958, 1959]


def test_a_sejmik_candidacy_is_not_a_second_place(con):
    # 1400 is how a mazowieckie sejmik candidacy comes out at powiat depth,
    # 1465 is Warszawa and 2400 is the śląskie sejmik.
    def standing(*powiats):
        return [
            {
                "election_year": "2006",
                "election_type": "samorządu",
                "teryt_candidacy_powiat": powiat,
                "teryt_powiat": [powiat],
            }
            for powiat in powiats
        ]

    people = pd.DataFrame(  # noqa: F841
        {
            "full_name": ["sejmik and warszawa", "two sejmiki", "two powiats"],
            "elections": [
                standing("1400", "1465"),
                standing("1400", "2400"),
                standing("1465", "2461"),
            ],
        }
    )
    con.execute("CREATE TABLE people_pkw_merged AS SELECT * FROM people")

    drop_contradictory_candidacies(con)

    ambiguous = dict(
        con.execute(
            "SELECT full_name, elections_ambiguous FROM people_pkw_merged"
        ).fetchall()
    )
    assert ambiguous == {
        "sejmik and warszawa": False,
        "two sejmiki": True,
        "two powiats": True,
    }


def witko_rows(*rows):
    """`person_pkw` rows for Marcin Witko, born 1971, in Tomaszów Mazowiecki."""
    return pd.DataFrame.from_records(
        [
            {
                "first_name": "Marcin",
                "middle_name": None,
                "last_name": "Witko",
                "pkw_name": "Witko Marcin",
                "birth_year": 1971.0,
                "teryt_candidacy": "101601",
                "teryt_living": "101601",
                "party": "KOMITET WYBORCZY PRAWO I SPRAWIEDLIWOŚĆ",
                "election_year": "2010",
                "election_type": "samorządu",
                **row,
            }
            for row in rows
        ]
    )


def elections(pkw_data: pd.DataFrame) -> list[tuple]:
    # All `people_pkw_merged` asks of the context is its connection.
    ctx = typing.cast(Context, SimpleNamespace(con=duckdb.connect()))
    merged = people_pkw_merged(ctx, pkw_data)
    assert len(merged) == 1
    return sorted(
        (e["office"], e["candidacy_success"]) for e in merged.iloc[0]["elections"]
    )


#: His 2010: the council seat, and the prezydent race in two rounds - through
#: to the run-off (`2`, read as FALSE), then lost it.
WITKO_2010 = [
    {"candidacy_success": "TRUE", "office": "Rada miasta"},
    {"candidacy_success": "FALSE", "office": "Prezydent"},
    {"candidacy_success": "FALSE", "office": "Prezydent"},
]


def test_a_council_run_and_a_mayoral_run_are_two_candidacies():
    assert elections(witko_rows(*WITKO_2010)) == [
        ("Prezydent", "FALSE"),
        ("Rada miasta", "TRUE"),
    ]


def test_a_run_off_won_is_one_candidacy_won():
    """The first round's row lost, the second's won: one race, won."""
    rows = witko_rows(
        {"candidacy_success": "FALSE", "office": "Prezydent", "election_year": "2014"},
        {"candidacy_success": "TRUE", "office": "Prezydent", "election_year": "2014"},
    )

    assert elections(rows) == [("Prezydent", "TRUE")]


def test_a_person_pkw_without_offices_is_read_as_before():
    """Built before the column: nothing is folded, as nothing tells a council
    run from a mayoral run in one town."""
    rows = witko_rows(*WITKO_2010).drop(columns=["office"])
    rows = pd.concat(
        [rows, rows.iloc[[1]].assign(candidacy_success="TRUE", election_year="2014")]
    )

    assert elections(rows) == [(None, "FALSE"), (None, "TRUE"), (None, "TRUE")]


def test_the_offices_named_are_the_ones_the_site_reads():
    """`site.py` mirrors the ingest's list of local offices, which is the
    site's. An office named by `scrapers.pkw.offices` and missing there would
    read as contradicting every stored „Samorząd” and be predicted, and
    written, as a candidacy of its own."""
    assert LOCAL_OFFICES == READ_BY_THE_SITE
