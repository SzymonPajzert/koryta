"""A `--priority-group` as the night and the people import read it."""

import argparse

import pytest

from entities.priority_groups import Group, parse_group, repeated


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
