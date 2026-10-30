from scrapers.koryta.download import KorytaPeople
from scrapers.stores import Context, Pipeline


class PeopleKorytaMerged(Pipeline):
    filename = "people_koryta_merged"
    # Ids, which `PeopleMerged` joins on as text. `rejestrio_id` survives a
    # restore from the shared cache today only because the 852 pages with no
    # register link store an empty one, and "" is not a number: if every page
    # were linked, the restore would re-infer the column as integers, and
    # DuckDB would refuse the merge's `list_contains(kpw.rejestrio_id,
    # ko.rejestrio_id)` - a list of text against a number. `birth_date` is
    # compared as text too, and most pages store none.
    dtype = {"rejestrio_id": str, "koryta_id": str, "birth_date": str}
    koryta_pipeline: KorytaPeople

    def process(self, ctx: Context):
        con = ctx.con

        koryta_data = self.koryta_pipeline.read_or_process(ctx)
        if "birth_date" not in koryta_data.columns:
            # A `KorytaPeople` built before 2026-10-10, restored from the
            # shared cache: no page's date, so no name match is refused on one.
            koryta_data = koryta_data.assign(birth_date=None)
        if "merged_into" not in koryta_data.columns:
            # A `KorytaPeople` built before 2026-09-22, restored from the
            # shared cache: it knew of no merge, so it has none to leave out.
            koryta_data = koryta_data.assign(merged_into=None)

        con.execute(
            """
            CREATE OR REPLACE TABLE koryta_people AS
            -- Most pages store no birth date - 1,833 of the 10,907 on
            -- 2026-10-10 do - so this cannot be a base to join the other
            -- sources on the way `krs_people` is. It is joined onto them
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
            --
            -- The birth date is for the same pages: a name is what namesakes
            -- share, and a page that stores the day its person was born is not
            -- a register entry born on another (`koryta_candidates`). A full
            -- date or a bare year; anything else is no date, and refuses
            -- nothing.
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
                full_name,
                nullif(regexp_extract(
                    trim(CAST(birth_date AS VARCHAR)),
                    '^([0-9]{4}(-[0-9]{2}-[0-9]{2})?)$',
                    1
                ), '') as birth_date
            FROM koryta_data page
            -- A page merged into another is left out: nobody is on it any
            -- more. The merge keeps it as a tombstone, with the name and the
            -- register link it had, and carries onto the page that survives
            -- whatever that page lacks (`carriedFields` in
            -- frontend/server/utils/merge.ts). So the survivor is here
            -- already, linking the same entry, and a tombstone kept beside it
            -- is a second page for one person: `koryta_match`, which never
            -- chooses between two pages, refused the entry. On 2026-10-24 it
            -- refused every entry a merged page links, 171 of 171, Golimont's
            -- 383093 and Saługa's 1230481 among them, and each was sent
            -- without the `korytaId` naming its page.
            --
            -- Left out rather than followed to the survivor, as the planner
            -- follows one (`_survivor` in analysis/payloads/site.py), because
            -- the survivor is a row of its own already. Followed, the
            -- tombstone would be that page a second time, and the name it
            -- lent would bring the survivor into the name tier, which keeps
            -- out every page linking an entry: the tombstone of Witold Heronim
            -- Stępień links none and fits two namesakes by name, 405711 and
            -- 1396271, and the page it went into links 1332974.
            --
            -- Kept, as it always was, where it is the one page linking its
            -- entry: where the survivor links another entry, or none. The
            -- merge never replaces a link the survivor has, and nothing stops
            -- an admin merging two pages that link two entries. Left out
            -- there, the entry would look as if no page had it and go to the
            -- name tier, which can hand it an unlinked namesake's page, and
            -- the ingest would write it there. Kept, it reaches the
            -- tombstone, which the ingest follows to the survivor as it
            -- follows the entry's own link: a survivor linking another entry
            -- holds the payload (`refuseAnotherEntry`). None of the 173
            -- linked tombstones of 2026-10-30 is one: each went into a page
            -- linking its own entry.
            --
            -- `deleted` would add nothing: only a merge sets it on a person
            -- page, and it sets `merged_into` with it. All 174 retired pages
            -- of 2026-10-24 carry both.
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
