"""That a person is only matched on name *and* full birth date.

The rule under test is a negative one: name alone must never produce a match,
however tempting the population makes it. Measured on the same day, name-only
matching was 0% precise against sole traders and 85.9% against KRS board
members -- the difference being that koryta's person corpus is largely built
from KRS board data, so a board member is drawn from the same population. Even
85.9% is one wrong human in seven.
"""

import json

import pytest

from scrapers.krs.odpis_pdf import OdpisPerson
from scrapers.krs.people_match import (
    fold_name,
    load_index,
    match_person,
    split_name,
    summarise,
)


def merged_row(first, last, birth_date, koryta_id=None, second=None):
    return {
        "base_first_name": first,
        "base_last_name": last,
        "birth_date": birth_date,
        "second_name": second,
        "koryta_id": koryta_id,
        "rejestrio_id": ["123"],
        "full_name": [f"{first.title()} {last.title()}"],
    }


@pytest.fixture
def index(tmp_path):
    path = tmp_path / "people_merged.jsonl"
    path.write_text(
        "\n".join(
            json.dumps(row, ensure_ascii=False)
            for row in [
                merged_row("paweł", "nowak", "1978-10-11", koryta_id="k1"),
                merged_row("paweł", "nowak", "1978-11-30"),
                merged_row("halina", "wiśniewska", "1948-05-16"),
                merged_row("jan", "kowalski", "1960-01-01"),
                merged_row("jan", "kowalski", "1960-01-01"),
            ]
        ),
        encoding="utf-8",
    )
    return load_index(path)


def person(given, surname, birth_date, sex="M"):
    return OdpisPerson(
        krs="0000000001",
        dzial=2,
        rubryka="Organ nadzoru",
        role="nadzor",
        organ_name="RADA NADZORCZA",
        organ="rada_nadzorcza",
        position=1,
        surname=surname,
        given_names=given,
        funkcja=None,
        birth_date=birth_date,
        sex=sex,
        person_seq=None,
        has_pesel=birth_date is not None,
        is_company=False,
        entry_added="1",
        entry_removed=None,
    )


def test_name_and_date_together_match(index):
    result = match_person(person("PAWEŁ", "NOWAK", "1978-10-11"), index)
    assert result.verdict == "matched"
    assert result.matched is not None
    assert result.matched.koryta_id == "k1"


def test_the_full_date_separates_two_people_a_year_would_merge(index):
    """PAWEŁ NOWAK born 1978-10-11 against one born 1978-11-30.

    Same name, same birth year, seven weeks apart. Name-plus-year would merge
    them; only the full date keeps them apart, which is why the year is not
    used as a fallback anywhere here.
    """
    first = match_person(person("PAWEŁ", "NOWAK", "1978-10-11"), index)
    second = match_person(person("PAWEŁ", "NOWAK", "1978-11-30"), index)
    assert first.verdict == "matched"
    assert second.verdict == "matched"
    assert first.matched != second.matched
    assert first.matched.koryta_id == "k1"
    assert second.matched.koryta_id is None


def test_a_name_in_the_corpus_with_a_different_date_is_refuted_not_matched(index):
    """The useful negative: the pair a name-only rule would have merged."""
    result = match_person(person("PAWEŁ", "NOWAK", "1955-03-03"), index)
    assert result.verdict == "refuted"
    assert result.matched is None
    assert len(result.candidates) == 2


def test_a_name_not_in_the_corpus_is_new(index):
    result = match_person(person("ZENOBIA", "PRZYBYSZEWSKA", "1970-01-01"), index)
    assert result.verdict == "new"
    assert result.candidates == ()


def test_two_people_of_the_same_name_and_day_are_ambiguous_not_guessed(index):
    result = match_person(person("JAN", "KOWALSKI", "1960-01-01"), index)
    assert result.verdict == "ambiguous"
    assert result.matched is None
    assert len(result.candidates) == 2


def test_a_person_with_no_birth_date_is_never_matched(index):
    """An `osoba-bez-pesel` equivalent: a name and nothing to confirm it."""
    result = match_person(person("PAWEŁ", "NOWAK", None), index)
    assert result.verdict == "no_birth_date"
    assert result.matched is None
    assert result.candidates == ()


def test_matching_folds_case_and_diacritics_on_both_sides(index):
    """PeopleMerged is lowercased but keeps diacritics; an odpis shouts."""
    assert fold_name("WIŚNIEWSKA") == fold_name("wiśniewska") == "wisniewska"
    assert fold_name("MŁODZIK") == "mlodzik"
    result = match_person(person("HALINA", "WIŚNIEWSKA", "1948-05-16"), index)
    assert result.verdict == "matched"


def test_only_the_first_given_name_is_part_of_the_key():
    """`Imiona` holds every given name; PeopleMerged keys on the first."""
    assert split_name(person("TADEUSZ WAWRZYNIEC", "FREISLER", "1953-08-10")) == (
        "TADEUSZ",
        "FREISLER",
    )


def test_a_middle_name_does_not_prevent_a_match(index):
    result = match_person(person("PAWEŁ JAN", "NOWAK", "1978-10-11"), index)
    assert result.verdict == "matched"


def test_summarise_reports_the_measured_precision_of_the_cheaper_rule(index):
    results = [
        match_person(person("PAWEŁ", "NOWAK", "1978-10-11"), index),
        match_person(person("HALINA", "WIŚNIEWSKA", "1948-05-16"), index),
        match_person(person("PAWEŁ", "NOWAK", "1955-03-03"), index),
    ]
    report = summarise(results)
    assert "matched" in report
    assert "2 agreed, 1 refuted" in report
    assert "66.7%" in report
