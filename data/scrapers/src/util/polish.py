import regex as re

# TODO Is there any better way to list upper case characters?
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


def parse_name(pkw_name: str):
    words = pkw_name.split(" ")
    first_name, middle_name, last_name = "", "", ""
    if words[-1].isupper() and any(c.islower() for w in words[:-1] for c in w):
        # Assume "First Middle LAST"
        last_name = words[-1]
        first_name = words[0]
        if len(words) > 2:
            middle_name = " ".join(words[1:-1])
    else:
        # Assume "LAST First Middle"
        m = re.match(f"((?:[-{UPPER}]+ ?)+)", pkw_name)
        if not m:
            raise ValueError(f"Invalid name: {pkw_name}")
        last_name = m.group(1).strip()
        rest = pkw_name[len(m.group(0)) :].strip()
        if rest:
            names = rest.split(" ")
            first_name = names[0]
            if len(names) > 1:
                middle_name = " ".join(names[1:])
        else:
            # This can happen if the whole name is uppercase and considered a last name.
            # Try to split it.
            name_parts = last_name.split(" ")
            if len(name_parts) > 1:
                last_name = " ".join(name_parts[:-1])
                first_name = name_parts[-1]
            else:
                first_name = ""

    return first_name, middle_name, last_name
