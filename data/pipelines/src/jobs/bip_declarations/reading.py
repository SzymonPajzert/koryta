"""Reading what a declaration says: its dates, its name, and PKW's windows.

Ported from the 2026-10-23 prototype (`~/.cache/koryta/bip-birthdates-2026-10-23`,
`extract.py` and `cut.py`), where it read 3,360 declarations' text and 1,070
scans' crops. Text goes through `fold` first, so every pattern here is lower
case and without diacritics, and an index into the folded text is an index into
the original.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import date, timedelta
from functools import cache

FOLD = str.maketrans("ąćęłńóśźżĄĆĘŁŃÓŚŹŻ", "acelnoszzACELNOSZZ")


@cache
def _fold_char(char: str) -> str:
    folded = char.translate(FOLD).lower()
    if len(folded) == 1 and folded.isascii():
        return folded
    base = unicodedata.normalize("NFKD", char)[:1].translate(FOLD).lower()
    return base if len(base) == 1 else "?"


def fold(text: str) -> str:
    """Lowercase, diacritics off, one character per character (indices line up)."""
    if text.isascii():
        return text.lower()
    return "".join(_fold_char(char) for char in text)


# -- birth dates --------------------------------------------------------------

#: The printed label in front of the date, as OCR reads it: "r0dzon", "rodz on".
LABEL = re.compile(r"r\s?[o0]\s?d\s?z\s?[o0]\s?n")
#: The same label in a text layer, with its "(a)", "/a" or "a" ending.
BORN = re.compile(
    r"u\s?r\s?o\s?d\s?z\s?o\s?n\s?[yae]\s?(?:\(\s?[a-z]\s?\)|/\s?[a-z]\b|[a-z]{0,2})?\s*[:.]?"
)
#: Where the date's field ends in a text layer: the next printed label.
AFTER_BORN = re.compile(r"\(\s*(?:imi|miejsc|nazw)|zatrudnion|po\s*zapoznaniu")
# Dates of the acts the form quotes, which a window running past its label reads.
LAW_DATES = {date(1990, 3, 8), date(1998, 6, 5), date(1997, 8, 21)}
MONTHS = {
    "stycz": 1,
    "lut": 2,
    "marz": 3,
    "marc": 3,
    "kwiet": 4,
    "kwiec": 4,
    "maj": 5,
    "czerw": 6,
    "lip": 7,
    "sierp": 8,
    "wrzes": 9,
    "pazdz": 10,
    "listop": 11,
    "grud": 12,
}
ROMAN = {
    "i": 1,
    "ii": 2,
    "iii": 3,
    "iv": 4,
    "v": 5,
    "vi": 6,
    "vii": 7,
    "viii": 8,
    "ix": 9,
    "x": 10,
    "xi": 11,
    "xii": 12,
}
NUMERIC = re.compile(
    r"(?<!\d)(\d{1,2})\s?[.\-/,]\s?(\d{1,2})\s?[.\-/,]\s?((?:19|20)\d{2})(?!\d)"
)
ISO = re.compile(
    r"(?<!\d)((?:19|20)\d{2})\s?[.\-/]\s?(\d{1,2})\s?[.\-/]\s?(\d{1,2})(?!\d)"
)
NAMED = re.compile(r"(?<!\d)(\d{1,2})\s?\.?\s?([a-z]{3,12})\s?((?:19|20)\d{2})(?!\d)")
ROMAN_DATE = re.compile(
    r"(?<!\d)(\d{1,2})\s?[.\-/ ]?\s?(x{0,1}i{1,3}|iv|vi{0,3}|ix|x|xi|xii)"
    r"\s?[.\-/ ]\s?((?:19|20)\d{2})(?!\d)"
)
#: "02 .11 1962 r": a space where the second dot should be.
SPACED = re.compile(r"(?<!\d)(\d{1,2})\s?[.\-/]\s?(\d{1,2})\s+((?:19|20)\d{2})(?!\d)")
#: Letters OCR reads in place of digits, next to digits.
DIGITS_FOR = str.maketrans(
    {
        "o": "0",
        "l": "1",
        "i": "1",
        "|": "1",
        "g": "9",
        "s": "5",
        "b": "8",
        "z": "2",
        "q": "9",
    }
)
MISREAD_DIGIT = re.compile(r"(?<=[\d.\-/ ])[olizgsbq|]|[olizgsbq|](?=[\d.\-/])")
#: Who sits on a council was born in these years; anything else is another date.
OLDEST, YOUNGEST = 1920, 2008


def _valid(year: int, month: int | None, day: int) -> date | None:
    if month is None or not OLDEST <= year <= YOUNGEST:
        return None
    try:
        return date(year, month, day)
    except ValueError:
        return None


def parse_date(window: str) -> date | None:
    """The first birth date in the folded window, written any way people write one."""
    for match in NUMERIC.finditer(window):
        a, b, c = match.groups()
        found = _valid(int(c), int(b), int(a))
        if found and found not in LAW_DATES:
            return found
    for match in ISO.finditer(window):
        a, b, c = match.groups()
        found = _valid(int(a), int(b), int(c))
        if found and found not in LAW_DATES:
            return found
    for match in NAMED.finditer(window):
        a, b, c = match.groups()
        month = next((v for k, v in MONTHS.items() if b.startswith(k)), None)
        found = _valid(int(c), month, int(a))
        if found and found not in LAW_DATES:
            return found
    for match in ROMAN_DATE.finditer(window):
        a, b, c = match.groups()
        found = _valid(int(c), ROMAN[b], int(a))
        if found and found not in LAW_DATES:
            return found
    return None


def date_in(text: str) -> date | None:
    """A birth date in a piece of OCR, the label's own letters left out, with a
    space for a dot and letters misread for digits forgiven."""
    folded = LABEL.sub(" ", fold(text))
    found = parse_date(folded)
    if found:
        return found
    for match in SPACED.finditer(folded):
        day, month, year = (int(g) for g in match.groups())
        found = _valid(year, month, day)
        if found:
            return found
    return parse_date(
        MISREAD_DIGIT.sub(lambda m: m.group().translate(DIGITS_FOR), folded)
    )


def born_in_text(text: str) -> tuple[date | None, str]:
    """The birth date a text layer gives after its "urodzony(a)", and the field's text.

    Only the text between the label and the next printed label counts: a date
    further on is the declaration's own or an act's. A hiring notice's
    "urodzonych 1 sierpnia 1972 r. lub później" is not a declarant's label.
    """
    folded = fold(text)
    for match in BORN.finditer(folded):
        if (
            folded[match.start() : match.start() + 11]
            .replace(" ", "")
            .startswith("urodzonych")
        ):
            continue
        window = folded[match.end() : match.end() + 110]
        end = AFTER_BORN.search(window)
        if end:
            window = window[: end.start()]
        field = text[match.end() : match.end() + len(window)]
        return parse_date(window), " ".join(field.split())
    return None, ""


def looks_typed(field: str) -> bool:
    """A field a text layer gives as a date nobody's OCR made up: no stray marks."""
    return sum(ch in "'\"`^~*•»«|\\" for ch in field) <= 1


# -- PKW's age -----------------------------------------------------------------

#: What PKW's "wiek" counts to, fitted on ~40k known birth dates
#: (~/.cache/koryta/pkw-age-days-2026-10-23): the exact age on election day in
#: 2014 and 2018, and in 2024 the exact age on 2025-03-17, the day PKW generated
#: its files. Before 2014 it is a mix per candidate, so no exact window.
AGE_DAYS = {
    2014: date(2014, 11, 16),
    2018: date(2018, 10, 21),
    2024: date(2025, 3, 17),
}


def _years_before(day: date, years: int) -> date:
    try:
        return day.replace(year=day.year - years)
    except ValueError:  # 29 February
        return day.replace(year=day.year - years, day=28)


def birth_window(election_year: int, age: int | None) -> tuple[date, date] | None:
    """Every birth date PKW's age for a candidacy allows, first and last day."""
    day = AGE_DAYS.get(election_year)
    if day is None or age is None or age < 0:
        return None
    latest = _years_before(day, age)
    earliest = _years_before(day, age + 1) + timedelta(days=1)
    return earliest, latest


def in_windows(born: date | None, windows: list[tuple[date, date]]) -> str:
    """ "yes" when the date fits every window, "no" when it misses one, "none"
    when there is no date or no window to hold it against."""
    if born is None or not windows:
        return "none"
    if all(low <= born <= high for low, high in windows):
        return "yes"
    return "no"


# -- the declarant's name -------------------------------------------------------

#: The name in a text layer: between "podpisany(a)" and "(imiona i nazwisko".
NAME_IN_TEXT = re.compile(
    r"podpisan\w*\s*(?:\(\s?[a-z]\s?\)|/\s?[a-z]\b|[a-z]{0,2})?\s*[,.:]?\s*(.{2,120}?)\s*\(\s*imi",
    re.S,
)


def name_in_text(text: str) -> str:
    """The declarant's name a text layer gives on the form's first lines, if any."""
    folded = fold(text)
    match = NAME_IN_TEXT.search(folded)
    if not match:
        return ""
    raw = text[match.start(1) : match.end(1)]
    raw = re.sub(r"[_.…·•]+", " ", raw)
    return re.sub(r"\s+", " ", raw).strip(" ,;:-–—")


def _distance(a: str, b: str) -> int:
    row = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev, row[0] = row[0], i
        for j, cb in enumerate(b, 1):
            prev, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, prev + (ca != cb))
    return row[-1]


def _close(word: str, tokens: list[str]) -> bool:
    """Whether OCR read `word` among the tokens: exactly when short, with a
    letter or two wrong when longer."""
    allowed = 0 if len(word) <= 4 else 1 if len(word) <= 7 else 2
    return any(
        abs(len(t) - len(word)) <= allowed and _distance(t, word) <= allowed
        for t in tokens
    )


def name_tokens(text: str) -> list[str]:
    return [t for t in re.split(r"[^a-z]+", fold(text)) if len(t) >= 2]


def name_matches(read: str, first_name: str, last_name: str) -> bool:
    """Whether a name read off a declaration is this candidate's: the first name
    and every part of the surname ("Nowak-Kowalska" is two) among its words.

    Order does not matter (forms are signed "Kowalski Jan" as often as not),
    and a middle name or a maiden name around them does not either.
    """
    tokens = name_tokens(read)
    wanted = name_tokens(last_name) + name_tokens(first_name)[:1]
    return bool(tokens) and bool(wanted) and all(_close(w, tokens) for w in wanted)


# -- the year a declaration is for ------------------------------------------------

#: "według stanu na dzień 31.12.2023 r.", "stan na dzień 31 grudnia 2019".
AS_OF = re.compile(r"stan\w*\s*na\s*dzie\w*\s*:?")
DECLARATION_YEAR = re.compile(r"(?<!\d)(199\d|20[0-4]\d)(?!\d)")


def declaration_year(text: str) -> int | None:
    """The year a declaration is for, from its "według stanu na dzień ..." line."""
    folded = fold(text)
    for match in AS_OF.finditer(folded):
        year = DECLARATION_YEAR.search(folded[match.end() : match.end() + 40])
        if year:
            return int(year.group(1))
    return None
