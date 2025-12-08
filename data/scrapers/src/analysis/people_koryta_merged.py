from scrapers.koryta.download import KorytaPeople
from scrapers.stores import Context, Pipeline


class PeopleKorytaMerged(Pipeline):
    filename = "people_koryta_merged"
    koryta_pipeline: KorytaPeople

    def process(self, ctx: Context):
        con = ctx.con

        koryta_data = self.koryta_pipeline.read_or_process(ctx)  # noqa: F841

        con.execute(
            """
            CREATE OR REPLACE TABLE koryta_people AS
            -- koryta_people lacks birth_year, so we can't use it as a base for joining with others on birth_year.
            -- We will use it for enrichment if we can parse first/last names.
            SELECT DISTINCT
                lower(regexp_extract(full_name, '^(\\S+)', 1)) as first_name,
                lower(trim(regexp_replace(full_name, '^(\\S+)', ''))) as last_name,
                double_metaphone(last_name) as metaphone,
                id as koryta_id,
                full_name
            FROM koryta_data
            WHERE full_name IS NOT NULL
            """
        )

        return con.sql("SELECT * FROM koryta_people").df()
