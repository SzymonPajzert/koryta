"""Find mentions of known people in parsed articles.

Cross-references the koryta people dataset (``person_koryta``) with the parsed
article corpus (``article_parsed``). Each article's text is scanned for
capitalized name sequences that match a known person and one record is emitted
per (article, person) pair, carrying the URL, the title, date and tags
recovered from the article's ld+json metadata.

Matching is nominative-only and diacritics-insensitive (e.g. "Jana
Kowalskiego" is not caught), so the output is a lower bound on true mentions.

A name match alone is not enough: a common name can be a coincidence, so every
matched person must also be confirmed by independent evidence (``proof``). The
person's parties and organizations (resolved from its ``rejestrIo`` id through
the KRS register) are looked up in the article text; a person is kept only
when at least one signal matches, and the ``proof`` dict records which ones
did. People are keyed by their koryta ``id``, not by register ids.
"""

import asyncio
import json
import re
from collections import Counter
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import pandas as pd
from tqdm import tqdm

from analysis.utils import as_sequence
from entities.article import ArticlePersonMentioned, ProofSignal
from scrapers.article.parse import date_iso_from_ld_json, title_from_ld_json
from scrapers.article.pipelines.common import (
    ascii_lower,
    normalize_text,
    strip_think_blocks,
)
from scrapers.article.pipelines.domain_to_region_pipeline import DomainToRegion
from scrapers.article.pipelines.incremental import IncrementalJsonlPipeline
from scrapers.article.pipelines.parsed_pipeline import ArticleParsed
from scrapers.article.pipelines.pipeline_utils import llm_model
from scrapers.koryta.download import KorytaPeople
from scrapers.stores import (
    LLM,
    VERSIONED_DIR,
    Context,
    LLMRequest,
    LLMResponsePool,
    iterate_pipeline_dict,
)

JUDGE_VERSION = 1
# Generous output budget so thinking models can finish their reasoning AND
# emit the verdict (they sometimes burn a lot inside <think>). Must stay well
# below the vLLM total-context cap (32768 tokens) minus the prompt, or the
# server rejects the request with HTTP 400.
MAX_TOKENS = 16000
TEMPERATURE = 0.0
TEXT_LIMIT = 30000
# Window of article text sent to the judge around the first name match. Long
# articles with a single mention make the model reason endlessly (and truncate
# into `unknown`), so we show a focused excerpt instead of the whole text.
CONTEXT_BEFORE = 2000
CONTEXT_AFTER = 3000

# A word is capitalized when it starts with an uppercase Polish letter.
_CAP = "A-ZĄĆĘŁŃÓŚŹŻ"
_LOW = "a-ząćęłńóśźż"
_WORD = rf"[{_CAP}][{_LOW}]+(?:['-][{_CAP}{_LOW}]+)*"
# Consecutive capitalized words (2..6) -> a candidate person-name run.
_MAX_RUN_WORDS = 6
_RUN_RE = re.compile(rf"(?:{_WORD}\s+){{1,{_MAX_RUN_WORDS - 1}}}{_WORD}")

# Domain -> region mapping (kept as an input file in files/, published to the
# shared cache by the DomainToRegion pipeline). Each entry lists the regions
# (woj/woj_code/powiat/powiat_code/miasto) the outlet covers.
# Temporary debug dump: one line per judged (article, person) pair with a
# truncated article excerpt, so verdicts can be eyeballed later.
_DEBUG_FILE = Path(VERSIONED_DIR) / "article_person_mentions" / "judge_debug.jsonl"
_DEBUG_CONTENT_LIMIT = 2000


def _name_tuple(name: str) -> tuple[str, ...]:
    return tuple(normalize_text(t) for t in str(name).split())


def _tags_from_ld_json(ld_json: Any) -> list[str]:
    """Keywords and article sections from a stored ld+json blob (incl. @graph)."""
    tags: list[str] = []

    def collect(item: Any) -> None:
        if isinstance(item, dict):
            for key in ("keywords", "articleSection"):
                value = item.get(key)
                if isinstance(value, str) and value.strip():
                    tags.append(value.strip())
                elif isinstance(value, list):
                    for v in value:
                        if isinstance(v, str) and v.strip():
                            tags.append(v.strip())
            graph = item.get("@graph")
            if isinstance(graph, list):
                for node in graph:
                    collect(node)
        elif isinstance(item, list):
            for sub in item:
                collect(sub)

    collect(ld_json)
    # Case-insensitive dedupe (e.g. "polityka" vs "Polityka"), keep first casing.
    seen: set[str] = set()
    deduped: list[str] = []
    for tag in tags:
        key = tag.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(tag)
    return deduped


class PersonNameIndex:
    """Lookup from normalized name tuples to the people they refer to."""

    def __init__(self) -> None:
        self._by_tuple: dict[tuple[str, ...], dict[str, str]] = {}
        self.max_len = 0
        self.people = 0
        self.forms = 0
        self._seen_people: set[str] = set()

    def add(self, display: str, name_forms: list[tuple[str, ...]]) -> None:
        """Register every spelling variant of one person's name.

        Display names that normalize to the same string (e.g. "Zieliński" and
        "Zielinski") are treated as one person; koryta names are unique, so the
        first spelling seen wins.
        """
        norm_display = normalize_text(display)
        if norm_display not in self._seen_people:
            self._seen_people.add(norm_display)
            self.people += 1
        for form in name_forms:
            if len(form) < 2:
                continue
            self._by_tuple.setdefault(form, {}).setdefault(norm_display, display)
            self.max_len = max(self.max_len, len(form))
            self.forms += 1

    def find_in_text(self, text: str) -> set[str]:
        """Return the display names of people mentioned in ``text``."""
        found: set[str] = set()
        for run in _RUN_RE.findall(text):
            words = run.split()
            n_words = len(words)
            max_n = min(n_words, self.max_len)
            for n in range(2, max_n + 1):
                for i in range(n_words - n + 1):
                    key = tuple(normalize_text(w) for w in words[i : i + n])
                    names = self._by_tuple.get(key)
                    if names:
                        found.update(names.values())
        return found


# National party abbreviations / names an article is likely to use, mapped
# from the long committee names stored in the data. The article text is
# searched for these short forms instead of the full committee name. Keys that
# are also ordinary Polish words (po, lewica, wiosna, razem, ko) are left out:
# they would match far too often to count as proof.
_PARTY_KEYS = (
    ("pis", "prawo i sprawiedliwosc"),
    ("psl", "polskie stronnictwo ludowe"),
    ("sld", "sojusz lewicy demokratycznej"),
    ("koalicja obywatelska", "koalicja obywatelska"),
    ("konfederacja", "konfederacja"),
    ("nowoczesna", "nowoczesna"),
    ("trzecia droga", "trzecia droga"),
    ("polska 2050", "polska 2050"),
    ("pl2050", "pl2050"),
    ("samoobrona", "samoobrona"),
    ("liga polskich rodzin", "ligi polskich rodzin"),
    ("zjednoczona prawica", "zjednoczona prawica"),
    ("akcja wyborcza solidarnosc", "akcja wyborcza solidarnosc"),
    ("unia wolnosci", "unia wolnosci"),
)


# Koryta people carry short party labels (PiS, PO, PSL...). Map them to the
# terms to search for in article text. "PO" is deliberately NOT a search term
# on its own (it is an ordinary Polish word); its people are matched through
# the coalition name instead. Kept separate from _PARTY_KEYS so the full
# committee names still resolve through the generic loop below.
_KORYTA_PARTY_TERMS: dict[str, set[str]] = {
    "pis": {"pis", "prawo i sprawiedliwosc"},
    "po": {"koalicja obywatelska"},
    "psl": {"psl", "polskie stronnictwo ludowe"},
    "polska 2050": {"polska 2050", "pl2050"},
    "nowa lewica": {"nowa lewica"},
    "konfederacja": {"konfederacja"},
}


def _party_match_terms(party_norm: str) -> set[str]:
    """Terms to look for in article text for a stored party label.

    Short koryta labels resolve through ``_KORYTA_PARTY_TERMS``; anything else
    is treated as a committee name and matched against ``_PARTY_KEYS``, which
    adds the short key and the bare name (e.g. ``pis`` and ``prawo i
    sprawiedliwosc``) so an article saying either ``PiS`` or ``Prawo i
    Sprawiedliwość`` counts as a match.
    """
    if party_norm in _KORYTA_PARTY_TERMS:
        return set(_KORYTA_PARTY_TERMS[party_norm])
    terms: set[str] = set()
    for key, needle in _PARTY_KEYS:
        if needle in party_norm:
            terms.add(key)
            terms.add(needle)
    return terms


# Common Polish nominal endings, stripped from the *end* so a company name and
# its declined form ("Przedsiębiorstwo" vs "Przedsiębiorstwa") share a stem.
_NOMINAL_SUFFIXES = (
    "owymi",
    "owego",
    "owej",
    "owym",
    "owych",
    "owie",
    "owego",
    "owemu",
    "ami",
    "ach",
    "om",
    "iem",
    "em",
    "u",
    "ie",
    "ej",
    "ego",
    "e",
    "i",
    "y",
    "a",
)
_STOP_ORG_WORDS = {
    "spolka",
    "spolki",
    "spolce",
    "spolke",
    "spolk",
    "spółka",
    "spółki",
    "spółk",
    "z",
    "ograniczona",
    "odpowiedzialnoscia",
    "odpowiedzialnosci",
    "odpowiedzialnosc",
    "spzoo",
    "sa",
    "s",
    "zaklad",
    "zaklady",
    "fundacja",
    "fundacji",
    "centrum",
    "sp",
    "akcyjna",
    "polska",
    "polskie",
    "polski",
    "polskiej",
    "krajowa",
    "krajowy",
    "powiatowa",
    "powiatowy",
    "miejskie",
    "miejskiego",
    "miejski",
    "miejskiej",
    "miejsca",
}


def _stem(word: str) -> str:
    """Light Polish stem: strip a common nominal ending off ``word``."""
    for suffix in _NOMINAL_SUFFIXES:
        if len(word) - len(suffix) >= 4 and word.endswith(suffix):
            return word[: len(word) - len(suffix)]
    return word


def _org_match_terms(org_norm: str) -> set[str]:
    """Significant word stems of an organization name to search the article for.

    Drops company-form words (``spółka``, ``z o.o.``) and keeps the
    distinguishing stems, so ``Przedsiębiorstwo Gospodarki Komunalnej i
    Mieszkaniowej Sp. z o.o.`` matches an article that declines any of them.
    """
    stems: set[str] = set()
    for word in org_norm.split():
        stripped = normalize_text(word)
        stemmed = _stem(stripped)
        if stripped in _STOP_ORG_WORDS or stemmed in _STOP_ORG_WORDS:
            continue
        if len(stemmed) >= 5:
            stems.add(stemmed)
    return stems


def _generic_org_stems(
    rows: Iterable[dict[str, Any]],
    krs_names: dict[str, str],
    person_krs: dict[str, set[str]],
) -> frozenset[str]:
    """Org stems too common across people to count as disambiguating proof.

    A stem appearing in many DIFFERENT people's organization names (e.g.
    ``przedsiebiorstwo``, ``komunaln``, ``opiek``) matches nearly any article
    and cannot confirm a specific person. Only stems that are distinctive to
    a small set of people are usable as org proof.
    """
    stem_people: Counter[str] = Counter()
    for row in rows:
        orgs: set[str] = set()
        for krs in _employed_krs(row, person_krs):
            name = krs_names.get(str(krs)) if krs else None
            if name:
                orgs |= _org_match_terms(ascii_lower(name))
        for stem in orgs:
            stem_people[stem] += 1
    # A stem shared by more than 500 distinct people is inherently generic.
    return frozenset(stem for stem, count in stem_people.items() if count > 500)


class PersonProfile:
    """Disambiguation evidence for one person: regions, parties, organizations."""

    __slots__ = ("woj", "powiat", "parties", "orgs")

    def __init__(self) -> None:
        self.woj: set[str] = set()
        self.powiat: set[str] = set()
        self.parties: set[str] = set()
        self.orgs: set[str] = set()

    def merge(self, other: "PersonProfile") -> None:
        self.woj.update(other.woj)
        self.powiat.update(other.powiat)
        self.parties.update(other.parties)
        self.orgs.update(other.orgs)

    def has_any(self) -> bool:
        return bool(self.woj or self.powiat or self.parties or self.orgs)


class PersonProfileIndex:
    """Per-person disambiguation evidence, kept separate across name collisions.

    A display name may map to several people (same first+last name, distinct
    ``person_id``). Each person keeps its OWN profile - signals are NOT merged
    across identities, so an article can be attributed to the specific person
    it actually refers to (the proof filter and the LLM judge both see only
    that person's signals).
    """

    def __init__(self) -> None:
        self._by_display: dict[str, list[tuple[str, PersonProfile]]] = {}

    def add(self, display: str, person_id: str, profile: PersonProfile) -> None:
        key = normalize_text(display)
        self._by_display.setdefault(key, []).append((person_id, profile))

    def candidates(self, display: str) -> list[tuple[str, PersonProfile]]:
        """Return all (person_id, profile) pairs sharing this display name."""
        return self._by_display.get(normalize_text(display), [])

    def __len__(self) -> int:
        return sum(len(v) for v in self._by_display.values())


class DomainRegionMap:
    """domain -> list of {woj, woj_code, powiat, powiat_code, miasto} regions."""

    def __init__(self, path: str | Path) -> None:
        try:
            with open(path, encoding="utf-8") as handle:
                self._data = json.load(handle)
        except FileNotFoundError:
            self._data = {}

    def powiat_codes(self, domain: str) -> set[str]:
        regions = self._data.get(domain, [])
        return {r["powiat_code"] for r in regions if r.get("powiat_code")}

    def woj_codes(self, domain: str) -> set[str]:
        regions = self._data.get(domain, [])
        return {r["woj_code"] for r in regions if r.get("woj_code")}


def _rejestr_io_id(rejestr_io_url: Any) -> str:
    """Extract the numeric rejestr.io person id from a URL like .../osoby/2786228.

    Returns "" when the value is missing or carries no trailing number.
    """
    if not rejestr_io_url:
        return ""
    m = re.search(r"/(\d+)/?$", str(rejestr_io_url).strip())
    return m.group(1) if m else ""


def _person_krs_map() -> dict[str, set[str]]:
    """rejestr.io person id -> set of ``employed_krs`` company numbers.

    Loads ``person_krs.jsonl`` (the rejestr.io person -> KRS employment mapping)
    once, keyed by the numeric rejestr.io person id so a koryta ``rejestrIo``
    URL can be resolved to the company numbers its owner works at.
    """
    mapping: dict[str, set[str]] = {}
    path = Path(VERSIONED_DIR) / "person_krs" / "person_krs.jsonl"
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                raw = line.strip()
                if not raw:
                    continue
                try:
                    row = json.loads(raw)
                except Exception:
                    continue
                pid = row.get("id")
                krs = row.get("employed_krs")
                if pid is not None and krs:
                    mapping.setdefault(str(pid), set()).add(str(krs))
    except FileNotFoundError:
        pass
    return mapping


def _employed_krs(row: dict[str, Any], person_krs: dict[str, set[str]]) -> set[str]:
    """Company KRS numbers a koryta person works at, via their ``rejestrIo``.

    The rejestrIo URL sits at the top level of fresh outputs; older cached
    outputs keep it nested inside the ``data`` dict, so both are checked.
    """
    rejestr_io = row.get("rejestrIo") or (row.get("data") or {}).get("rejestrIo")
    ri_id = _rejestr_io_id(rejestr_io)
    if not ri_id:
        return set()
    return person_krs.get(ri_id, set())


def _load_index_and_profiles(
    rows: Iterable[dict[str, Any]],
    krs_names: dict[str, str],
    person_krs: dict[str, set[str]],
) -> tuple[PersonNameIndex, PersonProfileIndex]:
    """Build the name index and per-person profiles in one pass."""
    index = PersonNameIndex()
    profiles = PersonProfileIndex()
    for row in rows:
        display = _display_name(row)
        if not display:
            continue
        person_id = _person_id(row)
        if not person_id:
            continue
        index.add(display, [_name_tuple(display)])

        profile = PersonProfile()
        profile.woj = {
            str(t) for t in (row.get("teryt_wojewodztwo") or []) if t not in (None, "")
        }
        profile.powiat = {
            str(t) for t in (row.get("teryt_powiat") or []) if t not in (None, "")
        }
        for party in row.get("parties") or []:
            if party:
                profile.parties.update(_party_match_terms(normalize_text(str(party))))
        for krs in _employed_krs(row, person_krs):
            name = krs_names.get(str(krs))
            if name:
                profile.orgs.update(_org_match_terms(ascii_lower(name)))
        profiles.add(display, person_id, profile)
    return index, profiles


def _person_id(row: dict[str, Any]) -> str:
    """Stable identity of the person: their koryta id."""
    return str(row.get("id") or "")


def _one_name(value: Any) -> str:
    """A name column as a single string, whether it holds one name or a list.

    `full_name` is a scalar on a KorytaPeople row and a DuckDB LIST column on a
    PeopleMerged one, so a column that reads as a plain string on one frame is
    an ndarray on another; `as_sequence` flattens both to a list.
    """
    items = as_sequence(value)
    if items:
        value = items[0]
    return str(value or "").strip()


def _display_name(row: dict[str, Any]) -> str:
    """What the person is called, in the register's own spelling where we have it.

    `base_full_name` is a LIST column, so on the run that rebuilt PeopleMerged
    it arrives as an ndarray rather than the `list` it is when read back from
    jsonl. Reading it through `as_sequence` is what stops it falling through to
    the title-cased first + last, which is a perfectly ordinary-looking name and
    so said nothing about being a fallback.
    """
    name = _one_name(row.get("full_name")) or _one_name(row.get("base_full_name"))
    if name:
        return name
    parts = (
        _one_name(row.get("base_first_name")),
        _one_name(row.get("base_last_name")),
    )
    return " ".join(part.title() for part in parts if part)


def _krs_name_map() -> dict[str, str]:
    """krs -> company name, from the company pipelines' outputs."""
    names: dict[str, str] = {}
    for rel in ("company_krs/company_krs.jsonl", "company_kmgp/company_kmgp.jsonl"):
        path = Path(VERSIONED_DIR) / rel
        try:
            with open(path, encoding="utf-8") as handle:
                for line in handle:
                    raw = line.strip()
                    if not raw:
                        continue
                    try:
                        row = json.loads(raw)
                    except Exception:
                        continue
                    krs = row.get("krs")
                    name = row.get("name")
                    if krs and name and krs not in names:
                        names[str(krs)] = str(name)
        except FileNotFoundError:
            continue
    return names


def _proof_for(
    profile: PersonProfile,
    domain: str,
    norm_content: str,
    domain_map: DomainRegionMap,
    generic_org_stems: frozenset[str] = frozenset(),
) -> list[ProofSignal]:
    """Signals confirming the person against the article; empty means drop."""
    proof: list[ProofSignal] = []

    powiat_codes = domain_map.powiat_codes(domain)
    if powiat_codes & profile.powiat:
        proof.append(ProofSignal(type="region", value="powiat"))
    elif not profile.powiat and domain_map.woj_codes(domain) & profile.woj:
        # Woj-level only confirms when the person has no powiat to pin them to;
        # with powiat data, a same-woj but different-powiat match is NOT proof
        # (it is exactly the same-name, same-region coincidence case).
        proof.append(ProofSignal(type="region", value="wojewodztwo"))

    if profile.parties:
        for term in sorted(profile.parties):
            if term and re.search(rf"\b{re.escape(term)}\b", norm_content):
                proof.append(ProofSignal(type="party", value=term))
                break

    if profile.orgs:
        ascii_content = ascii_lower(norm_content)
        text_words = {_stem(w) for w in re.findall(r"\w+", ascii_content)}
        # Only distinctive stems count as proof - generic ones (opiek, publiczn,
        # przedsiebiorstwo...) are shared by thousands of people and match any
        # article mentioning that topic.
        distinctive = profile.orgs - generic_org_stems
        matched = [o for o in distinctive if o in text_words]
        if len(matched) >= 2:
            proof.append(
                ProofSignal(type="organization", value=",".join(sorted(matched)[:3]))
            )

    return proof


def _mention_meta(row: dict[str, Any]) -> dict[str, Any]:
    """Article metadata to keep next to the URL in the output."""
    ld_json = row.get("ld_json")
    return {
        "url": str(row.get("url") or ""),
        "domain": str(row.get("domain") or ""),
        "title": row.get("title") or title_from_ld_json(ld_json),
        "date": row.get("publication_date") or date_iso_from_ld_json(ld_json),
        "tags": _tags_from_ld_json(ld_json),
    }


def _confirm_mentions(
    names: set[str],
    content: str,
    domain: str,
    profiles: PersonProfileIndex,
    domain_map: DomainRegionMap,
    generic_org_stems: frozenset[str] = frozenset(),
) -> dict[str, dict[str, list[ProofSignal]]]:
    """Keep (display, person) pairs with at least one proof signal.

    Returns ``display -> person_id -> proof signals``. Each same-name person
    is evaluated against its own profile, so an article gets attributed to the
    specific person whose signals it matches.
    """
    norm_content = normalize_text(content)
    confirmed: dict[str, dict[str, list[ProofSignal]]] = {}
    for name in names:
        for person_id, profile in profiles.candidates(name):
            if profile is None or not profile.has_any():
                continue
            proof = _proof_for(
                profile, domain, norm_content, domain_map, generic_org_stems
            )
            if proof:
                confirmed.setdefault(name, {})[person_id] = proof
    return confirmed


_JUDGE_PROMPT = (
    "Jesteś dokładnym weryfikatorem danych. Twoim zadaniem jest ocenić, czy "
    "znana osoba NAPRAWDĘ występuje w danym artykule, czy mamy do czynienia z "
    "przypadkiem, gdy w artykule występuje inna osoba o tym samym lub podobnym "
    "imieniu i nazwisku (tzw. zbieżność nazwisk).\n\n"
    "KLUCZOWA ZASADA: Pytanie brzmi wyłącznie: CZY TA OSOBA JEST WYMIENIONA W "
    "ARTYKULE? NIE pytamy o to, czy artykuł JEST O tej osobie, ani kto jest "
    "głównym bohaterem tekstu. Artykuł o dowolnym temacie może wymienić znaną "
    "osobę w jednym zdaniu - jeśli podaje jej pełne imię i nazwisko (lub "
    "jednoznacznie ją identyfikuje), to odpowiedź to TAK.\n\n"
    "JEDYNY wyjątek - odpowiedź NIE, gdy:\n"
    "- W tekście NIE występuje ani pełne imię i nazwisko, ani jednoznaczna "
    "identyfikacja (np. \"prezydent\" bez nazwiska to za mało, jeśli nie da się "
    "jednoznacznie ustalić, że chodzi o tę osobę).\n"
    "- Wzmianka występuje WYŁĄCZNIE w elemencie okołotematycznym, a nie w "
    "artykule: podpis pod zdjęciem, \"Czytaj więcej\", lista powiązanych "
    "artykułów, stopka, autor biografii, reklama.\n"
    "- Osoba o tym samym nazwisku jest opisana w sprzecznym kontekście "
    "(inna partia, inny region, inne stanowisko) - to zbieżność nazwisk.\n\n"
    "Poniżej podajemy: fragment artykułu, dane znanej osoby (partie, regiony, "
    "organizacje, w których jest zarejestrowana) oraz sygnały dopasowania, "
    "które zostały wykryte automatycznie.\n\n"
    "Oceń, czy osoba wzmiankowana w artykule to ta sama znana osoba. Zwróć uwagę na:\n"
    "- Czy artykuł podaje pełne imię i nazwisko lub jednoznacznie ją identyfikuje "
    "W TREŚCI ARTYKUŁU (nie w podpisie/stopce). Jeśli tak - odpowiedź TAK.\n"
    "- Jeśli znana osoba ma DRUGIE IMIĘ (np. \"Ryszard Henryk Czarnecki\"), a "
    "artykuł podaje tylko PIERWSZE i NAZWISKO (\"Ryszard Czarnecki\"), to NADAL "
    "jest to dopasowanie - artykuły niemal zawsze pomijają drugie imię. NIE "
    "odrzucaj z powodu braku drugiego imienia, jeśli imię + nazwisko i kontekst "
    "się zgadzają.\n"
    "- Jeśli artykuł podaje DRUGIE imię INNE niż w danych (np. dane: \"Jan "
    "Kowalski\", artykuł: \"Jan Marek Kowalski\"), to może być inna osoba - "
    "sprawdź kontekst.\n"
    "- Czy kontekst (partia, region, organizacja, stanowisko) zgadza się z danymi "
    "znanej osoby. ROZBIEŻNOŚĆ w partii, regionie lub organizacji to mocny sygnał, "
    "że to inna osoba o tym samym nazwisku.\n"
    "- Czy osoba może mieć wiele partii w przeszłości - ale jeśli artykuł opisuje "
    "ją jako działającą w innej partii lub przeciw innej partii, to prawdopodobnie "
    "to NIE jest ta znana osoba.\n"
    "- Czy nazwisko jest popularne (Nowak, Kowalski, Kamiński) - wtedy same "
    "wystąpienia nazwiska NIE wystarczają, potrzebny jest zgodny kontekst.\n"
    "- Artykuł o innym temacie (np. wywiad z politykiem albo ekspertem) NADAL "
    "może wzmiankować znaną osobę w swojej treści - jeśli podaje jej pełne imię "
    "i nazwisko, to TAK.\n"
    "- Jeśli artykuł identyfikuje osobę przez STANOWISKO lub PARTIĘ (np. \"były "
    "wiceminister\", \"poseł PiS\"), a te NIE zgadzają się z danymi znanej osoby, "
    "to to NIE ta osoba - mimo zgodnej zbieżności nazwiska czy regionu.\n"
    "- Samo dopasowanie REGIONU (region:powiat) jest SŁABE dla portali "
    "ogólnopolskich (tvn24.pl, rp.pl, onet.pl) oraz portali typu naszemiasto.pl, "
    "które pokrywają wiele powiatów. Gdy nazwisko jest popularne, sam region "
    "nie wystarcza - potrzebny jest zgodny kontekst (partia, stanowisko, "
    "organizacja).\n\n"
    "Artykuł:\n{article}\n\n"
    "Znana osoba: {name}\n"
    "Partie w danych: {parties}\n"
    "Regiony (kody TERYT) w danych: {regions}\n"
    "Organizacje w danych: {orgs}\n"
    "Wykryte sygnały dopasowania: {proof}\n\n"
    "Odpowiedz zwięźle, w dwóch częściach:\n"
    "1. Uzasadnienie (1-2 zdania): czy i w jakiej formie osoba występuje w "
    "artykule (w treści czy tylko obok artykułu) oraz czy kontekst się zgadza.\n"
    "2. Werdykt: TAK lub NIE (wyłącznie jedno słowo).\n\n"
    "Format odpowiedzi:\n"
    "Uzasadnienie: <twoje uzasadnienie>\n"
    "Werdykt: TAK\n"
)


# Used when several DIFFERENT people share the article's name and all have
# some proof signal. The article is judged ONCE against every candidate at
# once, so the model can pick the one whose profile actually fits (and reject
# the rest) instead of approving each in isolation.
_JUDGE_MULTI_PROMPT = (
    "Jesteś dokładnym weryfikatorem danych. W bazie danych jest "
    "KILKA RÓŻNYCH OSÓB o tym samym imieniu i nazwisku. W artykule występuje "
    "osoba o tym nazwisku. Twoim zadaniem jest ustalić, KTÓRA z tych osób "
    "(jeśli jakakolwiek) faktycznie występuje w artykule.\n\n"
    "WAŻNE: Pytanie brzmi wyłącznie - CZY KTÓRAŚ Z TYCH OSÓB JEST WYMIENIONA W "
    "ARTYKULE? Artykuł o dowolnym temacie może wymienić daną osobę jednorazowo. "
    "Nie oceniamy, o kim jest artykuł - wystarczy, że osoba jest w nim "
    "wymieniona. Jeśli artykuł podaje pełne imię i nazwisko i kontekst nie "
    "zaprzecza (brak sprzecznej partii/stanowiska), to ta osoba występuje.\n\n"
    "Zasady:\n"
    "- Jeśli artykuł podaje pełne imię i nazwisko, a kontekst (partia, "
    "stanowisko, region, organizacja) zgadza się z danymi JEDNEJ osoby - "
    "wybierz TĄ osobę.\n"
    "- Jeśli pełne imię i nazwisko jest podane, ale żaden kontekst nie pasuje "
    "do żadnej osoby, a nazwisko jest pospolite - odpowiedź NIE.\n"
    "- Jeśli artykuł identyfikuje osobę przez STANOWISKO lub PARTIĘ, a dana "
    "osoba ich NIE ma (albo ma inne) - to NIE ta osoba, nawet jeśli nazwisko "
    "się zgadza.\n"
    "- Samo dopasowanie regionu jest słabe dla portali ogólnopolskich; "
    "decyduje zgodny kontekst (partia, stanowisko, organizacja).\n\n"
    "Artykuł:\n{article}\n\n"
    "Kandydaci:\n{candidates}\n\n"
    "Odpowiedz zwięźle:\n"
    "1. Uzasadnienie (1-2 zdania): która osoba występuje w artykule i dlaczego "
    "(albo że żadna nie występuje).\n"
    "2. Werdykt: wyłącznie identyfikator osoby (np. K1) albo NIE, jeśli żadna "
    "osoba nie występuje.\n\n"
    "Format odpowiedzi:\n"
    "Uzasadnienie: <twoje uzasadnienie>\n"
    "Werdykt: <K1 | K2 | ... | NIE>\n"
)


def _judge_multi_request(
    person: str,
    candidates: list[tuple[str, PersonProfile, list[ProofSignal]]],
    content: str,
    model: str,
) -> LLMRequest:
    """Judge one article against several same-name people at once."""
    lines = []
    for i, (person_id, profile, proof) in enumerate(candidates, 1):
        parties = sorted(profile.parties) if profile else []
        regions = sorted(profile.woj | profile.powiat) if profile else []
        orgs = sorted(profile.orgs) if profile else []
        proof_text = ", ".join(f"{s.type}:{s.value}" for s in proof) or "brak"
        lines.append(
            f"K{i} (id {person_id}): partie={', '.join(parties) or 'brak'}, "
            f"regiony={', '.join(regions) or 'brak'}, "
            f"organizacje={', '.join(orgs) or 'brak'}, "
            f"sygnały={proof_text}"
        )
    return LLMRequest(
        prompt=_JUDGE_MULTI_PROMPT.format(
            article=_context_window(content, person),
            candidates="\n".join(lines),
        ),
        max_tokens=MAX_TOKENS,
        temperature=TEMPERATURE,
        model=model,
        enable_thinking=True,
    )


def _parse_multi_verdict(
    text: str, n_candidates: int
) -> tuple[str, str, str]:
    """Parse the multi-candidate verdict into (person_id, verdict, justification).

    ``person_id`` is the matched candidate's id or "" when none matched.
    """
    text = strip_think_blocks(text)
    lines = [line.strip() for line in text.strip().splitlines() if line.strip()]
    justification = ""
    verdict_raw = ""
    for line in lines:
        low = line.lower()
        if low.startswith("uzasadnienie") or low.startswith("justification"):
            justification = line.split(":", 1)[1].strip() if ":" in line else line
        elif "werdykt" in low or "verdict" in low or "wybrana" in low:
            verdict_raw = line.split(":", 1)[1].strip() if ":" in line else ""
    if not verdict_raw:
        verdict_raw = lines[-1].strip() if lines else ""
    verdict_raw = verdict_raw.upper().replace(" ", "")
    if verdict_raw in {"NIE", "NONE", "ŻADNA", "BRAK", "-"}:
        return "", "no", justification
    m = re.match(r"^(K\d+)", verdict_raw)
    if m:
        idx = int(m.group(1)[1:])
        if 1 <= idx <= n_candidates:
            return f"K{idx}", "yes", justification
    return "", "unknown", justification


def _context_window(content: str, person: str) -> str:
    """A focused excerpt of ``content`` around the first match of ``person``.

    Falls back to the whole text (capped at TEXT_LIMIT) when the name cannot
    be located (e.g. it only appears in declined/capitalized variants).
    """
    norm = normalize_text(content)
    for probe in (
        normalize_text(person),
        normalize_text(person).replace(" ", ""),
    ):
        idx = norm.find(probe)
        if idx >= 0:
            start = max(0, idx - CONTEXT_BEFORE)
            end = min(len(content), idx + CONTEXT_AFTER)
            return content[start:end]
    return content[:TEXT_LIMIT]


def _judge_request(
    person: str,
    profile: PersonProfile | None,
    proof: list[ProofSignal],
    content: str,
    model: str,
    same_name_count: int = 1,
) -> LLMRequest:
    parties = sorted(profile.parties) if profile else []
    regions = sorted(profile.woj | profile.powiat) if profile else []
    orgs = sorted(profile.orgs) if profile else []
    proof_text = ", ".join(f"{s.type}:{s.value}" for s in proof) or "brak"
    ambiguity = (
        f"\nUWAGA: w naszej bazie jest {same_name_count} RÓŻNYCH OSÓB o tym "
        "imieniu i nazwisku. Twoim zadaniem jest ocenić, czy artykuł dotyczy "
        "WŁAŚNIE TEJ osoby (konkretnie tej z podanymi poniżej danymi), a nie "
        "innej o tym samym nazwisku.\n"
        "DECYDUJĄCE ZASADY przy zbieżności nazwisk:\n"
        "- Jeśli artykuł nazywa PARTIĘ lub STANOWISKO tej osoby, a ta osoba "
        "NIE ma tej partii/stanowiska w danych (albo ma INNĄ partię), to "
        "odpowiedź to NIE - nawet jeśli nazwisko i region się zgadzają.\n"
        "- W szczególności: artykuł mówiący, że osoba jest \"posłem/wiceministrem "
        "PiS\" lub \"członkiem Suwerennej Polski (PiS)\" NIE dotyczy osoby, "
        "która w danych ma inną partię (np. PSL, PO, KWW) albo żadnej.\n"
        "- Region sam w sobie nie decyduje: to samo nazwisko może mieć kilka "
        "osób w tym samym regionie.\n"
        if same_name_count > 1
        else ""
    )
    return LLMRequest(
        prompt=_JUDGE_PROMPT.format(
            article=_context_window(content, person),
            name=person,
            parties=", ".join(parties) or "brak",
            regions=", ".join(regions) or "brak",
            orgs=", ".join(orgs) or "brak",
            proof=proof_text,
        )
        + ambiguity,
        max_tokens=MAX_TOKENS,
        temperature=TEMPERATURE,
        model=model,
        enable_thinking=True,
    )


def _parse_verdict(text: str) -> tuple[str, str]:
    text = strip_think_blocks(text)
    lines = [line.strip() for line in text.strip().splitlines() if line.strip()]
    justification = ""
    verdict = "unknown"
    for line in lines:
        low = line.lower()
        if low.startswith("uzasadnienie") or low.startswith("justification"):
            justification = line.split(":", 1)[1].strip() if ":" in line else line
        elif "werdykt" in low or "verdict" in low:
            val = line.split(":", 1)[1].strip().upper() if ":" in line else ""
            if val in {"TAK", "NIE", "YES", "NO"}:
                verdict = "yes" if val in {"TAK", "YES"} else "no"
    if verdict == "unknown":
        last = lines[-1].strip().upper() if lines else ""
        if last in {"TAK", "NIE", "YES", "NO"}:
            verdict = "yes" if last in {"TAK", "YES"} else "no"
        else:
            m = re.search(r"\b(TAK|NIE|YES|NO)\b\s*$", text.upper())
            if m:
                verdict = "yes" if m.group(1) in {"TAK", "YES"} else "no"
    if not justification and lines:
        justification = lines[0][:300]
    return verdict, justification[:500]


def _emit_person(
    ctx: Context,
    row: dict[str, Any],
    person: str,
    person_id: str,
    proof: list[ProofSignal],
    verdict: str,
    justification: str,
) -> None:
    """Emit one ``ArticlePersonMentioned`` row for a judged (article, person) pair."""
    ctx.io.dumper.insert_into(  # type: ignore[attr-defined]
        ArticlePersonMentioned(
            url=row["url"],
            person=person,
            person_id=person_id,
            domain=row["domain"],
            title=row["title"],
            date=row["date"],
            tags=row["tags"],
            proof=proof,
            verdict=verdict,
            justification=justification,
        ),
        [],
    )


def _write_debug(
    row: dict[str, Any],
    person: str,
    person_id: str,
    proof: list[ProofSignal],
    verdict: str,
    justification: str,
    content: str,
) -> None:
    """Append one judged pair with a truncated article excerpt to the debug file."""
    _DEBUG_FILE.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "url": row["url"],
        "person": person,
        "person_id": person_id,
        "verdict": verdict,
        "justification": justification,
        "proof": [{"type": s.type, "value": s.value} for s in proof],
        "content": content[: _DEBUG_CONTENT_LIMIT],
    }
    with _DEBUG_FILE.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def _build_requests(
    raw: dict[str, Any],
    content: str,
    index: PersonNameIndex,
    profiles: PersonProfileIndex,
    domain_map: DomainRegionMap,
    generic_org_stems: frozenset[str],
    model: str,
) -> (
    tuple[
        dict[str, Any],
        list[tuple[str, str, list[ProofSignal], LLMRequest]],
        int,
    ]
    | None
):
    """Judge requests for one article, or None when nothing passes the proof gate.

    Returns ``(row, requests, dropped)`` where ``requests`` holds one
    ``(person, person_id, proof, request)`` per confirmed (article, person)
    pair and ``dropped`` counts the names that had no proof.
    """
    names = index.find_in_text(content)
    if not names:
        return None
    confirmed = _confirm_mentions(
        names,
        content,
        str(raw.get("domain") or ""),
        profiles,
        domain_map,
        generic_org_stems,
    )
    name_pairs = sum(len(by_person) for by_person in confirmed.values())
    dropped = len(names) - name_pairs
    if not confirmed:
        return None
    row = _mention_meta(raw)
    requests: list[tuple[str, str, list[ProofSignal], LLMRequest]] = []
    for person, by_person in confirmed.items():
        for person_id, proof in by_person.items():
            profile = dict(profiles.candidates(person))[person_id]
            request = _judge_request(
                person,
                profile,
                proof,
                content,
                model,
                same_name_count=len(by_person),
            )
            requests.append((person, person_id, proof, request))
    return row, requests, dropped


async def _submit_requests(
    pool: LLMResponsePool,
    inflight: dict[
        int,
        tuple[dict[str, Any], str, str, list[ProofSignal], str, LLMRequest, bool],
    ],
    drain: Any,
    row: dict[str, Any],
    content: str,
    requests: list[tuple[str, str, list[ProofSignal], LLMRequest]],
) -> None:
    """Queue one article's judged pairs on the LLM response pool."""
    for person, person_id, proof, request in requests:
        while pool.is_full():
            await drain(pool)
        request_id = await pool.put_request(request)
        inflight[request_id] = (
            row,
            person,
            person_id,
            proof,
            content,
            request,
            False,
        )


async def _scan_and_judge(
    ctx: Context,
    parsed_path: Path,
    index: PersonNameIndex,
    profiles: PersonProfileIndex,
    domain_map: DomainRegionMap,
    generic_org_stems: frozenset[str],
    *,
    model: str,
) -> None:
    """Scan parsed articles and LLM-judge confirmed matches on the fly.

    Reads the corpus line by line; every article whose names pass the proof
    filter has its (article, person) pairs submitted to the LLM response pool
    immediately, so judging overlaps the scan and article text is never kept in
    memory. Each row is emitted as soon as its last request lands.
    """
    await LLM.from_context(ctx).check_health()

    # request_id -> (row, person, person_id, proof, content, request, retried)
    inflight: dict[
        int,
        tuple[dict[str, Any], str, str, list[ProofSignal], str, LLMRequest, bool],
    ] = {}

    candidates = 0
    dropped = 0
    rows = 0

    async def drain(pool: LLMResponsePool) -> None:
        request_id, response = await pool.get_response()
        row, person, person_id, proof, content, request, retried = inflight.pop(
            request_id
        )
        if isinstance(response, Exception):
            verdict, justification = "unknown", str(response)[:200]
        else:
            verdict, justification = _parse_verdict(response.content)
        if verdict == "unknown" and not retried:
            # Extremely rare: the model can still burn its whole output budget
            # inside a <think> block and return no verdict. Re-ask once without
            # thinking so every pair gets a verdict instead of a silent unknown.
            retry_req = LLMRequest(
                prompt=request.prompt,
                max_tokens=1500,
                temperature=TEMPERATURE,
                model=request.model,
                enable_thinking=False,
            )
            while pool.is_full():
                await drain(pool)
            rid = await pool.put_request(retry_req)
            inflight[rid] = (row, person, person_id, proof, content, retry_req, True)
            return
        _emit_person(ctx, row, person, person_id, proof, verdict, justification)
        _write_debug(row, person, person_id, proof, verdict, justification, content)
        bar.update(1)

    with tqdm(total=0, desc="Judging mentions", unit="pair") as bar:
        async with LLM.from_context(ctx).response_pool() as pool:
            with parsed_path.open(encoding="utf-8") as f:
                for line in tqdm(f, desc="Scanning parsed articles", unit="article"):
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        raw = json.loads(line)
                    except Exception:
                        continue
                    if raw.get("parse_status") != "ok":
                        continue
                    content = (
                        str(raw.get("title") or "")
                        + " "
                        + str(raw.get("article_content") or "")
                    )
                    if not content.strip():
                        continue
                    built = _build_requests(
                        raw,
                        content,
                        index,
                        profiles,
                        domain_map,
                        generic_org_stems,
                        model,
                    )
                    if built is None:
                        continue
                    row, requests, dropped_in_article = built
                    dropped += dropped_in_article
                    candidates += len(requests)
                    rows += 1
                    bar.total += len(requests)
                    await _submit_requests(
                        pool, inflight, drain, row, content, requests
                    )
            while inflight:
                await drain(pool)

    print(
        f"Confirmed {candidates:,} candidate people across {rows:,} articles "
        f"({dropped:,} dropped for lack of proof)"
    )


def _print_llm_usage(ctx: Context) -> None:
    llm = LLM.from_context(ctx)
    print(
        "Mention judge LLM usage: "
        f"{int(getattr(llm, 'request_count', 0) or 0)} requests, "
        f"{int(getattr(llm, 'total_tokens', 0) or 0)} total tokens"
    )


class ArticlePersonMentions(IncrementalJsonlPipeline[ArticlePersonMentioned]):
    """Cross-reference koryta people with article_parsed to find mentions."""

    filename = "article_person_mentions"
    # derived from the ~21GB parse corpus, local-only
    read_backup = write_backup = False

    koryta_people: KorytaPeople
    parsed: ArticleParsed
    domain_regions: DomainToRegion
    llm: LLM

    @property
    def output_class(self):
        return ArticlePersonMentioned

    def process(self, ctx: Context) -> pd.DataFrame:
        self.prepare_temp_output()

        people_df = self.koryta_people.read_or_process(ctx)
        krs_names = _krs_name_map()
        person_krs = _person_krs_map()
        people_rows = list(iterate_pipeline_dict(people_df))
        index, profiles = _load_index_and_profiles(people_rows, krs_names, person_krs)
        generic_org_stems = _generic_org_stems(people_rows, krs_names, person_krs)
        print(
            f"Filtering {len(generic_org_stems):,} generic org stems shared by "
            "many people"
        )
        self.koryta_people._cached_result = None
        if not index.people:
            print("No people found in koryta people, nothing to emit")
            return pd.DataFrame()
        print(
            f"Indexed {index.people:,} people ({index.forms:,} name forms, "
            f"{len(profiles):,} with disambiguation profiles)"
        )

        self.domain_regions.read_or_process(ctx)
        domain_map = DomainRegionMap(self.domain_regions.final_output_path)
        print(f"Loaded region map for {len(domain_map._data):,} domains")

        parsed_path = self.parsed.final_output_path
        if not parsed_path.exists():
            print("No parsed articles found, nothing to emit")
            return pd.DataFrame()

        model = llm_model()
        asyncio.run(
            _scan_and_judge(
                ctx,
                parsed_path,
                index,
                profiles,
                domain_map,
                generic_org_stems,
                model=model,
            )
        )
        _print_llm_usage(ctx)
        return pd.DataFrame()
