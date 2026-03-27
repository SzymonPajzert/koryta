"""URL scoring for the article crawler.

Assigns priority scores to URLs based on keyword relevance.
"""

from typing import Callable

from entities.util import NormalizedParse
from util.polish import remove_polish_diacritics

ScoringFunction = Callable[[str], int]

SCORING_FUNCTIONS: dict[str, ScoringFunction] = {}


def score_function(name: str):
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


def tag_in_url(tag: str, url: str) -> bool:
    tag = remove_polish_diacritics(tag.lower().replace(" ", "-"))
    return tag in url.lower()


DOMAINS_OF_INTEREST = [
    'krytykapolityczna.pl',
    'onet.pl',
    'wyborcza.pl',
    'rmf24.pl',
    'wykop.pl',
    'dzienniklodzki.pl',
    'echodnia.eu',
    'tvn24.pl',
    'gov.pl',
    'wp.pl',
    'interia.pl',
    'gazeta.pl',
    'polsatnews.pl',
    'tvp.info',
    'rp.pl',
    'gazetaprawna.pl',
    'money.pl',
    'bankier.pl',
    'businessinsider.com.pl',
    'forsal.pl',
    'wnp.pl',
    'fakt.pl',
    'se.pl',
    'o2.pl',
    'natemat.pl',
    'wpolityce.pl',
    'oko.press',
    'radiozet.pl',
    'tokfm.pl',
    'polskieradio24.pl',
    'pap.pl',
    'spidersweb.pl',
    'wirtualnemedia.pl',
    'gazetawroclawska.pl',
    'tuwroclaw.com',
    'dlk24.pl',
    'walbrzych24.com',
    'lca.pl',
    'pomorska.pl',
    'expressbydgoski.pl',
    'nowosci.com.pl',
    'ddtorun.pl',
    'ototorun.pl',
    'dziennikwschodni.pl',
    'kurierlubelski.pl',
    'lublin112.pl',
    'jawny.lublin.pl',
    'zamosconline.pl',
    'gazetalubuska.pl',
    'gorzowianin.com',
    'newslubuski.pl',
    'zachod.pl',
    'expressilustrowany.pl',
    'tulodz.pl',
    'epainfo.pl',
    'ddlodz.pl',
    'gazetakrakowska.pl',
    'dziennikpolski24.pl',
    'lovekrakow.pl',
    'podhale24.pl',
    'limanowa.in',
    'rdc.pl',
    'tustolica.pl',
    'tygodnikostrolecki.pl',
    'radom24.pl',
    'plock.eu',
    'nto.pl',
    '24opole.pl',
    'opowiecie.info',
    'radio.opole.pl',
    'nowiny24.pl',
    'supernowosci24.pl',
    'rzeszow-news.pl',
    'korso.pl',
    'stalowka.net',
    'poranny.pl',
    'wspolczesna.pl',
    'bialystokonline.pl',
    'mylomza.pl',
    'ddbialystok.pl',
    'dziennikbaltycki.pl',
    'trojmiasto.pl',
    'zawszepomorze.pl',
    'gp24.pl',
    'kartuzy.info',
    'dziennikzachodni.pl',
    'slazag.pl',
    'silesia24.pl',
    'tyskiflesz.pl',
    'radio.kielce.pl',
    'tkn24.pl',
    'wkielcach.info',
    'ostrowiecka.pl',
    'gazetaolsztynska.pl',
    'info.elblag.pl',
    'ro.com.pl',
    'mragowo24.info',
    'gloswielkopolski.pl',
    'epoznan.pl',
    'elka.pl',
    'faktykaliskie.pl',
    'rc.fm',
    '24kurier.pl',
    'gs24.pl',
    'gk24.pl',
    'iswinoujscie.pl',
    'szczeciner.pl',
]


@score_function("default")
def url_score(url: str) -> int:
    score = 0
    parsed_url = NormalizedParse.parse(url)

    if parsed_url.domain in DOMAINS_OF_INTEREST:
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
