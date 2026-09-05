import math

import pandas as pd

from analysis.people_koryta_merged import PeopleKorytaMerged
from analysis.people_krs_merged import PeopleKRSMerged
from analysis.people_pkw_merged import PeoplePKWMerged
from analysis.people_wiki_merged import PeopleWikiMerged
from analysis.utils import read_enriched
from analysis.utils.names import FirstNameFreq, NamesCountByRegion
from scrapers.krs.list import CompaniesKRS
from scrapers.map.teryt import Teryt
from scrapers.stores import Context, LocalFile, Pipeline

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
    # Poisson approximation for (1-p)^n ~= exp(-n*p) to avoid floating point issues
    # Probability of no collision is exp(-n*p)
    # We are interested in high precision, so we're returning
    # e^(-ln 10) = 1/10, so ln 10 is the number of zeroes
    # (n * p_combined) / LN_10) should be good

    if n < 50:
        return math.pow(1 - p_combined, n)
    return math.exp(-n * p_combined)


class PeopleMerged(Pipeline):
    filename = "people_merged"

    people_krs: PeopleKRSMerged
    people_wiki: PeopleWikiMerged
    people_pkw: PeoplePKWMerged
    people_koryta: PeopleKorytaMerged
    names_count_by_region: NamesCountByRegion
    first_name_freq: FirstNameFreq

    def process(self, ctx: Context):
        return people_merged(
            ctx,
            self.people_krs.read_or_process(ctx),
            self.people_wiki.read_or_process(ctx),
            self.people_pkw.read_or_process(ctx),
            self.people_koryta.read_or_process(ctx),
            self.names_count_by_region.read_or_process(ctx),
            self.first_name_freq.read_or_process(ctx),
        )


def people_merged(
    ctx: Context,
    krs_people,  # noqa: F841
    wiki_people,  # noqa: F841
    pkw_people,  # noqa: F841
    koryta_people,  # noqa: F841
    names_count_by_region_table,  # noqa: F841
    first_name_freq_table,  # noqa: F841
):
    con = ctx.con
    con.create_function(
        "unique_probability",
        unique_probability,
        null_handling="special",  # type: ignore
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
        print(f"{table}: {con.sql(f'SELECT COUNT(*) FROM {table}').fetchall()}")
        print(con.sql(f"SELECT * FROM {table} LIMIT 10").df())
        print("\n\n")

    print("--- Running the long running query ---")

    query = """
    WITH krs_numbered AS (
        -- The join below has to reason about all of one person's candidates at
        -- once, and `rejestrio_id` is a list rather than a key, so the row
        -- itself is the identity.
        SELECT row_number() OVER () as krs_row, * FROM krs_people
    ),
    pkw_candidates AS (
        -- Every PKW record this KRS person could be, with how much of the name
        -- actually agreed.
        --
        -- A middle name only one of the two sources records is not a
        -- disagreement. KRS carries what the court filing spelled out and PKW
        -- what the candidate wrote on the form, and either can be silent where
        -- the other is not: Jarosław Wieszołek is "jarosław maciej" to PKW and
        -- plain "jarosław" to KRS, and requiring the two to agree exactly cost
        -- him all three of his candidacies.
        SELECT
            k.krs_row,
            p.*,
            CASE
                WHEN k.second_name = p.second_name
                    OR ((k.second_name IS NULL OR k.second_name = '')
                        AND (p.second_name IS NULL OR p.second_name = ''))
                THEN 0
                ELSE 1
            END as second_name_tier
        FROM krs_numbered k
        JOIN pkw_people p ON (
            ABS(k.birth_year - p.birth_year) <= 1 OR p.birth_year IS NULL)
            AND k.last_name = p.last_name
            AND k.first_name = p.first_name
            AND (k.second_name = p.second_name
                OR (k.second_name IS NULL OR k.second_name = '')
                OR (p.second_name IS NULL OR p.second_name = ''))
    ),
    pkw_match AS (
        -- Which of those to believe.
        --
        -- A middle name the two sources agree on outranks one only half of
        -- them knows, so nobody who already had a match can be pulled off it
        -- by a looser one - 4292 people have both kinds and would otherwise be
        -- up for grabs.
        --
        -- Silence identifies somebody only when it leaves exactly one
        -- candidate. Where it leaves several the honest answer is "one of
        -- these four Piotr Mrozińskis", and picking by score would hang a
        -- stranger's career on the page - the same harm
        -- `drop_contradictory_candidacies` drops candidacies to avoid, so it
        -- is answered the same way: no match rather than a guessed one.
        SELECT * FROM pkw_candidates
        QUALIFY second_name_tier = min(second_name_tier) OVER (PARTITION BY krs_row)
            AND (second_name_tier = 0
                OR count(*) OVER (PARTITION BY krs_row) = 1)
    ),
    krs_pkw AS (
        SELECT
            k.full_name[1] as krs_name,
            p.full_name[1] as pkw_name,
            k.birth_year as birth_year,
            k.first_name as base_first_name, -- Carry base names for subsequent joins
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
                        k.second_name = p.second_name
                            AND k.second_name IS NOT NULL AND p.second_name IS NOT NULL,
                        names_count.count
                    )
                ELSE NULL
            END as unique_chance,
            *,
        FROM krs_numbered k
        LEFT JOIN pkw_match p USING (krs_row)
        LEFT JOIN first_name_freq_table p_fn ON k.first_name = p_fn.first_name
        LEFT JOIN first_name_freq_table p_sn ON k.second_name = p_sn.first_name
        LEFT JOIN names_count_by_region_table names_count
            ON k.last_name = names_count.last_name
            AND list_extract(p.teryt_wojewodztwo, 1) = names_count.teryt

    ),
    wiki_candidates AS (
        -- Every biography this KRS person could be.
        --
        -- Match on the day where the article gives one, and on the year where
        -- it does not. Without the second branch a biography that says only
        -- "ur. 1959" cannot match anybody: KRS knows every person's full date
        -- of birth, so equality always fails. With the year dropped instead of
        -- the day, it would match every namesake of any age.
        --
        -- How exact the first name has to be depends on which branch let the
        -- row through, because the two carry very different weight. A full
        -- date agreeing to the day is strong enough on its own that an
        -- approximate name costs nothing and earns its keep on KRS typos
        -- ("Józedf Jan Malec"), short forms (Alek/Aleksander) and
        -- transliteration (Gennadij/Hennadij). A year alone rules out almost
        -- nobody, so the first name is the only thing left telling two people
        -- apart and it has to be exact. Marzena Słomka was given Marek
        -- Słomka's article on the strength of a shared "mar":
        -- jaro_winkler_similarity('marzena', 'marek') is 0.8533, over the
        -- threshold by three thousandths. Nine of the ten year-only matches
        -- that leant on the threshold were somebody else; of the seven with a
        -- full date, none were.
        SELECT
            k.krs_row,
            w.*
        FROM krs_numbered k
        JOIN wiki_people w
            ON k.last_name = w.last_name
            AND CASE
                WHEN w.birth_date IS NOT NULL THEN
                    k.birth_date = w.birth_date
                    AND jaro_winkler_similarity(k.first_name, w.first_name) > 0.85
                ELSE
                    k.birth_year = w.birth_year
                    AND k.first_name = w.first_name
            END
    ),
    wiki_match AS (
        -- Which of those to believe - and where more than one fits, none of
        -- them. Two articles the join cannot tell apart are two people it
        -- cannot tell apart, and there is nothing to choose between "Robert
        -- Kwiatkowski (urzędnik)" and "Robert Kwiatkowski (polityk)" but the
        -- score, which would hang a stranger's biography on the page. The same
        -- harm `pkw_match` refuses to risk, refused the same way.
        SELECT * FROM wiki_candidates
        QUALIFY count(*) OVER (PARTITION BY krs_row) = 1
    ),
    krs_pkw_wiki AS (
        SELECT
            kp.*,
            w.full_name as wiki_name,
            w.source as wiki_url,
            w.is_polityk,
            w.wiki_score,
            -- What the article said the person was born on, kept beside the
            -- register's own `birth_date` rather than merged into it. The join
            -- above accepts a year-only article on the year alone, and nine of
            -- the ten matches that leant on that branch were somebody else -
            -- so a consumer that cannot afford a wrong match (`PeopleWikiNotes`
            -- pastes the article's prose onto a page) needs to see which branch
            -- let the row through, and only these two columns say.
            w.birth_date as wiki_birth_date,
            w.wiki_lead,
        FROM krs_pkw kp
        LEFT JOIN wiki_match w USING (krs_row)
    ),
    koryta_candidates AS (
        -- Every page this person could already be, and how it was reached.
        --
        -- The register id is an identity and a name is not, so the two are kept
        -- apart rather than or-ed into one similarity score: 170 pages shared a
        -- register id with another page and 36 had had a second person's
        -- written over them, all of it because a name was being treated as
        -- though it identified somebody.
        SELECT
            kpw.krs_row,
            ko.koryta_id,
            ko.full_name as koryta_name,
            coalesce(ko.rejestrio_id, '') != ''
                AND list_contains(kpw.rejestrio_id, ko.rejestrio_id) as by_register
        FROM krs_pkw_wiki kpw
        JOIN koryta_people ko ON (
            (coalesce(ko.rejestrio_id, '') != ''
                AND list_contains(kpw.rejestrio_id, ko.rejestrio_id))
            OR (
                -- Only for a page carrying no register link at all - 868 of
                -- them. Where the page has one and it is somebody else's, that
                -- is a different person however alike the two are spelled, and
                -- letting the name overrule it is the mistake being undone.
                --
                -- Coalesced on both sides of the OR: an unlinked page stores
                -- NULL, and SQL answers NULL to `= ''` and to `!= ''` alike, so
                -- without this such a page satisfies neither branch and drops
                -- out of the join altogether - losing exactly the people the
                -- name fallback is here for.
                coalesce(ko.rejestrio_id, '') = ''
                AND jaro_winkler_similarity(kpw.base_first_name, ko.first_name) > 0.95
                AND (
                    jaro_winkler_similarity(kpw.base_last_name, ko.last_name) > 0.95
                    OR jaro_winkler_similarity(kpw.base_last_name, ko.tail_name) > 0.95
                )
            )
        )
    ),
    koryta_match AS (
        -- The register tier if this person reached one, the name tier
        -- otherwise, and in either case only where exactly one page fits.
        --
        -- Two pages a name cannot choose between are two pages this must not
        -- choose between: the id travels into the payload and the ingest writes
        -- to whatever it names, so a wrong one does not make a duplicate, it
        -- overwrites somebody. Same judgement, and the same shape, as
        -- `wiki_match` above - which refuses for the milder reason that it
        -- would hang the wrong biography on a page.
        --
        -- Unique BOTH ways for a name match, which one-page-per-person is not.
        -- Measured against the 2026-08-29 export: 87 pages were each the only
        -- candidate for several different people at once - six Jerzy
        -- Kaczmareks, born between 1943 and 1968, all reaching the one page of
        -- that name, and a "Tomasz Zielinski" page reaching a Tomasz Dzielinski
        -- as well. Sending the id for all six would have written six careers
        -- onto one page: not a duplicate but a collapse, and the very thing the
        -- register id was carried to stop.
        --
        -- The register tier is exempt, and has to be. Two KRS rows carrying one
        -- register id are one human whom `create_people_table` split in two, so
        -- both belong on the one page - which is the answer, not the hazard.
        SELECT * FROM koryta_candidates
        QUALIFY by_register = bool_or(by_register) OVER (PARTITION BY krs_row)
            AND count(*) OVER (PARTITION BY krs_row, by_register) = 1
            AND (by_register OR count(*) OVER (PARTITION BY koryta_id) = 1)
    ),
    all_sources AS (
        SELECT
            kpw.*,
            km.koryta_id,
            km.koryta_name,
        FROM krs_pkw_wiki kpw
        LEFT JOIN koryta_match km USING (krs_row)
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
            MAX(overall_score) as max_score
        FROM scored
        GROUP BY base_first_name, base_last_name, birth_date
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
            AND max_scores.birth_date = scored.birth_date
            AND max_scores.max_score = scored.overall_score
        )
        QUALIFY ROW_NUMBER() OVER (
            PARTITION BY krs_name, birth_year
            ORDER BY overall_score DESC,
            ABS(birth_year - pkw_birth_year)
        ASC NULLS LAST) = 1
    )
    SELECT * FROM unique_krs
    ORDER BY mistake_odds DESC, overall_score DESC,
        koryta_name, krs_name, pkw_name, wiki_name, birth_year
    """
    df = con.execute(query).df()
    if df.empty:
        raise Exception("No matches found with the current criteria.")
    return df


def remove_duplicates(ctx: Context, df):
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
            # smaller = dupes[
            #     [
            #         "krs_name",
            #         "pkw_name",
            #         "wiki_name",
            #         "overall_score",
            #         "mistake_odds",
            #         "birth_year",
            #         "elections",
            #     ]
            # ].sort_values("krs_name")
            print(f"Found {len(dupes)} duplicates")
            # write_dataframe(ctx, smaller, "people_duplicated.jsonl", "jsonl")

    return df


class PeopleEnriched(Pipeline):
    filename = "people_enriched"

    people_merged: PeopleMerged
    companies_krs: CompaniesKRS
    teryt: Teryt

    def process(self, ctx):
        df = self.people_merged.read_or_process(ctx)
        companies_df = self.companies_krs.read_or_process(ctx)

        # Initialize the object no matter what.
        self.teryt.process(ctx)

        df = remove_duplicates(ctx, df)
        return read_enriched(ctx, df, companies_df, self.teryt)
