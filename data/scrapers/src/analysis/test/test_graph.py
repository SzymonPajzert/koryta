import pandas as pd
import pytest
from unittest.mock import MagicMock, patch
from analysis.graph import calculate_ppr_scores, flatten_parties

def test_flatten_parties():
    data = {
        "first_name": ["John", "Jane"],
        "second_name": ["A", "B"],
        "last_name": ["Doe", "Smith"],
        "elections": [
            [{"party": "PartyA"}, {"party": "PartyB"}],
            [{"party": "PartyA"}]
        ]
    }
    df = pd.DataFrame(data)
    result = flatten_parties(df)
    
    # John A Doe should have 2 entries (PartyA, PartyB)
    # Jane B Smith should have 1 entry (PartyA)
    assert len(result) == 3
    assert "person_id" in result.columns
    assert "subgroup_id" in result.columns
    
    john_rows = result[result["person_id"] == "John A Doe"]
    assert len(john_rows) == 2
    assert set(john_rows["subgroup_id"]) == {"partya", "partyb"}

def test_calculate_ppr_scores():
    # Create mock data
    # Group G1 -> Subgroup S1
    # Person P1 <-> Subgroup S1
    # So G1 influences S1, which influences P1.
    
    df_people_subgroups = pd.DataFrame({
        "person_id": ["P1"],
        "subgroup_id": ["S1"]
    })
    
    df_subgroups_groups = pd.DataFrame({
        "subgroup_id": ["S1"],
        "group_id": ["G1"]
    })
    
    scores = calculate_ppr_scores(df_people_subgroups, df_subgroups_groups, alpha=0.85)
    
    assert isinstance(scores, pd.DataFrame)
    assert "G1" in scores.columns
    assert "P1" in scores.index
    
    # P1 should have a non-zero score for G1
    assert scores.loc["P1", "G1"] > 0
    # Row should be normalized to 1 (since there's only 1 group, it must be 1.0)
    assert scores.loc["P1"].sum() == pytest.approx(1.0)

def test_calculate_ppr_scores_disconnected():
    # Add P3 connected to G1
    df_people_subgroups = pd.DataFrame({
        "person_id": ["P2", "P3"],
        "subgroup_id": ["S2", "S1"]
    })
    
    df_subgroups_groups = pd.DataFrame({
        "subgroup_id": ["S1"], # S1 is not S2
        "group_id": ["G1"]
    })
    
    scores = calculate_ppr_scores(df_people_subgroups, df_subgroups_groups)
    
    print(f"Scores for P2: {scores.loc['P2']}")
    print(f"Scores for P3: {scores.loc['P3']}")
    
    # P3 should have high score (1.0 or close), P2 should have 0
    assert scores.loc["P2", "G1"] == 0.0
    assert scores.loc["P3", "G1"] > 0.9
