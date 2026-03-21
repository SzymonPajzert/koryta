import pytest

from analysis.graph import PeopleParties, search_person
from conductor import setup_context


@pytest.fixture
def ctx():
    return setup_context(False)[0]


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
    numeric_graph = graph.select_dtypes(include="number")
    people_with_high_scores = graph[(numeric_graph > 0.5).sum(axis=1) >= 1]

    assert len(people_with_high_scores) > 0, (
        "No individuals were mapped to a party with a coefficient >= 0.5"
    )


def test_valid_score_range(graph):
    numeric_graph = graph.select_dtypes(include="number")
    # Due to absolute confidence scoring, individual scores are clipped to 1.0
    # but their sum can exceed 1.0
    invalid_scores = graph[(numeric_graph > 1.0).any(axis=1)]
    assert len(invalid_scores) == 0, (
        "Some individuals have a score greater than 1.0, "
        "which should not happen after scaling and clipping"
    )


def test_no_mappings(graph):
    # Depending on whether person_id is an index or a column, handle summation
    numeric_graph = graph.select_dtypes(include="number")
    people_with_no_mapping = graph[numeric_graph.sum(axis=1) == 0.0]
    print(people_with_no_mapping[:10])
    assert len(people_with_no_mapping) > 0, (
        "No individuals were mapped (i.e., all had zero scores)"
    )


def test_search_person(graph):
    matches = search_person("Donald Tusk", graph)
    assert matches is not None
    assert len(matches) >= 1
    assert any("donald" in m and "tusk" in m for m in matches)


def test_has_name_column(graph):
    assert "person_id" in graph.columns
