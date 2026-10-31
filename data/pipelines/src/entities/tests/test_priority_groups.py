"""A `--priority-group` as the night and the people import read it."""

import argparse

import pytest

from entities.priority_groups import Declared, Group, parse_group, repeated


def test_a_category_with_a_budget_and_a_cap_on_new_pages():
    group = parse_group("skarb-panstwa:100:new=50")

    assert group == Group("skarb-panstwa", 100, 50, text="skarb-panstwa:100:new=50")


def test_a_group_may_create_as_many_pages_as_it_sends_unless_told_otherwise():
    assert parse_group("skarb-panstwa:150").new == 150
    assert parse_group("energetyka:150:new=0").new == 0


@pytest.mark.parametrize(
    "text",
    [
        "skarb-panstwa",
        "skarb-panstwa:",
        ":100",
        "Skarb-Panstwa:100",
        "skarb-panstwa:treasury:100",
        "hutnictwo:100",
        "skarb-panstwa:-5",
        "skarb-panstwa:sto",
        "skarb-panstwa:100:new=150",
        "skarb-panstwa:100:old=5",
        "skarb-panstwa:100:new=",
    ],
)
def test_anything_else_is_refused_with_its_reason(text):
    with pytest.raises(argparse.ArgumentTypeError):
        parse_group(text)


def test_two_groups_of_one_category_are_named():
    groups = [
        parse_group("skarb-panstwa:100"),
        parse_group("energetyka:50"),
        parse_group("skarb-panstwa:10"),
    ]

    assert repeated(groups) == ["skarb-panstwa"]
    assert repeated(groups[:2]) == []


def test_the_two_declaration_groups_are_groups_too():
    drafts = parse_group("oswiadczenia-szkice:200")
    no_page = parse_group("oswiadczenia-bez-strony:200:new=100")

    assert (drafts.of_declarations, no_page.of_declarations) == (True, True)
    assert (drafts.new, no_page.new) == (200, 100)
    assert not parse_group("skarb-panstwa:10").of_declarations
    assert "birth date" in drafts.describe()
    with pytest.raises(argparse.ArgumentTypeError):
        parse_group("oswiadczenia:200")


def test_a_declared_person_is_found_by_their_entry_or_their_page():
    found = Declared(frozenset({"12"}), frozenset({"page"}))

    assert found.covers("12", None)
    assert found.covers(None, "page")
    assert found.covers("99", "page")
    assert not found.covers("99", "other")
    assert not found.covers(None, None)
    assert not Declared().covers("12", "page")
