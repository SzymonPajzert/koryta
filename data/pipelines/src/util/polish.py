import unicodedata
from datetime import date, datetime
from enum import Enum
from typing import Optional

import dateparser
import regex as re

UPPER = "A-ZĘẞÃŻŃŚŠĆČÜÖÓŁŹŽĆĄÁŇŚÑŠÁÉÇŐŰÝŸÄṔÍŢİŞÇİŅ'"

LOWER = UPPER.lower()

MONTH_NUMBER = {
    "styczeń": 1,
    "luty": 2,
    "marzec": 3,
    "kwiecień": 4,
    "maj": 5,
    "czerwiec": 6,
    "lipiec": 7,
    "sierpień": 8,
    "wrzesień": 9,
    "październik": 10,
    "listopad": 11,
    "grudzień": 12,
}

MONTH_NUMBER_GENITIVE = {
    "stycznia": 1,
    "lutego": 2,
    "marca": 3,
    "kwietnia": 4,
    "maja": 5,
    "czerwca": 6,
    "lipca": 7,
    "sierpnia": 8,
    "września": 9,
    "października": 10,
    "listopada": 11,
    "grudnia": 12,
}


class PkwFormat(Enum):
    UNKNOWN = 0
    First_Last = 1
    Last_First = 2
    First_LAST = 3
    LAST_First = 4


def parse_name(pkw_name: str, format: PkwFormat):
    words = pkw_name.split(" ")
    first_name, middle_name, last_name = "", "", ""
    match format:
        case PkwFormat.First_Last:
            last_name = words[-1]
            first_name = words[0]
            if len(words) > 2:
                middle_name = " ".join(words[1:-1])
        case PkwFormat.First_LAST:
            m = re.search(f"((?: [-{UPPER}]+)+)$", pkw_name)
            if not m:
                raise ValueError(f"Invalid name: '{pkw_name}'")
            last_name = m.group(1).strip()
            rest = pkw_name[: -len(m.group(0))].strip()
            if rest:
                names = rest.split(" ")
                first_name = names[0]
                if len(names) > 1:
                    middle_name = " ".join(names[1:])
        case PkwFormat.LAST_First:
            m = re.match(f"((?:[-{UPPER}]+ )+)", pkw_name)
            if not m:
                raise ValueError(f"Invalid name: '{pkw_name}'")
            last_name = m.group(1).strip()
            rest = pkw_name[len(m.group(0)) :].strip()
            if rest:
                names = rest.split(" ")
                first_name = names[0]
                if len(names) > 1:
                    middle_name = " ".join(names[1:])
        case _:
            raise ValueError(f"Unsupported format: {pkw_name}")

    return first_name, middle_name, last_name


#: Words that stay lowercase when a shouted name is put back into case. A
#: nobiliary particle is part of the surname rather than a word of its own
#: ("Piotr van der Coghen"), and `vel` is how the registers write an alias
#: ("Jan Kowalski vel Kuropatwa"); capitalising either of them spells the name
#: wrong. In first position there is nothing for the particle to hang off - a
#: name that begins with one is being shown on its own - so it is capitalised
#: like any other word.
#:
#: Only a shouted word is looked up here, which is what keeps "Jolanta Den" and
#: "Maria Du Vall" - real koryta.pl people whose surname *is* one of these words
#: - out of it: their capital is a choice somebody made, and nothing below
#: touches a word that carries a choice.
NAME_PARTICLES = frozenset(
    {
        "van",
        "von",
        "der",
        "den",
        "de",
        "del",
        "della",
        "di",
        "da",
        "do",
        "dos",
        "du",
        "la",
        "le",
        "el",
        "ten",
        "ter",
        "vel",
        "zu",
    }
)

#: What separates two parts of one word, each of which is capitalised on its
#: own: a double-barrelled surname (Hardie-Douglas) and the elided article of
#: D'Obyrn or O'Brien. Both spellings of the apostrophe occur in the registers.
NAME_PART_SEPARATORS = "-'\u2019"


def _capitalize_shouted(part: str) -> str:
    """One part of a shouted word - `GRADZIUK`, or the `NOWAK` of `KOWALSKA-NOWAK`.

    The part holds no lowercase letter, so lowering everything after the first
    one loses nothing: there was no case in it to lose.
    """
    letters = [index for index, char in enumerate(part) if char.isalpha()]
    if not letters:
        return part
    first = letters[0]
    return part[:first] + part[first].upper() + part[first + 1 :].lower()


def format_person_name(name: str) -> str:
    """A person's name with any word that shouts put back into case.

    The sources do not agree on case. PKW shouts every surname by convention -
    its listings spell a candidate "KOPCZYŃSKI Andrzej Jacek" - and some of what
    the company register returns arrives in full capitals too: five people have
    a koryta.pl page named "MAŁGORZATA GRADZIUK" or the like, sitting in the
    same listings as the properly capitalised majority.

    A word holding even one lowercase letter is left exactly as it is, whatever
    it looks like. Its case is a spelling somebody chose - `McDonald`, `Du Vall`
    and the lowercased `hardie-douglas` alike - and this is not a proofreader:
    it undoes shouting, and nothing else. Which is also what makes it different
    from `str.title()`, whose flattening of `van der Coghen` to `Van Der Coghen`
    is exactly the kind of guess that is not wanted.

    Whitespace is left alone for the same reason, so the transformation is only
    ever the case of a word: the name comes back the shape it went in.

    Idempotent: a name with nothing left shouting is returned unchanged, which
    is what lets the invariant be stated as ``format_person_name(name) == name``.
    """
    position = -1

    def word(match) -> str:
        nonlocal position
        position += 1
        item = match.group(0)
        if any(char.islower() for char in item):
            return item
        if position > 0 and item.lower() in NAME_PARTICLES:
            return item.lower()
        return "".join(
            piece if piece in NAME_PART_SEPARATORS else _capitalize_shouted(piece)
            for piece in re.split(f"([{NAME_PART_SEPARATORS}])", item)
        )

    # Substituting word by word rather than splitting and rejoining is what
    # leaves the whitespace between them as it was.
    return re.sub(r"\S+", word, name)


def normalize_person_name(name: str) -> str:
    """A person's name folded down to what two spellings of them share.

    A transcription of `normalizePersonName` in `frontend/shared/names.ts`, and
    it has to stay one: the site stores the result on every person node as
    `nameNormalized` and the ingest looks a person up by it, so a pipeline that
    folded a name differently would predict the wrong page. Same steps in the
    same order - strip the combining marks NFD exposes, then `ł` and `Ł`, which
    are their own codepoints and survive NFD, then lowercase, then anything
    left that is not a letter or a digit becomes a word break.

    Deliberately looser than `format_person_name`, which is about how a name is
    *shown*. This one is only ever a key.
    """
    decomposed = unicodedata.normalize("NFD", name)
    stripped = "".join(char for char in decomposed if not unicodedata.combining(char))
    folded = stripped.replace("ł", "l").replace("Ł", "l").lower()
    return re.sub(r"[^a-z0-9]+", " ", folded).strip()


def parse_polish_date(date_string: str) -> Optional[date]:
    if not date_string:
        return None

    date_string = date_string.strip()

    for fmt in (
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S%z",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(date_string, fmt).date()
        except ValueError:
            pass

    try:
        parsed = dateparser.parse(
            date_string,
            languages=["pl"],
            settings={
                "DATE_ORDER": "DMY",
                "RETURN_AS_TIMEZONE_AWARE": False,
                "PREFER_DAY_OF_MONTH": "first",
            },
        )
    except Exception:
        return None
    return parsed.date() if parsed else None


def remove_polish_diacritics(text: str) -> str:
    mapping = {
        "ą": "a",
        "ć": "c",
        "ę": "e",
        "ł": "l",
        "ń": "n",
        "ó": "o",
        "ś": "s",
        "ź": "z",
        "ż": "z",
        "Ą": "A",
        "Ć": "C",
        "Ę": "E",
        "Ł": "L",
        "Ń": "N",
        "Ó": "O",
        "Ś": "S",
        "Ź": "Z",
        "Ż": "Z",
    }
    return "".join(mapping.get(char, char) for char in text)
