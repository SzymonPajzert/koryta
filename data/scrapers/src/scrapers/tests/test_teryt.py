from scrapers.teryt import Teryt


teryt = Teryt(None)  # TODO


def test_powiaty_data_loading():
    """Tests if the powiaty data is loaded correctly."""
    assert "0261" in teryt.powiaty
    assert teryt.powiaty["0261"] == "Jelenia Góra"
    assert "1401" in teryt.powiaty
    # TODO make sure that we have powiat białobrzeski
    assert teryt.powiaty["1401"] == "białobrzeski"


def test_teryt_dictionary():
    """Tests the combined TERYT dictionary."""
    assert teryt.TERYT["0261"] == "Jelenia Góra"  # From powiaty
    assert teryt.TERYT["0661"] == "Biała Podlaska"  # Manually added
    assert teryt.TERYT["3200"] == "ZACHODNIOPOMORSKIE"  # From wojewodztwa


def test_cities_to_teryt_mapping():
    """Tests the mapping from city names to TERYT codes."""
    assert teryt.cities_to_teryt["Jelenia Góra"] == "0261"
    assert teryt.cities_to_teryt["Warszawa"] == "1465"
    assert teryt.cities_to_teryt["Sieradz"] == "1014"  # Manually extended


def test_voj_lower_to_teryt_mapping():
    """Tests the mapping from lowercase voivodeship names to TERYT codes."""
    assert teryt.voj_lower_to_teryt["małopolskie"] == "12"
    assert teryt.voj_lower_to_teryt["lubelskie"] == "06"


def test_parse_teryt():
    """Tests the parse_teryt function."""
    assert teryt.parse_teryt("Małopolskie", "krakowski", "Skawina", "Kraków") == "12"
