import glob
import os
import sys

import duckdb
import pandas as pd

from util.config import VERSIONED_DIR

pd.set_option("display.max_rows", None)
pd.set_option("display.max_columns", None)
pd.set_option("display.width", None)


def check_versioned_dir(filename: str) -> str:
    try:
        return glob.glob(os.path.join(VERSIONED_DIR, filename))[0]
    except IndexError:
        print(f"{filename} is missing.")
        sys.exit(1)


krs_file = check_versioned_dir("people_krs.jsonl")
wiki_file = check_versioned_dir("people_wiki.jsonl")
pkw_file = check_versioned_dir("people_pkw.jsonl")
koryta_file = check_versioned_dir("people_koryta.jsonl")

con = duckdb.connect(database=":memory:")
read_limit = ""

con.execute(
    f"""
CREATE OR REPLACE TABLE krs_people AS
SELECT
    lower(first_name) as first_name,
    lower(last_name) as last_name,
    CAST(SUBSTRING(CAST(birth_date AS VARCHAR), 1, 4) AS INTEGER) as birth_year,
    'krs' as source,
    id as source_id,
    full_name
FROM read_json_auto('{krs_file}', format='newline_delimited', auto_detect=true)
WHERE birth_date IS NOT NULL AND first_name IS NOT NULL AND last_name IS NOT NULL
{read_limit}
"""
)

# TODO the name logic is wrong for wiki, try matching on the full name
con.execute(
    f"""
CREATE OR REPLACE TABLE wiki_people AS
SELECT
    lower(regexp_extract(full_name, '^(\\S+)', 1)) as first_name,
    lower(trim(regexp_replace(full_name, '^(\\S+)', ''))) as last_name,
    birth_year,
    'wiki' as source,
    source as source_id,
    full_name
FROM read_json_auto('{wiki_file}', format='newline_delimited', auto_detect=true)
WHERE birth_year IS NOT NULL AND full_name IS NOT NULL AND birth_year > 1930
{read_limit}
"""
)

con.execute(
    f"""
CREATE OR REPLACE TABLE pkw_people AS
SELECT
    lower(first_name) as first_name,
    lower(last_name) as last_name,
    birth_year,
    'pkw' as source,
    pkw_name as source_id,
    pkw_name as full_name
FROM read_json_auto('{pkw_file}', format='newline_delimited', auto_detect=true)
WHERE birth_year IS NOT NULL AND first_name IS NOT NULL AND last_name IS NOT NULL
{read_limit}
"""
)

con.execute(
    f"""
CREATE OR REPLACE TABLE koryta_people AS
SELECT
    full_name as full_name
FROM read_json_auto('{koryta_file}', format='newline_delimited', auto_detect=true)
WHERE birth_year IS NOT NULL AND first_name IS NOT NULL AND last_name IS NOT NULL
{read_limit}
"""
)


def find_two_way_matches(con, table1, table2, limit: int | None = 20):
    name1 = table1.split("_")[0]
    name2 = table2.split("_")[0]
    limit_str = ""
    if limit is not None:
        limit_str = f"LIMIT {limit}"
    query = f"""
    WITH matches AS (
        SELECT
            t1.full_name as {name1}_name,
            t2.full_name as {name2}_name,
            t1.birth_year as {name1}_year,
            t2.birth_year as {name2}_year,
            jaro_winkler_similarity(t1.first_name, t2.first_name) as first_name_sim,
            jaro_winkler_similarity(t1.last_name, t2.last_name) as last_name_sim
        FROM {table1} t1
        JOIN {table2} t2 ON ABS(t1.birth_year - t2.birth_year) <= 1
        WHERE last_name_sim > 0.97 AND first_name_sim > 0.97
    )
    SELECT
        *,
        (first_name_sim + last_name_sim * 2) / 3 as score
    FROM matches
    WHERE score > 0.95
    ORDER BY score DESC
    {limit_str};
    """
    print(f"\n--- Overlaps between {name1.upper()} and {name2.upper()} ---")
    df = con.execute(query).df()
    if df.empty:
        print("No matches found with the current criteria.")
    else:
        print(df)


def main():
    print("--- Imported table sizes ---")
    print(f"KRS: {con.sql("SELECT COUNT(*) FROM krs_people").fetchall()}")
    print(f"Wiki: {con.sql("SELECT COUNT(*) FROM wiki_people").fetchall()}")
    print(f"PKW: {con.sql("SELECT COUNT(*) FROM pkw_people").fetchall()}")

    print("--- Overlaps between all three sources (KRS, Wiki, PKW) ---")
    find_two_way_matches(con, "krs_people", "wiki_people", limit=None)
    find_two_way_matches(con, "krs_people", "pkw_people", limit=None)
    con.close()


if __name__ == "__main__":
    main()
