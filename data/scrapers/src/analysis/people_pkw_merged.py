from scrapers.stores import Pipeline, LocalFile, Context
from analysis.utils.tables import create_people_table, init_tables


pkw_file = LocalFile("person_pkw.jsonl", "versioned")


@Pipeline.cached_dataframe
def people_pkw_merged(ctx: Context):
    con = ctx.con

    init_tables(con)

    pkw_data = ctx.io.read_data(pkw_file).read_dataframe("jsonl")

    con.execute(
        f"""
    CREATE OR REPLACE TABLE people_pkw_merged_raw AS
    SELECT
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
        pkw_name as full_name,
        party,
        election_year,
        election_type,
    FROM pkw_data
    WHERE first_name IS NOT NULL AND last_name IS NOT NULL
    """
    )

    print(
        f"people_pkw_merged_raw has {len(con.sql("select * from people_pkw_merged_raw").df())} rows"
    )

    create_people_table(
        con,
        "people_pkw_merged",
        to_list=["full_name"],
        flatten_list=["teryt_wojewodztwo", "teryt_powiat"],
        elections={
            "party": "party",
            "election_year": "election_year",
            "election_type": "election_type",
            "teryt_wojewodztwo": "teryt_wojewodztwo",
            "teryt_powiat": "teryt_powiat",
        },
    )

    return con.sql("select * from people_pkw_merged").df()
