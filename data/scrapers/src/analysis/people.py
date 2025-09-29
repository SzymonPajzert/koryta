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

con.execute(
    """
    INSTALL splink_udfs FROM community;
    LOAD splink_udfs;
    """
)

read_limit = ""

con.execute(
    f"""
CREATE OR REPLACE TABLE krs_people AS
SELECT DISTINCT
    lower(first_name) as first_name,
    lower(last_name) as last_name,
    double_metaphone(last_name) as metaphone,
    CAST(SUBSTRING(CAST(birth_date AS VARCHAR), 1, 4) AS INTEGER) as birth_year,
    id as rejestrio_id,
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
SELECT DISTINCT
    lower(regexp_extract(full_name, '^(\\S+)', 1)) as first_name,
    lower(trim(regexp_replace(full_name, '^(\\S+)', ''))) as last_name,
    double_metaphone(last_name) as metaphone,
    birth_year,
    full_name
FROM read_json_auto('{wiki_file}', format='newline_delimited', auto_detect=true)
WHERE birth_year IS NOT NULL AND full_name IS NOT NULL AND birth_year > 1930
{read_limit}
"""
)

con.execute(
    f"""
CREATE OR REPLACE TABLE pkw_people AS
SELECT DISTINCT
    lower(first_name) as first_name,
    lower(last_name) as last_name,
    double_metaphone(last_name) as metaphone,
    birth_year,
    pkw_name as full_name
FROM read_json_auto('{pkw_file}', format='newline_delimited', auto_detect=true)
WHERE birth_year IS NOT NULL AND first_name IS NOT NULL AND last_name IS NOT NULL
{read_limit}
"""
)

con.execute(
    f"""
CREATE OR REPLACE TABLE koryta_people AS
-- koryta_people lacks birth_year, so we can't use it as a base for joining with others on birth_year.
-- We will use it for enrichment if we can parse first/last names.
SELECT DISTINCT
    lower(regexp_extract(full_name, '^(\\S+)', 1)) as first_name,
    lower(trim(regexp_replace(full_name, '^(\\S+)', ''))) as last_name,
    double_metaphone(last_name) as metaphone,
    id as koryta_id,
    full_name
FROM read_json_auto('{koryta_file}', format='newline_delimited', auto_detect=true)
WHERE full_name IS NOT NULL
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


# TODO Bonus points if wiki people has polityk infobox


def find_all_matches(con, limit: int | None = 20):
    limit_str = f"LIMIT {limit}" if limit is not None else ""
    query = f"""
    WITH krs_pkw AS (
        SELECT
            k.metaphone as metaphone,
            k.full_name as krs_name,
            p.full_name as pkw_name,
            k.birth_year as birth_year,
            k.first_name as base_first_name, -- Carry forward base names for subsequent joins
            k.last_name as base_last_name,
            k.full_name as base_full_name,
            (
                jaro_winkler_similarity(k.first_name, p.first_name) +
                jaro_winkler_similarity(k.last_name, p.last_name) * 2 +
                jaro_winkler_similarity(k.full_name, p.full_name)
            ) / 4.0 as pkw_score
        FROM krs_people k
        FULL JOIN pkw_people p ON k.birth_year = p.birth_year AND k.metaphone = p.metaphone
            AND jaro_winkler_similarity(k.last_name, p.last_name) > 0.95
            AND jaro_winkler_similarity(k.first_name, p.first_name) > 0.95
    ),
    krs_pkw_wiki AS (
        SELECT
            kp.*,
            w.full_name as wiki_name,
            (
                jaro_winkler_similarity(kp.base_first_name, w.first_name) +
                jaro_winkler_similarity(kp.base_last_name, w.last_name) * 2 +
                jaro_winkler_similarity(kp.base_full_name, w.full_name)
            ) / 4.0 as wiki_score
        FROM krs_pkw kp
        LEFT JOIN wiki_people w ON kp.birth_year = w.birth_year AND kp.metaphone = w.metaphone
            AND jaro_winkler_similarity(kp.base_last_name, w.last_name) > 0.95
            AND jaro_winkler_similarity(kp.base_first_name, w.first_name) > 0.95
    ),
    all_sources AS (
        SELECT
            kpw.*,
            ko.full_name as koryta_name,
            (
                jaro_winkler_similarity(kpw.base_first_name, ko.first_name) +
                jaro_winkler_similarity(kpw.base_last_name, ko.last_name) * 2 +
                jaro_winkler_similarity(kpw.base_full_name, ko.full_name)
            ) / 4.0 as koryta_score
        FROM krs_pkw_wiki kpw
        FULL JOIN koryta_people ko ON jaro_winkler_similarity(kpw.base_last_name, ko.last_name) > 0.95
            AND jaro_winkler_similarity(kpw.base_first_name, ko.first_name) > 0.95
    )
    SELECT
        koryta_name,
        krs_name,
        pkw_name,
        wiki_name,
        birth_year,
        (
            (CASE WHEN krs_name IS NOT NULL THEN 8 ELSE 0 END) +
            (CASE WHEN pkw_name IS NOT NULL THEN 4 ELSE 0 END) +
            (CASE WHEN koryta_name IS NOT NULL THEN 2 ELSE 0 END) +
            (CASE WHEN wiki_name IS NOT NULL THEN 1 ELSE 0 END)
        ) as overall_score
    FROM all_sources
    ORDER BY overall_score DESC
    {limit_str};
    """
    print("\n--- Overlaps between Koryta, KRS, PKW, and Wiki ---")
    df = con.execute(query).df()
    if df.empty:
        raise Exception("No matches found with the current criteria.")
    return df


def main():
    print("--- Imported table sizes ---")
    for table in ["krs_people", "wiki_people", "pkw_people", "koryta_people"]:
        print(f"{table}: {con.sql(f"SELECT COUNT(*) FROM {table}").fetchall()}")
        print(con.sql(f"SELECT * FROM {table} LIMIT 10").df())
        print("\n\n")

    print("--- Overlaps between all three sources (KRS, Wiki, PKW) ---")
    # find_two_way_matches(con, "krs_people", "wiki_people", limit=100)
    # find_two_way_matches(con, "krs_people", "pkw_people", limit=100)

    df = find_all_matches(con, limit=4000)
    print(df)
    con.close()


if __name__ == "__main__":
    main()
