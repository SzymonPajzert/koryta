import duckdb
import pandas as pd
import math
import os

from analysis.utils import read_enriched
from util.config import versioned
from analysis.utils.tables import init_tables
from analysis.people_krs_merged import people_krs_merged
from analysis.people_wiki_merged import people_wiki_merged
from analysis.people_koryta_merged import people_koryta_merged
from analysis.people_pkw_merged import people_pkw_merged
from analysis.utils.names import names_count_by_region, first_name_freq
from util.conductor import pipeline


pd.set_option("display.max_rows", None)
pd.set_option("display.max_columns", None)
pd.set_option("display.width", None)


krs_file = versioned.assert_path("people_krs.jsonl")
wiki_file = versioned.assert_path("people_wiki.jsonl")
koryta_file = versioned.assert_path("people_koryta.jsonl")
matched_file = versioned.get_path("people_matched.parquet")


SAMPLE_FILTER = ""
# SAMPLE_FILTER = "AND lower(last_name) LIKE 'alek%'"


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


@pipeline(init_duckdb=True)
def people_merged(**kwargs):
    con = kwargs["con"]
    init_tables(con)
    con.create_function(
        "unique_probability", unique_probability, null_handling="special"  # type: ignore
    )

    # TODO this should be automatically called as a source of the pipeline function
    # Note passing by name, to reuse the duckdb connection
    names_count_by_region(con=con)
    first_name_freq(con=con)
    people_krs_merged(con=con)
    people_wiki_merged(con=con)
    # This is a good shit - TODO reuse the outputs here and around
    pkw_people = people_pkw_merged(con=con, force=True)
    people_koryta_merged(con=con)

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

    print("--- Running the long running query ---")

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
            k.employment,
            k.birth_year = p.birth_year as kp_same_birth_year,
            p.elections,
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
            AND (k.second_name = p.second_name OR ((k.second_name IS NULL OR k.second_name = '') AND (p.second_name IS NULL OR p.second_name = '')))
        LEFT JOIN first_name_freq p_fn ON k.first_name = p_fn.first_name
        LEFT JOIN first_name_freq p_sn ON k.second_name = p_sn.first_name
        LEFT JOIN names_count_by_region names_count
            ON k.last_name = names_count.last_name
            -- We need to pick one teryt, let's use the first one from pkw_people if available
            -- TODO - make sure that the teryt is the same as the company's location
            AND list_extract(p.teryt_wojewodztwo, 1) = names_count.teryt

    ),
    krs_pkw_wiki AS (
        SELECT
            kp.*,
            w.full_name as wiki_name,
            w.is_polityk,
            w.wiki_score,
        FROM krs_pkw kp
        LEFT JOIN wiki_people w
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
        LEFT JOIN koryta_people ko ON jaro_winkler_similarity(kpw.base_last_name, ko.last_name) > 0.95
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
        employment,
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

    df = read_enriched(df)

    non_duplicates = len(
        df[df["overall_score"] > 10.5].drop_duplicates(
            ["krs_name", "pkw_name", "wiki_name"]
        )
    )
    print(
        f"Rows with no duplicates in krs_name, pkw_name, and wiki_name: {non_duplicates}"
    )
    return df
