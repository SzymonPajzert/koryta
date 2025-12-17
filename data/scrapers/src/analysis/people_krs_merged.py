import pandas as pd

from analysis.utils.tables import create_people_table
from scrapers.krs.list import PeopleKRS
from scrapers.stores import Context, LocalFile, Pipeline

krs_file = LocalFile("person_krs.jsonl", "versioned")


class PeopleKRSMerged(Pipeline):
    filename = "people_krs_merged"
    people_krs: PeopleKRS

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
            CAST(NULL AS VARCHAR) as second_name,
            CAST(SUBSTRING(CAST(birth_date AS VARCHAR), 1, 4) AS INTEGER) as birth_year,
            CAST(birth_date AS VARCHAR) as birth_date,
            employed_start,
            employed_end,
            employed_krs,
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
        to_list=["rejestrio_id", "full_name"],
        any_vals=["birth_date"],
        employment={
            "employed_krs": "employed_krs",
            "employed_end": "employed_end",
            "employed_for": "employed_for",
            "employed_start": "employed_start",
        },
    )

    return con.sql("SELECT * FROM krs_people").df()
