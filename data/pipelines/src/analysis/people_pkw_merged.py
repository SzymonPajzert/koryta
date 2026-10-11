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
    if "office" not in pkw_data.columns:
        # A `person_pkw` built before it had the column: every office unknown,
        # so every local candidacy stays „Samorząd” and nothing is folded.
        pkw_data = pkw_data.assign(office=None)

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
        CAST(office AS VARCHAR) AS office,
    FROM pkw_data
    WHERE first_name IS NOT NULL AND last_name IS NOT NULL
    """
    )
    fold_rounds(con)

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
            "office": "office",
        },
    )

    split_records_by_place(con)

    return con.sql("select * from people_pkw_merged").df()


def fold_rounds(con):
    """One row per candidacy where the office is known, whatever the rounds.

    The 2002, 2006 and 2010 mayoral files list a candidate once per round, and
    the rows differ only in the result: a first-round `2` for whoever went
    through, then the second round's verdict. Folded into the elections by
    `list_distinct` they stayed two candidacies wherever the run-off was won -
    a loss and a win for one race. A person stands for one office once per
    election, so rows that agree on everything but the result are one
    candidacy, won if any of its rows says so.

    Rows with no office are left as they are: a council run and a mayoral run
    in one town are just as alike without one, and they are two candidacies.
    """
    con.execute(
        """
    CREATE OR REPLACE TABLE people_pkw_merged_raw AS
    SELECT * FROM people_pkw_merged_raw WHERE office IS NULL
    UNION ALL BY NAME
    SELECT
        * EXCLUDE (candidacy_success),
        CASE
            WHEN bool_or(candidacy_success = 'TRUE') THEN 'TRUE'
            WHEN bool_or(candidacy_success = 'FALSE') THEN 'FALSE'
        END AS candidacy_success,
    FROM people_pkw_merged_raw
    WHERE office IS NOT NULL
    GROUP BY ALL
    """
    )


def split_records_by_place(con):
    """Split a PKW record that stands in two places at once, one record per place.

    Namesakes of the same age are merged on purpose: somebody who filed as
    "Donald Tusk" in one election and "Donald Franciszek Tusk" in the next is
    one person, and `create_people_table` joins the two records to say so. It
    cannot tell that apart from two different people who share a name and a
    birth year, and some records give themselves away by standing in two
    places at once - Tomasz Wojciech Krasowski in both Warszawa and powiat
    sokólski, in 2010, 2014, 2018 and 2024; Andrzej Jankowski in Ostrów
    Wielkopolski and in Leszno in 2010, which is the "wiele osób na raz zostało
    połączonych" note on his page.

    Such a record used to have its candidacies emptied, and the emptying took
    whole careers with it. PKW's Sejm, Senate and European lists since 2001
    carry no age, so a name whose dated holders are more than a year apart
    pools all its national runs into one undated record, and one namesake's
    run emptied it: Anna Paluch, a PiS MP, had none of her Sejm wins in okręg
    14 from 2005 to 2019, because a namesake from Koprzywnica stood in okręg 33
    in 2023. On the 2026-10-10 inputs that was 18,980 records, and 30,820
    candidacies of 4,187 register people - 400 Sejm wins among them. Szymon,
    2026-10-11: split them by place instead.

    Each part keeps the record's name, middle name and birth year, so it fits
    exactly the people the whole record did, and attaches the way any record
    does: to every person nothing contradicts. Which part is whose is the
    reviewers' to judge, as for any record two people fit. The runs that
    clashed reach people the way every ingested candidacy does - as an edge
    the ingest stores unpublished, which only a reviewer puts live - and name
    no party for them (`parties_from_committees`), since a page's parties go
    live with the page.

    A part is a województwo. 16,342 of the 18,980 records clash only between
    two of them, and a województwo keeps together what one career there looks
    like: a gmina council, the powiat's, the sejmik above them, a Sejm run in
    the region's okręg - none of which contradicts the others. Where two
    powiats of one województwo clash, as Ostrów Wielkopolski and Leszno do
    (2,638 records), that województwo is split by powiat instead, and its runs
    for the whole region - sejmik, Sejm, Senate - make a part of their own, as
    no powiat has a better claim to them than another. A run with no place -
    the European lists of 2009, 2014 and 2024, the Sejm lists of the 1990s,
    some Senate ones - is a part of its own too: it contradicts no other part and
    nothing says which it goes with, and copied into every part one candidacy
    would become several, each to be judged on its own.

    One office per election is the rule being applied, so candidacies are only
    compared within the same year *and* the same kind of election - a
    europarliament seat and a gmina council seat in 2024 are two different
    contests. A województwo code is not a contradiction with a powiat inside
    it: standing for the sejmik and for a local council in the same region is
    an ordinary thing to do, and the two are recorded at different depths.

    `elections_ambiguous` marks a part of a record that was split.
    """
    con.execute(
        """
    CREATE OR REPLACE TABLE people_pkw_places AS
    WITH candidacies AS (
        SELECT
            person_row,
            ord,
            e,
            coalesce(e.teryt_candidacy_powiat, e.teryt_powiat[1]) AS teryt
        FROM (
            SELECT
                rowid AS person_row,
                unnest(elections) AS e,
                generate_subscripts(elections, 1) AS ord
            FROM people_pkw_merged
        )
    )
    -- A sejmik candidacy is filed under the województwo's own code, XX0000,
    -- which cut to powiat depth is XX00 - a prefix of no powiat, so every
    -- other candidacy in the region read as a second place. At its real
    -- depth, XX, it is a prefix of all of them. An empty code, which the Sejm
    -- lists of the 1990s and most European ones have, is no place at all.
    SELECT
        person_row,
        ord,
        e,
        e.election_year AS election_year,
        e.election_type AS election_type,
        CASE
            WHEN teryt LIKE '__00' THEN teryt[:2]
            ELSE nullif(teryt, '')
        END AS teryt
    FROM candidacies
    """
    )
    con.execute(
        """
    CREATE OR REPLACE TABLE people_pkw_contradictions AS
    SELECT a.person_row, a.teryt AS here, b.teryt AS there
    FROM people_pkw_places a
    JOIN people_pkw_places b
        ON a.person_row = b.person_row
        AND a.election_year = b.election_year
        AND a.election_type = b.election_type
    WHERE a.teryt IS NOT NULL
        AND b.teryt IS NOT NULL
        AND NOT starts_with(a.teryt, b.teryt)
        AND NOT starts_with(b.teryt, a.teryt)
    """
    )
    con.execute(
        """
    CREATE OR REPLACE TABLE people_pkw_parts AS
    WITH crowded AS (
        -- The województwa where two of its powiats clash, which one part
        -- for the województwo would leave standing in two places.
        SELECT DISTINCT person_row, here[:2] AS wojewodztwo
        FROM people_pkw_contradictions
        WHERE here[:2] = there[:2]
    )
    SELECT
        p.person_row,
        CASE
            WHEN p.teryt IS NULL THEN NULL
            WHEN c.wojewodztwo IS NOT NULL THEN p.teryt
            ELSE p.teryt[:2]
        END AS place,
        list(p.e ORDER BY p.ord) AS elections
    FROM people_pkw_places p
    LEFT JOIN crowded c
        ON c.person_row = p.person_row AND c.wojewodztwo = p.teryt[:2]
    WHERE p.person_row IN (SELECT person_row FROM people_pkw_contradictions)
    GROUP BY ALL
    """
    )

    records, parts = con.sql(
        "SELECT count(DISTINCT person_row), count(*) FROM people_pkw_parts"
    ).fetchone() or (0, 0)
    print(
        f"{records} merged PKW records stand in two places at once and have "
        f"been split into {parts} by place"
    )

    con.execute(
        """
    CREATE OR REPLACE TABLE people_pkw_merged AS
    SELECT p.*, false AS elections_ambiguous
    FROM people_pkw_merged p
    WHERE p.rowid NOT IN (SELECT person_row FROM people_pkw_parts)
    UNION ALL BY NAME
    SELECT
        p.* REPLACE (
            s.elections AS elections,
            -- Everywhere the part is connected to, as the record lists it.
            list_distinct(flatten(
                list_transform(s.elections, e -> e.teryt_wojewodztwo)
            )) AS teryt_wojewodztwo,
            list_distinct(flatten(
                list_transform(s.elections, e -> e.teryt_powiat)
            )) AS teryt_powiat
        ),
        true AS elections_ambiguous
    FROM people_pkw_merged p
    JOIN people_pkw_parts s ON p.rowid = s.person_row
    """
    )
