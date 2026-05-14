import sys
import typing
from unittest.mock import patch

import pytest

from entities.composite import Person
from koryta import setup_context
from pipelines import PeoplePayloads


@pytest.fixture
def ctx():
    return setup_context(False)[0]


@pytest.fixture
def outputs_df(ctx, request):
    # TODO this should be handled by the pipeline migration
    with patch.object(
        sys, "argv", ["koryta", "PeoplePayloads", "--region", request.param]
    ):
        pipeline = PeoplePayloads()
        return pipeline.read_or_process(ctx)


@pytest.fixture
def outputs_list(ctx, request) -> typing.Iterable[Person]:
    with patch.object(
        sys, "argv", ["koryta", "PeoplePayloads", "--region", request.param]
    ):
        pipeline = PeoplePayloads()
        return pipeline.read_or_process_list(ctx)


@pytest.mark.parametrize("outputs_df", [("3061"), ("3063"), ("3064")], indirect=True)
def test_non_empty_elections(outputs_df):
    elections_lengths = outputs_df["elections"].apply(
        lambda x: len(x) if isinstance(x, list) else 0
    )
    some_elections = len(elections_lengths[elections_lengths != 0])

    assert some_elections < len(elections_lengths)
    assert some_elections / len(elections_lengths) > 0.2


@pytest.mark.parametrize("outputs_df", [("3061"), ("3063"), ("3064")], indirect=True)
def test_non_empty_wikipedia(outputs_df):
    has_wiki_entries = outputs_df["wikipedia_url"].apply(
        lambda x: len(x) > 0 if isinstance(x, str) else False
    )
    some_wiki_entries = len(has_wiki_entries[has_wiki_entries])

    assert some_wiki_entries < len(has_wiki_entries)
    assert some_wiki_entries > 0


@pytest.mark.parametrize("outputs_list", [("3061"), ("3063"), ("3064")], indirect=True)
def test_elections_to_parties_ratio(outputs_list):
    has_elections = 0
    has_party = 0
    for payload in outputs_list:
        if payload.elections:
            has_elections += 1
        if payload.parties:
            has_party += 1

    assert has_party > has_elections / 2, (
        f"has_party={has_party}, has_elections={has_elections}"
    )


@pytest.mark.parametrize("outputs_list", [("3061"), ("3063"), ("3064")], indirect=True)
def test_roles_non_empty(outputs_list):
    for person in outputs_list:
        for company in person.companies:
            assert company.role is not None, f"No role for {person.name}"


EXPECTED_PEOPLE: list[Person] = [
    # TODO Person()
]


@pytest.mark.parametrize(
    "expected_person",
    EXPECTED_PEOPLE,
)
def test_expected_output(outputs_df, expected_person):
    pytest.skip("TODO")


EXPECTED_REJESTRIO_ENTRIES = [
    # People from Rada Miasta Kraków
    2585275,
    775848,
    3466426,
    1496535,
    2016431,
    483409,
    3396675,
    1335842,
    839619,
    374707,
    875769,
    1287087,
    2456438,
    1194906,
    56415,
    390304,
    90690,
    259496,
    3192722,
    1257087,
    1802484,
    57996,
    1205347,
    1490826,
    654570,
    752869,
    2769750,
    # People from Sejmik Województwa Małopolskiego
    1336689,
    147600,
    1336689,
    147600,
    1173777,
    2242764,
    4999,
    1281709,
    727228,
    1273316,
    1258289,
    921721,
    702144,
    738890,
    1244292,
    694315,
    1350410,
    1356875,
    1021650,
    1209075,
    72070,
    3076050,
    2301302,
    973977,
]
