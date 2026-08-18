"""The PESEL date derivation, including the bands a naive one gets wrong."""

import datetime

import pytest

from scrapers.sudop import pesel


@pytest.mark.parametrize(
    "value,expected",
    [
        # The century is folded into the month, and the 1800s band is last
        # rather than first - which is the part that gets implemented backwards.
        ("02070803628", "1902-07-08"),
        ("02270803628", "2002-07-08"),
        ("02470803628", "2102-07-08"),
        ("02670803628", "2202-07-08"),
        ("02870803628", "1802-07-08"),
        # Separators as people write them.
        ("020708-036-28", "1902-07-08"),
    ],
)
def test_reads_the_century_out_of_the_month(value, expected):
    assert pesel.birth_iso(value) == expected


@pytest.mark.parametrize(
    "value",
    [
        "02130803628",  # month 13: inside no century band
        "02330803628",  # month 33: same, one band up
        "02023003628",  # 30 February
        "02043103628",  # 31 April
        "02000803628",  # month 00
        "1234567890",  # ten digits
        "123456789012",  # twelve
        "",
        "not a pesel",
    ],
)
def test_refuses_what_encodes_no_date(value):
    assert pesel.birth_date(value) is None
    assert pesel.birth_iso(value) == ""
    assert not pesel.is_valid(value)


def test_the_twenty_ninth_of_february_depends_on_the_century_band():
    # Year 00 either way, and the same day. 2000 was a leap year and 1900 was
    # not - a century is only one if it divides by 400 - so the month band is
    # what decides whether this is a date at all. A check that read the year
    # without the band, or that tested leapness by fours, gets exactly one of
    # these two wrong.
    assert pesel.birth_date("00222900000") == datetime.date(2000, 2, 29)
    assert pesel.birth_date("00022900000") is None


def test_checksum():
    assert pesel.is_valid("44051401359")
    # Any single digit changed fails, because the weights are coprime with ten
    # in the positions that matter.
    assert not pesel.is_valid("44051401358")
    assert not pesel.is_valid("44051401459")


def test_sex_is_the_tenth_digit():
    assert pesel.sex("44051401359") == "M"
    assert pesel.sex("44051401269") == "F"
    assert pesel.sex("123") is None


def test_nothing_returns_the_number_itself():
    # The whole point of the module: what crosses out of it is a date.
    exported = {name for name in dir(pesel) if not name.startswith("_")} - {
        "datetime",
        "re",
        "typing",
    }
    assert exported == {"birth_date", "birth_iso", "is_valid", "sex"}
