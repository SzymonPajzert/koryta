from frameworks.conductor import pipeline
from util.config import versioned
from analysis.utils.tables import create_people_table

# TODO mark it as an output of scrape_wiki - to be named people_wiki
wiki_file = versioned.get_path("people_wiki.jsonl")


@pipeline(sources=[wiki_file])
def people_wiki_merged(con):
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
    """
    )

    create_people_table(
        con,
        "wiki_people",
        any_vals=["is_polityk", "full_name", "wiki_score", "birth_date"],
    )
