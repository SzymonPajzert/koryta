
from unittest.mock import MagicMock

import pandas as pd

from analysis.utils import EXPECTED_SCORE, filter_local_good


def test_filter_local_good_dynamic_teryt():
    # Mock Teryt object
    mock_teryt = MagicMock()
    mock_teryt.cities_to_teryt = {
        "Łódź": "1061011",
        "Zgierz": "1020031",
        "Warszawa": "1465011",
    }

    # Mock Companies DataFrame
    companies_data = [
        {"krs": "0000000001", "city": "Łódź"},
        {"krs": "0000000002", "city": "Zgierz"},
        {"krs": "0000000003", "city": "Warszawa"},
        {"krs": "0000000004", "city": "Unknown"},
    ]
    companies_df = pd.DataFrame(companies_data)

    # Mock People DataFrame
    people_data = [
        {
            "krs_name": "Person Lodz",
            "pkw_name": None,
            "wiki_name": "Wiki",
            "overall_score": EXPECTED_SCORE + 5,
            "first_employed": pd.Timestamp("2024-01-01"),
            "last_employed": pd.Timestamp("2025-01-01"),
            "employment": [{"employed_krs": "0000000001"}], # Works in Łódź
            "teryt_wojewodztwo": [],
            "unique_chance": 0.0,
        },
        {
            "krs_name": "Person Zgierz",
            "pkw_name": None,
            "wiki_name": "Wiki Zgierz",
            "overall_score": EXPECTED_SCORE + 5,
            "first_employed": pd.Timestamp("2024-01-01"),
            "last_employed": pd.Timestamp("2025-01-01"),
            "employment": [{"employed_krs": "0000000002"}], # Works in Zgierz
            "teryt_wojewodztwo": [],
            "unique_chance": 0.0,
        },
        {
            "krs_name": "Person Warszawa",
            "pkw_name": None,
            "wiki_name": "Wiki",
            "overall_score": EXPECTED_SCORE + 5,
            "first_employed": pd.Timestamp("2024-01-01"),
            "last_employed": pd.Timestamp("2025-01-01"),
            "employment": [{"employed_krs": "0000000003"}], # Works in Warszawa
            "teryt_wojewodztwo": [],
            "unique_chance": 0.0,
        },
    ]
    people_df = pd.DataFrame(people_data)

    # Test 1: Filter for Łódzkie (10) - should include Łódź and Zgierz
    result_10 = filter_local_good(people_df, "10", companies_df, mock_teryt)
    assert len(result_10) == 2
    assert "Person Lodz" in result_10["krs_name"].values
    assert "Person Zgierz" in result_10["krs_name"].values
    assert "Person Warszawa" not in result_10["krs_name"].values

    # Test 2: Filter for Powiat m. Łódź (1061) - should include only Łódź
    result_1061 = filter_local_good(people_df, "1061", companies_df, mock_teryt)
    assert len(result_1061) == 1
    assert "Person Lodz" in result_1061["krs_name"].values

    # Test 3: Filter for Mazowieckie (14) - should include only Warszawa
    result_14 = filter_local_good(people_df, "14", companies_df, mock_teryt)
    assert len(result_14) == 1
    assert "Person Warszawa" in result_14["krs_name"].values

def test_filter_local_good_region_candidacy():
     # Mock Teryt object
    mock_teryt = MagicMock()
    mock_teryt.cities_to_teryt = {}

    # Mock Companies DataFrame
    companies_df = pd.DataFrame([])

    # Mock People DataFrame
    people_data = [
        {
            "krs_name": "Candidate Lodz",
            "pkw_name": None,
            "wiki_name": "Wiki",
            "overall_score": EXPECTED_SCORE + 5,
            "first_employed": pd.Timestamp("2024-01-01"),
            "last_employed": pd.Timestamp("2025-01-01"),
            "employment": [],
            "teryt_wojewodztwo": ["1061011"], # Candidate in Łódź
            "unique_chance": 0.0,
        },
        {
             "krs_name": "Candidate Warsaw",
            "pkw_name": None,
            "wiki_name": "Wiki",
            "overall_score": EXPECTED_SCORE + 5,
            "first_employed": pd.Timestamp("2024-01-01"),
            "last_employed": pd.Timestamp("2025-01-01"),
            "employment": [],
            "teryt_wojewodztwo": ["1465011"], # Candidate in Warsaw
            "unique_chance": 0.0,
        }
    ]
    people_df = pd.DataFrame(people_data)

    # Test 1: Filter for Łódzkie (10)
    result_10 = filter_local_good(people_df, "10", companies_df, mock_teryt)
    assert len(result_10) == 1
    assert "Candidate Lodz" in result_10["krs_name"].values

    # Test 2: Filter for Powiat m. Łódź (1061)
    result_1061 = filter_local_good(people_df, "1061", companies_df, mock_teryt)
    assert len(result_1061) == 1
    assert "Candidate Lodz" in result_1061["krs_name"].values
