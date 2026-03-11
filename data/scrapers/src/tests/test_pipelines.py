from pipelines import graphviz


def test_output():
    o = graphviz()
    assert o != ""
    assert "->" in o
    # Check that PeopleMerged have sources listed
    assert "-> PeopleMerged" in o
