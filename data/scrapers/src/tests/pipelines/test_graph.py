import pytest

from analysis.graph import PeopleParties
from main import _setup_context


@pytest.fixture
def ctx():
    return _setup_context(False)[0]


@pytest.fixture
def graph(ctx):
    people_parties = PeopleParties()
    return people_parties.read_or_process(ctx)


def test_party_mapping(graph):
    # Need people mapped
    assert len(graph) > 0, "No scores computed"

    # Find assignments
    # TODO use it instead
    # assigned_parties = graph.idxmax(axis=1)

    # Someone with score > 0.5
    people_with_high_scores = graph[(graph > 0.5).sum(axis=1) >= 1]

    assert len(people_with_high_scores) > 0, (
        "No individuals were mapped to a party with a coefficient >= 0.5"
    )


def test_no_mappings(graph):
    people_with_no_mapping = graph[graph.sum(axis=1) == 0.0]
    print(people_with_no_mapping[:10])
    assert len(people_with_no_mapping) > 0, (
        "No individuals were mapped (i.e., all had zero scores)"
    )
