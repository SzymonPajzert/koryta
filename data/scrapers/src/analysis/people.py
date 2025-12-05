import pandas as pd
import math

from analysis.utils import read_enriched
from analysis.utils.names import NamesCountByRegion, FirstNameFreq
from scrapers.stores import PipelineModel, LocalFile, Context
from analysis.people_krs_merged import PeopleKRSMerged
from analysis.people_wiki_merged import PeopleWikiMerged
from analysis.people_koryta_merged import PeopleKorytaMerged
from analysis.people_pkw_merged import PeoplePKWMerged
from scrapers.krs.list import CompaniesKRS

pd.set_option("display.max_rows", None)
pd.set_option("display.max_columns", None)
pd.set_option("display.width", None)


krs_file = LocalFile("people_krs.jsonl", "versioned")
wiki_file = LocalFile("people_wiki.jsonl", "versioned")
koryta_file = LocalFile("people_koryta.jsonl", "versioned")
matched_file = LocalFile("people_matched.parquet", "versioned")


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
        n = 50000
    n = n / 40
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


class PeopleMerged(PipelineModel):
    filename: str = "people_merged"
    people_krs: PeopleKRSMerged
    people_wiki: PeopleWikiMerged
    people_pkw: PeoplePKWMerged
    # people_koryta: PeopleKorytaMerged
    names_count_by_region: NamesCountByRegion
    first_name_freq: FirstNameFreq
    companies_krs: CompaniesKRS

    def process(self, ctx: Context):
        return people_merged(
            ctx,
            self.people_krs.process(ctx),
            self.people_wiki.process(ctx),
            self.people_pkw.process(ctx),
            self.names_count_by_region.process(ctx),
            self.first_name_freq.process(ctx),
            self.companies_krs.process(ctx),
        )


def people_merged(
    ctx: Context,
    krs_people,
    wiki_people,
    pkw_people,
    names_count_by_region_table,
    first_name_freq_table,
    companies_df,
):
    con = ctx.con
    con.create_function(
        "unique_probability", unique_probability, null_handling="special"  # type: ignore
    )

    # TODO koryta_people = people_koryta_merged.process(ctx)
    koryta_people = pd.DataFrame(
        data=[{"first_name": "empty", "last_name": "empty", "full_name": "empty"}]
    )

    print("--- Imported table sizes ---")
    for table in [
        "krs_people",
        "wiki_people",
        "pkw_people",
        "koryta_people",
        "names_count_by_region_table",
        "first_name_freq_table",
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
            p.birth_year as pkw_birth_year,
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
        LEFT JOIN first_name_freq_table p_fn ON k.first_name = p_fn.first_name
        LEFT JOIN first_name_freq_table p_sn ON k.second_name = p_sn.first_name
        LEFT JOIN names_count_by_region_table names_count
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
    ),
    unique_krs AS (
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
            *
        FROM max_scores LEFT JOIN scored ON (
            max_scores.base_first_name = scored.base_first_name
            AND max_scores.base_last_name = scored.base_last_name
            AND max_scores.metaphone = scored.metaphone
            AND max_scores.birth_date = scored.birth_date
            AND max_scores.max_score = scored.overall_score
        )
        WHERE overall_score >= 8
        QUALIFY ROW_NUMBER() OVER (PARTITION BY krs_name, birth_year ORDER BY overall_score DESC, ABS(birth_year - pkw_birth_year) ASC NULLS LAST) = 1
    )
    SELECT * FROM unique_krs
    ORDER BY mistake_odds DESC, overall_score DESC, koryta_name, krs_name, pkw_name, wiki_name, birth_year
    """
    df = con.execute(query).df()
    if df.empty:
        raise Exception("No matches found with the current criteria.")

    df = read_enriched(ctx, df, companies_df)

    dupes = df[df.duplicated(subset=["krs_name"], keep=False)]
    if not dupes.empty:
        # Filter out duplicates where birth years differ by more than 1
        def has_conflicting_birth_years(group):
            years = group["birth_year"].dropna().unique()
            if len(years) <= 1:
                return False
            return (years.max() - years.min()) > 1

        # Let's do it more explicitly
        conflicting_names = (
            dupes.groupby("krs_name")
            .filter(has_conflicting_birth_years)["krs_name"]
            .unique()
        )
        dupes = dupes[~dupes["krs_name"].isin(conflicting_names)]

        if not dupes.empty:
            smaller = dupes[
                [
                    "krs_name",
                    "pkw_name",
                    "wiki_name",
                    "overall_score",
                    "mistake_odds",
                    "birth_year",
                    "elections",
                ]
            ].sort_values("krs_name")
            print(f"Found {len(dupes)} duplicates")
            ctx.io.write_dataframe(smaller, "people_duplicated.jsonl")

    non_duplicates = len(
        df[df["overall_score"] > 10.5].drop_duplicates(
            ["krs_name", "pkw_name", "wiki_name"]
        )
    )
    return df
