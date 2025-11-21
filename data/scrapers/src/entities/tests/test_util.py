"""Tests for the utility classes and functions."""

import unittest
from entities.util import IgnoredDates, NormalizedParse


class TestUtil(unittest.TestCase):
    """Test cases for utility classes."""

    def test_ignored_dates_creation(self):
        """Tests the creation of an IgnoredDates object."""
        ignored_date = IgnoredDates(date="2023-01-01")
        self.assertEqual(ignored_date.date, "2023-01-01")

    def test_normalized_parse_basic(self):
        """Tests basic URL parsing and normalization."""
        url = "http://www.example.com/path/to/page/"
        parsed = NormalizedParse.parse(url)
        self.assertEqual(parsed.scheme, "http")
        self.assertEqual(parsed.netloc, "www.example.com")
        self.assertEqual(parsed.path, "/path/to/page")
        self.assertEqual(parsed.hostname, "www.example.com")
        self.assertEqual(parsed.hostname_normalized, "example.com")
        self.assertEqual(parsed.domain, "http://www.example.com")

    def test_normalized_parse_https(self):
        """Tests parsing of an HTTPS URL."""
        url = "https://sub.example.co.uk"
        parsed = NormalizedParse.parse(url)
        self.assertEqual(parsed.scheme, "https")
        self.assertEqual(parsed.hostname, "sub.example.co.uk")
        self.assertEqual(parsed.hostname_normalized, "sub.example.co.uk")
        self.assertEqual(parsed.domain, "https://sub.example.co.uk")
        self.assertEqual(parsed.path, "")

    def test_normalized_parse_no_www(self):
        """Tests normalization without a 'www' prefix."""
        url = "http://example.com"
        parsed = NormalizedParse.parse(url)
        self.assertEqual(parsed.hostname_normalized, "example.com")

    def test_normalized_parse_ip_address(self):
        """Tests parsing a URL with an IP address."""
        url = "http://127.0.0.1:8000/some/path"
        parsed = NormalizedParse.parse(url)
        self.assertEqual(parsed.hostname, "127.0.0.1")
        self.assertEqual(parsed.hostname_normalized, "127.0.0.1")
        self.assertEqual(parsed.domain, "http://127.0.0.1")
        self.assertEqual(parsed.netloc, "127.0.0.1:8000")

    def test_normalized_parse_no_scheme(self):
        """Tests parsing a URL without a scheme."""
        url = "example.com/path"
        parsed = NormalizedParse.parse(url)
        self.assertEqual(parsed.scheme, "http")
        self.assertEqual(parsed.hostname_normalized, "example.com")
        self.assertEqual(parsed.domain, "http://example.com")
        self.assertEqual(parsed.path, "/path")

    def test_normalized_parse_empty_path(self):
        """Tests parsing a URL with just a domain."""
        url = "http://example.com"
        parsed = NormalizedParse.parse(url)
        self.assertEqual(parsed.path, "")

    def test_normalized_parse_type_error(self):
        """Tests that a TypeError is raised for non-string input."""
        with self.assertRaises(TypeError):
            NormalizedParse.parse(123)  # type: ignore


if __name__ == "__main__":
    unittest.main()
