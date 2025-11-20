"""Tests for the Teryt class."""

import unittest
from unittest.mock import MagicMock

# It's better to have a single, shared test utility module
# For now, we import from another test file, which is not ideal.
# If this were a real project, I would move Mock* classes to a shared location.
try:
    from src.scrapers.tests.test_stores import MockIO, MockFile
except ImportError:
    # A simple fallback if test_stores is not available
    class MockIO:
        def __init__(self):
            self.files = {}
        def read_data(self, fs):
            return self.files.get(str(fs))
    class MockFile:
        def __init__(self, content):
            self.content = content
        def read_zip(self, *args, **kwargs): return self
        def read_file(self, *args, **kwargs): return self.content

from src.scrapers.teryt import Teryt, teryt_data
from src.scrapers.stores import Context


# Sample CSV data for testing, including voivodeships, powiats, and other data
FAKE_TERYT_CSV = """WOJ;POW;GMI;RODZ;NAZWA;NAZWA_DOD;STAN_NA
02;;;;DOLNOŚLĄSKIE;województwo;2025-11-15
02;61;;;Jelenia Góra;miasto na prawach powiatu;2025-11-15
06;;;;LUBELSKIE;województwo;2025-11-15
06;61;;;Biała Podlaska;miasto na prawach powiatu;2025-11-15
10;;;;ŁÓDZKIE;województwo;2025-11-15
12;;;;MAŁOPOLSKIE;województwo;2025-11-15
14;;;;MAZOWIECKIE;województwo;2025-11-15
14;01;;;białobrzeski;powiat;2025-11-15
14;65;;;Warszawa;miasto na prawach powiatu;2025-11-15
30;;;;WIELKOPOLSKIE;województwo;2025-11-15
32;;;;ZACHODNIOPOMORSKIE;województwo;2025-11-15
"""

class TestTeryt(unittest.TestCase):
    """Test cases for the Teryt class."""

    @classmethod
    def setUpClass(cls):
        """Set up a mock context and initialize the Teryt class once for all tests."""
        mock_io = MockIO()
        
        # Create a mock file with fake CSV content
        mock_zip_content = MagicMock()
        mock_zip_content.read_zip.return_value.read_file.return_value = FAKE_TERYT_CSV.encode('utf-8')

        # When read_data is called with the teryt_data source, return our mock file
        mock_io.read_data = MagicMock(return_value=mock_zip_content)

        # Create a context with the mock IO
        mock_context = Context(io=mock_io, rejestr_io=None)

        # Initialize Teryt with the mocked context
        cls.teryt = Teryt(mock_context)

    def test_wojewodztwa_loading(self):
        """Tests if the voivodeship data is loaded correctly."""
        self.assertIn("0200", self.teryt.wojewodztwa)
        self.assertEqual(self.teryt.wojewodztwa["0200"], "DOLNOŚLĄSKIE")
        self.assertEqual(self.teryt.wojewodztwa["1400"], "MAZOWIECKIE")

    def test_powiaty_data_loading(self):
        """Tests if the powiaty data is loaded correctly."""
        self.assertIn("0261", self.teryt.powiaty)
        self.assertEqual(self.teryt.powiaty["0261"], "Jelenia Góra")
        self.assertIn("1401", self.teryt.powiaty)
        self.assertEqual(self.teryt.powiaty["1401"], "białobrzeski")

    def test_teryt_dictionary(self):
        """Tests the combined TERYT dictionary."""
        self.assertEqual(self.teryt.TERYT["0261"], "Jelenia Góra")  # From powiaty
        self.assertEqual(self.teryt.TERYT["0600"], "LUBELSKIE")  # From wojewodztwa

    def test_cities_to_teryt_mapping(self):
        """Tests the mapping from city names to TERYT codes."""
        self.assertEqual(self.teryt.cities_to_teryt["Jelenia Góra"], "0261")
        self.assertEqual(self.teryt.cities_to_teryt["Warszawa"], "1465")
        # Test manually extended mapping
        self.assertEqual(self.teryt.cities_to_teryt["Sieradz"], "1014")

    def test_voj_lower_to_teryt_mapping(self):
        """Tests the mapping from lowercase voivodeship names to TERYT codes."""
        self.assertEqual(self.teryt.voj_lower_to_teryt["małopolskie"], "12")
        self.assertEqual(self.teryt.voj_lower_to_teryt["lubelskie"], "06")

    def test_parse_teryt(self):
        """Tests the parse_teryt function."""
        self.assertEqual(self.teryt.parse_teryt("Małopolskie", "krakowski", "Skawina", "Kraków"), "12")
        self.assertEqual(self.teryt.parse_teryt("LUBELSKIE", "", "", ""), "06")


if __name__ == "__main__":
    unittest.main()