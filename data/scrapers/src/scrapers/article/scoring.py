"""URL scoring for the article crawler.

Assigns priority scores to URLs based on keyword relevance.
"""

from typing import Callable

ScoringFunction = Callable[[str], int]

SCORING_FUNCTIONS: dict[str, ScoringFunction] = {}


def _register(name: str):
    def decorator(fn: ScoringFunction) -> ScoringFunction:
        SCORING_FUNCTIONS[name] = fn
        return fn
    return decorator


def get_scoring_function(name: str) -> ScoringFunction:
    """Look up a scoring function by name.

    Available: {list(SCORING_FUNCTIONS.keys())}
    """
    if name not in SCORING_FUNCTIONS:
        available = ", ".join(SCORING_FUNCTIONS.keys())
        raise ValueError(f"Unknown scoring function: {name!r}. Available: {available}")
    return SCORING_FUNCTIONS[name]


def remove_polish_diacritics(text: str) -> str:
    mapping = {
        'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z',
        'Ą': 'A', 'Ć': 'C', 'Ę': 'E', 'Ł': 'L', 'Ń': 'N', 'Ó': 'O', 'Ś': 'S', 'Ź': 'Z', 'Ż': 'Z'
    }
    return "".join(mapping.get(char, char) for char in text)


def tag_in_url(tag: str, url: str) -> bool:
    tag = remove_polish_diacritics(tag.lower().replace(" ", "-"))
    return tag in url.lower()


@_register("default")
def url_score(url: str) -> int:
    score = 0

    keywords = [
        "afera", "korupcja", "skandal", "układ", "mafia", "nepotyzm",
        "polityk", "partia", "dotacje", "prywatyzacja", "fundusz", "wybory",
        "polityczny", "polityczna", "afera korupcyjna",
    ]
    for k in keywords:
        score += tag_in_url(k, url)

    if tag_in_url("polityka prywatności", url):
        score -= 10

    return max(0, score)


@_register("kalisz")
def url_score_kalisz(url: str) -> int:
    score = 0

    wrong_ends = [
        ".pdf",
        ".jpg",
        ".webp",
        ".png",
    ]
    for wrong_end in wrong_ends:
        if url.endswith(wrong_end):
            return 0

    keywords = [
        "gloswielkopolski.pl",
        "kalisz24.info.pl",
        "kalisz.naszemiasto.pl",
        # "kalisz.wyborcza.pl",
        "kurierostrowski.pl/",
        "latarnikkaliski.pl",
        "m.rc.fm",
        "ostrzeszowinfo.pl",
        "poznan.tvp.pl",
        # "poznan.wyborcza.pl",
        "pzkol.pl",
        "radiopoznan.fm/informacje",
        "wiadomosci.onet.pl/poznan",
        "wlkp24.info",
        "faktykaliskie.info",
        "zyciekalisza.pl",
    ]
    for k in keywords:
        score += tag_in_url(k, url) * 10

    keywords = [
        "afera", "korupcja", "skandal", "układ", "mafia", "nepotyzm",
        "polityk", "partia", "dotacje", "prywatyzacja", "fundusz", "wybory",
        "polityczny", "polityczna", "afera korupcyjna",
    ]
    for k in keywords:
        score += tag_in_url(k, url)

    return max(0, score)
