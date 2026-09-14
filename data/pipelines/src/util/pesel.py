"""What a PESEL says about the person it identifies.

A PESEL is not an opaque key. Its first six digits are the holder's date of
birth, its tenth is their sex, and its eleventh is a check digit over the other
ten. That is what makes it useful here: KRS publishes the PESEL of everybody it
registers as a board member, and the pipeline's person table is keyed on
``birth_date`` -- so a PESEL read out of the register turns into the join key
the rest of the pipeline already uses, without the PESEL itself going anywhere
near the site.

The number carries nothing else. It is not a hash of a name and it says nothing
about place of birth; digits 7-9 are a within-day serial and are the reason two
people born on the same day do not collide.

**Which century.** The month field is offset by 20 per century, so a birth month
of ``41`` means May and means the 2100s. That is the one rule here worth stating
twice, because reading the field as a plain month silently dates everybody born
from 2000 onwards to the 1900s -- and it fails *quietly*, because ``21`` through
``32`` are all valid-looking day-of-month values for a reader that got the two
fields the wrong way round.

Output types are chosen to match what they are compared against, both measured
over 3,766 cached ``rejestr.io`` person entries: `sex` is ``"M"``/``"F"``
because ``tozsamosc.plec`` is (2,685 M, 936 F, 145 absent), and `birth_date` is
an ISO ``YYYY-MM-DD`` string because ``tozsamosc.data_urodzenia`` is -- all
3,621 of the populated ones. Returning a `datetime.date` would make every
comparison site convert.
"""

from dataclasses import dataclass
from datetime import date

#: A PESEL is exactly this many digits. Anything else is not a short PESEL, it
#: is a different kind of thing -- usually a REGON (9 or 14) or a NIP (10).
PESEL_LENGTH = 11

#: Weights for the check digit, applied to the first ten digits.
_CHECKSUM_WEIGHTS = (1, 3, 7, 9, 1, 3, 7, 9, 1, 3)

#: Century by the multiple of 20 added to the month field. Ordered as the
#: register uses them: the 1800s sort last because they are encoded last, not
#: because they are least likely -- a 19th-century birth date is a data error
#: rather than a centenarian, and worth being able to spot as one.
_CENTURY_BY_OFFSET = {0: 1900, 1: 2000, 2: 2100, 3: 2200, 4: 1800}


@dataclass(frozen=True)
class PeselFacts:
    """The birth date and sex a valid PESEL encodes."""

    #: ISO ``YYYY-MM-DD``, to match ``KRS.birth_date``.
    birth_date: str
    #: ``"M"`` or ``"F"``, to match ``KRS.sex``.
    sex: str

    @property
    def birth_year(self) -> int:
        return int(self.birth_date[:4])


def looks_like_pesel(value: str | None) -> bool:
    """Whether this is eleven digits, before asking whether it is a real one.

    Kept apart from `checksum_valid` so a caller can tell "the parser picked up
    the wrong field" from "the register holds a number that does not check
    out". The first is a bug here; the second happens in the register and is
    not ours to fix.
    """
    if value is None:
        return False
    return len(value) == PESEL_LENGTH and value.isdigit()


def checksum_valid(pesel: str) -> bool:
    """Whether the eleventh digit agrees with the other ten."""
    if not looks_like_pesel(pesel):
        return False
    total = sum(int(digit) * weight for digit, weight in zip(pesel, _CHECKSUM_WEIGHTS))
    return (10 - total % 10) % 10 == int(pesel[10])


def sex_of(pesel: str) -> str | None:
    """``"M"`` or ``"F"`` from the tenth digit -- odd is male, even is female."""
    if not looks_like_pesel(pesel):
        return None
    return "M" if int(pesel[9]) % 2 else "F"


def birth_date_of(pesel: str) -> str | None:
    """The ISO birth date the first six digits encode, or None if they cannot.

    Returns None rather than raising for a number whose date part is not a real
    date -- month 13, or 31 February. Those exist in the wild and a single bad
    row must not stop a parse over thousands of people; the caller decides
    whether to count or discard them.
    """
    if not looks_like_pesel(pesel):
        return None

    year_in_century = int(pesel[0:2])
    month_field = int(pesel[2:4])
    day = int(pesel[4:6])

    century = _CENTURY_BY_OFFSET.get(month_field // 20)
    month = month_field % 20
    if century is None or not 1 <= month <= 12:
        return None

    try:
        return date(century + year_in_century, month, day).isoformat()
    except ValueError:
        # A real encoding of an impossible day, e.g. the 31st of a 30-day
        # month. The rest of the number may still be meaningful, but the date
        # is not, and guessing which digit is wrong would invent a person.
        return None


def facts(pesel: str | None) -> PeselFacts | None:
    """Everything the number says, or None unless all of it holds.

    All-or-nothing on purpose. A PESEL that fails its checksum has a digit
    wrong somewhere, and there is no way to know it is not one of the six that
    make up the birth date -- so a caller that got a `PeselFacts` back can use
    the date without also having to check how much to trust it.
    """
    if pesel is None or not checksum_valid(pesel):
        return None
    birth_date = birth_date_of(pesel)
    sex = sex_of(pesel)
    if birth_date is None or sex is None:
        return None
    return PeselFacts(birth_date=birth_date, sex=sex)


class PersonIds:
    """A run-local number per distinct PESEL, and nothing else about it.

    This is what stands in for the number in the output, and it is deliberately
    **not** stable between runs.

    A stable identifier would have to be a keyed hash, which means a key that
    has to be kept, kept secret, and kept the same forever -- and a key that
    ships anywhere near the data protects nothing at all. Measured against the
    artifact this pipeline writes: the row already carries ``birth_date`` and
    ``sex``, which fix seven of the eleven digits, and the eleventh is a check
    digit over the other ten. That leaves 5,000 candidates, so an unkeyed
    digest of a PESEL is recoverable in about 10 ms per person -- 62 seconds
    for a 6,188-row artifact.

    A counter has no such preimage: it is assigned in first-seen order and says
    only "these rows are the same human". Over the 2026-09-13 artifact that is
    worth 11 people whom (first name, surname, birth date) splits -- married
    names, a double-barrelled surname recorded both ways, two typed-wrong
    surnames -- and one pair of strangers who share a name and a birthday that
    it keeps apart.

    What it cannot do is join one artifact to the next. Rebuild instead: the
    odpisy are kept, so a rebuild is a re-parse rather than a re-crawl.
    """

    def __init__(self) -> None:
        self._seen: dict[str, int] = {}

    def of(self, pesel: str | None) -> int | None:
        """The number for this PESEL, assigning the next one if it is new."""
        if not pesel:
            return None
        return self._seen.setdefault(pesel, len(self._seen) + 1)

    def __len__(self) -> int:
        """How many distinct people have been seen."""
        return len(self._seen)

    def __bool__(self) -> bool:
        """Always true. A registry that has seen nobody is still a registry.

        Without this, `__len__` makes a fresh one falsy, and every caller
        spells the "was one passed?" check as ``if person_ids`` -- which then
        silently assigns no numbers at all for the first document, and for
        every document if none of them holds a PESEL.
        """
        return True
