import json
import re
import unicodedata
from pathlib import Path
from typing import Any

import pandas as pd
from tqdm import tqdm

from entities.article import ArticleAnalyzedRecord
from scrapers.article.parse import date_iso_from_ld_json, title_from_ld_json
from scrapers.article.pipelines.incremental import IncrementalJsonlPipeline
from scrapers.article.pipelines.koryciarski_scores_pipeline import (
    ArticleKoryciarskiScores,
)
from scrapers.article.pipelines.parsed_pipeline import ArticleParsed
from scrapers.article.pipelines.pipeline_utils import (
    article_analyzed_keep_evidence,
    article_analyzed_only_matched_koryta,
    article_tag,
)
from scrapers.article.pipelines.verified_facts_pipeline import ArticleFactsVerified
from scrapers.stores import VERSIONED_DIR, Context

_PARSED_FILE = Path(VERSIONED_DIR) / "article_parsed" / "article_parsed.jsonl"
_SCORES_FILE = (
    Path(VERSIONED_DIR)
    / "article_koryciarski_scores"
    / "article_koryciarski_scores.jsonl"
)
_FACTS_FILE = (
    Path(VERSIONED_DIR) / "article_facts_verified" / "article_facts_verified.jsonl"
)

def _mswia_forms(n: str) -> str:
    """MSWiA in any word order / contiguous committee name."""
    n = re.sub(
        r"^ministerstwo administracji i spraw wewnetrznych$",
        "ministerstwo spraw wewnetrznych i administracji",
        n,
    )
    n = re.sub(
        r"^ministerstwo sprawiedliwosci i spraw wewnetrznych$",
        "ministerstwo spraw wewnetrznych i administracji",
        n,
    )
    return n


def _fold(value: str | None) -> str:
    """Fold Polish diacritics to ASCII (incl. ``ł``) for canonical keys.

    Deliberately *not* applied to person names: spelling variants of the same
    person are still meant to stay apart in dedup keys. Org, role and party
    canonicals fold so that "smoleńska" ≡ "smolenska", "panstwowy" ≡
    "państwowy", etc.
    """
    text = unicodedata.normalize("NFD", value or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    return text.replace("ł", "l").replace("Ł", "l")


# Party aliases: spellings journalists use interchangeably for the same party.
# Dedup keys are built from the canonical form, so "PiS" and "Prawo i
# Sprawiedliwość" count as one party without touching the stored value.
# Keys and values are diacritic-folded so "sojusz lewicy demokratycznej" and
# "Sojusz Lewicy Demokratycznej" map under one folded form.
_PARTY_ALIASES_RAW: dict[str, str] = {
    "pis": "Prawo i Sprawiedliwość",
    "prawo i sprawiedliwość": "Prawo i Sprawiedliwość",
    "prawo i sprawiedliwości": "Prawo i Sprawiedliwość",
    "psl": "Polskie Stronnictwo Ludowe",
    "polskie stronnictwo ludowe": "Polskie Stronnictwo Ludowe",
    "psl-koalicja polska": "Polskie Stronnictwo Ludowe",
    "po": "Platforma Obywatelska",
    "platforma obywatelska": "Platforma Obywatelska",
    "platforma obywatelska rp": "Platforma Obywatelska",
    "ko": "Koalicja Obywatelska",
    "koalicja obywatelska": "Koalicja Obywatelska",
    "sld": "Sojusz Lewicy Demokratycznej",
    "sojusz lewicy demokratycznej": "Sojusz Lewicy Demokratycznej",
    "razem": "Razem",
    "partia razem": "Razem",
    "nowoczesna": "Nowoczesna",
    ".nowoczesna": "Nowoczesna",
}

_PARTY_ALIASES: dict[str, str] = {
    _fold(k).lower(): _fold(v).lower() for k, v in _PARTY_ALIASES_RAW.items()
}


def _norm(value: str | None) -> str:
    """Lowercased, whitespace-collapsed form used for dedup keys."""
    return " ".join((value or "").strip().lower().split())


def _normalize_person_name(value: str | None) -> str:
    """Match the website's normalizePersonName (names.ts): fold diacritics and
    ``ł``, lowercase, collapse non-alphanumerics. Used for the person-page
    match so the pipeline agrees with what the ingest endpoint will link."""
    text = unicodedata.normalize("NFD", value or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.replace("ł", "l").replace("Ł", "l").lower()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())


def _canonical_party(party: str | None) -> str:
    """Map a party spelling to its canonical name, else the normalized value.

    The result is diacritic-folded, so all spellings of e.g. Sojusz Lewicy
    Demokratycznej collapse onto one dedup key.
    """
    folded = _fold(_norm(party))
    return _PARTY_ALIASES.get(folded, folded)


# Legal-form/abbreviation/rename aliases for an organization name.
_ORG_ALIASES_RAW: dict[str, str] = {
    "sejm": "sejm",
    "sejm rp": "sejm",
    "sejm rzeczypospolitej polskiej": "sejm",
    "senat": "senat",
    "senat rp": "senat",
    "senat rzeczypospolitej polskiej": "senat",
    "rząd": "rzad",
    "rząd rp": "rzad",
    "rząd rzeczypospolitej polskiej": "rzad",
    "rząd donalda tuska": "rzad",
    "rząd po i psl": "rzad",
    "kancelaria prezydenta": "kancelaria prezydenta",
    "kancelaria prezydenta rp": "kancelaria prezydenta",
    "kancelaria prezydenta rzeczypospolitej polskiej": "kancelaria prezydenta",
    "kancelaria prezydenta andrzeja dudy": "kancelaria prezydenta",
    "prezydentura": "prezydentura",
    "prezydentura rzeczypospolitej polskiej": "prezydentura",
    "prezydent rzeczypospolitej polskiej": "prezydentura",
    "orlen": "orlen",
    "pkn orlen": "orlen",
    "pkp": "pkp",
    "pkp s.a.": "pkp",
    "mon": "ministerstwo obrony narodowej",
    "ministerstwo obrony": "ministerstwo obrony narodowej",
    # Ministry renames the extractor swaps freely for the same office.
    "ministerstwo klimatu": "ministerstwo klimatu i środowiska",
    "ministerstwo środowiska i klimatu": "ministerstwo klimatu i środowiska",
    "ministerstwo środowiska": "ministerstwo klimatu i środowiska",
    "ministerstwo rolnictwa": "ministerstwo rolnictwa i rozwoju wsi",
    "ministerstwo edukacji": "ministerstwo edukacji",
    "ministerstwo edukacji narodowej": "ministerstwo edukacji",
    "ministerstwo edukacji i nauki": "ministerstwo edukacji i nauki",
    "ministerstwo nauki i edukacji": "ministerstwo edukacji i nauki",
    "ministerstwo nauki i szkolnictwa wyższego": "ministerstwo edukacji i nauki",
    "ministerstwo nauki": "ministerstwo edukacji i nauki",
    "ministerstwo sportu": "ministerstwo sportu i turystyki",
    "ministerstwo kultury": "ministerstwo kultury i dziedzictwa narodowego",
    "ministerstwo pracy": "ministerstwo pracy i polityki społecznej",
    "ministerstwo rodziny i polityki społecznej": (
        "ministerstwo pracy i polityki społecznej"
    ),
    "ministerstwo rodziny, pracy i polityki społecznej": (
        "ministerstwo pracy i polityki społecznej"
    ),
    "ministerstwo spraw wewnętrznych": (
        "ministerstwo spraw wewnętrznych i administracji"
    ),
    "ministerstwo infrastruktury": "ministerstwo infrastruktury i budownictwa",
    "ministerstwo obrony narodowej": "ministerstwo obrony narodowej",
    "ministerstwo funduszy": "ministerstwo funduszy i polityki regionalnej",
    "ministerstwo rozwoju i polityki regionalnej": (
        "ministerstwo funduszy i polityki regionalnej"
    ),
    "rada ministrów": "rzad",
    "rada ministrow": "rzad",
    "klub parlamentarny pis": "klub prawa i sprawiedliwości",
    "klub pis": "klub prawa i sprawiedliwości",
    "parlamentarny klub pis": "klub prawa i sprawiedliwości",
    "kp pis": "klub prawa i sprawiedliwości",
    "klub parlamentarny prawa i sprawiedliwości": "klub prawa i sprawiedliwości",
    "klub ko": "klub ko",
    "klub koalicji obywatelskiej": "klub ko",
    "klub parlamentarny koalicji obywatelskiej": "klub ko",
    "klub parlamentarny koalicja obywatelska": "klub ko",
    "koalicja obywatelska": "koalicja obywatelska",
    # Polska 2050 spelling variants (incl. the genitive ``Polski 2050``).
    "polska2050": "polska 2050",
    "polski 2050": "polska 2050",
    "ruch polska 2050": "polska 2050",
    "stowarzyszenie polska 2050": "polska 2050",
    "polska 2050 szymona hołowni": "polska 2050",
    "polska 2050 - trzecia droga": "trzecia droga",
    "td-polska 2050": "trzecia droga",
    "polska 2050 - td": "trzecia droga",
    "polska 2050-td": "trzecia droga",
    "psl - trzecia droga": "trzecia droga",
    "trzecia droga: psl-polska 2050": "trzecia droga",
    # PSP abbreviation and its genitive form
    "państwowa straż pożarna": "państwowej straży pożarnej",
    "panstwowa straz pozarna": "państwowej straży pożarnej",
    # Ministry renames 2015-23 that the extractor emits interchangeably
    "ministerstwo funduszy i rozwoju regionalnego": (
        "ministerstwo funduszy i polityki regionalnej"
    ),
    "ministerstwo funduszy i rozwoju": "ministerstwo funduszy i polityki regionalnej",
    "ministerstwo infrastruktury i budownictwa": (
        "ministerstwo infrastruktury i budownictwa"
    ),
    "ministerstwo infrastruktury i rozwoju": (
        "ministerstwo infrastruktury i budownictwa"
    ),
    "ministerstwo skarbu": "ministerstwo skarbu państwa",
    "ministerstwo skarbu panstwa": "ministerstwo skarbu państwa",
    # Companies journalists name several ways (incl. legal-form / group forms).
    "polski koncern naftowy orlen": "orlen",
    "polskiego koncernu naftowego orlen": "orlen",
    "koncern naftowy orlen": "orlen",
    "pkn orlenu": "orlen",
    "pk orlen": "orlen",
    "orlenu": "orlen",
    "tauron polska energia": "tauron",
    "tauron polska": "tauron",
    "kghm polska miedz": "kghm",
    "pge polska grupa energetyczna": "pge",
    "poczta polska spolka akcyjna": "poczta polska",
    "pkp polskie linie kolejowe": "pkp plk",
    "bank pko bp": "pko bank polski",
    "pko bp": "pko bank polski",
    "pkobp": "pko bank polski",
    "szpital im. stefana zeromskiego": "szpital im. zeromskiego",
    "szpital specjalistyczny im. zeromskiego": "szpital im. zeromskiego",

    "rada nadzorcza orlenu": "rada nadzorcza orlen",
    "rada nadzorcza pkn orlen": "rada nadzorcza orlen",
    "rada nadzorcza pkn orlenu": "rada nadzorcza orlen",
    "rada nadzorcza banku pekao": "rada nadzorcza bank pekao",
    "rada nadzorcza pko banku polskiego": "rada nadzorcza pko bank polski",
    "energi": "energa",
    "energia": "energa",
    "globe trade centre": "globe trade center",
    "gtc": "globe trade center",
    "europarlament": "parlament europejski",
    "europejski parlament europejski": "parlament europejski",
    "lpr": "liga polskich rodzin",
    "sluzby kontrwywiadu wojskowego": "sluzba kontrwywiadu wojskowego",
    "teatr nowego": "teatr nowy",
    "polskie radio pik": "radio pik",
    "ministerstwo rozwoju regionalnego": "ministerstwo rozwoju",
    "fundacja instytut sobieskiego": "instytut sobieskiego",
    "ministerstwo finansow inwestycji i rozwoju": "ministerstwo inwestycji i rozwoju",
    "ministerstwo finansow i rozwoju": "ministerstwo inwestycji i rozwoju",
    "ministerstwo rozwoju i inwestycji": "ministerstwo inwestycji i rozwoju",
    "ministerstwo rozwoju i finansow": "ministerstwo inwestycji i rozwoju",
    "ministerstwo finansow oraz inwestycji i rozwoju": (
        "ministerstwo inwestycji i rozwoju"
    ),
    "ministerstwo inwestycji rozwoju i finansow": "ministerstwo inwestycji i rozwoju",
    "ministerstwo finansow i polityki regionalnej": (
        "ministerstwo funduszy i polityki regionalnej"
    ),
    "ministerstwo polityki regionalnej": "ministerstwo funduszy i polityki regionalnej",
    "ministerstwo ds. funduszy i polityki regionalnej": (
        "ministerstwo funduszy i polityki regionalnej"
    ),
    "stronnictwo ludowe": "polskie stronnictwo ludowe",
    "krajowy osrodek wspierania rolnictwa": "krajowy osrodek wsparcia rolnictwa",
    "krajowy osrodek rozwoju rolnictwa": "krajowy osrodek wsparcia rolnictwa",
    "zaklad aktywizacji zawodowej": "zaklad aktywnosci zawodowej",
    "urzad miasto ostrolec": "urzad miasto ostrolek",
    "energetyk row rybnik": "row rybnik",
    "energetyka row rybnik": "row rybnik",
    "gabinet polityczny wicepremiera": "gabinet polityczny",
    "fundacja europejskie centrum przedsiebiorczosci": (
        "europejskie centrum przedsiebiorczosci"
    ),
    "centrum pomocy rodzinie": "centrum pomocy rodziny",
    "wojewodzki fundusz ochrony srodowiska": (
        "wojewodzki fundusz ochrony srodowiska i gospodarki wodnej"
    ),
    "polska grupa energetyczna": "pge",
    "walbrzyska specjalna strefa ekonomiczna invest park": (
        "walbrzyska specjalna strefa ekonomiczna"
    ),
    "klub po w radzie miejskiej wroclawia": "klub po w radzie miejskiej",
    "pr.motion": "pr motion",
    "pr-motion": "pr motion",
    "straz pozarna": "panstwowej strazy pozarnej",
    "komisja weryfikacyjna": "komisja weryfikacyjna wsi",
}

_ORG_ALIASES: dict[str, str] = {
    _fold(k).lower(): _fold(v).lower() for k, v in _ORG_ALIASES_RAW.items()
}
# Legal-form suffixes stripped from an org before alias lookup.
_LEGAL_SUFFIX_RE = re.compile(
    r"\s+(s\.?\s*a\.?|sa|sp\.?\s*z\.?\s*o\.?\s*o\.?"
    r"|spolka\s+z\s+o\.?\s*o\.?|spolki\s+z\.?\s*o\.?\s*o\.?"
    r"|sp\s*z\.?\s*o\.?\s*o\.?|spzoz|sp\s*zoz|zrt\.?"
    r"|spolka akcyjna|spolki akcyjnej)\b\.?"
)
_REPLACE_PUNCT_RE = re.compile(r"[,–—-]+")
_MST_RE = re.compile(r"\bm\s*\.?\s*st\.?")
# Preposition before a seat: "w" and the euphonic "we" ("we Wrocławiu").
_W_RE = re.compile(r"\s+(?:w|we)\s+")

# Voivodeship-name adjectives; stripped as redundant from "Urząd Wojewódzki
# <adjektiv>" and used as org prefixes for the trailing-locative strip.
_VOIVODESHIPS = {
    "malopolski",
    "mazowiecki",
    "slaski",
    "dolnoslaski",
    "kujawsko pomorski",
    "lubelski",
    "lubuski",
    "lodzki",
    "opolski",
    "podkarpacki",
    "podlaski",
    "pomorski",
    "swietokrzyski",
    "warminsko mazurski",
    "wielkopolski",
    "zachodniopomorski",
}
_VOIVODESHIPS_GEN = {
    "malopolskiego": "malopolski",
    "mazowieckiego": "mazowiecki",
    "slaskiego": "slaski",
    "dolnoslaskiego": "dolnoslaski",
    "kujawsko pomorskiego": "kujawsko pomorski",
    "lubelskiego": "lubelski",
    "lubuskiego": "lubuski",
    "lodzkiego": "lodzki",
    "opolskiego": "opolski",
    "podkarpackiego": "podkarpacki",
    "podlaskiego": "podlaski",
    "pomorskiego": "pomorski",
    "swietokrzyskiego": "swietokrzyski",
    "warminsko mazurskiego": "warminsko mazurski",
    "wielkopolskiego": "wielkopolski",
    "zachodniopomorskiego": "zachodniopomorski",
}
# Reverse map: base adjective -> genitive ("małopolski" -> "małopolskiego").
_VOIVODESHIPS_GEN_OF = {v: k for k, v in _VOIVODESHIPS_GEN.items()}
# Org-word prefixes after which a trailing "w <miasto>" is the redundant seat
# of the same single institution (``Miejskie OSIR w Radomiu`` vs ``MOSIR``).
_LOCATIVE_PREFIXES = {
    "urzad",
    "rady",
    "rada",
    "starostwo",
    "komenda",
    "osrodek",
    "centrum",
    "szpital",
    "przedsiebiorstwo",
    "zaklad",
    "fundusz",
    "spoldzielnia",
    "zwiazek",
    "klub",
    "spolka",
    "zarzad",
    "towarzystwo",
    "gmina",
    "miasto",
    "powiat",
    # scope adjectives: "Miejski Ośrodek ... w Radomiu", "Wojewódzki Fundusz
    # ... w Łodzi", "Powiatowy Związek ..."
    "miejski",
    "miejskie",
    "miejskiego",
    "miejskiej",
    "powiatowy",
    "powiatowe",
    "wojewodzki",
    "wojewodzkie",
    "gminny",
    "gminne",
    "panstwowy",
    "panstwowe",
    "uniwersytet",
    "politechnika",
    "akademia",
    "szkola",
    "instytut",
    # cultural venues and libraries: the seat "w <miasto>" is redundant
    "teatr",
    "opera",
    "filharmonia",
    "muzeum",
    "galeria",
    "biblioteka",
    "forum",
    "izba",
    "lo",
    "stacja",
    "port",
    # regional adjectives: "Pomorskie Centrum Reumatologiczne [w Sopocie]"
    "malopolska",
    "malopolskie",
    "mazowiecka",
    "mazowieckie",
    "slaska",
    "slaskie",
    "dolnoslaskie",
    "lubelskie",
    "lubuskie",
    "lodzkie",
    "opolskie",
    "podkarpackie",
    "podlaskie",
    "pomorskie",
    "swietokrzyskie",
    "wielkopolskie",
    "zachodniopomorskie",
}


def _canonical_urzad_region(n: str) -> str | None:
    """Region-scaled urząd (wojewódzki/wojewody/marszałkowski) → one form.

    The region adjective, ``w <miasto>`` seat and ``wojewodztwa <X>``
    qualifier are all redundant for dedup: a given person is the wojewoda /
    marszałek of a single region, and the person slot already pins it.
    ``None`` means ``n`` is not a region-scaled urząd.
    """
    if "urzad wojewodzki" not in n and "urzad marszalkowski" not in n:
        return None
    n = re.sub(r"\s+(?:w|we)\s+[a-z]+$", "", n)
    toks = n.split()
    if toks and toks[0] in _VOIVODESHIPS or toks and toks[0] in _VOIVODESHIPS_GEN:
        toks = toks[1:]
    if "wojewodztwa" in toks:
        i = toks.index("wojewodztwa")
        if i + 1 < len(toks) and toks[i + 1] in _VOIVODESHIPS_GEN:
            toks = toks[:i]
    return re.sub(r"\s+", " ", " ".join(toks)).strip()


# City-name inflection endings -> cut length, longest first, so the locative/
# genitive of a place folds to its base ("pcimiu"→"pcim", "krakowie"→"krakow").
_CITY_SUFFIXES = (
    ("iu", 2),
    ("ia", 2),
    ("ach", 3),
    ("ego", 3),
    ("em", 2),
    ("ie", 2),
    ("ej", 2),
    ("y", 1),
    ("i", 1),
    ("a", 1),
    ("u", 1),
    ("e", 1),
)


# City-name disambiguators ("Gorzów Wielkopolski", "Piotrków Trybunalski")
# are redundant once the base city is known.
_CITY_DISAMBIG = (
    "wielkopolsk", "mazowieck", "lubelsk", "kujawsk", "slask", "podlask",
    "trybunalsk", "gornicz", "bieszczadzk", "walbrzysk", "kaszubsk",
    "wlkp",
)


def _drop_city_disambiguator(toks: list[str]) -> list[str]:
    if len(toks) >= 2 and toks[-1].startswith(_CITY_DISAMBIG):
        toks = toks[:-1]
    return toks


def _stem_city_token(word: str) -> str:
    """Stem one inflected city token to its base; ``pokrzywnicy`` → ``pokrzywnic``."""
    for suffix, cut in _CITY_SUFFIXES:
        if word.endswith(suffix) and len(word) > cut + 3:
            return word[: -cut]
    return word


def _stem_trailing_token(n: str) -> str:
    """Stem an inflected trailing city token (krakowie → krakow)."""
    toks = n.split()
    if len(toks) >= 2 and toks[-1] not in (
        "miasto",
        "gminy",
        "gmina",
        "powiatu",
        "wojewodzki",
        "wojewodztwa",
        "marszalkowski",
        "dzielnicy",
    ):
        toks[-1] = _stem_city_token(toks[-1])
        n = " ".join(toks)
    return re.sub(r"\s+", " ", n).strip()


def _canonical_urzad(n: str) -> str:
    """Canonical form of an ``urząd`` org (input already diacritic-folded).

    Folds ``Urząd Miasta Krakowa`` ↔ ``Urząd Miejski w Krakowie`` and the
    ``m.st.``/``m st``/``miasto stołeczne`` city variants. Gmina and miasto
    offices are the SAME municipality (``Urząd Gminy``, ``Urząd Miejski``,
    ``Urząd Miasta``), so both fold onto ``urzad miasto <city>`` (``urzad
    powiatu`` stays its own scope). The city name is kept, stemmed against
    inflection (``pokrzywnicy`` → ``pokrzywnic``), so a person who held the
    same role in two towns still keeps two facts; a bare office without a city
    keeps only the scope word. Warsaw is kept verbatim as ``urzad miasta
    stolecznego warszawy``. Region-scaled offices (wojewódzki/wojewody/
    marszałkowski) collapse on ``_canonical_urzad_region``.
    """
    region = _canonical_urzad_region(n)
    if region is not None:
        return region
    if n.startswith("urzad wojewody "):
        return "urzad wojewodzki"
    if "urzad prezydenta" in n:
        # "Urząd Prezydenta Miasta X" is the mayor's city office.
        n = re.sub(r"^urzad prezydenta( miasta)? ", "urzad miasto ", n)
    # Generic: miejski/miasta → miasto, drop "w".
    n = re.sub(r"\bmiejski\w*\b", "miasto", n)
    n = re.sub(r"\bmiasta\b", "miasto", n)
    n = re.sub(r"\bmiastu\b", "miasto", n)
    n = _W_RE.sub(" ", f" {n} ")
    n = n.lstrip()
    # "Miejski Urząd Pracy" == "Urząd Pracy" (adjectival prefix on the office).
    n = re.sub(r"^miasto urzad\b", "urzad", n)
    # "Urząd Gminy i Miasta X": urban-rural commune office = "urzad gminy X".
    n = re.sub(r"\bgminy i miasto\b", "gminy", n)
    n = " ".join(n.split())
    # Municipal scope: keep the scope word plus the (stemmed) city, the rest is
    # redundant. Gmina and miasto spellings are the SAME municipality (``Urząd
    # Gminy``, ``Urząd Miejski``, ``Urząd Miasta``) — ``gmina pokrzywnicy``,
    # ``urzad gminy pokrzywnica`` and ``urzad miejski w pokrzywnicy`` all fold
    # onto ``urzad miasto pokrzywnic``. The city stays, so a person who served
    # the same role in two different towns (Świebodzin and Braniewo) keeps two
    # distinct facts; bare forms without a city keep their scope word only.
    m = re.match(r"^(urzad (?:miasto|gminy|powiatu))(?: |$)", n)
    if m:
        scope = "urzad powiatu" if "powiatu" in m.group(1) else "urzad miasto"
        rest = n[m.end() :].strip()
        if not rest:
            return scope
        # stem the trailing city token (pokrzywnicy → pokrzywnic)
        toks = rest.split()
        toks = _drop_city_disambiguator(toks)
        toks[-1] = _stem_city_token(toks[-1])
        return f"{scope} {' '.join(toks)}"
    return _stem_trailing_token(n)


def _komisja_forms(n: str) -> str:
    """Committee prefixes that are not part of the name
    (Sejmowa Komisja, Komisja Śledcza, Komisja Doraźna ...)."""
    n = re.sub(r"^sejmowa komisja ", "komisja ", n)
    n = re.sub(r"^komisja (sledcza|dorazna|nadzwyczajna) ", "komisja ", n)
    return n


def _warsaw_canonical(n: str) -> str | None:
    """Warsaw city forms → the Rada/Urząd of m.st. Warszawy, else ``None``."""
    if "warsz" not in n or not (
        "rada" in n or "m st" in n or "miej" in n or "miast" in n or "dzielnic" in n
    ):
        return None
    if "dzielnicy" in n:
        t = n.replace("miasto stoleczne", "")
        t = re.sub(r"\s+", " ", t).strip()
        t = re.sub(r"warsz\w*", "warszawa", t)
        t = re.sub(r"\bmiejski\w*\b", "miasto", t)
        t = _W_RE.sub(" ", f" {t} ")
        t = re.sub(r"\bwarszawa\b", " ", t)
        return " ".join(t.split())
    if "rada" in n:
        return "rada miasta stolecznego warszawy"
    return "urzad miasta stolecznego warszawy"


def _municipal_unit_canonical(n: str) -> str | None:
    """Commune/city written as the unit, not the office, → the same municipality.

    ``Gmina Pokrzywnica`` and ``Miasto i Gmina Halinów`` are the same
    self-government as ``Urząd Gminy w Pokrzywnicy`` / ``Urząd Miejski w
    Halinowie`` — journalists swap them freely, so they fold onto the same
    ``urzad miasto <city>`` canonical. The city stays so two different towns
    for the same person stay different facts.
    """
    place: str | None = None
    for prefix in ("miasto i gmina ", "gmina i miasto ", "gmina ", "miasto "):
        if n.startswith(prefix):
            place = n[len(prefix) :].strip()
            break
    if not place or not place.split():
        return None
    place = _W_RE.sub(" ", place).strip()
    toks = place.split()
    toks = _drop_city_disambiguator(toks)
    toks[-1] = _stem_city_token(toks[-1])
    return "urzad miasto " + " ".join(toks)


def _county_canonical(n: str) -> str | None:
    """County written as itself, its office or its board → the starostwo.

    ``Powiat Gryfiński``, ``Starostwo Powiatowe w Gryfinie`` (+ ``we
    Wrocławiu``, ``Starostwo Powiatowe Wrocław``), ``Starostwo Powiatu
    Gryfińskiego`` and ``Zarząd Powiatu Gryfińskiego`` are the same county
    government — a person serves one county — so they all fold onto
    ``starostwo powiatowe``.
    """
    if n.startswith("starostwo powiat"):  # powiatowe / powiatu / + city
        return "starostwo powiatowe"
    if n.startswith("zarzad powiatu ") or n.startswith("zarzad powiatowy "):
        return "starostwo powiatowe"
    if n.startswith("powiat "):
        return "starostwo powiatowe"
    return None


def _solectwo_canonical(n: str) -> str | None:
    """Village self-government — sołectwo, its rada, its urząd — one unit.

    ``Sołectwo Laseczno``, ``Urząd Sołectwa Laseczno`` and ``Rada Sołecka
    Laseczna`` are one village; a person is sołtys of a single sołectwo, so
    they fold onto ``solectwo``.
    """
    if n.startswith(("solectwo ", "urzad solectwa ", "rada solecka ")):
        return "solectwo"
    return None


def _council_canonical(n: str) -> str | None:
    """City/council and sejmiki → one canonical per body type, else ``None``.

    ``Rada Miasta Krakowa``, ``Rada Miejska w Krakowie`` and ``Rada Gminy w
    Krakowie`` all fold to ``rada miasta krakow``; the council a person sits
    on stays pinned by the (stemmed) city so different-town councils across a
    person's career stay separate.
    """
    if re.match(r"^zarzad wojewodztwa [a-z]+$", n):
        return "zarzad wojewodztwa"
    n = re.sub(r"^rada miejsk\w*", "rada miasta", n)
    n = re.sub(r"^rada gmin\w*", "rada miasta", n)
    if n.startswith("rada miasta"):
        rest = n[len("rada miasta") :].strip()
        if rest:
            rest = _W_RE.sub(" ", f" {rest} ").strip()
            toks = rest.split()
            toks = _drop_city_disambiguator(toks)
            toks[-1] = _stem_city_token(toks[-1])
            return "rada miasta " + " ".join(toks)
        return "rada miasta"
    if n.startswith("sejmik "):
        toks = n.split()
        if len(toks) >= 3 and toks[0] in _VOIVODESHIPS and toks[1] == "sejmik":
            return "sejmik wojewodztwa " + toks[0]
        if len(toks) >= 2 and toks[1] in _VOIVODESHIPS:
            return "sejmik wojewodztwa " + _VOIVODESHIPS_GEN_OF[toks[1]]
        if len(toks) >= 2 and toks[1] in _VOIVODESHIPS_GEN:
            return "sejmik wojewodztwa " + toks[1]
    return None


def _smolensk_canonical(n: str) -> str | None:
    """Smoleńsk committees — wording variants of the same body type.

    ``10 kwietnia`` (2010) is the crash date, so date-only spellings
    (``podkomisja ds. ponownego zbadania wypadku lotniczego w dniu 10 kwietnia
    2010 roku``) fold into the same family as ``ds. katastrofy smolenskiej``.
    """
    m = re.search(r"\b(podkomisja|komisja|zespol)\b", n)
    if m and re.search(
        r"smolensk|tu\s*154|154m|10 kwietnia|wypadku lotniczego|"
        r"zbadania|wyjasnienia|badajacy",
        n,
    ):
        return f"{m.group(1)} ds. katastrofy smolenskiej"
    return None


def _hospital_canonical(n: str) -> str:
    """Named-hospital adjective/initial variants (Szpital Specjalistyczny
    im. S. Żeromskiego == Szpital im. Żeromskiego)."""
    adj = (
        "specjalistyczny|miejski|powiatowy|wojewodzki|kliniczny|regionalny|"
        "wojskowy|uniwersytecki|krajowy|kliniczny|psychiatryczny|"
        "rejonowy|onkologiczny|miejski|edukacyjny"
    )
    # Strip consecutive adjectives on either side of "szpital".
    for _ in range(3):
        n2 = re.sub(rf"^(szpital)(?:\s+(?:{adj}))+", "szpital", n)
        n2 = re.sub(
            rf"^(?:(?:{adj}))(?:\s+(?:{adj}))*\s+szpital(?:\s+(?:{adj}))*",
            "szpital",
            n2,
        )
        if n2 == n:
            break
        n = n2
    return n


def _strip_trailing_locative(n: str) -> str:
    """Drop a trailing `` w <miasto>`` seat for municipal/edu institution names.

    Only when the org begins with a known municipal/regional designator, so
    ``Miejski Ośrodek Sportu i Rekreacji w Radomiu`` and ``MOSIR`` both fold to
    ``miejski osrodek sportu i rekreacji`` while unrelated orgs keep their
    location. The person in the dedup key keeps seats apart across persons.
    """
    first2 = n.split(maxsplit=2)
    if not first2 or not any(t in _LOCATIVE_PREFIXES for t in first2[:2]):
        return n
    m = re.match(r"^(.*?)\s+(?:w|we)\s+[a-z][a-z0-9]*$", n)
    return m.group(1) if m else n


def _committee_connectives(n: str) -> str:
    """Committee conjunctions: "do spraw"/"do" ↔ "ds.", "Stały Komitet"
    ↔ "Komitet Stały"."""
    n = re.sub(r"^staly komitet ", "komitet staly ", n)
    n = re.sub(r"\bdo spraw\b", "ds.", n)
    n = re.sub(r"\b do \b", " ds. ", f" {n} ")
    return " ".join(n.split())


def _name_substitutions(n: str) -> str:
    n = re.sub(r"\s+w radzie miasta\b.*$", "", n)
    """Party-caucus and company-name substrings that recur inside longer names
    (``klub radnych PiS w Szczecińskiej Radzie Miasta``,
    ``Rada Nadzorcza PKN Orlen``, ``Polski Koncern Naftowy Orlen``).
    """
    n = re.sub(r"\bklub pis\b", "klub prawa i sprawiedliwosci", n)
    n = re.sub(
        r"\b(?:klub parlamentarny psl|parlamentarny klub psl|klub psl)\b",
        "klub polskiego stronnictwa ludowego",
        n,
    )
    n = re.sub(r"\bpkn orlen\b", "orlen", n)
    n = re.sub(r"\borlenu\b", "orlen", n)
    n = re.sub(r"\bpolski(ego)? koncern naftowy orlen\b", "orlen", n)
    return n


def _strip_scope_adjective(n: str) -> str:
    """Drop a leading scope adjective in front of a municipal institution type
    (``Miejski Ośrodek Pomocy Społecznej`` == ``Ośrodek Pomocy Społecznej``).
    """
    scope = (
        "miejski ", "miejskie ", "powiatowy ", "powiatowe ", "gminny ",
        "gminna ", "wojewodzki ", "wojewodzkie ", "panstwowy ", "panstwowe ",
    )
    inst = (
        "osrodek ", "szpital ", "centrum ", "szkola ", "przedsiebiorstwo ",
        "zaklad ", "zwiazek ", "biblioteka ", "izba ", "towarzystwo ",
    )
    for adj in scope:
        if n.startswith(adj) and n[len(adj):].startswith(inst):
            return n[len(adj):]
    return n


def _finish_org_forms(n: str) -> str:
    """Post-seat normalizations that can rewrite the whole org.

    Housing co-ops (``SM X`` ≡ ``Spółdzielnia Mieszkaniowa X`` ≡
    ``Spółdzielnia X``), supervisory boards of a company (``Rada Nadzorcza
    spółki/grupy X``), ARiMR in any word order, and named cultural venues
    (``Teatr Nowy im. K. Dejmka w Łodzi`` ≡ ``Teatr Nowy``).
    """
    # Patron dedication — the first name/initial is redundant:
    # "im. Gabriela Narutowicza" ≡ "im. Narutowicza", "im. S. Narutowicza" ≡
    # "im. Narutowicza".  Runs after the seat is stripped so "w krakowie" does
    # not look like a following name.
    n = re.sub(r"(\bim\.\s+)[a-z]\s*\.?\s+", r"\1", n)
    n = re.sub(
        r"\bim\.\s+(?:(?:dr\.?|prof\.?|sw\.?|ojca|ks\.?|[a-z])\.?\s+)?"
        r"[a-ząćęłńóśźż]+\s+(?=[a-ząćęłńóśźż])",
        "im. ",
        n,
    )
    n = re.sub(r"^spoldzielnia mieszkaniowa ", "spoldzielnia ", n)
    n = n.replace("spoldzielnia mieszkaniowa ", "spoldzielnia ")
    # "Resort Aktywów Państwowych" is the Ministry — the common synonym.
    if n.startswith("resort "):
        n = "ministerstwo " + n[len("resort") :].strip()
    n = re.sub(r"^rada nadzorcza (spolki|grupy) ", "rada nadzorcza ", n)
    if n.startswith("komisja ") and "rady miasta" in n:
        n = re.sub(r"\s+(?:bydgoskiej\s+)?rady miasta\s+[a-z]+$", "", n)
    if n.startswith("wydzial "):
        n = re.sub(r"\surzedu miasta [a-z]+$", "", n)
        n = re.sub(r"\s+umk$", "", n)
    if n == "arimr" or (
        n.startswith("agencja ")
        and "rolnictwa" in n
        and any(w in n for w in ("restrukturyzacji", "modernizacji", "rozwoju"))
    ):
        return "agencja restrukturyzacji i modernizacji rolnictwa"
    if n.startswith(
        ("teatr ", "opera ", "filharmonia ", "muzeum ", "galeria ", "biblioteka ")
    ):
        n = re.sub(r"\s+im\.\s+.*$", "", n)
    # Zakłady Azotowe Kędzierzyn — "Grupa Azoty ZAK", "Grupa Azoty Zakłady
    # Azotowe Kędzierzyn S.A." and "Zakłady Azotowe „Kędzierzyn”" are one plant.
    if "kedzierzyn" in n or n == "azoty zak":
        if "azoty" in n or "zak" in n:
            return "zaklady azotowe kedzierzyn"
    return n


def _canonical_org(org: str | None) -> str:
    """Canonical form of an org for dedup keys.

    The result is diacritic-folded and conflates the ways the same body is
    named: legal-form suffixes (``S.A.``/``SA``/``sp. z o.o.``/``SPZOZ``),
    ``... RP`` suffixes, ``m.st.``/``miasto stołeczne`` Warsaw spellings,
    the municipality as a unit vs its office (``Gmina Pokrzywnica`` =
    ``Urząd Gminy w Pokrzywnicy`` = ``urzad miasto pokrzywnic``; ``rada
    miasta``/``rada miejska``/``rada gminy``), trailing ``w <miasto>`` seats,
    designator prefixes (``grupa``/``spółka``/``koncern``), ``klub radnych X``
    vs ``klub X``, committee ``do (spraw)`` vs ``ds.``, ministry party/rename
    aliases and a curated company dictionary (``PKN Orlen``, ``Tauron Polska
    Energia``, ``PZU``, banks, ...).
    """
    n = _fold(_norm(org))
    if not n:
        return n
    n = re.sub(r"\s*\(.*?\)\s*", " ", n).strip()  # "(PGNiG)" etc.
    # Company-name punctuation: "Lotos - Biopaliwa", "Komisja X, Badań ...",
    # "Energa–Obrót", quotes around names („Energa").
    n = _REPLACE_PUNCT_RE.sub(" ", n)
    n = re.sub(r"\.\s+(?=\d)", ".", n)
    n = re.sub(r"(?<=\d)\.(?=\s)", "", n)
    for quote in ('"', "„", "”", "«", "»", "“", "‘", "’", "'"):
        n = n.replace(quote, " ")
    # SM / Spółdzielnia Mieszkaniowa — one org ("SM Jaskółka").
    n = re.sub(r"(?<![a-z0-9])s\.?\s*m\.?(?![a-z0-9])", "spoldzielnia mieszkaniowa", n)
    n = re.sub(r"\s+", " ", n)
    # The common misspelling "Rzeczpospolitej" (not "Rzeczypospolitej") would
    # otherwise split "Sejm RP" from "Sejm Rzeczpospolitej Polskiej".
    n = n.replace("rzeczpospolitej", "rzeczypospolitej")
    # PSP abbreviation → full form (genitive)
    n = re.sub(r"\bpsp\b", "panstwowej strazy pozarnej", n)
    n = _mswia_forms(n)
    # "Śląska Komenda Wojewódzka PSP" vs "KP PSP w Katowicach"
    if n.startswith("slaska ") and "komenda" in n:
        n = n.removeprefix("slaska ").strip()
    # m.st. / m. st. / m.st → m st (so the Warsaw checks match)
    n = _MST_RE.sub("m st", n)
    n = re.sub(r"\s+", " ", n)
    # Warsaw city forms: Rada / Urząd / Miasto Stołeczne / bare "m st Warszawy"
    warsaw = _warsaw_canonical(n)
    if warsaw is not None:
        return warsaw
    # Generic urzad handling
    if "urzad" in n:
        n = _canonical_urzad(n)
    # Commune/city unit written without "urzad" (Gmina X / Miasto i Gmina X).
    muni = _municipal_unit_canonical(n)
    if muni is not None:
        return muni
    # County government, named as itself, its starostwo or its board.
    county = _county_canonical(n)
    if county is not None:
        return county
    # Village self-government (sołectwo / its rada / its urząd).
    solectwo = _solectwo_canonical(n)
    if solectwo is not None:
        return solectwo
    # City councils and voivodeship sejmiki
    council = _council_canonical(n)
    if council is not None:
        return council
    # "Miejski Ośrodek Pomocy Społecznej" == "Ośrodek Pomocy Społecznej".
    n = _strip_scope_adjective(n)
    # Leading designators that are only legal-form/generic nouns.
    for prefix in (
        "grupa kapitalowa ",
        "grupa energetyczna ",
        "koncern energetyczny ",
        "panstwowy koncern ",
        "spolka ",
        "grupa ",
        "koncern ",
        "firma ",
        "partia ",
        "stowarzyszenie ",
    ):
        if n.startswith(prefix):
            n = n[len(prefix) :].strip()
            break
    # Council caucus: "Klub Radnych PiS" vs "Klub PiS".
    n = re.sub(r"^klub radnych ", "klub ", n)
    # Word order: "Parlamentarny Klub PSL" vs "Klub Parlamentarny PSL",
    # "Parlamentarny Zespół ..." vs "Zespół Parlamentarny ...".
    n = re.sub(r"^parlamentarny (klub|zespol) ", r"\1 parlamentarny ", n)
    # "Sejmowa Komisja X" is the same committee as "Komisja X"; committee
    # descriptors (sledcza/dorazna) are not part of the name.
    n = _komisja_forms(n)
    n = _committee_connectives(n)
    n = _name_substitutions(n)
    # Smoleńsk committees — wording variants of the same body type.
    smolensk = _smolensk_canonical(n)
    if smolensk is not None:
        return smolensk
    # Hospitals: adjectives and name initials don't change the institution.
    n = _hospital_canonical(n)
    # Legal-form suffix first, so "Zakłady Mechaniczne S.A. w Tarnowie" can
    # lose its seat too, then the trailing seat for municipal/edu institutions
    # and finally the post-seat org forms.
    n = _LEGAL_SUFFIX_RE.sub("", n)
    n = _strip_trailing_locative(n)
    n = _finish_org_forms(n)
    if n.endswith(" rzeczypospolitej polskiej"):
        n = n[: -len(" rzeczypospolitej polskiej")]
    elif n.endswith(" rp"):
        n = n[:-3].rstrip()
    n = re.sub(r"\s+", " ", n).strip()
    # A party used as an org (``prezes @ PSL`` vs ``@ Polskie Stronnictwo
    # Ludowe``) folds under the same aliases as party_membership.
    if n in _PARTY_ALIASES:
        return _PARTY_ALIASES[n]
    return _ORG_ALIASES.get(n, n)


# Role variants (gender, ``prezes zarządu`` form) folded for dedup keys.
# Keys/values are diacritic-folded at construction, so "przewodnicząca" and
# "przewodniczaca" map under the same folded key.
_ROLE_ALIASES_RAW: dict[str, str] = {
    "minister": "minister",
    "ministra": "minister",
    "ministerka": "minister",
    "szef": "szef",
    "szefowa": "szef",
    "szef zarządu": "szef",
    "wiceszef": "wiceszef",
    "wiceszefowa": "wiceszef",
    "poseł": "poseł",
    "posłanka": "poseł",
    "prezes": "prezes",
    "prezes zarządu": "prezes",
    "prezeska": "prezes",
    "wiceprezes": "wiceprezes",
    "wiceprezes zarządu": "wiceprezes",
    "wiceprezeska": "wiceprezes",
    "członek": "członek",
    "członkini": "członek",
    "radny": "radny",
    "radna": "radny",
    "radni": "radny",
    "przewodniczący": "przewodniczący",
    "przewodnicząca": "przewodniczący",
    "wiceprzewodniczący": "wiceprzewodniczący",
    "wiceprzewodnicząca": "wiceprzewodniczący",
    "wicprzewodniczący": "wiceprzewodniczący",
    "viceprzewodniczący": "wiceprzewodniczący",
    "lider": "lider",
    "liderka": "lider",
    "koordynator": "koordynator",
    "koordynatorka": "koordynator",
    "rzecznik": "rzecznik",
    "rzeczniczka": "rzecznik",
    "rzecznik prasowy": "rzecznik",
    "współprowadzący program": "współprowadzący",
    "współprowadząca program": "współprowadzący",
    "komendanta wojewódzkiego": "komendant wojewódzki",
    "komendanta": "komendant",
    "komendantka": "komendant",
    "marszałek": "marszałek",
    "marszałkini": "marszałek",
    # Acting / locum tenure: "pełniący obowiązki prezesa" == "prezes".
    "pełniący obowiązki prezesa": "prezes",
    "pełniący obowiązki dyrektora": "dyrektor",
    "pełniący obowiązki prezydenta": "prezydent",
    "pełniący obowiązki burmistrza": "burmistrz",
    "pełniący obowiązki komendanta": "komendant",
    "pełniący obowiązki szefa": "szef",
    # Inflected (genitive) forms the extractor emits for the same role.
    "dyrektora": "dyrektor",
    "dyrektorki": "dyrektor",
    "dyrektorka": "dyrektor",
    "prezesa": "prezes",
    "prezesów": "prezes",
    "prezydenta": "prezydent",
    "burmistrza": "burmistrz",
    "marszałka": "marszałek",
    "sekretarza": "sekretarz",
    "starosty": "starosta",
    "wójta": "wójt",
    "rzecznika": "rzecznik",
    "wiceprezydenta": "wiceprezydent",
    "wicemarszałka": "wicemarszałek",
    "wicewojewody": "wicewojewoda",
    "wojewody": "wojewoda",
    "wiceministra": "wiceminister",
    # In the cabinet, "podsekretarz stanu" is how the wiceminister is titled.
    "podsekretarz": "wiceminister",
    "podsekretarz stanu": "wiceminister",
    "sekretarz generalny": "sekretarz",
    "sekretarz generalna": "sekretarz",
    "marszałek województwa": "marszałek",
    "wicemarszałek województwa": "wicemarszałek",
    "dyrektor naczelny": "dyrektor",
    "dyrektorka naczelna": "dyrektor",
    "członkini rady nadzorczej": "członek rady nadzorczej",
    "członek rady nadzorczej": "członek rady nadzorczej",
    "przedstawiciel miasta": "przedstawiciel",
}
_ROLE_ALIASES: dict[str, str] = {
    _fold(k).lower(): _fold(v).lower() for k, v in _ROLE_ALIASES_RAW.items()
}

# Ordinal qualifiers in front of deputy roles ("I zastępca prezydenta",
# "drugi wicewojewoda") — folded away so "1st deputy" and "deputy" dedupe.
_ROLE_ORDINALS = (
    "i",
    "ii",
    "iii",
    "iv",
    "v",
    "pierwszy",
    "pierwsza",
    "drugi",
    "druga",
    "trzeci",
    "trzecia",
    "czwarty",
    "czwarta",
)


def _canonical_role(role: str | None, org_canon: str | None = None) -> str:
    """Fold role gender/inflection variants used for dedup keys.

    ``org_canon`` is the canonical org of the same fact; the scope adjectives
    that merely repeat the org's scope (``wojewódzki`` in a wojewódzki urząd,
    ``miasta`` in an urząd miasta) are dropped so the role matches the bare
    variant from another article.
    """
    r = _fold(_norm(role))
    if not r:
        return r
    # "marszałek-senior" == "marszałek senior" — hyphen is not a word.
    r = re.sub(r"[-–—,]+", " ", r)
    r = " ".join(r.split())
    # Strip the "pełniący obowiązki" / "p.o." prefix, so the acting-role
    # ("pełniący obowiązki komendanta wojewódzkiego") folds on the base role.
    r = re.sub(r"^(pełniący obowiązki|p\.o\.|p o)\s+", "", r)
    r = _fold(_norm(r))
    # Ordinal qualifiers on deputy roles collapse to the bare role.
    for ordinal in _ROLE_ORDINALS:
        if r.startswith(ordinal + " "):
            r = r[len(ordinal) + 1 :].strip()
            break
    r = _ROLE_ALIASES.get(r, r)
    if org_canon:
        if "wojewodz" in org_canon:
            r = re.sub(
                r"\b(wojewodztwa|wojewodzki|wojewodzkiego|wojewodzka|wojewodzkiej)\b",
                " ",
                r,
            )
        if "powiat" in org_canon:
            r = re.sub(r"\b(powiatu|powiatowego|powiatowa|powiatowy)\b", " ", r)
        if "miasto" in org_canon and re.match(
            r"^(zastepca|przedstawiciel|doradca|pelnomocnik)", r
        ):
            r = re.sub(r"\b(miasta|miasto)\b", " ", r)
        if org_canon.startswith("rada nadzorcza") and re.match(
            r"^czlonek rady( nadzorczej)?$", r
        ):
            r = "czlonek rady nadzorczej"
        # A member of "Zarząd X" is a "członek zarządu"; "Doradca burmistrza"
        # at an urząd miasta is the same as "doradca" (with its scope).
        if org_canon.startswith("zarzad ") and r == "czlonek":
            r = "czlonek zarzadu"
        if org_canon == "parlament europejski" and r == "posel":
            r = "europosel"
        # "zarzad" scope for "czlonek" done; "doradca burmistrza" scope drop.
        if "miasto" in org_canon and r.startswith("doradca"):
            r = re.sub(r"\b(burmistrza|miasta|miasto)\b", " ", r)
        # "szef resortu"/"wiceszef resortu" are the minister/wiceminister.
        if org_canon.startswith(("ministerstwo ", "resort ")):
            if r == "szef":
                r = "minister"
            elif r == "wiceszef":
                r = "wiceminister"
        # "komendant wojewódzki" in a "komenda wojewódzka psp" org — scope said it.
        if "komenda" in org_canon:
            r = re.sub(r"\bwojewodzki\b", "", r)
    return " ".join(r.split())


# A dedup key: fact type plus entity components, where the person slot is a
# (literal name, koryta id) pair so same-named people stay separated.
_FactKey = tuple[str | tuple[str, str], ...]


# Roles that only make sense as the head of a municipality — used to fold a
# bare town-name org ("burmistrz @ Kisielice") onto "urzad miasto <city>".
_MUNICIPAL_HEAD_ROLES = {
    "wojt",
    "burmistrz",
    "prezydent",
    "wiceprezydent",
    "zastepca prezydenta",
}
# Single-token org canonicals that must NOT be treated as a bare town.
_MUNICIPAL_HEAD_ORGS = {"urzad", "miasto", "gmina", "powiat", "rada"}


def _fact_key(
    fact: dict[str, Any],
    person_name: str | None = None,
    person_id: str | None = None,
) -> _FactKey:
    """A dedup key for a fact across articles.

    Exact on the entity fields (fuzzy name matching is intentionally left
    out); party_membership additionally folds party aliases, so "PiS" and
    "Prawo i Sprawiedliwość" group together.

    The person component is ``(literal name, koryta id)`` — the name first, so
    spelling variants stay apart, then the id, which splits same-named people
    who are different koryta individuals (e.g. two different "Piotr Woźniak"
    with different ids). An empty id keeps the name grouping when the person
    was never confirmed against koryta.
    """
    fact_type = str(fact.get("fact_type") or "")
    person = (
        (person_name, person_id or "")
        if person_name is not None
        else (_norm(fact.get("person")), person_id or "")
    )
    if fact_type == "employment":
        org_canon = _canonical_org(fact.get("organization"))
        # "burmistrz @ Kisielice" (bare town as the org) is the municipal
        # office — fold it onto the same "urzad miasto <city>" canonical.
        # Skips ALL-CAPS acronym orgs ("EUROMONTANA", "PZU", ...).
        raw_org = fact.get("organization") or ""
        if (
            not raw_org.isupper()
            and len(org_canon.split()) <= 2
            and org_canon not in _MUNICIPAL_HEAD_ORGS
        ):
            role0 = _canonical_role(fact.get("role"), org_canon)
            if role0 in _MUNICIPAL_HEAD_ROLES:
                town = _stem_city_token(org_canon)
                org_canon = (
                    "urzad miasta stolecznego warszawy"
                    if town == "warszaw"
                    else "urzad miasto " + town
                )
        return (
            fact_type,
            person,
            org_canon,
            _canonical_role(fact.get("role"), org_canon),
        )
    if fact_type == "party_membership":
        return (
            fact_type,
            person,
            _canonical_party(fact.get("party")),
        )
    if fact_type == "personal_relation":
        return (
            fact_type,
            person,
            _norm(fact.get("object")),
            _norm(fact.get("relation")),
        )
    if fact_type == "affair_involvement":
        return (
            fact_type,
            person,
            _norm(fact.get("role")),
            _norm(fact.get("affair")),
        )
    return (fact_type, json.dumps(fact, sort_keys=True, default=str))


# Mentions are an OPTIONAL enrichment: ArticleAnalyzed reads article_person_mentions
# by path when present. Declaring it as a pipeline source would make the runner
# auto-rebuild it whenever it looks stale (its sources are refreshed often) —
# an expensive, hours-long job that would clobber a good file mid-run.
_MENTIONS_FILE = (
    Path(VERSIONED_DIR) / "article_person_mentions" / "article_person_mentions.jsonl"
)
_KORYTA_PEOPLE_FILE = Path(VERSIONED_DIR) / "person_koryta" / "person_koryta.jsonl"

# Verifier bookkeeping fields kept in article_facts_verified but stripped from
# the analyzed output.
_VERIFICATION_FIELDS = {"verified", "verification_verdict", "verification_reason"}


class ArticleAnalyzed(IncrementalJsonlPipeline[ArticleAnalyzedRecord]):
    filename = "article_analyzed"
    backup_to_shared_cache = False  # large incremental output, keep local-only
    # No interrupt_exceptions: a Ctrl+C during the merge still flushes via the
    # base's finally, then propagates (this step is cheap to re-run).

    parsed: ArticleParsed
    koryciarski_scores: ArticleKoryciarskiScores
    verified_facts: ArticleFactsVerified

    @property
    def output_class(self):
        return ArticleAnalyzedRecord

    def process(self, ctx: Context) -> pd.DataFrame:
        tag = article_tag()

        # Load facts first (small) to get the URL set we care about
        print("Loading facts...")
        facts = _load_facts(_FACTS_FILE)
        if not facts:
            print("No facts found, nothing to emit")
            return pd.DataFrame()
        print(f"  {len(facts):,} articles with facts")

        # Load scores (small, ~16MB) filtered to facts URLs
        print("Loading scores...")
        scores = _load_jsonl_filtered(_SCORES_FILE, facts)
        print(f"  {len(scores):,} matching scores")

        # Stream parsed (large) — only keep rows whose URL is in facts
        print("Streaming parsed articles...")
        parsed = _load_jsonl_filtered(_PARSED_FILE, facts)
        print(f"  {len(parsed):,} matching parsed records")

        # People confirmed in each article (koryta ids) — a small extra file.
        print("Loading person mentions...")
        koryta_ids_by_url = _koryta_ids_by_url(_MENTIONS_FILE)
        person_ids_by_url = _person_ids_by_url(_MENTIONS_FILE)
        print(f"  {len(koryta_ids_by_url):,} articles with confirmed mentions")

        keep_evidence = article_analyzed_keep_evidence()
        only_matched = article_analyzed_only_matched_koryta()
        # Names of the koryta people each article's ids resolve to, so a fact
        # whose person matches by name can be tied to a person page (the exact
        # rule the website ingest applies).
        koryta_name_by_id = _koryta_name_by_id(_KORYTA_PEOPLE_FILE)
        print(f"  {len(koryta_name_by_id):,} koryta people loaded")

        emitted = 0
        # url -> (parsed_row, score_row, publication_date, [(fact_key, fact)])
        pending: dict[
            str,
            tuple[
                dict[str, Any],
                dict[str, Any] | None,
                str | None,
                list[tuple[_FactKey, dict[str, Any]]],
            ],
        ] = {}
        first_seen: dict[_FactKey, str] = {}
        evidence_by_key: dict[_FactKey, list[str]] = {}

        for url, fact_rows in tqdm(facts.items(), desc="Filtering", unit="article"):
            parsed_row = parsed.get(url)
            if parsed_row is None:
                continue
            score_row = scores.get(url)

            # Prefer the parse-time date; fall back to re-deriving it from the
            # stored ld+json blob (older rows / @graph pages missed it at parse).
            publication_date = parsed_row.get(
                "publication_date"
            ) or date_iso_from_ld_json(parsed_row.get("ld_json"))

            # Keep only verified facts and stamp each with the article date.
            # The verifier's bookkeeping fields stay in article_facts_verified;
            # they're redundant here (every kept fact is verified).
            verified_facts = []
            for fact in fact_rows:
                if not isinstance(fact, dict) or fact.get("verified") is False:
                    continue
                fact = _strip_and_date_fact(fact, publication_date)
                if only_matched and not _fact_matches_koryta(
                    fact, url, koryta_ids_by_url.get(url, []), koryta_name_by_id
                ):
                    continue
                verified_facts.append(fact)
            triaged = _dedup_facts_for_article(
                url,
                verified_facts,
                first_seen,
                evidence_by_key,
                person_ids=person_ids_by_url.get(url),
            )

            # Skip articles whose facts were all filtered out — an analyzed
            # record with no facts carries no signal.
            if not triaged:
                continue

            pending[url] = (parsed_row, score_row, publication_date, triaged)

        kept_facts = 0
        # Between-article duplicates: keep the fact only in its first-seen
        # article; everywhere else it collapses into the first fact's evidence.
        for url, (parsed_row, score_row, publication_date, triaged) in tqdm(
            pending.items(), desc="Emitting", unit="article"
        ):
            deduped_facts = _collapse_between_articles(
                url, triaged, first_seen, evidence_by_key, keep_evidence=keep_evidence
            )
            if not deduped_facts:
                continue

            record = ArticleAnalyzedRecord(
                url=url,
                domain=parsed_row.get("domain", ""),
                title=parsed_row.get("title")
                or title_from_ld_json(parsed_row.get("ld_json")),
                publication_date=publication_date,
                article_content=parsed_row.get("article_content", ""),
                koryciarski_llm_score=(
                    score_row.get("koryciarski_llm_score") if score_row else None
                ),
                koryciarski_llm_reason=(
                    score_row.get("koryciarski_llm_reason", "") if score_row else ""
                ),
                extracted_facts=deduped_facts,
                koryta_ids=koryta_ids_by_url.get(url, []),
                tag=tag,
            )
            ctx.io.dumper.insert_into(record, [])  # type: ignore[attr-defined]
            emitted += 1
            kept_facts += len(deduped_facts)

        print(f"Emitted {emitted:,} ArticleAnalyzed records, {kept_facts:,} facts")
        return pd.DataFrame()


def _strip_and_date_fact(
    fact: dict[str, Any], publication_date: str | None
) -> dict[str, Any]:
    """Drop verifier bookkeeping and stamp the article date onto a fact."""
    fact = {k: v for k, v in fact.items() if k not in _VERIFICATION_FIELDS}
    fact["date"] = publication_date
    return fact


def _dedup_facts_for_article(
    url: str,
    verified_facts: list[dict[str, Any]],
    first_seen: dict[_FactKey, str],
    evidence_by_key: dict[_FactKey, list[str]],
    person_ids: dict[str, str] | None = None,
) -> list[tuple[_FactKey, dict[str, Any]]]:
    """Within-article dedup; record global first-seen and evidence.

    ``person_ids`` maps the article's confirmed person names to their koryta
    ids, so same-named individuals who are different koryta people get
    different dedup keys.
    """
    person_ids = person_ids or {}
    triaged: list[tuple[_FactKey, dict[str, Any]]] = []
    seen_this_article: set[_FactKey] = set()
    for fact in verified_facts:
        name, pid = _fact_person(fact, person_ids)
        key = _fact_key(fact, person_name=name, person_id=pid)
        # Within-article duplicates: keep the first occurrence only.
        if key in seen_this_article:
            continue
        seen_this_article.add(key)
        first_seen.setdefault(key, url)
        evidence_by_key.setdefault(key, []).append(url)
        triaged.append((key, fact))
    return triaged


def _fact_person(
    fact: dict[str, Any], person_ids: dict[str, str]
) -> tuple[str, str | None]:
    """(literal name, koryta person id) the fact's subject resolves to.

    ``person`` carries the fact's subject for most types; a personal_relation
    names it ``subject``. The literal name is always the key's first part; the
    id ('' when the person was never confirmed in the article) splits
    same-named people.
    """
    name = str(fact.get("person") or fact.get("subject") or "")
    normed = _norm(name)
    return normed, person_ids.get(normed, "")


def _person_ids_by_url(path: Path) -> dict[str, dict[str, str]]:
    """url -> {confirmed person name -> koryta person id}.

    Reads ArticlePersonMentions (one row per (article, person) pair) and keeps
    only pairs the LLM judge confirmed (``verdict == 'yes'``), so only genuine
    mentions split same-named facts.
    """
    result: dict[str, dict[str, str]] = {}
    if not path.exists():
        return result
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row: dict[str, Any] = json.loads(line)
            except Exception:
                continue
            if row.get("verdict") != "yes":
                continue
            url = row.get("url")
            person = row.get("person")
            person_id = row.get("person_id")
            if (
                not isinstance(url, str)
                or not url
                or not isinstance(person, str)
                or not person.strip()
                or not isinstance(person_id, str)
                or not person_id
            ):
                continue
            result.setdefault(url, {}).setdefault(_norm(person), person_id)
    return result


def _koryta_name_by_id(path: Path) -> dict[str, str]:
    """koryta person id -> full name from the person_koryta dataset."""
    result: dict[str, str] = {}
    if not path.exists():
        return result
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row: dict[str, Any] = json.loads(line)
            except Exception:
                continue
            person_id = row.get("id")
            name = row.get("full_name")
            if (
                isinstance(person_id, str)
                and person_id
                and isinstance(name, str)
                and name.strip()
            ):
                result[person_id] = name
    return result


def _collapse_between_articles(
    url: str,
    triaged: list[tuple[_FactKey, dict[str, Any]]],
    first_seen: dict[_FactKey, str],
    evidence_by_key: dict[_FactKey, list[str]],
    keep_evidence: bool = False,
) -> list[dict[str, Any]]:
    """Keep only facts first seen in this article; optionally attach evidence."""
    deduped: list[dict[str, Any]] = []
    for key, fact in triaged:
        if first_seen[key] != url:
            continue
        fact = dict(fact)
        if keep_evidence:
            fact["evidence"] = list(evidence_by_key[key])
        deduped.append(fact)
    return deduped


def _fact_matches_koryta(
    fact: dict[str, Any],
    url: str,
    koryta_ids: list[str],
    koryta_name_by_id: dict[str, str],
) -> bool:
    """Whether a fact's person (subject for relations) matches one of the
    article's confirmed koryta people by normalized name — the same match the
    website ingest uses to link a fact to a person page.
    """
    subject = fact.get("person") or fact.get("subject")
    if not subject or not koryta_ids:
        return False
    normed = _normalize_person_name(subject)
    return any(
        _normalize_person_name(koryta_name_by_id.get(pid)) == normed
        for pid in koryta_ids
    )


def _load_facts(path: Path) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {}
    if not path.exists():
        return result
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row: dict[str, Any] = json.loads(line)
                url = row.get("url")
                facts = row.get("extracted_facts")
                if isinstance(url, str) and url and isinstance(facts, list) and facts:
                    result[url] = facts
            except Exception:
                continue
    return result


def _load_jsonl_filtered(
    path: Path, url_set: dict[str, Any]
) -> dict[str, dict[str, Any]]:
    """Stream a jsonl file, keeping only rows whose url is in url_set."""
    result: dict[str, dict[str, Any]] = {}
    if not path.exists():
        return result
    total = path.stat().st_size
    with (
        path.open(encoding="utf-8") as f,
        tqdm(total=total, unit="B", unit_scale=True, desc=f"  {path.name}") as bar,
    ):
        for line in f:
            bar.update(len(line.encode("utf-8")))
            line = line.strip()
            if not line:
                continue
            try:
                row: dict[str, Any] = json.loads(line)
                url = row.get("url")
                if isinstance(url, str) and url in url_set:
                    result[url] = row
            except Exception:
                continue
    return result


def _koryta_ids_by_url(path: Path) -> dict[str, list[str]]:
    """koryta ids of the people confirmed in each article.

    Reads ArticlePersonMentions (one row per (article, person) pair) and keeps
    only pairs the LLM judge confirmed (``verdict == 'yes'``), deduplicated in
    file order per article.
    """
    result: dict[str, list[str]] = {}
    if not path.exists():
        return result
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row: dict[str, Any] = json.loads(line)
            except Exception:
                continue
            if row.get("verdict") != "yes":
                continue
            url = row.get("url")
            person_id = row.get("person_id")
            if (
                not isinstance(url, str)
                or not url
                or not isinstance(person_id, str)
                or not person_id
            ):
                continue
            ids = result.setdefault(url, [])
            if person_id not in ids:
                ids.append(person_id)
    return result
