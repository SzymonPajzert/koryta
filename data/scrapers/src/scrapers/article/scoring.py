"""URL scoring for the article crawler.

Assigns priority scores to URLs based on keyword relevance.
"""

from typing import Callable

from entities.util import NormalizedParse
from util.polish import remove_polish_diacritics

# Internal type: all registered scorers accept domains_of_interest
_RawScorer = Callable[[str, frozenset[str]], int]
# Public type returned by get_scoring_function (domains already bound)
ScoringFunction = Callable[[str], int]

SCORING_FUNCTIONS: dict[str, _RawScorer] = {}


def score_function(name: str):
    def decorator(fn: _RawScorer) -> _RawScorer:
        SCORING_FUNCTIONS[name] = fn
        return fn

    return decorator


def get_scoring_function(
    name: str, domains_of_interest: frozenset[str] = frozenset()
) -> ScoringFunction:
    """Look up a scoring function by name.

    Available: {list(SCORING_FUNCTIONS.keys())}
    """
    if name not in SCORING_FUNCTIONS:
        available = ", ".join(SCORING_FUNCTIONS.keys())
        raise ValueError(f"Unknown scoring function: {name!r}. Available: {available}")
    fn = SCORING_FUNCTIONS[name]
    return lambda url: fn(url, domains_of_interest)


def tag_in_url(tag: str, url: str) -> bool:
    tag = remove_polish_diacritics(tag.lower().replace(" ", "-"))
    return tag in url.lower()


@score_function("default")
def url_score(url: str, domains_of_interest: frozenset[str] = frozenset()) -> int:
    score = 0
    parsed_url = NormalizedParse.parse(url)

    if parsed_url.hostname_normalized in domains_of_interest:
        score += 10

    keywords = [
        "afera",
        "korupcja",
        "skandal",
        "układ",
        "mafia",
        "nepotyzm",
        "polityk",
        "partia",
        "dotacje",
        "prywatyzacja",
        "fundusz",
        "wybory",
        "polityczny",
        "polityczna",
        "afera korupcyjna",
    ]
    for k in keywords:
        score += tag_in_url(k, parsed_url.path)

    if tag_in_url("polityka prywatności", parsed_url.path):
        score -= 10

    return max(0, score)


@score_function("kalisz")
def url_score_kalisz(
    url: str, domains_of_interest: frozenset[str] = frozenset()
) -> int:
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
        "kalisz.wyborcza.pl",
        "kurierostrowski.pl/",
        "latarnikkaliski.pl",
        "m.rc.fm",
        "ostrzeszowinfo.pl",
        "poznan.tvp.pl",
        "poznan.wyborcza.pl",
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
        "afera",
        "korupcja",
        "skandal",
        "układ",
        "mafia",
        "nepotyzm",
        "polityk",
        "partia",
        "dotacje",
        "prywatyzacja",
        "fundusz",
        "wybory",
        "polityczny",
        "polityczna",
        "afera korupcyjna",
    ]
    for k in keywords:
        score += tag_in_url(k, url)

    return max(0, score)
