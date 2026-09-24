import duckdb
import pandas as pd
import pytest

from analysis.people_pkw_merged import drop_contradictory_candidacies
from analysis.utils.tables import create_people_table


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
