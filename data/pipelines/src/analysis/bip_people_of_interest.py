"""Who to look up on BIP: the won local candidacies of the people koryta follows.

Radni, wójtowie, burmistrzowie and prezydenci file an oświadczenie majątkowe
every year, and its public part prints the date of birth. The BIP crawler's
people mode (``koryta_scrape_bip crawl --people-of-interest``) reads this
output, the way the KRS jobs read ``ScrapeRejestrIO``, and searches each
unit's BIP for the declarations of the people in it.

People are ``PeopleMerged``'s: every KRS person, on the site (``koryta_id``) or
not uploaded yet. Their PKW record there names the office and the year but
places the candidacy only to the powiat, so each won local candidacy is joined
back to ``PeoplePKW``, whose ``teryt_candidacy`` is the unit itself - the gmina
whose BIP has the declaration. The join is by name, year, office and powiat,
with PKW's birth year within two of the merged record's: both sides are PKW's
own rows, so this finds the row ``PeopleMerged`` was built from, not a new
match.

No register birth date goes in or out: the declarations are read to check the
register against, so the register's date must not travel with them or stand
in for theirs. KRS and BIP meet later, in a join of their own (task
link-bip-birth-dates-to-people).

    koryta BipPeopleOfInterest [--bip-poi-since 2018]

Site pages with no register link are not here: without a KRS match they are
out of scope (Szymon, 10-29), and a match brings them in through PeopleMerged.
"""

import argparse
import hashlib
from functools import cache

import duckdb
import pandas as pd

from analysis.people import PeopleMerged
from entities.bip import BipPersonOfInterest
from scrapers.koryta.download import KorytaPeople
from scrapers.pkw.process import PeoplePKW
from scrapers.stores import Context, Pipeline

DEFAULT_SINCE = 2018
#: The PeopleMerged columns read: PKW's names and year, the elections, the ids.
MERGED_COLUMNS = (
    "koryta_id",
    "rejestrio_id",
    "base_first_name",
    "base_last_name",
    "pkw_birth_year",
    "elections",
)


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--bip-poi-since",
        type=int,
        default=DEFAULT_SINCE,
        help="BipPeopleOfInterest: the first local election year to look up "
        f"(default {DEFAULT_SINCE}; declarations stay on BIP about six years).",
    )


@cache
def _args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    add_arguments(parser)
    return parser.parse_known_args()[0]


class BipPeopleOfInterest(Pipeline[BipPersonOfInterest]):
    filename = "bip_people_of_interest"
    dtype = {"teryt": str, "key": str}

    people: PeopleMerged
    pkw: PeoplePKW
    koryta: KorytaPeople

    @property
    def output_class(self):
        return BipPersonOfInterest

    def process(self, ctx: Context) -> pd.DataFrame:
        return people_of_interest(
            ctx.con,
            self.people.read_or_process(ctx),
            self.pkw.read_or_process(ctx),
            self.koryta.read_or_process(ctx),
            since=_args().bip_poi_since,
        )


def people_of_interest(
    con: duckdb.DuckDBPyConnection,
    people_merged: pd.DataFrame,
    person_pkw: pd.DataFrame,
    koryta_people: pd.DataFrame,
    *,
    since: int = DEFAULT_SINCE,
) -> pd.DataFrame:
    """One row per won local candidacy since ``since`` of a ``PeopleMerged`` person."""
    if "office" not in person_pkw.columns:
        # Built before PeoplePKW had the office: every local candidacy would
        # look like every other in its town, so refuse rather than guess.
        raise ValueError("person_pkw has no `office` column; rebuild PeoplePKW")
    # Only PKW's side of PeopleMerged and the ids that point back at people:
    # the register's birth date never enters, so it cannot travel with the
    # declarations, nor stand in for one; KRS and BIP meet in a later join.
    people_merged = people_merged[list(MERGED_COLUMNS)]
    for name, frame in (
        ("bip_poi_merged", people_merged),
        ("bip_poi_pkw", person_pkw),
        ("bip_poi_koryta", koryta_people),
    ):
        con.register(name, frame)
    con.execute(
        """
        CREATE OR REPLACE TEMP MACRO bip_poi_fold(x) AS
            trim(regexp_replace(
                replace(strip_accents(lower(x)), 'ł', 'l'), '[^a-z0-9]+', ' ', 'g'
            ))
        """
    )
    rows = con.execute(
        """
        WITH merged AS (
            SELECT
                CAST(koryta_id AS VARCHAR) AS koryta_id,
                CAST(rejestrio_id AS VARCHAR[]) AS rejestrio_ids,
                bip_poi_fold(base_first_name) AS fn,
                bip_poi_fold(base_last_name) AS ln,
                TRY_CAST(pkw_birth_year AS INTEGER) AS pkw_birth_year,
                unnest(elections) AS e
            FROM bip_poi_merged
            WHERE elections IS NOT NULL
        ),
        won AS (
            SELECT DISTINCT
                koryta_id, rejestrio_ids, fn, ln, pkw_birth_year,
                CAST(e.election_year AS INTEGER) AS election_year,
                CAST(e.office AS VARCHAR) AS office,
                CAST(e.teryt_candidacy_powiat AS VARCHAR) AS powiat
            FROM merged
            WHERE e.election_type = 'samorządu'
              AND e.candidacy_success = 'TRUE'
              AND e.office IS NOT NULL
              AND CAST(e.election_year AS INTEGER) >= $since
        ),
        pkw AS (
            SELECT
                bip_poi_fold(first_name) AS fn,
                bip_poi_fold(last_name) AS ln,
                trim(first_name) AS first_name,
                nullif(trim(middle_name), '') AS middle_name,
                trim(last_name) AS last_name,
                CAST(election_year AS INTEGER) AS election_year,
                CAST(teryt_candidacy AS VARCHAR) AS teryt,
                CAST(office AS VARCHAR) AS office,
                TRY_CAST(age AS INTEGER) AS pkw_age,
                TRY_CAST(birth_year AS INTEGER) AS pkw_birth_year
            FROM bip_poi_pkw
            WHERE election_type = 'samorządu'
              AND candidacy_success = 'TRUE'
              AND office IS NOT NULL
              AND length(CAST(teryt_candidacy AS VARCHAR)) = 6
              AND CAST(election_year AS INTEGER) >= $since
        ),
        -- Winners of one name in one unit and year: a father and a son on one
        -- council are two people here, and only their declarations tell them
        -- apart. One person's mayoral and council wins are one person.
        people_by_name AS (
            SELECT fn, ln, teryt, election_year,
                   count(DISTINCT coalesce(middle_name, '') || '|'
                         || coalesce(CAST(pkw_birth_year AS VARCHAR), '')) - 1
                       AS namesakes
            FROM pkw
            GROUP BY ALL
        ),
        pkw_counted AS (
            SELECT p.*, n.namesakes
            FROM pkw p JOIN people_by_name n USING (fn, ln, teryt, election_year)
        ),
        joined AS (
            SELECT p.*, w.koryta_id, w.rejestrio_ids
            FROM won w
            JOIN pkw_counted p
              ON p.fn = w.fn AND p.ln = w.ln
             AND p.election_year = w.election_year
             AND p.office = w.office
             AND left(p.teryt, 4) = w.powiat
             -- PKW's years only: two of one person's rows can differ by two,
             -- as "wiek" counts on different days in different elections.
             AND (p.pkw_birth_year IS NULL OR w.pkw_birth_year IS NULL
                  OR abs(p.pkw_birth_year - w.pkw_birth_year) <= 2)
        ),
        site AS (
            SELECT
                CAST(id AS VARCHAR) AS koryta_id,
                coalesce(CAST(is_public AS BOOLEAN), false) AS published,
                -- Whether the page shows one, not which: the date stays out.
                coalesce(CAST(birth_date AS VARCHAR), '') <> '' AS dated
            FROM bip_poi_koryta
            WHERE merged_into IS NULL OR CAST(merged_into AS VARCHAR) = ''
        )
        SELECT
            j.first_name, j.middle_name, j.last_name, j.teryt, j.office,
            j.election_year, any_value(j.pkw_age) AS pkw_age,
            j.pkw_birth_year, any_value(j.namesakes) AS namesakes,
            list_sort(list_distinct(coalesce(
                list(j.koryta_id) FILTER (WHERE s.koryta_id IS NOT NULL), []
            ))) AS koryta_ids,
            list_sort(list_distinct(flatten(list(coalesce(j.rejestrio_ids, [])))))
                AS rejestrio_ids,
            -- Dated only if every page of the candidacy shows a birth date.
            coalesce(bool_and(s.dated) FILTER (WHERE s.koryta_id IS NOT NULL), false)
                AS page_has_birth_date,
            bool_or(s.koryta_id IS NOT NULL) AS on_site,
            coalesce(bool_or(s.published), false) AS published
        FROM joined j
        LEFT JOIN site s ON s.koryta_id = j.koryta_id
        GROUP BY ALL
        """,
        {"since": since},
    ).df()
    if rows.empty:
        return pd.DataFrame(
            columns=[f for f in BipPersonOfInterest.__dataclass_fields__]
        )
    for column in ("koryta_ids", "rejestrio_ids"):
        # DuckDB hands lists over as numpy arrays; the dataclass wants lists.
        rows[column] = rows[column].map(
            lambda v: [] if v is None else [str(x) for x in v]
        )
    rows["middle_name"] = rows.middle_name.astype(object).where(
        rows.middle_name.notna(), None
    )
    rows["full_name"] = [
        " ".join(p for p in (first, middle, last) if isinstance(p, str) and p)
        for first, middle, last in zip(
            rows.first_name, rows.middle_name, rows.last_name
        )
    ]
    rows["unit_level"] = rows.teryt.map(unit_level)
    rows["priority"] = [
        priority(published, on_site, dated)
        for published, on_site, dated in zip(
            rows.published, rows.on_site, rows.page_has_birth_date
        )
    ]
    rows["key"] = [
        candidacy_key(t, o, y, f, m, last, b)
        for t, o, y, f, m, last, b in zip(
            rows.teryt,
            rows.office,
            rows.election_year,
            rows.first_name,
            rows.middle_name,
            rows.last_name,
            rows.pkw_birth_year,
        )
    ]
    rows = rows.sort_values(
        ["priority", "election_year", "teryt", "last_name"],
        ascending=[True, False, True, True],
    )
    return rows[[f for f in BipPersonOfInterest.__dataclass_fields__]].reset_index(
        drop=True
    )


def unit_level(teryt: str) -> str:
    """PKW's six digits name the unit by depth: WW0000, WWPP00, else a gmina."""
    if teryt.endswith("0000"):
        return "wojewodztwo"
    if teryt.endswith("00"):
        return "powiat"
    return "gmina"


def priority(published: bool, on_site: bool, page_has_birth_date: bool) -> int:
    """0 a published page with no birth date, 1 a draft with none, 2 a page with
    one, 3 a person not on the site."""
    if not on_site:
        return 3
    if page_has_birth_date:
        return 2
    return 0 if published else 1


def candidacy_key(
    teryt: str,
    office: str,
    year: int,
    first: str,
    middle: str | None,
    last: str,
    birth_year: int | None,
) -> str:
    born = "" if birth_year is None or pd.isna(birth_year) else int(birth_year)
    raw = "|".join(
        str(x) for x in (teryt, office, int(year), first, middle or "", last, born)
    )
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]
