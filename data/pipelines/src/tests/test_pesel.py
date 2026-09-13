import pytest

import util.pesel
from util.pesel import (
    FINGERPRINT_LENGTH,
    PESEL_LENGTH,
    SALT_ENV,
    MissingPeselSalt,
    birth_date_of,
    checksum_valid,
    facts,
    fingerprint,
    looks_like_pesel,
    sex_of,
)


def with_checksum(first_ten: str) -> str:
    """The eleven-digit PESEL whose first ten digits are these.

    Fixtures are written as the ten meaningful digits and closed here, so a
    test reads as "somebody born on this date, of this sex" rather than as a
    magic number -- and so that a test cannot accidentally assert on a PESEL
    that would not pass its own checksum.
    """
    weights = (1, 3, 7, 9, 1, 3, 7, 9, 1, 3)
    total = sum(int(d) * w for d, w in zip(first_ten, weights))
    return first_ten + str((10 - total % 10) % 10)


@pytest.mark.parametrize(
    "first_ten, expected",
    [
        # Month 01-12: the 1900s.
        ("4405231234", "1944-05-23"),
        ("9912311234", "1999-12-31"),
        ("0001011234", "1900-01-01"),
        # Month 21-32: the 2000s. The +20 offset is the rule most easily got
        # wrong, so each century boundary is pinned.
        ("0021011234", "2000-01-01"),
        ("1032151234", "2010-12-15"),
        # Month 41-52: the 2100s. 61-72: the 2200s. 81-92: the 1800s.
        ("5041101234", "2150-01-10"),
        ("0061011234", "2200-01-01"),
        ("8581151234", "1885-01-15"),
    ],
)
def test_birth_date_decodes_the_century_from_the_month_field(first_ten, expected):
    assert birth_date_of(with_checksum(first_ten)) == expected


@pytest.mark.parametrize(
    "first_ten, expected",
    [
        ("4405231234", "F"),  # tenth digit 4, even
        ("4405231231", "M"),  # tenth digit 1, odd
        ("4405231230", "F"),  # tenth digit 0 counts as even
    ],
)
def test_sex_comes_from_the_tenth_digit(first_ten, expected):
    assert sex_of(with_checksum(first_ten)) == expected


def test_checksum_rejects_a_single_wrong_digit():
    good = with_checksum("4405231234")
    assert checksum_valid(good)

    # Flip the last digit: same date, same sex, but the number is not one the
    # register could have issued.
    bad = good[:10] + str((int(good[10]) + 1) % 10)
    assert not checksum_valid(bad)


@pytest.mark.parametrize(
    "value",
    [
        None,
        "",
        "1234567890",  # ten digits -- a NIP, not a PESEL
        "123456789012",  # twelve
        "4405231234X",
        "00202718000000",  # a 14-digit REGON
    ],
)
def test_a_number_of_the_wrong_shape_is_not_a_pesel(value):
    assert not looks_like_pesel(value)
    assert facts(value) is None


@pytest.mark.parametrize(
    "first_ten",
    [
        "4413231234",  # month field 13: neither a month nor a century offset
        "4420231234",  # month field 20: the offset with no month
        "4402301234",  # 30 February
        "4404311234",  # 31 April
    ],
)
def test_an_impossible_date_yields_no_date_rather_than_a_wrong_one(first_ten):
    pesel = with_checksum(first_ten)
    assert looks_like_pesel(pesel)
    assert checksum_valid(pesel)
    assert birth_date_of(pesel) is None
    # The checksum passes, so only the date rule rejects it -- and `facts` is
    # all-or-nothing, so nothing downstream sees a half-decoded person.
    assert facts(pesel) is None


def test_facts_returns_both_fields_together():
    result = facts(with_checksum("7008142345"))
    assert result is not None
    assert result.birth_date == "1970-08-14"
    assert result.sex == "M"
    assert result.birth_year == 1970


def test_facts_rejects_a_number_that_fails_its_checksum():
    good = with_checksum("7008142345")
    bad = good[:10] + str((int(good[10]) + 5) % 10)
    assert birth_date_of(bad) == "1970-08-14"  # the date part still reads
    assert facts(bad) is None  # but it is not trusted


def test_pesel_length_is_the_documented_eleven():
    assert PESEL_LENGTH == 11
    assert len(with_checksum("4405231234")) == PESEL_LENGTH


def test_fingerprint_is_stable_for_a_given_key():
    pesel = with_checksum("7008142345")
    assert fingerprint(pesel, salt="key-one") == fingerprint(pesel, salt="key-one")
    assert len(fingerprint(pesel, salt="key-one")) == FINGERPRINT_LENGTH


def test_fingerprint_separates_people_and_keys():
    one = with_checksum("7008142345")
    two = with_checksum("7008142352")
    assert fingerprint(one, salt="k") != fingerprint(two, salt="k")
    # Rotating the key renumbers everybody, which is why it must not change
    # between runs that are meant to join.
    assert fingerprint(one, salt="k") != fingerprint(one, salt="other")


def test_fingerprint_does_not_leak_the_number():
    pesel = with_checksum("7008142345")
    digest = fingerprint(pesel, salt="k")
    assert pesel not in digest
    assert pesel[:6] not in digest


@pytest.mark.parametrize("missing", [None, ""])
def test_fingerprint_refuses_to_run_unkeyed(missing):
    """An unkeyed digest of a PESEL is reversible, so absence must raise.

    Falling back to an unkeyed hash would make a bad run look exactly like a
    good one, and the output is meant to be publishable.
    """
    with pytest.raises(MissingPeselSalt, match=SALT_ENV):
        fingerprint(with_checksum("7008142345"), salt=missing)


def test_the_key_is_not_read_from_the_environment_here():
    """`util` is kept free of ``os``; supplying the key is the caller's job.

    The env var is *named* in `SALT_ENV` so the error message and whatever
    reads it agree, but this module never looks it up.
    """
    assert SALT_ENV == "KORYTA_PESEL_SALT"
    assert not hasattr(util.pesel, "os")
