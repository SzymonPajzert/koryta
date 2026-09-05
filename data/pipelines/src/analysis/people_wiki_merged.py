from analysis.utils.tables import create_people_table
from scrapers.stores import Context, Pipeline
from scrapers.wiki.process_articles import ProcessWiki


class PeopleWikiMerged(Pipeline):
    filename = "people_wiki_merged"
    wiki_pipeline: ProcessWiki

    def process(self, ctx: Context):
        return people_wiki_merged(ctx, self.wiki_pipeline.read_or_process(ctx))


def people_wiki_merged(ctx: Context, wiki_data):  # noqa: F841
    con = ctx.con

    con.execute(
        """
        CREATE OR REPLACE TABLE wiki_people_raw AS
        SELECT
            lower(regexp_extract(
                regexp_replace(full_name, ' \\(.*\\)', ''), '^(\\S+)', 1)
            ) as first_name,
            lower(trim(regexp_extract(
                regexp_replace(full_name, ' \\(.*\\)', ''), '(\\S+)$', 1))
            ) as last_name,
            CAST(NULL AS VARCHAR) as second_name,
            birth_year,
            -- A Wikipedia infobox that gives only a year, or only a month and
            -- a year, is parsed into a date-shaped string with zeroes standing
            -- in for what it did not say: `1959-00-00`, `1959-03-00`. That is a
            -- fine way to carry a year through `parse_date`, and a terrible
            -- thing to join on - it can never equal a real date, and it is not
            -- NULL either, so the KRS join's "or the article gives no date"
            -- branch never fires and the person is simply unmatchable. Say
            -- outright that the day is unknown; `birth_year` above still
            -- carries what the article did say.
            CASE WHEN birth_iso8601 LIKE '%-00' THEN NULL ELSE birth_iso8601 END
                AS birth_date,
            CASE
                WHEN 'Polityk' in infoboxes THEN 'Polityk'
                WHEN 'Biogram' in infoboxes THEN 'Biogram'
                WHEN 'Naukowiec' in infoboxes THEN 'Naukowiec'
                ELSE NULL    
            END as is_polityk,
            atan(content_score) AS wiki_score,
            -- Quoted and renamed on the way in: `lead` is a window function in
            -- DuckDB, and `any_value(lead)` below would be read as one.
            "lead" AS wiki_lead,
            full_name,
            source
        FROM wiki_data
        WHERE birth_year IS NOT NULL AND full_name IS NOT NULL AND birth_year >= 1920
        """
    )

    create_people_table(
        con,
        "wiki_people",
        any_vals=[
            "is_polityk",
            "full_name",
            "wiki_score",
            "birth_date",
            "source",
            "wiki_lead",
        ],
    )

    return con.sql("SELECT * FROM wiki_people").df()
