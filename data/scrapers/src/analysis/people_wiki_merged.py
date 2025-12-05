from analysis.utils.tables import create_people_table
from scrapers.stores import PipelineModel, Context
from scrapers.wiki.process_articles import ProcessWiki


class PeopleWikiMerged(PipelineModel):
    filename: str = "people_wiki_merged"
    wiki_pipeline: ProcessWiki

    def process(self, ctx: Context):
        con = ctx.con

        wiki_data = self.wiki_pipeline.process(ctx)

        con.execute(
            f"""
        CREATE OR REPLACE TABLE wiki_people_raw AS
        SELECT
            lower(regexp_extract(full_name, '^(\\S+)', 1)) as first_name,
            lower(trim(regexp_extract(full_name, '(\\S+)$', 1))) as last_name,
            CAST(NULL AS VARCHAR) as second_name,
            birth_year,
            birth_iso8601 AS birth_date,
            CASE
                WHEN 'Polityk' in infoboxes THEN 'Polityk'
                WHEN 'Biogram' in infoboxes THEN 'Biogram'
                WHEN 'Naukowiec' in infoboxes THEN 'Naukowiec'
                ELSE NULL    
            END as is_polityk,
            atan(content_score) AS wiki_score,
            full_name
        FROM wiki_data
        WHERE birth_year IS NOT NULL AND full_name IS NOT NULL AND birth_year > 1930
        """
        )

        create_people_table(
            con,
            "wiki_people",
            any_vals=["is_polityk", "full_name", "wiki_score", "birth_date"],
        )

        return con.sql("SELECT * FROM wiki_people").df()
