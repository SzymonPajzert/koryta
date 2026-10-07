"""Which Wikipedia biography, if any, the KRS↔PKW join attaches to a person."""

import io
import itertools
from types import SimpleNamespace

import duckdb
import pandas as pd
import pytest

from analysis.people import (
    PeopleMerged,
    people_merged,
    preferred_spelling,
    unique_probability,
)
from analysis.people_wiki_merged import people_wiki_merged
from scrapers.stores import Context, ProcessPolicy
from scrapers.stores.file import VersionedBackup
from scrapers.test_tree import MockIO, MockNLP, MockRejestrIO, MockUtils, MockWeb
from stores.file import FromBytesIO


@pytest.fixture
def ctx():
    return Context(
        io=MockIO(),
        rejestr_io=MockRejestrIO(),
        con=duckdb.connect(),
        utils=MockUtils(),
        web=MockWeb(),
        nlp=MockNLP(),
        refresh_policy=ProcessPolicy.with_default(),
    )


def krs_person(
    first: str, last: str, birth_date: str, second: str | None = None
) -> dict:
    return {
        "first_name": first,
        "last_name": last,
        "second_name": second,
        "birth_year": int(birth_date[:4]),
        "birth_date": birth_date,
        "full_name": [f"{first} {last}"],
        "rejestrio_id": ["1"],
        "employment": [],
    }


def pkw_person(
    first: str,
    last: str,
    birth_year: int | None,
    second: str | None = None,
    years: tuple[str, ...] = ("2024",),
) -> dict:
    """One PKW candidate, as `PeoplePKWMerged` leaves them."""
    return {
        "first_name": first,
        "last_name": last,
        "second_name": second,
        "birth_year": birth_year,
        "full_name": [
            " ".join(part for part in [first, second, last] if part),
        ],
        "teryt_wojewodztwo": ["14"],
        "teryt_powiat": ["1465"],
        "elections": [
            {
                "party": "Komitet Wyborczy Prawo i Sprawiedliwość",
                "election_year": year,
                "election_type": "Samorząd",
                "teryt_candidacy_wojewodztwo": "14",
                "teryt_candidacy_powiat": "1465",
                "teryt_living_wojewodztwo": "14",
                "teryt_living_powiat": "1465",
                "teryt_wojewodztwo": ["14"],
                "teryt_powiat": ["1465"],
                "candidacy_success": True,
            }
            for year in years
        ],
    }


def article(name: str, birth_iso8601: str) -> dict:
    """One Wikipedia biography, as `ProcessWiki` leaves it.

    `birth_iso8601` is whatever `parse_date` made of the infobox: a full date
    where the article gave one, `1959-00-00` where it gave only a year.
    """
    return {
        "source": f"https://pl.wikipedia.org/wiki/{name.replace(' ', '_')}",
        "full_name": name,
        "party": "",
        "birth_iso8601": birth_iso8601,
        "birth_year": int(birth_iso8601[:4]),
        "infoboxes": ["Polityk"],
        "content_score": 1,
        "links": [],
    }


KORYTA_COLUMNS = [
    "first_name",
    "last_name",
    "tail_name",
    "rejestrio_id",
    "koryta_id",
    "full_name",
]


def koryta_person(full_name: str, koryta_id: str, rejestrio_id: str = "") -> dict:
    """One person node already on the site, as `PeopleKorytaMerged` leaves it."""
    words = full_name.split()
    return {
        "first_name": words[0].lower(),
        "last_name": words[-1].lower(),
        "tail_name": " ".join(words[1:]).lower(),
        "rejestrio_id": rejestrio_id,
        "koryta_id": koryta_id,
        "full_name": full_name,
    }


def no_koryta() -> pd.DataFrame:
    """A site with nobody on it, for the joins that are not about the site."""
    return pd.DataFrame(columns=KORYTA_COLUMNS)


def match_pkw(ctx, krs: list[dict], pkw: list[dict]) -> pd.DataFrame:
    """Run the merge over nothing but KRS and PKW.

    The mirror of `match`: Wikipedia is left empty because it joins on its own
    terms and would only add noise to a question about candidacies.
    """
    return people_merged(
        ctx,
        pd.DataFrame(krs),
        pd.DataFrame(
            columns=[
                "first_name",
                "last_name",
                "second_name",
                "birth_year",
                "birth_date",
                "full_name",
                "source",
                "is_polityk",
                "wiki_score",
            ]
        ),
        pd.DataFrame(pkw),
        no_koryta(),
        pd.DataFrame(columns=["last_name", "teryt", "count"]),
        pd.DataFrame(columns=["first_name", "p"]),
    )


def candidacy_years(result: pd.DataFrame) -> list[str]:
    """The election years the merge hung on the one person it was given.

    A person the join found nobody for keeps the `elections` of the outer join,
    which is `pd.NA` rather than an empty list - the same "no candidacies" the
    caller is asking about, so it reads back as one.
    """
    elections = result["elections"].iloc[0]
    if elections is None or elections is pd.NA:
        return []
    return sorted(str(e["election_year"]) for e in elections)


def match(ctx, krs: list[dict], articles: list[dict]) -> pd.DataFrame:
    """Run the merge over nothing but KRS and Wikipedia, and hand back the rows.

    The wiki side goes through its own merge first, so the test sees the same
    `birth_date` the pipeline would produce rather than one written by hand.
    PKW is left empty on purpose: it joins in its own right and would only add
    noise to a question about Wikipedia. The two frequency tables are the
    smallest shape `unique_probability` accepts.
    """
    wiki = people_wiki_merged(ctx, pd.DataFrame(articles))
    return people_merged(
        ctx,
        pd.DataFrame(krs),
        wiki,
        pd.DataFrame(
            columns=[
                "first_name",
                "last_name",
                "second_name",
                "birth_year",
                "full_name",
                "teryt_wojewodztwo",
                "teryt_powiat",
                "elections",
            ]
        ),
        no_koryta(),
        pd.DataFrame(columns=["last_name", "teryt", "count"]),
        pd.DataFrame(columns=["first_name", "p"]),
    )


def test_a_year_only_biography_matches_somebody_born_that_year(ctx):
    """The bug: `1959-00-00` is neither a date nor NULL, so it matched nobody.

    Polish biographies of local officials routinely give the year alone, and
    KRS knows everybody's full date of birth, so equality can never hold. Only
    297 of 6077 people carried a Wikipedia link, against reviewers repeatedly
    noting "brakuje wikipedii" on people who plainly have an article.
    """
    result = match(
        ctx,
        [krs_person("piotr", "uszok", "1959-03-02")],
        [article("Piotr Uszok", "1959-00-00")],
    )

    assert list(result["wiki_name"]) == ["Piotr Uszok"]


def test_a_year_only_biography_does_not_match_a_different_year(ctx):
    """Dropping the day must not amount to dropping the year with it."""
    result = match(
        ctx,
        [krs_person("piotr", "uszok", "1984-03-02")],
        [article("Piotr Uszok", "1959-00-00")],
    )

    assert result["wiki_name"].isna().all()


def test_a_dated_biography_still_has_to_agree_on_the_day(ctx):
    """Where the article is precise, so is the match."""
    result = match(
        ctx,
        [krs_person("piotr", "uszok", "1959-03-02")],
        [article("Piotr Uszok", "1959-11-30")],
    )

    assert result["wiki_name"].isna().all()


def test_a_dated_biography_matches_the_day_it_names(ctx):
    result = match(
        ctx,
        [krs_person("piotr", "uszok", "1959-03-02")],
        [article("Piotr Uszok", "1959-03-02")],
    )

    assert list(result["wiki_name"]) == ["Piotr Uszok"]


def test_a_middle_name_only_pkw_knows_still_matches(ctx):
    """The bug: silence about a middle name read as disagreement.

    Jarosław Wieszołek is "jarosław maciej" on the PKW candidate list and plain
    "jarosław" in KRS, so requiring the two to agree exactly cost him all three
    candidacies - and the reader who noticed wrote "Brakuje PKW" on his page.
    """
    result = match_pkw(
        ctx,
        [krs_person("jarosław", "wieszołek", "1971-09-21")],
        [pkw_person("jarosław", "wieszołek", 1971, second="maciej")],
    )

    assert candidacy_years(result) == ["2024"]


def test_a_middle_name_only_krs_knows_still_matches(ctx):
    """Silence is symmetric: PKW is as free to omit one as KRS is."""
    result = match_pkw(
        ctx,
        [krs_person("marcin", "marzyński", "1979-02-04", second="tomasz")],
        [pkw_person("marcin", "marzyński", 1979)],
    )

    assert candidacy_years(result) == ["2024"]


def test_middle_names_that_disagree_still_do_not_match(ctx):
    """Relaxing silence must not relax contradiction."""
    result = match_pkw(
        ctx,
        [krs_person("jacek", "guzicki", "1972-10-06", second="piotr")],
        [pkw_person("jacek", "guzicki", 1972, second="andrzej")],
    )

    assert candidacy_years(result) == []


def test_silence_decides_nothing_when_it_leaves_two_candidates(ctx):
    """Four Piotr Mrozińskis stand; KRS names no middle name for its one.

    Any of them could be the person, so none of them is: hanging a stranger's
    candidacies on the page is the harm the whole merge is arranged to avoid.
    """
    result = match_pkw(
        ctx,
        [krs_person("piotr", "mroziński", "1955-04-15")],
        [
            pkw_person("piotr", "mroziński", 1955, second="paweł"),
            pkw_person("piotr", "mroziński", 1956, second="teofil"),
        ],
    )

    assert candidacy_years(result) == []


def test_an_agreeing_middle_name_wins_over_a_silent_one(ctx):
    """A person who already had a match cannot be pulled off it by a looser one.

    4292 people have both kinds of candidate. Whoever agrees on the middle name
    is the answer; the one that merely fails to contradict is not even
    considered, so the count of candidates behind it cannot matter.
    """
    result = match_pkw(
        ctx,
        [krs_person("mariusz", "mandat", "1974-01-04", second="mieczysław")],
        [
            pkw_person("mariusz", "mandat", 1974, second="mieczysław", years=("2014",)),
            pkw_person("mariusz", "mandat", 1974, years=("2002",)),
            pkw_person("mariusz", "mandat", 1975, years=("2010",)),
        ],
    )

    assert candidacy_years(result) == ["2014"]


def test_a_year_only_biography_needs_the_first_name_exactly(ctx):
    """The bug: Marzena Słomka's page carried Marek Słomka's biography.

    `jaro_winkler_similarity('marzena', 'marek')` is 0.8533 - over the
    threshold by three thousandths, on the strength of a shared "mar". A birth
    year rules out almost nobody, so with the day unknown the first name is the
    only thing left telling the two apart and an approximate one tells them
    apart badly: nine of the ten year-only matches that leant on the threshold
    were somebody else.
    """
    result = match(
        ctx,
        [krs_person("marzena", "słomka", "1971-05-22")],
        [article("Marek Słomka", "1971-00-00")],
    )

    assert result["wiki_name"].isna().all()


def test_a_dated_biography_still_forgives_a_misspelt_first_name(ctx):
    """The other nine in ten, which the fuzzy match is there for.

    KRS spells Józef Malec "Józedf", and a birth date agreeing to the day says
    who he is regardless - so the tolerance stays where it is corroborated.
    """
    result = match(
        ctx,
        [krs_person("józedf", "malec", "1955-03-28")],
        [article("Józef Jan Malec", "1955-03-28")],
    )

    assert list(result["wiki_name"]) == ["Józef Jan Malec"]


def test_two_biographies_that_both_fit_decide_nothing(ctx):
    """Robert Kwiatkowski the urzędnik and Robert Kwiatkowski the polityk.

    Both were born on 1961-11-07 and there is nothing to choose between them
    but the score, which would hang a stranger's biography on the page - the
    same harm the PKW side refuses to risk, refused the same way.
    """
    result = match(
        ctx,
        [krs_person("robert", "kwiatkowski", "1961-11-07")],
        [
            article("Robert Kwiatkowski (urzędnik)", "1961-11-07"),
            article("Robert Kwiatkowski (polityk)", "1961-11-07"),
        ],
    )

    assert result["wiki_name"].isna().all()


def test_a_namesake_the_first_name_rules_out_leaves_one_match(ctx):
    """Refusing ambiguity must not refuse what is no longer ambiguous.

    Dariusz Popławski drew two candidates: his own article and Mariusz
    Popławski's, the latter on a shared birth year and the threshold alone.
    With the year-only branch made exact that one is gone before the count is
    taken, and the person keeps the biography that is actually his.
    """
    result = match(
        ctx,
        [krs_person("dariusz", "popławski", "1975-09-12")],
        [
            article("Dariusz Popławski (wicewojewoda)", "1975-09-12"),
            article("Mariusz Popławski", "1975-00-00"),
        ],
    )

    assert list(result["wiki_name"]) == ["Dariusz Popławski (wicewojewoda)"]


def test_a_year_only_biography_naming_another_middle_name_is_somebody_else(ctx):
    """The bug: Ryszard Jan Piasecki carried Ryszard Tomasz Piasecki's article.

    Both were born in 1951, which is all the article says, so the middle name
    is the one thing telling them apart - and it says they are two people.
    """
    result = match(
        ctx,
        [krs_person("ryszard", "piasecki", "1951-04-19", second="jan")],
        [article("Ryszard Tomasz Piasecki", "1951-00-00")],
    )

    assert result["wiki_name"].isna().all()


def test_a_year_only_biography_giving_an_initial_still_matches(ctx):
    """Wikipedia writes some middle names as initials: "Andrzej W. Nowak"."""
    result = match(
        ctx,
        [krs_person("andrzej", "nowak", "1974-11-10", second="wojciech")],
        [article("Andrzej W. Nowak", "1974-00-00")],
    )

    assert list(result["wiki_name"]) == ["Andrzej W. Nowak"]


def test_a_qualifier_in_brackets_is_not_a_middle_name(ctx):
    """What an article's title adds in brackets says what the person is, not
    what they are called, so it contradicts no middle name."""
    result = match(
        ctx,
        [krs_person("andrzej", "sikora", "1946-12-01", second="jan")],
        [article("Andrzej Sikora (ur. 1946)", "1946-00-00")],
    )

    assert list(result["wiki_name"]) == ["Andrzej Sikora (ur. 1946)"]


def match_koryta(ctx, krs: list[dict], koryta: list[dict]) -> pd.DataFrame:
    """Run the merge over KRS and the site's own pages."""
    return people_merged(
        ctx,
        pd.DataFrame(krs),
        pd.DataFrame(
            columns=[
                "first_name",
                "last_name",
                "second_name",
                "birth_year",
                "birth_date",
                "full_name",
                "source",
                "is_polityk",
                "wiki_score",
            ]
        ),
        pd.DataFrame(
            columns=[
                "first_name",
                "last_name",
                "second_name",
                "birth_year",
                "full_name",
                "teryt_wojewodztwo",
                "teryt_powiat",
                "elections",
            ]
        ),
        pd.DataFrame(koryta, columns=KORYTA_COLUMNS),
        pd.DataFrame(columns=["last_name", "teryt", "count"]),
        pd.DataFrame(columns=["first_name", "p"]),
    )


def test_the_register_id_finds_the_page_whatever_it_is_called(ctx):
    """The point of carrying the id at all.

    The page is named with a middle name and the payload is not, which is the
    170-duplicate case. The register id is the same, so it is the same man.
    """
    result = match_koryta(
        ctx,
        [krs_person("andrzej", "golimont", "1965-04-01")],
        [koryta_person("Andrzej Marcin Golimont", "node-1", rejestrio_id="1")],
    )

    assert list(result["koryta_id"]) == ["node-1"]


def test_a_page_whose_register_id_is_somebody_elses_is_not_this_person(ctx):
    """The collapse case, refused.

    Same name, different register entry: two strangers. Matching them would put
    one man's posts on the other's page - worse than leaving him without one.
    """
    result = match_koryta(
        ctx,
        [krs_person("michal", "nowak", "1961-02-03")],
        [koryta_person("Michal Nowak", "node-1", rejestrio_id="999")],
    )

    assert list(result["koryta_id"]) == [None]


def test_a_page_with_no_register_link_is_still_found_by_name(ctx):
    """868 pages carry no register link, and the name is all there is."""
    result = match_koryta(
        ctx,
        [krs_person("halina", "czapla", "1958-07-07")],
        [koryta_person("Halina Czapla", "node-1")],
    )

    assert list(result["koryta_id"]) == ["node-1"]


def test_a_page_whose_register_link_is_null_is_still_found_by_name(ctx):
    """The stored field is absent, not empty, for a page nobody has linked.

    Worth its own case because SQL answers NULL to both `= ''` and `!= ''`, so
    a join written the obvious way drops these rows off both sides of its OR
    and loses precisely the people the name fallback is for.
    """
    result = match_koryta(
        ctx,
        [krs_person("halina", "czapla", "1958-07-07")],
        [koryta_person("Halina Czapla", "node-1", rejestrio_id=None)],
    )

    assert list(result["koryta_id"]) == ["node-1"]


def test_a_page_named_with_a_middle_name_is_found_by_name_too(ctx):
    """The old join read everything after the first word as the surname, so
    "Andrzej Marcin Golimont" looked like a Mr "Marcin Golimont" and matched
    nobody - losing exactly the people this is for."""
    result = match_koryta(
        ctx,
        [krs_person("andrzej", "golimont", "1965-04-01")],
        [koryta_person("Andrzej Marcin Golimont", "node-1")],
    )

    assert list(result["koryta_id"]) == ["node-1"]


def test_a_double_surname_written_with_a_space_is_still_found(ctx):
    """The register keeps "Pietrzak Sikorska" whole in `last_name`, so the
    surname is the tail of the page's name rather than its last word."""
    result = match_koryta(
        ctx,
        [krs_person("malgorzata", "pietrzak sikorska", "1970-01-01")],
        [koryta_person("Malgorzata Pietrzak Sikorska", "node-1")],
    )

    assert list(result["koryta_id"]) == ["node-1"]


def test_two_pages_a_name_cannot_choose_between_decide_nothing(ctx):
    """The id is written to, not merely reported, so an ambiguous match is a
    page overwritten with somebody else's career. Same refusal `wiki_match`
    makes for the milder harm of a wrong biography."""
    result = match_koryta(
        ctx,
        [krs_person("jan", "kowalski", "1960-05-05")],
        [
            koryta_person("Jan Kowalski", "node-1"),
            koryta_person("Jan Kowalski", "node-2"),
        ],
    )

    assert list(result["koryta_id"]) == [None]


def test_the_register_id_wins_over_a_second_page_that_only_matches_by_name(ctx):
    """A duplicate not yet merged should not make the real page unreachable."""
    result = match_koryta(
        ctx,
        [krs_person("andrzej", "golimont", "1965-04-01")],
        [
            koryta_person("Andrzej Golimont", "node-real", rejestrio_id="1"),
            koryta_person("Andrzej Golimont", "node-dup"),
        ],
    )

    assert list(result["koryta_id"]) == ["node-real"]


def test_one_page_two_namesakes_gives_neither_of_them_the_id(ctx):
    """The hazard the other way round, and the one that bites on real data.

    Refusing where a person matches two pages is not enough: a page can be the
    only candidate for several *different* people. Against the 2026-08-29 export
    87 pages were, one of them reached by six Jerzy Kaczmareks born between 1943
    and 1968. Handing all six the same id would write six careers onto one page
    - a collapse, which is worse than the duplicate the id is here to prevent.
    """
    result = match_koryta(
        ctx,
        [
            krs_person("jerzy", "kaczmarek", "1943-01-01"),
            krs_person("jerzy", "kaczmarek", "1968-01-01"),
        ],
        [koryta_person("Jerzy Kaczmarek", "node-1")],
    )

    assert set(result["koryta_id"]) == {None}


def test_two_krs_rows_carrying_one_register_id_both_reach_the_page(ctx):
    """And the exemption that has to go with it.

    `create_people_table` groups on the birth year, so one register entry filed
    under two dates comes out as two rows. Both carry the same register id, so
    both are the same man and both belong on his one page - 7 pages on the site
    are reached that way. Refusing here, the way a shared name is refused, would
    strand him instead.
    """
    result = match_koryta(
        ctx,
        [
            krs_person("marcin", "adamczyk", "1970-01-01"),
            krs_person("marcin", "adamczyk", "1985-01-01"),
        ],
        [koryta_person("Marcin Adamczyk", "node-1", rejestrio_id="1")],
    )

    assert list(result["koryta_id"]) == ["node-1", "node-1"]


def test_a_person_pkw_has_twice_still_reaches_their_page(ctx):
    """The bug: Andrzej Wyszyński, entry 1291534, was never matched to his page.

    PKW has him as two records with no middle name, born 1954 and 1955, and
    KRS gives none either, so both stayed his candidates. The page match was
    made once per candidate, and the one page found twice read as two pages.
    """
    result = people_merged(
        ctx,
        pd.DataFrame([krs_person("andrzej", "wyszyński", "1954-08-05")]),
        pd.DataFrame(columns=WIKI_COLUMNS),
        pd.DataFrame(
            [
                pkw_person("andrzej", "wyszyński", 1954, years=("2010",)),
                pkw_person("andrzej", "wyszyński", 1955, years=("2014",)),
            ]
        ),
        pd.DataFrame(
            [koryta_person("Andrzej Wyszyński", "node-1", rejestrio_id="1")],
            columns=KORYTA_COLUMNS,
        ),
        pd.DataFrame(columns=["last_name", "teryt", "count"]),
        pd.DataFrame(columns=["first_name", "p"]),
    )

    assert list(result["koryta_id"]) == ["node-1"]


# ------------------------------------------ two register entries, two people
# After krs-people-full-birth-date's tests, counted by person.
def registered(person: dict, rejestrio_id: str) -> dict:
    return {**person, "rejestrio_id": [rejestrio_id]}


JAN_FEBRUARY = registered(krs_person("jan", "nowak", "1970-02-08"), "7")
JAN_NOVEMBER = registered(krs_person("jan", "nowak", "1970-11-30"), "8")


@pytest.mark.parametrize("order", [1, -1])
def test_namesakes_born_the_same_year_are_both_kept_in_either_order(ctx, order):
    """It kept one row per name and birth year, so whichever the row order
    put second went missing, register entry and posts with it."""
    result = match_koryta(ctx, [JAN_FEBRUARY, JAN_NOVEMBER][::order], [])

    assert sorted(result["birth_date"]) == ["1970-02-08", "1970-11-30"]


def test_a_candidacy_two_namesakes_could_have_stood_for_goes_to_neither(ctx):
    """PKW knows the year, give or take one; it cannot say which of the two stood.

    Each of them alone would take it. Both at once would put one candidacy on
    two people, so neither does.
    """
    february_1971 = registered(krs_person("jan", "nowak", "1971-02-08"), "8")
    result = match_pkw(
        ctx, [JAN_FEBRUARY, february_1971], [pkw_person("jan", "nowak", 1970)]
    )

    assert result["pkw_name"].isna().all()


def test_two_entries_born_the_same_day_are_two_claimants(ctx):
    """One name and one birth date under two register entries: two people as
    far as anybody can tell, so the candidacy is neither's."""
    twin = registered(krs_person("jan", "nowak", "1970-02-08"), "8")
    result = match_pkw(ctx, [JAN_FEBRUARY, twin], [pkw_person("jan", "nowak", 1970)])

    assert len(result) == 2
    assert result["pkw_name"].isna().all()


def test_the_namesake_whose_middle_name_agrees_keeps_the_candidacy(ctx):
    """Unless one of them claims it by a middle name both sources agree on."""
    adam = registered(krs_person("jan", "nowak", "1970-02-08", second="adam"), "7")
    result = match_pkw(
        ctx, [adam, JAN_NOVEMBER], [pkw_person("jan", "nowak", 1970, second="adam")]
    ).set_index("birth_date")

    assert result.loc["1970-02-08", "pkw_name"] == "jan adam nowak"
    assert pd.isna(result.loc["1970-11-30", "pkw_name"])


def test_a_namesake_set_aside_for_ambiguity_still_counts_as_a_claimant(ctx):
    """Jan Piotr fits two candidacies and so takes neither, but he could still be
    the Jan Nowak of 1970 - which is no more Jan Adam's for that."""
    adam = registered(krs_person("jan", "nowak", "1970-02-08", second="adam"), "7")
    piotr = registered(krs_person("jan", "nowak", "1971-03-01", second="piotr"), "8")
    result = match_pkw(
        ctx,
        [adam, piotr],
        [pkw_person("jan", "nowak", 1970), pkw_person("jan", "nowak", 1972)],
    )

    assert result["pkw_name"].isna().all()


def test_namesakes_born_the_same_day_are_both_kept_whatever_they_score(ctx):
    """Only one of them matches the candidacy; that must not cost the other his row."""
    robert = registered(krs_person("janusz", "kowalczyk", "1962-01-01", "robert"), "1")
    piotr = registered(krs_person("janusz", "kowalczyk", "1962-01-01", "piotr"), "2")
    result = match_pkw(
        ctx, [robert, piotr], [pkw_person("janusz", "kowalczyk", 1962, second="robert")]
    )

    assert sorted(i for ids in result["rejestrio_id"] for i in ids) == ["1", "2"]
    assert list(result["pkw_name"].dropna()) == ["janusz robert kowalczyk"]


def test_a_year_only_biography_two_namesakes_fit_is_neither_of_theirs(ctx):
    """The same for Wikipedia: "ur. 1970" fits both Jan Nowaks, so neither."""
    result = match(
        ctx, [JAN_FEBRUARY, JAN_NOVEMBER], [article("Jan Nowak", "1970-00-00")]
    )

    assert result["wiki_name"].isna().all()


# ------------------------------------------------- which spelling names the row
def spelled(first: str, last: str, birth_date: str, second: str, *names: str) -> dict:
    """A KRS person whose register entries spell them as `names`, in that order."""
    return {
        **krs_person(first, last, birth_date, second=second),
        "full_name": list(names),
    }


def test_a_namesake_spelled_two_ways_keeps_his_row(ctx):
    """The bug: Tomasz Marcin Sikora, born 1973-02-26, was a row one night and
    gone the next.

    His entries read "Tomasz Sikora" and "Tomasz Marcin Sikora", and `krs_name`
    was whichever of the two duckdb listed first. As "Tomasz Sikora" he shared
    a name and a birth year with the biathlete born that December, and
    `unique_krs` keeps one row per name and year.
    """
    result = match_koryta(
        ctx,
        [
            spelled(
                "tomasz",
                "sikora",
                "1973-02-26",
                "marcin",
                "Tomasz Sikora",
                "Tomasz Marcin Sikora",
            ),
            spelled("tomasz", "sikora", "1973-12-21", "wacław", "Tomasz Sikora"),
        ],
        [],
    )

    assert sorted(result["krs_name"]) == ["Tomasz Marcin Sikora", "Tomasz Sikora"]


def test_the_name_is_the_spelling_the_row_was_matched_by(ctx):
    """Marcin Golański's entries are typed with Polish letters and without.

    `create_people_table` gives his register id the spelling with them, and
    PKW is matched against that - so the row's name has to be that one too,
    not the copy typed without them that happened to be listed first.
    """
    result = match_pkw(
        ctx,
        [
            spelled(
                "marcin",
                "golański",
                "1978-11-08",
                "jerzy",
                "Marcin Golanski",
                "Marcin Golański",
            )
        ],
        [pkw_person("marcin", "golański", 1978, second="jerzy")],
    )

    assert list(result["krs_name"]) == ["Marcin Golański"]
    assert candidacy_years(result) == ["2024"]


@pytest.mark.parametrize(
    "names",
    list(
        itertools.permutations(
            ["Andrzej Sikora", "ANDRZEJ JAN SIKORA", "Andrzej Jan Sikora"]
        )
    ),
)
def test_the_spelling_does_not_depend_on_the_order_it_comes_in(names):
    """The middle name, then not shouting - whichever order duckdb lists them."""
    assert (
        preferred_spelling(list(names), "andrzej", "jan", "sikora")
        == "Andrzej Jan Sikora"
    )


def test_a_person_with_no_spelling_has_no_name():
    assert preferred_spelling(None, "jan", None, "nowak") is None
    assert preferred_spelling([None, " "], "jan", None, "nowak") is None


# ---------------------------------------- the surname count, however it is read
WIKI_COLUMNS = [
    "first_name",
    "last_name",
    "second_name",
    "birth_year",
    "birth_date",
    "full_name",
    "source",
    "is_polityk",
    "wiki_score",
]


def surname_count(teryt) -> pd.DataFrame:
    """How many people bear "kucza" in one voivodeship, as `NamesCountByRegion`."""
    return pd.DataFrame([{"last_name": "kucza", "count": 16.0, "teryt": teryt}])


def match_region(ctx, voivodeships: list[str], names: pd.DataFrame) -> pd.DataFrame:
    """Run the merge over one KRS person, their candidacy and a surname count."""
    candidate = {**pkw_person("jan", "kucza", 1950), "teryt_wojewodztwo": voivodeships}
    return people_merged(
        ctx,
        pd.DataFrame([krs_person("jan", "kucza", "1950-05-01")]),
        pd.DataFrame(columns=WIKI_COLUMNS),
        pd.DataFrame([candidate]),
        no_koryta(),
        names,
        pd.DataFrame([{"first_name": "jan", "p": 0.01}]),
    )


@pytest.mark.parametrize(
    "teryt",
    [
        pytest.param("02", id="as-written"),
        pytest.param(2, id="restored-unpinned"),
        pytest.param("2", id="read-back-after-that-restore"),
    ],
)
def test_the_regional_surname_count_joins_however_the_code_was_read(ctx, teryt):
    """`NamesCountByRegion`'s codes have reached the merge in all three shapes.

    Built, or read through its pin, they are "02". A restore made before the
    pin re-inferred them as integers and wrote those back to disk, so every
    later read of that file gave "2" - which, as text, found no surname count
    in the four voivodeships with a leading zero. One person, priced the same
    all three ways.
    """
    result = match_region(ctx, ["02"], surname_count(teryt))

    assert result["unique_chance"].iloc[0] == pytest.approx(
        unique_probability(0.01, None, False, 16.0)
    )


def test_a_candidacy_with_no_voivodeship_does_not_stop_the_merge(ctx):
    """The crash: "Could not convert string '' to INT64".

    PKW records no voivodeship for 13,343 candidates, most of them on the Sejm
    lists of 1991, 1993 and 1997. With the surname counts restored as integers,
    DuckDB cast PKW's text codes to compare them, and `koryta_scrape_krs_free`
    ended at the first empty one. No voivodeship is no regional count: the
    national default.
    """
    result = match_region(ctx, [""], surname_count(2))

    assert candidacy_years(result) == ["2024"]
    assert result["unique_chance"].iloc[0] == pytest.approx(
        unique_probability(0.01, None, False, None)
    )


class SharedCacheOnly(MockIO):
    """A checkout with nothing on disk and every output in the shared cache.

    Where a fresh workspace, CI or a Cloud Run container starts. A backup is
    read through `FromBytesIO`, as a real restore reads it, and whatever the
    run would write - locally or back to the cache - is kept here instead.
    """

    def __init__(self, backups: dict[str, pd.DataFrame]):
        self.backups = {}
        for filename, frame in backups.items():
            buffer = io.BytesIO()
            frame.to_json(buffer, orient="records", lines=True)
            self.backups[filename] = buffer.getvalue()
        self.written: dict[str, str] = {}
        self.dumper = SimpleNamespace(dump_pandas=lambda: None)

    def read_data(self, fs):
        if isinstance(fs, VersionedBackup) and fs.filename in self.backups:
            return FromBytesIO(io.BytesIO(self.backups[fs.filename]), fs.filename)
        raise FileNotFoundError(fs)

    def get_mtime(self, fs):
        return None

    def write_file(self, fs, content):
        buffer = io.BytesIO()
        content(buffer)
        self.written[fs.filename] = buffer.getvalue().decode()


LINKED = koryta_person("Anna Maria Kowalska", "node-1", rejestrio_id="11")
UNLINKED = koryta_person("Halina Czapla", "node-2")


@pytest.mark.parametrize(
    "pages",
    [
        pytest.param([LINKED, UNLINKED], id="as-the-site-is"),
        pytest.param([LINKED], id="every-page-linked"),
    ],
)
def test_a_cold_run_restores_what_the_merge_reads_and_still_merges(
    ctx, monkeypatch, pages
):
    """`koryta_scrape_krs_free`'s crash, end to end.

    Rebuilding PeopleMerged where none of its inputs is on disk restores all
    six from the shared cache. The surname counts came back with integer codes
    and the merge died on the first candidate with no voivodeship. The site's
    register ids come back as text only while some page has none; once every
    page is linked they would have come back as integers too.
    """
    monkeypatch.setenv("DISABLE_BACKUP", "0")
    kowalska = krs_person("anna", "kowalska", "1962-01-01", second="maria")
    kucza = krs_person("jan", "kucza", "1950-05-01")
    shared = SharedCacheOnly(
        {
            "people_krs_merged": pd.DataFrame(
                [
                    {**kowalska, "rejestrio_id": ["11"]},
                    {**kucza, "rejestrio_id": ["12"]},
                ]
            ),
            "people_wiki_merged": people_wiki_merged(
                ctx, pd.DataFrame([article("Piotr Uszok", "1959-03-02")])
            ),
            "people_pkw_merged": pd.DataFrame(
                [
                    {
                        **pkw_person("anna", "kowalska", 1962, second="maria"),
                        "teryt_wojewodztwo": ["02"],
                    },
                    {**pkw_person("jan", "kucza", 1950), "teryt_wojewodztwo": [""]},
                ]
            ),
            "people_koryta_merged": pd.DataFrame(pages),
            "names_count_by_region": pd.DataFrame(
                [
                    {"last_name": "kowalska", "count": 2079.0, "teryt": "02"},
                    {"last_name": "kucza", "count": 16.0, "teryt": "32"},
                ]
            ),
            "first_name_freq": pd.DataFrame(
                [
                    {"first_name": "anna", "count": 200, "p": 0.02},
                    {"first_name": "jan", "count": 100, "p": 0.01},
                    {"first_name": "maria", "count": 300, "p": 0.03},
                ]
            ),
        }
    )
    cold = Context(
        io=shared,
        rejestr_io=MockRejestrIO(),
        con=duckdb.connect(),
        utils=MockUtils(),
        web=MockWeb(),
        nlp=MockNLP(),
        refresh_policy=ProcessPolicy({"PeopleMerged"}),
    )

    merged = PeopleMerged().read_or_process(cold).set_index("krs_name")

    assert merged.loc["anna kowalska", "unique_chance"] == pytest.approx(
        unique_probability(0.02, 0.03, True, 2079.0)
    )
    assert merged.loc["anna kowalska", "koryta_id"] == "node-1"
    assert merged.loc["jan kucza", "unique_chance"] == pytest.approx(
        unique_probability(0.01, None, False, None)
    )
    # The restore writes the counts back to disk as the cache holds them.
    restored = shared.written["names_count_by_region/names_count_by_region.jsonl"]
    assert '"teryt":"02"' in restored
