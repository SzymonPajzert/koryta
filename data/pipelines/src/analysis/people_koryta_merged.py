from scrapers.koryta.download import KorytaPeople
from scrapers.stores import Context, Pipeline


class PeopleKorytaMerged(Pipeline):
    filename = "people_koryta_merged"
    # Kept as text, as `PeopleMerged` compares them: restored from the shared
    # cache, `rejestrio_id` could otherwise come back as integers, and
    # `list_contains` refuses a number against the KRS side's text ids.
    dtype = {"rejestrio_id": str, "koryta_id": str, "birth_date": str}
    koryta_pipeline: KorytaPeople

    def process(self, ctx: Context):
        con = ctx.con

        koryta_data = self.koryta_pipeline.read_or_process(ctx)
        # A `KorytaPeople` backup from before 2026-10-10 lacks `birth_date`,
        # one from before 2026-09-22 `merged_into`.
        if "birth_date" not in koryta_data.columns:
            koryta_data = koryta_data.assign(birth_date=None)
        if "merged_into" not in koryta_data.columns:
            koryta_data = koryta_data.assign(merged_into=None)

        con.execute(
            """
            CREATE OR REPLACE TABLE koryta_people AS
            -- Which page a person is already on. Joined onto the other
            -- sources afterwards rather than used as their base, since most
            -- pages store no birth date.
            --
            -- `rejestrio_id` is the bare entry id from the page's link, as
            -- `krs_people` carries it, without any trailing slug. Names and
            -- the birth date serve pages with no link. `last_name` is the
            -- last word, so a middle name does not hide it; `tail_name` is
            -- everything after the first word, for a double surname written
            -- with a space. A full date or a bare year refuses a namesake
            -- born on another day (`koryta_candidates`); anything else is no
            -- date.
            SELECT DISTINCT
                lower(regexp_extract(full_name, '^(\\S+)', 1)) as first_name,
                lower(regexp_extract(full_name, '(\\S+)$', 1)) as last_name,
                lower(trim(regexp_replace(full_name, '^(\\S+)', ''))) as tail_name,
                -- '' rather than NULL for a page with no link: the join tests
                -- `= ''` and `!= ''`, and NULL passes neither.
                coalesce(regexp_extract(rejestrIo, 'osoby/([0-9]+)', 1), '')
                    as rejestrio_id,
                id as koryta_id,
                full_name,
                nullif(regexp_extract(
                    trim(CAST(birth_date AS VARCHAR)),
                    '^([0-9]{4}(-[0-9]{2}-[0-9]{2})?)$',
                    1
                ), '') as birth_date
            FROM koryta_data page
            -- A page merged into another (a tombstone) is left out where its
            -- survivor links the same entry, since `koryta_match` refuses an
            -- entry two pages link, and where it links none, so its name
            -- cannot make name matches ambiguous. Otherwise (two entries
            -- merged, or a link edited away) it is its entry's only page and
            -- stays: without it the name tier could give that entry to a
            -- namesake. On a person page `deleted` comes only with
            -- `merged_into`.
            WHERE full_name IS NOT NULL
                AND (
                    merged_into IS NULL
                    OR (
                        regexp_extract(page.rejestrIo, 'osoby/([0-9]+)', 1) != ''
                        AND NOT EXISTS (
                            SELECT 1 FROM koryta_data survivor
                            WHERE survivor.id = page.merged_into
                                AND regexp_extract(
                                    survivor.rejestrIo, 'osoby/([0-9]+)', 1
                                ) = regexp_extract(
                                    page.rejestrIo, 'osoby/([0-9]+)', 1
                                )
                        )
                    )
                )
            """
        )

        return con.sql("SELECT * FROM koryta_people").df()
