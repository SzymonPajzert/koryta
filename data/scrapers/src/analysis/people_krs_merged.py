from scrapers.stores import Pipeline, LocalFile, Context
from analysis.utils.tables import create_people_table

# TODO mark it as an output of scrape_krs - to be named people_krs
krs_file = LocalFile("person_krs.jsonl", "versioned")


@Pipeline.cached_dataframe
def people_krs_merged(ctx: Context):
    con = ctx.con

    krs_data = ctx.io.read_data(krs_file).read_dataframe("jsonl")

    con.execute(
        f"""
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
        WHERE birth_date IS NOT NULL AND first_name IS NOT NULL AND last_name IS NOT NULL
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
