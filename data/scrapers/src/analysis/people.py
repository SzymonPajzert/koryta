import duckdb
import pandas as pd
import os

from util.config import versioned

pd.set_option("display.max_rows", None)
pd.set_option("display.max_columns", None)
pd.set_option("display.width", None)


krs_file = versioned.assert_path("people_krs.jsonl")
wiki_file = versioned.assert_path("people_wiki.jsonl")
pkw_file = versioned.assert_path("people_pkw.jsonl")
koryta_file = versioned.assert_path("people_koryta.jsonl")

con = duckdb.connect(database=":memory:")

con.execute(
    """
    INSTALL splink_udfs FROM community;
    LOAD splink_udfs;
    """
)

read_limit = ""


def create_people_table(tbl_name, to_list: list[str] = [], any_vals: list[str] = []):
    con.execute(
        f"""
        CREATE OR REPLACE TABLE {tbl_name} AS
        SELECT
            first_name,
            last_name,
            trim(replace(
                replace(lower(full_name), lower(first_name), ''),
                lower(last_name),
                '')) as second_name,
            double_metaphone(last_name) as metaphone,
            birth_year,
            {'\n'.join([f"list({col}) as {col}," for col in to_list])}
            {'\n'.join([f"any_value({col}) as {col}," for col in any_vals])}
        FROM {tbl_name}_raw
        GROUP BY ALL
        """
    )


con.execute(
    f"""
CREATE OR REPLACE TABLE krs_people_raw AS
SELECT
    lower(first_name) as first_name,
    lower(last_name) as last_name,
    CAST(SUBSTRING(CAST(birth_date AS VARCHAR), 1, 4) AS INTEGER) as birth_year,
    employed_end,
    employed_krs,
    id as rejestrio_id,
    full_name
FROM read_json_auto('{krs_file}', format='newline_delimited', auto_detect=true)
WHERE birth_date IS NOT NULL AND first_name IS NOT NULL AND last_name IS NOT NULL
{read_limit};
"""
)

create_people_table(
    "krs_people", to_list=["employed_krs", "employed_end", "rejestrio_id", "full_name"]
)

# TODO the name logic is wrong for wiki, try matching on the full name
con.execute(
    f"""
CREATE OR REPLACE TABLE wiki_people_raw AS
SELECT
    lower(regexp_extract(full_name, '^(\\S+)', 1)) as first_name,
    lower(trim(regexp_replace(full_name, '^(\\S+)', ''))) as last_name,
    birth_year,
    CASE
        WHEN infobox = 'Polityk' THEN 'Polityk'
        WHEN infobox = 'Biogram' THEN 'Biogram'
        WHEN infobox = 'Naukowiec' THEN 'Naukowiec'
        ELSE NULL    
    END as is_polityk,
    atan(content_score) AS wiki_score,
    full_name
FROM read_json_auto('{wiki_file}', format='newline_delimited', auto_detect=true)
WHERE birth_year IS NOT NULL AND full_name IS NOT NULL AND birth_year > 1930
{read_limit}
"""
)

create_people_table("wiki_people", any_vals=["is_polityk", "full_name", "wiki_score"])

con.execute(
    f"""
CREATE OR REPLACE TABLE pkw_people_raw AS
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

create_people_table("pkw_people", to_list=["full_name"])

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


# TODO Bonus points if wiki people has polityk infobox


def _find_all_matches(con):
    query = f"""
    WITH krs_pkw AS (
        SELECT
            k.metaphone as metaphone,
            k.full_name[1] as krs_name,
            p.full_name[1] as pkw_name,
            k.birth_year as birth_year,
            k.first_name as base_first_name, -- Carry forward base names for subsequent joins
            k.last_name as base_last_name,
            k.full_name as base_full_name,
            k.employed_end,
            k.employed_krs,
        FROM krs_people k
        FULL JOIN pkw_people p ON (ABS(k.birth_year - p.birth_year) <= 1 OR p.birth_year IS NULL)
            AND k.metaphone = p.metaphone
            AND k.last_name = p.last_name
            AND k.first_name = p.first_name
            AND (k.second_name = p.second_name OR k.second_name IS NULL OR p.second_name IS NULL OR k.second_name = '' OR p.second_name = '')
    ),
    krs_pkw_wiki AS (
        SELECT
            kp.*,
            w.full_name as wiki_name,
            w.is_polityk,
            w.wiki_score,
        FROM krs_pkw kp
        FULL JOIN wiki_people w ON ABS(kp.birth_year - w.birth_year) <= 1 AND kp.metaphone = w.metaphone
            AND kp.base_last_name = w.last_name
            AND kp.base_first_name = w.first_name
    ),
    all_sources AS (
        SELECT
            kpw.*,
            ko.full_name as koryta_name,
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
        employed_end,
        employed_krs,
        is_polityk,
        (
            (CASE WHEN krs_name IS NOT NULL THEN 8 ELSE 0 END) +
            (CASE WHEN pkw_name IS NOT NULL THEN 4 ELSE 0 END) +
            (CASE WHEN koryta_name IS NOT NULL THEN 16 ELSE 0 END) +
            (CASE WHEN wiki_name IS NOT NULL THEN 2 ELSE 0 END) +
            (CASE
                WHEN is_polityk = 'Polityk' THEN 1
                WHEN is_polityk IS NOT NULL THEN 0.5
                ELSE 0
            END) + COALESCE(wiki_score, 0)
        ) as overall_score
    FROM all_sources
    WHERE overall_score >= 8
    ORDER BY overall_score DESC, koryta_name, krs_name, pkw_name, wiki_name, birth_year
    """
    print("\n--- Overlaps between Koryta, KRS, PKW, and Wiki ---")
    df = con.execute(query).df()
    if df.empty:
        raise Exception("No matches found with the current criteria.")
    return df


def find_all_matches(con):
    df_path = versioned.get_path("matched.parquet")
    df = None  # TODO Do I need it for visibility?
    if os.path.exists(df_path):
        print(f"Reading memoized {df_path}")
        df = pd.read_parquet(df_path)
    else:
        df = _find_all_matches(con)
        print(f"Got results, saving to {df_path}")
        df.to_parquet(df_path)
    return df


def main():
    print("--- Imported table sizes ---")
    for table in ["krs_people", "wiki_people", "pkw_people", "koryta_people"]:
        print(f"{table}: {con.sql(f"SELECT COUNT(*) FROM {table}").fetchall()}")
        print(con.sql(f"SELECT * FROM {table} LIMIT 10").df())
        print("\n\n")

    print("--- Overlaps between all three sources (KRS, Wiki, PKW) ---")

    df = find_all_matches(con)
    print(df)
    con.close()


if __name__ == "__main__":
    main()
