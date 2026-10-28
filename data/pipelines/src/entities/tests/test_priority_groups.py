"""A `--priority-group` as the night and the people import read it."""

import argparse

import pytest

from entities.priority_groups import (
    CATEGORY,
    KRS,
    TREASURY,
    Group,
    parse_group,
    repeated,
)


def test_the_treasury_s_companies_with_a_budget_and_a_cap_on_new_pages():
    group = parse_group("skarb-panstwa:treasury:100:new=50")

    assert group == Group(
        "skarb-panstwa", TREASURY, 100, 50, text="skarb-panstwa:treasury:100:new=50"
    )


def test_a_group_may_create_as_many_pages_as_it_sends_unless_told_otherwise():
    assert parse_group("skarb-panstwa:treasury:150").new == 150
    assert parse_group("skarb-panstwa:treasury:150:new=0").new == 0


def test_companies_named_by_hand_are_ten_digit_krs_numbers():
    group = parse_group("partia:krs=104717,0000054418:20")

    assert (group.source, group.krs) == (KRS, ("0000104717", "0000054418"))


def test_a_category_names_one_the_site_files_companies_under():
    group = parse_group("energia:category=energetyka:50:new=10")

    assert (group.source, group.category, group.budget, group.new) == (
        CATEGORY,
        "energetyka",
        50,
        10,
    )


@pytest.mark.parametrize(
    "text",
    [
        "skarb-panstwa",
        "skarb-panstwa:treasury",
        "skarb-panstwa:treasury:",
        "Skarb:treasury:100",
        "skarb państwa:treasury:100",
        "skarb:treasury:-5",
        "skarb:treasury:sto",
        "skarb:treasury:100:new=150",
        "skarb:treasury:100:old=5",
        "skarb:treasury:100:new=",
        "skarb:treasury=1:100",
        "skarb:prokuratoria:100",
        "skarb:krs=:100",
        "skarb:krs=0000104717,KRS1:100",
        "skarb:krs=00001047170:100",
        "skarb:category=hutnictwo:100",
    ],
)
def test_anything_else_is_refused_with_its_reason(text):
    with pytest.raises(argparse.ArgumentTypeError):
        parse_group(text)


def test_two_groups_of_one_name_are_named():
    groups = [
        parse_group("skarb:treasury:100"),
        parse_group("energia:category=energetyka:50"),
        parse_group("skarb:krs=104717:10"),
    ]

    assert repeated(groups) == ["skarb"]
    assert repeated(groups[:2]) == []
