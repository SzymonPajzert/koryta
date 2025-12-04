import pytest
import duckdb
import pandas as pd
from analysis.utils.tables import create_people_table, init_tables

@pytest.fixture
def con():
    con = duckdb.connect()
    init_tables(con)
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
    
    df = pd.DataFrame(data, columns=[
        "first_name", "last_name", "second_name", "full_name", "birth_year", "party", "election_year"
    ])
    
    # Create raw table
    con.execute("CREATE TABLE people_pkw_merged_raw AS SELECT * FROM df")
    
    # Run merging logic
    create_people_table(
        con,
        "people_pkw_merged",
        to_list=["full_name"],
        flatten_list=[], # simplified for test
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
    assert len(donalds_1957) == 1, f"Expected 1 Donald Tusk 1957, got {len(donalds_1957)}"
    
    row = donalds_1957.iloc[0]
    assert row["second_name"] == "franciszek"
    
    # Check total count (including NULL birth year)
    # If we want to merge NULL birth year too, we need to change logic.
    # For now, let's see if 1957 merged.
    assert len(donalds) == 1, f"Expected 1 Donald Tusk total, got {len(donalds)}"
    # Check if all elections are present
    # aggregated 'party' and 'election_year' are lists of structs or similar, depending on create_people_table implementation
    # In create_people_table, kwargs are struct_packed. 
    # elections={"party": "party", ...} means we get a column 'party' which is a list of structs? 
    # No, look at create_people_table call in people_pkw_merged.py:
    # elections={ "party": "party", ... }
    # In create_people_table: kwargs=elections.
    # kwargs_select_list = [ f"list(struct_pack({struct_pack(struct)})) as {col}" ... ]
    # So 'party' column in output will be a list of structs? 
    # Wait, the key in kwargs is the output column name, the value is the struct definition?
    # In people_pkw_merged.py:
    # elections={ "party": "party", "election_year": "election_year", ... }
    # This implies the output column 'party' will contain structs of {party: party_value}.
    # Actually, create_people_table takes **kwargs.
    # In people_pkw_merged.py it passes `elections={...}`. 
    # But `create_people_table` does NOT have an `elections` parameter!
    # It has `**kwargs`. So `elections` goes into `kwargs`.
    # So `kwargs` = {'elections': {'party': 'party', ...}}
    # Then `for col, struct in kwargs.items()`:
    # col = "elections", struct = {'party': 'party', ...}
    # So it creates a column named "elections" which is a list of structs defined by that dict.
    
    # So in my test, I should check the 'elections' column.
    
    assert 'elections' in row
    elections = row['elections']
    assert len(elections) >= 3 # 1991, 2007, 2011, 2019 -> 4 records.
    # If 1991 (NULL birth_year) didn't merge, we might have fewer.


def test_teresa_zieba_merging(con):
    # Create a table with Teresa Zięba records having close birth years
    con.execute(
        """
        CREATE OR REPLACE TABLE people_pkw_merged_raw AS
        SELECT * FROM (VALUES
            ('teresa', 'zięba', 'teresa', 'zięba', 1958, 'ZIĘBA Teresa', 'teresa', 'zięba'),
            ('teresa', 'zięba', 'teresa', 'zięba', 1959, 'ZIĘBA Teresa', 'teresa', 'zięba')
        ) AS t(first_name, last_name, full_name, second_name, birth_year, source_name, base_first_name, base_last_name)
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

