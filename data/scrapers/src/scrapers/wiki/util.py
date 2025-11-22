from regex import match

from util.polish import MONTH_NUMBER, MONTH_NUMBER_GENITIVE


def parse_date(human_readable: str):
    human_readable = human_readable.replace("[", "")
    human_readable = human_readable.replace("]", "")
    human_readable = human_readable.replace("{{data|", "")
    human_readable = human_readable.replace("}}", "")
    human_readable = human_readable.split("<ref")[0]
    human_readable = human_readable.split(" r.")[0]
    if human_readable == "":
        return None

    for ignorable in [
        "n.e",
        "(",
        "ok.",
        "lub",
        "/",
        "przed",
        "ochrz.",
        "między",
    ]:
        if ignorable in human_readable:
            return None

    m = match("^\\d{4}-\\d{2}-\\d{2}$", human_readable)
    if m is not None:
        return human_readable

    try:
        m = match("^(\\d+) (\\w+) (\\d{4})$", human_readable)
        if m is not None:
            days = int(m.group(1))
            month = MONTH_NUMBER_GENITIVE[m.group(2)]
            return f"{m.group(3)}-{month:02d}-{days:02d}"

        m = match("^(\\w+) (\\d{4})$", human_readable)
        if m is not None:
            month = MONTH_NUMBER[m.group(1)]
            return f"{m.group(2)}-{month:02d}-00"
    except KeyError:
        return None

    m = match("^(\\d+)$", human_readable)
    if m is not None:
        return f"{m.group(1)}-00-00"
