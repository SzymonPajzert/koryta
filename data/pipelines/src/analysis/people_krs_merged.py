import pandas as pd

from analysis.utils.tables import create_people_table
from scrapers.krs.odpis_people import PeopleKRSCombined
from scrapers.stores import Context, LocalFile, Pipeline

krs_file = LocalFile("person_krs.jsonl", "versioned")


class PeopleKRSMerged(Pipeline):
    filename = "people_krs_merged"
    # rejestr.io's people, with the odpisy standing in wherever they are newer.
    people_krs: PeopleKRSCombined

    def process(self, ctx: Context):
        krs_data = self.people_krs.read_or_process(ctx)
        return people_krs_merged(ctx, krs_data)


def people_krs_merged(ctx: Context, krs_data: pd.DataFrame):
    con = ctx.con

    con.execute(
        """
        CREATE OR REPLACE TABLE krs_people_raw AS
        SELECT
            lower(first_name) as first_name,
            lower(last_name) as last_name,
            -- The register knows the middle name; it is `drugie_imiona` in the
            -- response and `scrapers/krs/list.py` has always captured it. This
            -- used to be `CAST(NULL AS VARCHAR)`, which threw it away and left
            -- `create_people_table` to work it out by subtracting the first and
            -- last name from `full_name` - a guess, and made against a column
            -- that is not one value per person.
            --
            -- An empty `drugie_imiona` means "no middle name" and is trusted as
            -- such rather than coalesced back into the guess. Of the 180,330
            -- rows crawled, 85,581 carry one; of the 94,749 that do not, every
            -- single one whose `full_name` still runs to three words has a
            -- two-word `last_name` - a double surname, not a middle name the
            -- register forgot. Nothing is left for the guess to add.
            --
            -- NULL is still NULL, and still derives: that is a field the
            -- response did not have at all, which is not the same answer as an
            -- empty one.
            lower(trim(second_names)) as second_name,
            CAST(SUBSTRING(CAST(birth_date AS VARCHAR), 1, 4) AS INTEGER) as birth_year,
            CAST(birth_date AS VARCHAR) as birth_date,
            employed_start,
            employed_end,
            employed_krs,
            employed_role,
            employed_for,
            id as rejestrio_id,
            full_name
        FROM krs_data
        WHERE birth_date IS NOT NULL AND first_name IS NOT NULL
            AND last_name IS NOT NULL
        """
    )

    create_people_table(
        con,
        "krs_people",
        # The register id says who a row is, so all of one id's rows are
        # spelled alike before the name groups them. rejestr.io writes a
        # person the way each company's entry has it - without Polish letters,
        # under a maiden name, with the middle name and without - and in the
        # 2026-10-01 crawl 87 ids came out split over two rows each. 60 were
        # one person spelled two ways. The other 27 were worse: an entry
        # missing its middle name had joined every namesake born the same
        # year, so a stranger's row carried the id and the post. 13 of those
        # remain, ids written without a middle name at every company, which
        # leaves nothing to tell which namesake they belong with.
        identity="rejestrio_id",
        to_list=["rejestrio_id", "full_name"],
        any_vals=["birth_date"],
        employment={
            "employed_krs": "employed_krs",
            "employed_end": "employed_end",
            "employed_for": "employed_for",
            "employed_start": "employed_start",
            "employed_role": "employed_role",
        },
    )

    return con.sql("SELECT * FROM krs_people").df()
