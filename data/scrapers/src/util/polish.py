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





def parse_polish_date(date_string: str) -> Optional[date]:
    if not date_string:
        return None

    date_string = date_string.strip()

    for fmt in (
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(date_string, fmt).date()
        except ValueError:
            pass

    parsed = dateparser.parse(
        date_string,
        languages=["pl"],
        settings={
            "DATE_ORDER": "DMY",
            "RETURN_AS_TIMEZONE_AWARE": False,
            "PREFER_DAY_OF_MONTH": "first",
        },
    )
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
