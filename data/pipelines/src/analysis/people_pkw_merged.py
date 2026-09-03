from analysis.utils.tables import create_people_table
from scrapers.pkw.process import PeoplePKW
from scrapers.stores import Context, Pipeline


class PeoplePKWMerged(Pipeline):
    filename = "people_pkw_merged"
    pkw_pipeline: PeoplePKW

    def process(self, ctx: Context):
        return people_pkw_merged(ctx, self.pkw_pipeline.read_or_process(ctx))


def people_pkw_merged(ctx: Context, pkw_data):  # noqa: F841
    con = ctx.con

    con.execute(
        """
    CREATE OR REPLACE TABLE people_pkw_merged_raw AS
    SELECT
        lower(first_name) as first_name,
        lower(last_name) as last_name,
        lower(middle_name) as second_name,
        -- Where the candidacy was, and where the candidate lived, which
        -- are not the same question and used to be answered by the same
        -- unordered list. `list_distinct` drops NULLs and reorders what is
        -- left, so for anybody whose home powiat differs from the one they
        -- stood in - and PKW does not always record the first - the
        -- residence could come out in front, and everything downstream
        -- takes element one.
        teryt_candidacy[:2] as teryt_candidacy_wojewodztwo,
        teryt_candidacy[:4] as teryt_candidacy_powiat,
        teryt_living[:2] as teryt_living_wojewodztwo,
        teryt_living[:4] as teryt_living_powiat,
        -- Everywhere the person is connected to, candidacy first.
        -- `list_filter` keeps the order `list_distinct` did not.
        list_filter([
            teryt_candidacy[:2],
            teryt_living[:2],
        ], x -> x IS NOT NULL) as teryt_wojewodztwo,
        list_filter([
            teryt_candidacy[:4],
            teryt_living[:4],
        ], x -> x IS NOT NULL) as teryt_powiat,
        birth_year,
        pkw_name as full_name,
        party,
        election_year,
        election_type,
        candidacy_success,
        party_member,
    FROM pkw_data
    WHERE first_name IS NOT NULL AND last_name IS NOT NULL
    """
    )

    row_num = len(con.sql("select * from people_pkw_merged_raw").df())
    print(f"people_pkw_merged_raw has {row_num} rows")

    create_people_table(
        con,
        "people_pkw_merged",
        to_list=["full_name"],
        flatten_list=["teryt_wojewodztwo", "teryt_powiat"],
        elections={
            "party": "party",
            "election_year": "election_year",
            "election_type": "election_type",
            "teryt_candidacy_wojewodztwo": "teryt_candidacy_wojewodztwo",
            "teryt_candidacy_powiat": "teryt_candidacy_powiat",
            "teryt_living_wojewodztwo": "teryt_living_wojewodztwo",
            "teryt_living_powiat": "teryt_living_powiat",
            "teryt_wojewodztwo": "teryt_wojewodztwo",
            "teryt_powiat": "teryt_powiat",
            "candidacy_success": "candidacy_success",
            # On the candidacy rather than on the person, because it is an
            # answer given at one election: somebody can declare PiS in 2011
            # and no party in 2024, and both are true of them.
            "party_member": "party_member",
        },
    )

    drop_contradictory_candidacies(con)

    return con.sql("select * from people_pkw_merged").df()


def drop_contradictory_candidacies(con):
    """Take the elections off anybody who is evidently two people.

    Namesakes of the same age are merged on purpose: somebody who filed as
    "Donald Tusk" in one election and "Donald Franciszek Tusk" in the next is
    one person, and `create_people_table` joins the two records to say so. It
    cannot tell that apart from two different people who share a name and a
    birth year, and 135 of the merged people give themselves away by standing
    in two places at once - Tomasz Wojciech Krasowski in both Warszawa and
    powiat sokólski, in 2010, 2014, 2018 and 2024; Andrzej Jankowski in Ostrów
    Wielkopolski and in Leszno in 2010, which is the "wiele osób na raz zostało
    połączonych" note on his page.

    Nothing here can say which of the two the KRS person is, so the candidacies
    go and the rest of the record stays. Publishing half of somebody else's
    career on a page about corruption is worse than publishing none of it, and
    dropping the whole match instead would cost the person four points of
    `overall_score` and could take them off the site altogether.

    One office per election is the rule being applied, so candidacies are only
    compared within the same year *and* the same kind of election - a
    europarliament seat and a gmina council seat in 2024 are two different
    contests. A województwo code is not a contradiction with a powiat inside
    it: standing for the sejmik and for a local council in the same region is
    an ordinary thing to do, and the two are recorded at different depths.
    """
    con.execute(
        """
    CREATE OR REPLACE TABLE people_pkw_contradictions AS
    WITH candidacies AS (
        SELECT
            rowid AS person_row,
            e.election_year AS election_year,
            e.election_type AS election_type,
            coalesce(e.teryt_candidacy_powiat, e.teryt_powiat[1]) AS teryt
        FROM (SELECT rowid, unnest(elections) AS e FROM people_pkw_merged)
    )
    SELECT DISTINCT a.person_row
    FROM candidacies a
    JOIN candidacies b
        ON a.person_row = b.person_row
        AND a.election_year = b.election_year
        AND a.election_type = b.election_type
    WHERE a.teryt IS NOT NULL
        AND b.teryt IS NOT NULL
        AND NOT starts_with(a.teryt, b.teryt)
        AND NOT starts_with(b.teryt, a.teryt)
    """
    )

    contradictory = con.sql("SELECT COUNT(*) FROM people_pkw_contradictions").fetchone()
    print(
        f"{contradictory[0] if contradictory else 0} merged PKW records stand in "
        f"two places at once and have had their candidacies dropped"
    )

    con.execute(
        """
    CREATE OR REPLACE TABLE people_pkw_merged AS
    SELECT
        p.* EXCLUDE (elections),
        CASE
            WHEN c.person_row IS NULL THEN p.elections
            -- Typed empty list; a bare [] would be a list of unknowns.
            ELSE list_filter(p.elections, x -> false)
        END AS elections,
        c.person_row IS NOT NULL AS elections_ambiguous
    FROM people_pkw_merged p
    LEFT JOIN people_pkw_contradictions c ON p.rowid = c.person_row
    """
    )
