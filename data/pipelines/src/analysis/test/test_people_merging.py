"""Which Wikipedia biography, if any, the KRS↔PKW join attaches to a person."""

import duckdb
import pandas as pd
import pytest

from analysis.people import people_merged
from analysis.people_wiki_merged import people_wiki_merged
from scrapers.stores import Context, ProcessPolicy
from scrapers.test_tree import MockIO, MockNLP, MockRejestrIO, MockUtils, MockWeb


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


def article(name: str, birth_iso8601: str, lead: str | None = None) -> dict:
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
        "lead": lead if lead is not None else f"{name} – polski polityk.",
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


#: `wiki_people` as `people_wiki_merged` leaves it. Spelled out rather than
#: derived, because an empty frame carries no columns of its own and duckdb
#: binds `krs_pkw_wiki` against these names - a column missing here is a binder
#: error in every test that leaves Wikipedia out.
WIKI_COLUMNS = [
    "first_name",
    "last_name",
    "birth_year",
    "birth_date",
    "full_name",
    "source",
    "is_polityk",
    "wiki_score",
    "wiki_lead",
]


def no_wiki() -> pd.DataFrame:
    """No biographies at all, for the joins that are not about Wikipedia."""
    return pd.DataFrame(columns=WIKI_COLUMNS)


def match_pkw(ctx, krs: list[dict], pkw: list[dict]) -> pd.DataFrame:
    """Run the merge over nothing but KRS and PKW.

    The mirror of `match`: Wikipedia is left empty because it joins on its own
    terms and would only add noise to a question about candidacies.
    """
    return people_merged(
        ctx,
        pd.DataFrame(krs),
        no_wiki(),
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


def test_the_lead_and_the_articles_own_birth_date_reach_the_merged_row(ctx):
    """What `PeopleWikiNotes` reads, carried through two merges to get here.

    `wiki_birth_date` is kept beside the register's `birth_date` rather than
    folded into it, because which of the two branches above matched is the
    whole gate on a wiki note: an article giving only a year matched on the
    year, and that is not evidence enough to paste its prose onto a page.
    """
    result = match(
        ctx,
        [krs_person("jan", "pamuła", "1951-06-24")],
        [article("Jan Pamuła", "1951-06-24", lead="Jan Pamuła – polski polityk.")],
    )

    assert list(result["wiki_lead"]) == ["Jan Pamuła – polski polityk."]
    assert list(result["wiki_birth_date"]) == ["1951-06-24"]
    assert list(result["birth_date"]) == ["1951-06-24"]


def test_a_year_only_biography_leaves_no_article_birth_date_behind(ctx):
    # The year-only branch is exactly the one a note must not be written from,
    # and this is what tells it apart: the article named no day, so there is no
    # day to agree with.
    result = match(
        ctx,
        [krs_person("jan", "pamuła", "1951-06-24")],
        [article("Jan Pamuła", "1951-00-00")],
    )

    assert list(result["wiki_name"]) == ["Jan Pamuła"]
    assert result["wiki_birth_date"].isna().all()


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


def match_koryta(ctx, krs: list[dict], koryta: list[dict]) -> pd.DataFrame:
    """Run the merge over KRS and the site's own pages."""
    return people_merged(
        ctx,
        pd.DataFrame(krs),
        no_wiki(),
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
