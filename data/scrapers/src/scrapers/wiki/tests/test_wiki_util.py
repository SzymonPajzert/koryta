import pytest

from scrapers.wiki.util import parse_date


class TestParseDate:

    # --- Happy Paths: Standard Date Formats ---

    @pytest.mark.parametrize(
        "input_str, expected",
        [
            ("2022-05-20", "2022-05-20"),  # ISO Format
            ("1999-12-31", "1999-12-31"),  # ISO Format end of year
            ("2023", "2023-00-00"),  # Year only
            ("1945", "1945-00-00"),  # Year only
        ],
    )
    def test_iso_and_year_only(self, input_str, expected):
        assert parse_date(input_str) == expected

    @pytest.mark.parametrize(
        "input_str, expected",
        [
            ("12 stycznia 2020", "2020-01-12"),  # Full date (Genitive)
            ("1 maja 1918", "1918-05-01"),  # Single digit day
            ("29 lutego 2024", "2024-02-29"),  # Leap year date
            ("31 grudnia 1999", "1999-12-31"),  # End of year
        ],
    )
    def test_polish_full_date(self, input_str, expected):
        assert parse_date(input_str) == expected

    @pytest.mark.parametrize(
        "input_str, expected",
        [
            ("styczeń 2020", "2020-01-00"),  # Month + Year (Nominative)
            ("maj 1945", "1945-05-00"),  # Short month name
            ("listopad 2011", "2011-11-00"),  # Long month name
        ],
    )
    def test_polish_month_year(self, input_str, expected):
        assert parse_date(input_str) == expected

    # --- Cleanup Logic: Wiki Syntax Removal ---

    @pytest.mark.parametrize(
        "input_str, expected",
        [
            ("[[2020]]", "2020-00-00"),  # Wiki links
            ("[[12 stycznia]] [[2020]]", "2020-01-12"),  # Split links
            ("{{data|2022-01-01}}", "2022-01-01"),  # Template syntax
            ("2020 r.", "2020-00-00"),  # "rok" abbreviation
            ("15 lipca 1410<ref>some_source</ref>", "1410-07-15"),  # References
            ("[[1990]] r.", "1990-00-00"),  # Mixed links and suffix
        ],
    )
    def test_cleanup_mechanisms(self, input_str, expected):
        assert parse_date(input_str) == expected

    # --- Ignored Patterns: Should Return None ---

    @pytest.mark.parametrize(
        "input_str",
        [
            "ok. 1920",  # "ok." (circa)
            "100 n.e",  # "n.e" (AD)
            "przed 1900",  # "przed" (before)
            "1990/1991",  # "/" (ranges)
            "1990 lub 1991",  # "lub" (or)
            "między 1990 a 1995",  # "między" (between)
            "(1920)",  # Parentheses
            "ochrz. 1920",  # Baptism abbreviation
            "",  # Empty string
        ],
    )
    def test_ignored_patterns(self, input_str):
        assert parse_date(input_str) is None

    # --- Edge Cases and Error Handling ---

    def test_invalid_month_name_raises_keyerror_handled(self):
        # Logic: Returns None if month not found in dict (KeyError)
        assert parse_date("12 UnknownMonth 2020") is None
        assert parse_date("UnknownMonth 2020") is None
