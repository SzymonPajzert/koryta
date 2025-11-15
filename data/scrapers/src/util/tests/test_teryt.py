from util.teryt import (
    TERYT,
    cities_to_teryt,
    parse_teryt,
    powiaty,
    voj_lower_to_teryt,
)


def test_powiaty_data_loading():
    """Tests if the powiaty data is loaded correctly."""
    assert "0261" in powiaty
    assert powiaty["0261"] == "Jelenia Góra"
    assert "1401" in powiaty
    # TODO make sure that we have powiat białobrzeski
    assert powiaty["1401"] == "białobrzeski"


def test_teryt_dictionary():
    """Tests the combined TERYT dictionary."""
    assert TERYT["0261"] == "Jelenia Góra"  # From powiaty
    assert TERYT["0661"] == "Biała Podlaska"  # Manually added
    assert TERYT["3200"] == "ZACHODNIOPOMORSKIE"  # From wojewodztwa


def test_cities_to_teryt_mapping():
    """Tests the mapping from city names to TERYT codes."""
    assert cities_to_teryt["Jelenia Góra"] == "0261"
    assert cities_to_teryt["Warszawa"] == "1465"
    assert cities_to_teryt["Sieradz"] == "1014"  # Manually extended


def test_voj_lower_to_teryt_mapping():
    """Tests the mapping from lowercase voivodeship names to TERYT codes."""
    assert voj_lower_to_teryt["małopolskie"] == "12"
    assert voj_lower_to_teryt["lubelskie"] == "06"


def test_parse_teryt():
    """Tests the parse_teryt function."""
    assert parse_teryt("Małopolskie", "krakowski", "Skawina", "Kraków") == "12"
