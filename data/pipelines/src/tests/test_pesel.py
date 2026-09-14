import pytest

import util.pesel
from util.pesel import (
    PESEL_LENGTH,
    PersonIds,
    birth_date_of,
    checksum_valid,
    facts,
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


def test_one_pesel_gets_one_number_however_often_it_is_seen():
    """The point of the registry: one human, one number, across documents."""
    ids = PersonIds()
    one = with_checksum("7008142345")
    two = with_checksum("7008142352")
    assert ids.of(one) == 1
    assert ids.of(two) == 2
    assert ids.of(one) == 1
    assert len(ids) == 2


@pytest.mark.parametrize("missing", [None, ""])
def test_no_pesel_gets_no_number(missing):
    ids = PersonIds()
    assert ids.of(missing) is None
    assert len(ids) == 0


def test_numbers_are_local_to_the_registry():
    """Two runs are two registries, so the numbers mean nothing across them.

    Pinned because the field looks like a stable id and is not: joining one
    artifact to another on it would silently pair unrelated people. The
    docstring on `PersonIds` says why a stable one would have to be keyed, and
    why a key that ships near the data protects nothing.
    """
    pesel = with_checksum("7008142345")
    first, second = PersonIds(), PersonIds()
    second.of(with_checksum("7008142352"))
    assert first.of(pesel) == 1
    assert second.of(pesel) == 2


def test_nothing_derived_from_the_number_can_reach_the_output():
    """A counter has no preimage -- that is the whole security argument.

    With `birth_date` and `sex` in the same row, seven of the eleven digits are
    fixed and the eleventh is a check digit, so only 5,000 PESELs are possible
    and any published digest is recoverable in milliseconds. An integer
    assigned by arrival order carries none of that.
    """
    ids = PersonIds()
    pesel = with_checksum("7008142345")
    seq = ids.of(pesel)
    assert isinstance(seq, int)
    # No digit of the number survives into what is written out, so there is
    # nothing to enumerate against.
    assert pesel not in str(seq)
    assert pesel[:6] not in str(seq)


def test_the_module_never_reads_the_environment():
    """`util` is kept free of ``os``; nothing here needs configuring."""
    assert not hasattr(util.pesel, "os")


def test_a_fresh_registry_is_truthy():
    """`__len__` alone would make an empty one falsy.

    Callers spell "was a registry passed?" as ``if person_ids``, so a falsy
    empty registry assigns no numbers until something else has been seen --
    which is nothing, for a run whose first document has no PESEL in it.
    """
    assert PersonIds()
    assert len(PersonIds()) == 0
