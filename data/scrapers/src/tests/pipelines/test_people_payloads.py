import sys
import typing
from unittest.mock import patch

import pytest

from entities.composite import Person
from main import setup_context
from pipelines import PeoplePayloads


@pytest.fixture
def ctx():
    return setup_context(False)[0]


@pytest.fixture
def outputs_df(ctx):
    # TODO this should be handled by the pipeline migration
    with patch.object(sys, "argv", ["koryta", "PeoplePayloads", "--region", "3061"]):
        pipeline = PeoplePayloads()
        return pipeline.read_or_process(ctx)


@pytest.fixture
def outputs_list(ctx) -> typing.Iterable[Person]:
    with patch.object(sys, "argv", ["koryta", "PeoplePayloads", "--region", "3061"]):
        pipeline = PeoplePayloads()
        return pipeline.read_or_process_list(ctx)


def test_non_empty_elections(outputs_df):
    elections_lengths = outputs_df["elections"].apply(
        lambda x: len(x) if isinstance(x, list) else 0
    )
    some_elections = len(elections_lengths[elections_lengths != 0])

    assert some_elections < len(elections_lengths)
    assert some_elections / len(elections_lengths) > 0.2


def test_non_empty_wikipedia(outputs_df):
    has_wiki_entries = outputs_df["wikipedia_url"].apply(
        lambda x: len(x) > 0 if isinstance(x, str) else False
    )
    some_wiki_entries = len(has_wiki_entries[has_wiki_entries])

    assert some_wiki_entries < len(has_wiki_entries)
    assert some_wiki_entries > 0


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
