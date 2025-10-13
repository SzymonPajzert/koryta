import duckdb
import pandas as pd
import math
import os

from util.download import FileSource
from util.config import versioned, downloaded

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

sources = [
    FileSource(
        "https://dane.gov.pl/pl/dataset/1681,nazwiska-osob-zyjacych-wystepujace-w-rejestrze-pesel/resource/65049/table",
        "nazwiska_męskie-osoby_żyjące_w_podziale_na_województwo_zameldowania.csv",
    ),
    FileSource(
        "https://dane.gov.pl/pl/dataset/1681,nazwiska-osob-zyjacych-wystepujace-w-rejestrze-pesel/resource/65090/table",
        "nazwiska_żeńskie-osoby_żyjące_w_podziale_na_województwo_zameldowania.csv",
    ),
    FileSource(
        "https://dane.gov.pl/pl/dataset/1667,lista-imion-wystepujacych-w-rejestrze-pesel-osoby-zyjace/resource/63929/table",
        "8_-_Wykaz_imion_męskich_osób_żyjących_wg_pola_imię_pierwsze_występujących_w_rejestrze_PESEL_bez_zgonów.csv",
    ),
    FileSource(
        "https://dane.gov.pl/pl/dataset/1667,lista-imion-wystepujacych-w-rejestrze-pesel-osoby-zyjace/resource/63924/table",
        "8_-_Wykaz_imion_żeńskich__osób_żyjących_wg_pola_imię_pierwsze_występujących_w_rejestrze_PESEL_bez_zgonów.csv",
    ),
]
# This doesn't work, because dane.gov.pl sucks, you need to download manually
# for source in sources:
#     if not source.downloaded():
#         source.download()

SAMPLE_FILTER = ""
# SAMPLE_FILTER = "AND lower(last_name) LIKE 'alek%'"

con.execute(
    f"""CREATE TABLE names_count_by_region AS
    SELECT
        lower("Nazwisko aktualne") as last_name,
        AVG("Liczba") as count,
        teryt
    FROM (
        SELECT *, 'M' as sex FROM read_csv('{downloaded.assert_path(sources[0].filename)}')
        UNION ALL
        SELECT *, 'F' as sex FROM read_csv('{downloaded.assert_path(sources[1].filename)}')
    ) AS names
    LEFT JOIN (
        SELECT * FROM (VALUES
            ('DOLNOŚLĄSKIE', '02'),
            ('KUJAWSKO-POMORSKIE', '04'),
            ('LUBELSKIE', '06'),
            ('LUBUSKIE', '08'),
            ('ŁÓDZKIE', '10'),
            ('MAŁOPOLSKIE', '12'),
            ('MAZOWIECKIE', '14'),
            ('OPOLSKIE', '16'),
            ('PODKARPACKIE', '18'),
            ('PODLASKIE', '20'),
            ('POMORSKIE', '22'),
            ('ŚLĄSKIE', '24'),
            ('ŚWIĘTOKRZYSKIE', '26'),
            ('WARMIŃSKO-MAZURSKIE', '28'),
            ('WIELKOPOLSKIE', '30'),
            ('ZACHODNIOPOMORSKIE', '32')
        ) AS t(wojewodztwo, teryt)
    ) AS regions ON names."Województwo zameldowania na pobyt stały" = regions.wojewodztwo
    WHERE TRUE {SAMPLE_FILTER}
    GROUP BY ALL
    """
)

con.execute(
    f"""CREATE TABLE first_name_freq AS
    WITH raw_names AS (
        SELECT
            lower("IMIĘ_PIERWSZE") as first_name,
            "LICZBA_WYSTĄPIEŃ" as count
        FROM read_csv('{downloaded.assert_path(sources[2].filename)}')
        UNION ALL
        SELECT
            lower("IMIĘ_PIERWSZE") as first_name,
            "LICZBA_WYSTĄPIEŃ" as count
        FROM read_csv('{downloaded.assert_path(sources[3].filename)}')
    ),
    total AS (
        SELECT SUM(count) as total_count FROM raw_names
    )
    SELECT
        first_name,
        count,
        CAST(count AS DOUBLE) / total.total_count as p
    FROM raw_names, total
"""
)

LN_10 = math.log(10)


def unique_probability(
    p1: float, p2: float | None, second_name_match: bool, n: float
) -> float:
    """
    Calculates the probability of no accidental match.
    p1: probability of the first name.
    p2: probability of the second name (or 1.0 if no second name).
    n: number of people with the same last name in the region.
    """

    if p2 is None or math.isnan(p2) or not second_name_match:
        p2 = 1.0
    if p1 is None or math.isnan(p1):
        p1 = 1.0

    p_combined = p1 * p2
    if n is None:
        n = 50000  # TODO check
    n = n / 40  # TODO calculate demographic data
    if p_combined is None or p_combined == 1:
        return 0
    # Using Poisson approximation for (1-p)^n ~= exp(-n*p) to avoid floating point issues
    # Probability of no collision is exp(-n*p)
    # We are interested in high precision, so we're returning
    # e^(-ln 10) = 1/10, so ln 10 is the number of zeroes
    # (n * p_combined) / LN_10) should be good

    if n < 50:
        return math.pow(1 - p_combined, n)
    return math.exp(-n * p_combined)


con.create_function(
    "unique_probability", unique_probability, null_handling="special"  # type: ignore
)


def create_people_table(
    tbl_name,
    to_list: list[str] = [],
    any_vals: list[str] = [],
    flatten_list: list[str] = [],
):
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
            {'\n'.join([f"list_distinct(list({col})) as {col}," for col in to_list])}
            {'\n'.join([f"list_distinct(flatten(list({col}))) as {col}," for col in flatten_list])}
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
    CAST(birth_date AS VARCHAR) as birth_date,
    employed_end,
    employed_krs,
    id as rejestrio_id,
    full_name
FROM read_json_auto('{krs_file}', format='newline_delimited', auto_detect=true)
WHERE birth_date IS NOT NULL AND first_name IS NOT NULL AND last_name IS NOT NULL
{SAMPLE_FILTER}
"""
)

create_people_table(
    "krs_people",
    to_list=["employed_krs", "employed_end", "rejestrio_id", "full_name"],
    any_vals=["birth_date"],
)

# TODO the name logic is wrong for wiki, try matching on the full name
con.execute(
    f"""
CREATE OR REPLACE TABLE wiki_people_raw AS
SELECT
    lower(regexp_extract(full_name, '^(\\S+)', 1)) as first_name,
    lower(trim(regexp_extract(full_name, '(\\S+)$', 1))) as last_name,
    birth_year,
    birth_iso8601 AS birth_date,
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
{SAMPLE_FILTER}
"""
)

create_people_table(
    "wiki_people",
    any_vals=["is_polityk", "full_name", "wiki_score", "birth_date"],
)

con.execute(
    f"""
CREATE OR REPLACE TABLE pkw_people_raw AS
SELECT DISTINCT
    lower(first_name) as first_name,
    lower(last_name) as last_name,
    lower(middle_name) as second_name,
    double_metaphone(last_name) as metaphone,
    list_distinct([
        teryt_candidacy[:2],
        teryt_living[:2],
    ]) as teryt_wojewodztwo,
    list_distinct([
        teryt_candidacy[:4],
        teryt_living[:4],
    ]) as teryt_powiat,
    birth_year,
    pkw_name as full_name
FROM read_json_auto('{pkw_file}', format='newline_delimited', auto_detect=true)
WHERE birth_year IS NOT NULL AND first_name IS NOT NULL AND last_name IS NOT NULL
{SAMPLE_FILTER}
"""
)

create_people_table(
    "pkw_people",
    to_list=["full_name"],
    flatten_list=["teryt_wojewodztwo", "teryt_powiat"],
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
            k.birth_date as birth_date,
            k.employed_end,
            k.employed_krs,
            k.birth_year = p.birth_year as kp_same_birth_year,
            CASE
                WHEN p.full_name IS NOT NULL THEN
                    unique_probability(
                        p_fn.p,
                        p_sn.p,
                        k.second_name = p.second_name AND k.second_name IS NOT NULL AND p.second_name IS NOT NULL,
                        names_count.count
                    )
                ELSE NULL
            END as unique_chance,
            *,
        FROM krs_people k
        LEFT JOIN pkw_people p ON (ABS(k.birth_year - p.birth_year) <= 1 OR p.birth_year IS NULL)
            AND k.metaphone = p.metaphone
            AND k.last_name = p.last_name
            AND k.first_name = p.first_name
            AND (k.second_name = p.second_name OR k.second_name IS NULL OR p.second_name IS NULL OR k.second_name = '' OR p.second_name = '')
        LEFT JOIN first_name_freq p_fn ON k.first_name = p_fn.first_name
        LEFT JOIN first_name_freq p_sn ON k.second_name = p_sn.first_name
        LEFT JOIN names_count_by_region names_count
            ON k.last_name = names_count.last_name
            -- We need to pick one teryt, let's use the first one from pkw_people if available
            AND list_extract(p.teryt_wojewodztwo, 1) = names_count.teryt

    ),
    krs_pkw_wiki AS (
        SELECT
            kp.*,
            w.full_name as wiki_name,
            w.is_polityk,
            w.wiki_score,
        FROM krs_pkw kp
        FULL JOIN wiki_people w
            ON (kp.birth_date = w.birth_date OR w.birth_date IS NULL)
            AND kp.metaphone = w.metaphone
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
    ),
    scored AS (
        SELECT
            (
                (CASE WHEN kp_same_birth_year THEN 2 ELSE 0 END) + 
                (CASE WHEN krs_name IS NOT NULL THEN 8 ELSE 0 END) +
                (CASE WHEN pkw_name IS NOT NULL THEN 4 ELSE 0 END) +
                (CASE WHEN koryta_name IS NOT NULL THEN 16 ELSE 0 END) +
                (CASE WHEN wiki_name IS NOT NULL THEN 2 ELSE 0 END) +
                (CASE
                    WHEN is_polityk = 'Polityk' THEN 1
                    WHEN is_polityk IS NOT NULL THEN 0.5
                    ELSE 0
                END) + COALESCE(wiki_score, 0)
            ) as overall_score,
            *,
        FROM all_sources
    ),
    max_scores AS (
        SELECT
            base_first_name,
            base_last_name,
            birth_date,
            metaphone,
            MAX(overall_score) as max_score
        FROM scored
        GROUP BY base_first_name, base_last_name, metaphone, birth_date
    )
    
    SELECT
        1 / (1 - unique_chance) as mistake_odds,
        unique_chance,
        overall_score,
        koryta_name,
        krs_name,
        pkw_name,
        wiki_name,
        birth_year,
        max_scores.birth_date,
        employed_end,
        employed_krs,
        is_polityk,
        *  -- TODO remove 
    FROM max_scores LEFT JOIN scored ON (
        max_scores.base_first_name = scored.base_first_name
        AND max_scores.base_last_name = scored.base_last_name
        AND max_scores.metaphone = scored.metaphone
        AND max_scores.birth_date = scored.birth_date
        AND max_scores.max_score = scored.overall_score
    )
    WHERE overall_score >= 8
    ORDER BY mistake_odds DESC, overall_score DESC, koryta_name, krs_name, pkw_name, wiki_name, birth_year
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
    for table in [
        "krs_people",
        "wiki_people",
        "pkw_people",
        "koryta_people",
        "names_count_by_region",
        "first_name_freq",
    ]:
        print(f"{table}: {con.sql(f"SELECT COUNT(*) FROM {table}").fetchall()}")
        print(con.sql(f"SELECT * FROM {table} LIMIT 10").df())
        print("\n\n")

    print("--- Overlaps between all three sources (KRS, Wiki, PKW) ---")

    df = find_all_matches(con)

    non_duplicates = len(
        df[df["overall_score"] > 10.5].drop_duplicates(
            ["krs_name", "pkw_name", "wiki_name"]
        )
    )
    print(
        f"Rows with no duplicates in krs_name, pkw_name, and wiki_name: {non_duplicates}"
    )

    print(df)
    con.close()


if __name__ == "__main__":
    main()
