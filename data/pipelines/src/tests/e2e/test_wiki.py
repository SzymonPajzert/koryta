"""Semantic checks on the Wikipedia extraction.

This is the pipeline the dump download exists for, and the one whose failures
are quietest: a change to infobox handling loses a field for every article at
once without raising anything. These run on both tiers -- a shard exercises the
same parser as the whole dump.
"""

import dataclasses
import datetime

import pytest
from regex import match

from entities.company import Wikipedia as CompanyWikipedia
from entities.person import Wikipedia as PersonWikipedia

pytestmark = pytest.mark.e2e

# parse_date emits 00 for the parts it could not read, e.g. 1970-00-00 for an
# article that gives only a year.
ISO_DATE = "^\\d{4}-\\d{2}-\\d{2}$"

# plwiki carries biographies well back into the middle ages -- the shard alone
# has people born in 1475. This is a floor for parse garbage, not a claim about
# who the dataset covers.
OLDEST_PLAUSIBLE_BIRTH_YEAR = 1000


def field_names(entity) -> set[str]:
    return {f.name for f in dataclasses.fields(entity)}


@pytest.fixture(scope="session")
def people(read_output):
    return read_output("person_wikipedia")


@pytest.fixture(scope="session")
def companies(read_output):
    # As text: once every value is a number, pandas reads the column as one.
    return read_output("company_wikipedia", dtype={"krs": str})


def test_people_schema_matches_entity(people):
    assert set(people.columns) == field_names(PersonWikipedia)


def test_companies_schema_matches_entity(companies):
    assert set(companies.columns) == field_names(CompanyWikipedia)


def test_people_have_a_source_and_a_name(people):
    assert people["source"].notna().all()
    assert people["source"].str.startswith("https://pl.wikipedia.org/wiki/").all()
    assert people["full_name"].notna().all()
    assert (people["full_name"].str.strip() != "").all()


def test_people_are_sorted_by_content_score(people):
    # ProcessWiki sorts before writing, and downstream consumers take the top
    # of the file as the best-covered articles.
    scores = people["content_score"]
    assert (scores >= 0).all()
    assert scores.is_monotonic_decreasing


def test_birth_years_are_plausible(people):
    years = people["birth_year"].dropna()
    if years.empty:
        pytest.fail("no article yielded a birth year -- date extraction is broken")

    this_year = datetime.date.today().year
    out_of_range = years[(years < OLDEST_PLAUSIBLE_BIRTH_YEAR) | (years > this_year)]
    assert out_of_range.empty, (
        f"{len(out_of_range)} birth year(s) outside "
        f"{OLDEST_PLAUSIBLE_BIRTH_YEAR}-{this_year}: "
        f"{sorted(out_of_range.unique())[:10]}"
    )


def test_birth_dates_are_iso_shaped(people):
    dates = people["birth_iso8601"].dropna()
    if dates.empty:
        pytest.fail("no article yielded a birth date -- date extraction is broken")

    malformed = [d for d in dates.unique() if match(ISO_DATE, str(d)) is None]
    assert not malformed, f"birth_iso8601 not in YYYY-MM-DD form: {malformed[:10]}"


def test_birth_year_agrees_with_birth_date(people):
    both = people.dropna(subset=["birth_iso8601", "birth_year"])
    if both.empty:
        pytest.skip("no article carries both a birth date and a birth year")

    from_date = both["birth_iso8601"].str.slice(0, 4).astype(int)
    disagree = both[from_date != both["birth_year"].astype(int)]
    columns = ["full_name", "birth_iso8601", "birth_year"]
    assert disagree.empty, (
        f"{len(disagree)} article(s) have a birth_year that contradicts "
        f"birth_iso8601, e.g. {disagree[columns].head(5).to_dict('records')}"
    )


def test_infoboxes_are_lists(people):
    assert people["infoboxes"].map(lambda v: isinstance(v, list)).all()


def test_companies_have_a_name(companies):
    assert companies["name"].notna().all()
    assert (companies["name"].str.strip() != "").all()
    assert (companies["content_score"] >= 0).all()


def test_company_krs_numbers_are_digits(companies):
    # A file written before ProcessWiki cleaned the column has "" for an empty
    # "numer rejestru" rather than None. Absent either way, so it is not what
    # this test is about.
    krs = companies["krs"].dropna()
    krs = krs[krs.str.strip() != ""]
    if krs.empty:
        pytest.skip("no company article carried a KRS number")

    malformed = [k for k in krs.unique() if not str(k).strip().isdigit()]
    assert not malformed, f"KRS numbers that are not digits: {malformed[:10]}"
