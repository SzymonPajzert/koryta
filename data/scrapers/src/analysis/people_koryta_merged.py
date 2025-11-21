from scrapers.stores import Pipeline, LocalFile, Context

# TODO mark it as an output of scrape_koryta - to be named people_koryta
koryta_file = LocalFile("people_koryta.jsonl", "versioned")


@Pipeline()
def people_koryta_merged(ctx: Context):
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
