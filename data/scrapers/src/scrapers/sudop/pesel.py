"""What a PESEL says about a date of birth, and nothing that is kept.

A PESEL is eleven digits: `YYMMDDPPPQC`. The first six are the date of birth
with the century folded into the month, the next four order people born on the
same day and encode sex in the tenth digit, and the eleventh is a check digit.
So a PESEL yields a date of birth exactly, which is the one thing that tells two
people of the same name apart.

**Nothing here stores one.** `birth_date` is the whole interface: a PESEL goes
in, an ISO date comes out, and the number itself is never written to a payload,
a node or a log. It is a national identification number, and a transparency site
has no business republishing one - which is also what the published analysis of
this data did, stating that the PESELs in its source were deliberately omitted.
A date of birth is not the same thing: it is already public for most people the
site tracks, since PKW publishes a candidate's age.

Where a PESEL could actually come from is a separate question with an
uncomfortable answer - see `README.md`. The official KRS API censors them to
their first digit (`8**********`), so the 19094 api-krs snapshots koryta has
crawled hold none.
"""

import datetime
import re
import typing

#: Added to the month to encode the century, per the 1974 numbering.
#: A month of 01-12 is the 1900s, 21-32 the 2000s, 41-52 the 2100s, 61-72 the
#: 2200s, and 81-92 the 1800s. The 1800s coming last is the part a naive
#: implementation gets wrong, along with reading the offset as a multiplier.
_CENTURY_BY_OFFSET = {0: 1900, 20: 2000, 40: 2100, 60: 2200, 80: 1800}

#: Weights for the check digit, applied to the first ten digits. The check digit
#: is what makes the last digit of the sum, not the sum itself, so a
#: transposition inside the date is caught here rather than surfacing as a
#: plausible birthday in the wrong decade.
_WEIGHTS = (1, 3, 7, 9, 1, 3, 7, 9, 1, 3)


def _digits(pesel: str) -> str:
    return re.sub(r"\D", "", pesel or "")


def is_valid(pesel: str) -> bool:
    """Eleven digits, a real date, and a check digit that agrees.

    All three, because each catches something the others do not: the checksum
    passes for a date that does not exist (month 13 with the right check digit),
    and a valid date says nothing about a mistyped serial.
    """
    value = _digits(pesel)
    if len(value) != 11:
        return False
    if birth_date(value) is None:
        return False

    total = sum(int(d) * w for d, w in zip(value[:10], _WEIGHTS))
    return (10 - total % 10) % 10 == int(value[10])


def birth_date(pesel: str) -> datetime.date | None:
    """The date of birth a PESEL encodes, or None if it encodes no real date.

    Deliberately does not check the checksum: a register can hold a PESEL that
    fails it, and the date it names is still the best evidence available about
    who this is. Callers that need both ask for both.
    """
    value = _digits(pesel)
    if len(value) != 11:
        return None

    year = int(value[0:2])
    month = int(value[2:4])
    day = int(value[4:6])

    # Month 13-20 and 33-40 and so on fall into a band with no century, and
    # land on a month number datetime rejects below. That is the intent: they
    # encode nothing, so there is no date to return.
    offset = (month - 1) // 20 * 20
    century = _CENTURY_BY_OFFSET.get(offset)
    if century is None:
        return None

    try:
        return datetime.date(century + year, month - offset, day)
    except ValueError:
        # Day 31 of a thirty-day month, 29 February in a common year, month 00.
        return None


def sex(pesel: str) -> typing.Literal["F", "M"] | None:
    """From the tenth digit: even is female, odd is male.

    Here because it is a second, weak discriminator when two people share a name
    and a birth year - not because the site records anyone's sex.
    """
    value = _digits(pesel)
    if len(value) != 11:
        return None
    return "M" if int(value[9]) % 2 else "F"


def birth_iso(pesel: str) -> str:
    """The date of birth as `YYYY-MM-DD`, or an empty string.

    The shape `Person.birthDate` is stored in, so that the only thing crossing
    out of this module is already the thing that gets written.
    """
    date = birth_date(pesel)
    return date.isoformat() if date else ""
