from scrapers.koryta.download import KorytaPeople
from scrapers.stores import Context, Pipeline


class PeopleKorytaMerged(Pipeline):
    filename = "people_koryta_merged"
    # Ids, which `PeopleMerged` joins on as text. `rejestrio_id` survives a
    # restore from the shared cache today only because the 852 pages with no
    # register link store an empty one, and "" is not a number: if every page
    # were linked, the restore would re-infer the column as integers, and
    # DuckDB would refuse the merge's `list_contains(kpw.rejestrio_id,
    # ko.rejestrio_id)` - a list of text against a number.
    dtype = {"rejestrio_id": str, "koryta_id": str}
    koryta_pipeline: KorytaPeople

    def process(self, ctx: Context):
        con = ctx.con

        koryta_data = self.koryta_pipeline.read_or_process(ctx)  # noqa: F841

        con.execute(
            """
            CREATE OR REPLACE TABLE koryta_people AS
            -- A page has no birth year, so this cannot be a base to join the
            -- other sources on the way `krs_people` is. It is joined onto them
            -- afterwards, to answer one question: which page is this person
            -- already on?
            --
            -- `rejestrio_id` is the answer wherever the page has one, and 8,359
            -- of the 9,227 person pages do. Pulled out of the stored url rather
            -- than compared as a url, because that is the shape `krs_people`
            -- carries it in - a bare id in a list - and comparing
            -- `https://rejestr.io/osoby/383093` against `383093` matches
            -- nothing. The trailing slug some links carry
            -- (`/osoby/2479295/marta-twardowska-krol`, typed by hand into the
            -- admin form) is dropped with it.
            --
            -- The names are for the 868 pages with no register link, and are
            -- deliberately kept as two readings rather than one. The old
            -- `last_name` here was everything after the first word, so "Andrzej
            -- Marcin Golimont" gave "marcin golimont" and matched no KRS person
            -- at all - and a page named with a middle name is exactly the case
            -- this has to catch. `tail_name` keeps that reading, because it is
            -- the right one for a double surname written with a space
            -- ("Malgorzata Pietrzak Sikorska"), which the register stores whole
            -- in `last_name`.
            SELECT DISTINCT
                lower(regexp_extract(full_name, '^(\\S+)', 1)) as first_name,
                lower(regexp_extract(full_name, '(\\S+)$', 1)) as last_name,
                lower(trim(regexp_replace(full_name, '^(\\S+)', ''))) as tail_name,
                -- Coalesced, because a page with no link at all stores NULL
                -- and `regexp_extract` passes that straight through - and in
                -- SQL both `NULL = ''` and `NULL != ''` are NULL, so such a
                -- page would satisfy neither side of the join's OR and vanish
                -- from it entirely. That is the 868 people the name fallback
                -- exists for, so they are exactly the ones it would lose.
                coalesce(regexp_extract(rejestrIo, 'osoby/([0-9]+)', 1), '')
                    as rejestrio_id,
                id as koryta_id,
                full_name
            FROM koryta_data
            WHERE full_name IS NOT NULL
            """
        )

        return con.sql("SELECT * FROM koryta_people").df()
