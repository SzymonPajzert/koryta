"""What the machine suggests for a printed employer band: the public body each
post on it is at, and the role it is held in.

On a printed band the cut's OCR is good enough to read, so readers get the
machine's reading of it as rows to accept or reject: at most four, each a body
of the public bodies table by its REGON and one of their role chips by its id
(`suggestionSchema` in frontend/shared/declarationEmployment.ts). Suggestions,
never text: a post the table or the chips cannot name gets no row, and readers
add it themselves. A handwritten band gets none.

`suggest` reads a band's OCR lines with the declarant's unit:

1. Stamps and footers go first: a receipt stamp, „Z up. STAROSTY” with the
   name and title signed under it, a form generator's „www.signform.pl Sp. z
   o.o.”.
2. A body is on the band where one of its names is, in the band's text as OCR
   squashes it, spaces gone, with the letters OCR swaps made one (ł read as t,
   ó as 6, o as 0, i as l): its whole name, its name without a patron, the
   same in the case the line puts it in („w Urzędzie Miejskim w Opolu”), or
   an abbreviation that starts a word („GOPS w ...”). A name that does not
   say its town („Zakład Gospodarki Komunalnej”) counts only with twelve
   letters or more, and with its town beside it on the band (never a
   street's name), or with the body in the declarant's unit or their powiat,
   and only where that leaves one body; a ministry's or a central
   institution's long name counts alone, unless the line names a branch.
   Where bodies share a name, the one nearest the declarant's unit is taken.
3. A title starts a word: „zastępca dyrektora”, „Z-ca Naczelnika Wydziału”,
   „Główny Specjalista”. Its family is the one declarationEmploymentRoles.json
   folds it into, as the site does (`roleFamilyOf`), and its chip the one of
   that family whose label it names; any staff title is a „pracownik”. Titles
   OCR glued together are split first: „ZASTĘPCAWÓJTAGMINY”.
4. Each body takes the first title after it, before the next body; where a
   mandate („Radny Rady Powiatu”), a contract or a pension comes first, or a
   title held at another kind of office („Członek Zarządu Powiatu” after a
   forestry directorate), the body gets no row; so too after „na stanowisku”
   followed by a title no chip names. A body with nothing after it takes a
   title that runs into it („Dyrektor Szkoły Podstawowej ...”). A title no
   body took that starts an item names its own office where it can: a wójt
   or a burmistrz the urząd of the declarant's gmina, a wicestarosta or a
   „sekretarz powiatu” the starostwo of their powiat, a marszałek the urząd
   marszałkowski; not where it names another place.
5. Rows at the declarant's unit come first, at most four.

What the 2026-11-20 pilot's classify.py learned is kept: OCR's letter swaps;
a short key („odr”, „pec”, „sa”) only as a word of its own; a gmina ending in
„-wice” run into „Wójt” is a wójt, not a „wicewójt”; a name only with its
town and a twelve letter core; stamps, footers, private employers and the
mandate itself never suggested.
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections import defaultdict
from collections.abc import Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any, cast

from scrapers.map.offices import (
    GMINA_OFFICE,
    MARSHAL_OFFICE,
    POWIAT_OFFICE,
    VOIVODE_OFFICE,
)
from scrapers.map.public_bodies import PublicBodies
from scrapers.stores import Context
from util.polish import normalize_person_name

#: The role chips, as the site reads them (shared/declarationEmployment.ts).
ROLES_FILE = (
    Path(__file__).resolve().parents[5]
    / "frontend"
    / "shared"
    / "declarationEmploymentRoles.json"
)

#: `MAX_SUGGESTIONS` in shared/declarationEmployment.ts.
MAX_SUGGESTIONS = 4
#: The chip readers pick for a role not on the list: never a suggestion.
OTHER_ROLE = "inne"
#: The chip a staff title gets when it names no other one: an „inspektor” or a
#: „główny specjalista” is a pracownik.
EMPLOYEE_ROLE = "pracownik"
#: The fewest squashed letters a name not saying its town counts with.
MIN_CORE = 12
#: The fewest a name saying its town counts with.
MIN_NAME = 8
#: A national body's name not saying its town, this long and no other body's,
#: needs nothing beside it: „Ministerstwo Infrastruktury”.
UNIQUE_CORE = 20
#: How far after and before a name its town may stand, in squashed letters.
TOWN_AFTER = 40
TOWN_BEFORE = 20

#: The offices a title can name without naming the body, by the kind of
#: institution declarationEmploymentRoles.json offers their chips at.
OFFICE_KINDS = {
    "urzad_gminy": GMINA_OFFICE,
    "starostwo": POWIAT_OFFICE,
    "urzad_marszalkowski": MARSHAL_OFFICE,
    "urzad_wojewodzki": VOIVODE_OFFICE,
}
#: What a title says to name an office's level: „sekretarz powiatu”.
#: Nouns, not adjectives: a „Biuro Powiatowe” is ARiMR's, not a starostwo.
OFFICE_LEVELS = {
    "urzad_gminy": re.compile(r"\b(gminy|miasta|wojta|burmistrza|prezydenta)\b"),
    "starostwo": re.compile(r"\b(powiatu|starosty)\b"),
    "urzad_marszalkowski": re.compile(r"\b(wojewodztwa|marszalka|sejmiku)\b"),
    "urzad_wojewodzki": re.compile(r"\bwojewody\b"),
}
#: The families who run an office, so that the title alone says which:
#: a wójt, a zastępca burmistrza, a starosta, a wicemarszałek.
OFFICE_FAMILIES = frozenset({"mayor", "deputy_mayor", "office_head", "office_deputy"})


# -- text --------------------------------------------------------------------------


def fold(text: str) -> str:
    """Lower case, without diacritics, ł as l: „Łódź” is "lodz"."""
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return text.replace("ł", "l").replace("Ł", "L").lower()


def squash(text: str) -> str:
    """The letters and digits only, folded: as OCR often reads a line."""
    return re.sub(r"[^a-z0-9]", "", fold(text))


#: Letters OCR reads for one another, made one: ł read as t, i as l, ą as q,
#: y as v.
_SAME_LETTERS = str.maketrans("tiqv", "llay")
#: A digit with no digit beside it is a letter misread: ó or o as 6 or 0, l or
#: i as 1. A number („nr 16”, „26-130”) keeps its digits.
_LONE_DIGIT = re.compile(r"(?<![0-9])[016](?![0-9])")


def _same(squashed: str) -> str:
    """Squashed text with OCR's swaps made one, letter for letter."""
    squashed = _LONE_DIGIT.sub(lambda m: "l" if m[0] == "1" else "o", squashed)
    return squashed.translate(_SAME_LETTERS)


def canon(text: str) -> str:
    """Text as names are compared: squashed, OCR's swaps made one."""
    return _same(squash(text))


def valid_regon(regon: str) -> bool:
    """Nine digits, or fourteen for a local unit, ending in their check digits:
    `isValidRegon` in frontend/shared/identifiers.ts."""

    def check(weights: Sequence[int]) -> int:
        remainder = sum(int(d) * w for d, w in zip(regon, weights)) % 11
        return 0 if remainder == 10 else remainder

    if not re.fullmatch(r"\d{9}|\d{14}", regon):
        return False
    if check((8, 9, 2, 3, 4, 5, 6, 7)) != int(regon[8]):
        return False
    return len(regon) == 9 or check((2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8)) == int(
        regon[13]
    )


# -- role chips --------------------------------------------------------------------


@dataclass(frozen=True)
class RoleChip:
    id: str
    label: str
    #: elected, executive, managerial or staff; None for „Inne”.
    kind: str | None
    family: str | None


@dataclass(frozen=True)
class Roles:
    """The chips and the families titles fold into, as
    declarationEmploymentRoles.json has them."""

    chips: tuple[RoleChip, ...]
    prefixes: tuple[re.Pattern[str], ...]
    families: tuple[tuple[str, tuple[re.Pattern[str], ...]], ...]
    #: The kinds of institution each chip is offered at.
    offered_at: Mapping[str, frozenset[str]]

    def chip(self, chip_id: str) -> RoleChip | None:
        return next((chip for chip in self.chips if chip.id == chip_id), None)

    def family(self, title: str | None) -> str | None:
        """`roleFamilyOf`: the family a title folds into; None for a mandate,
        a contract or a bare „członek”."""
        folded = self._cut(title)
        if not folded:
            return None
        return next(
            (
                family
                for family, patterns in self.families
                if any(pattern.search(folded) for pattern in patterns)
            ),
            None,
        )

    def read(self, title: str | None) -> tuple[str | None, RoleChip | None]:
        """A title's family, and its chip: the one of that family whose label
        the title names, else the family's only chip, else for a staff title
        the pracownik. No chip where none fits the family, as for a
        „podsekretarz stanu”."""
        family = self.family(title)
        if family is None:
            return None, None
        chips = [chip for chip in self.chips if chip.family == family]
        folded = self._cut(title)
        forms = [*_deputy_forms(folded), _without_deputy(folded)]
        for anywhere in (False, True):
            for form in forms:
                found = _named_chip(chips, form.split(), anywhere)
                if found:
                    return family, found
        if len(chips) == 1:
            return family, chips[0]
        employee = self.chip(EMPLOYEE_ROLE)
        return family, employee if employee and employee.family == family else None

    def _cut(self, title: str | None) -> str:
        folded = normalize_person_name(title)
        for prefix in self.prefixes:
            folded = prefix.sub("", folded, count=1)
        return folded


@cache
def read_roles(path: Path = ROLES_FILE) -> Roles:
    data = json.loads(path.read_text(encoding="utf-8"))
    offered: dict[str, set[str]] = defaultdict(set)
    for institution, ids in data["institutions"].items():
        for chip_id in ids:
            offered[chip_id].add(institution)
    return Roles(
        chips=tuple(
            RoleChip(role["id"], role["label"], role["kind"], role["family"])
            for role in data["roles"]
        ),
        prefixes=tuple(re.compile(prefix) for prefix in data["prefixes"]),
        families=tuple(
            (family["id"], tuple(re.compile(p) for p in family["patterns"]))
            for family in data["families"]
        ),
        offered_at={chip: frozenset(kinds) for chip, kinds in offered.items()},
    )


_DEPUTY = re.compile(r"^(zastepc\w*|z ca|zca) ")


def _deputy_forms(folded: str) -> list[str]:
    """The title, and the same with its deputy written the other way: a
    „zastępca prezesa” is a wiceprezes, a „wicewójt” a zastępca wójta."""
    deputy = _DEPUTY.match(folded)
    if deputy:
        rest = folded[deputy.end() :]
        return [f"zastepca {rest}", f"wice{rest}"]
    if folded.startswith("wice"):
        return [folded, f"zastepca {folded[4:].lstrip()}"]
    return [folded]


def _without_deputy(folded: str) -> str:
    """„Z-ca naczelnika wydziału” is a naczelnik where no chip is a deputy's."""
    deputy = _DEPUTY.match(folded)
    return folded[deputy.end() :] if deputy else folded


def _stem(word: str) -> str:
    """What a word starts with in every case: „marszal” for marszałek and
    marszałka, „rad” for rada and rady."""
    if len(word) > 4 and word.endswith("ek"):
        return word[:-2]
    return word.rstrip("aeiouy") or word


def _named_chip(
    chips: Sequence[RoleChip], words: Sequence[str], anywhere: bool
) -> RoleChip | None:
    """The chip whose label a title's words say from its first word, or from
    any („przewodnicząca rady nadzorczej”); the longest label."""

    def says(label: list[str], at: int) -> bool:
        return at + len(label) <= len(words) and all(
            words[at + i].startswith(_stem(part)) for i, part in enumerate(label)
        )

    starts = range(len(words)) if anywhere else [0]
    found = [
        chip
        for chip in chips
        if any(says(normalize_person_name(chip.label).split(), at) for at in starts)
    ]
    return max(found, key=lambda chip: len(chip.label)) if found else None


# -- the public bodies table -------------------------------------------------------


@dataclass(frozen=True)
class Body:
    regon: str
    name: str
    kind: str
    #: The unit it serves and the gmina it stands in, as TERC codes: two digits
    #: for a województwo, four for a powiat, seven for a gmina.
    teryt: str
    seat: str


#: Legal forms after a company's name: no reader writes them out in full.
_LEGAL_FORM = re.compile(
    r"\b(spolka z ograniczona odpowiedzialnoscia|sp z o o|spolka akcyjna|"
    r"spolka komandytowa|w likwidacji|w upadlosci)\b"
)
_LEGAL_FORM_AT_END = re.compile(r"(\s(s a|sp k|sp j))+$")
_PATRON = re.compile(r"\sim(ienia)?\s.*?(?=\s(w|we)\s|$)")
_TOWN_CLAUSE = re.compile(r"\s(w|we)\s(?!.*\s(w|we)\s)(.+)$")
_TOWN_SUFFIX = re.compile(r"^(.*?)\s*\(([^()]*)\)\s*$")
#: Names that say a body is not public, whatever the catalogue files it under.
_PRIVATE_NAME = re.compile(r"niepubliczn|prywatn|\bnzoz\b")
#: An urząd miasta's two names: declarations write either.
_URZAD_HEADS = {
    "urzad miejski w ": "urzad miasta w ",
    "urzad miasta w ": "urzad miejski w ",
}
#: Words saying the line names a body's branch, not its head office: „Biuro
#: Powiatowe ARiMR w ...”, „Oddział Regionalny”.
_BRANCH = tuple(
    _same(word)
    for word in (
        "oddzia", "biur", "placow", "delegatur", "fili", "terenow",
        "regionaln", "powiatow", "wojewodzk", "okregow", "rejonow",
    )
)  # fmt: skip

#: Head nouns of public bodies' names with their genitive and locative: a
#: declaration names its employer in any of the three („zatrudniona w
#: Starostwie Powiatowym”, „pracownik Urzędu Gminy”).
_NOUNS = {
    "urzad": ("urzedu", "urzedzie"),
    "starostwo": ("starostwa", "starostwie"),
    "szkola": ("szkoly", "szkole"),
    "zespol": ("zespolu", "zespole"),
    "przedszkole": ("przedszkola", "przedszkolu"),
    "osrodek": ("osrodka", "osrodku"),
    "dom": ("domu", "domu"),
    "zaklad": ("zakladu", "zakladzie"),
    "przedsiebiorstwo": ("przedsiebiorstwa", "przedsiebiorstwie"),
    "biblioteka": ("biblioteki", "bibliotece"),
    "komenda": ("komendy", "komendzie"),
    "sad": ("sadu", "sadzie"),
    "prokuratura": ("prokuratury", "prokuraturze"),
    "nadlesnictwo": ("nadlesnictwa", "nadlesnictwie"),
    "zarzad": ("zarzadu", "zarzadzie"),
    "inspektorat": ("inspektoratu", "inspektoracie"),
    "szpital": ("szpitala", "szpitalu"),
    "poradnia": ("poradni", "poradni"),
    "stacja": ("stacji", "stacji"),
    "agencja": ("agencji", "agencji"),
    "akademia": ("akademii", "akademii"),
    "uniwersytet": ("uniwersytetu", "uniwersytecie"),
    "politechnika": ("politechniki", "politechnice"),
    "instytut": ("instytutu", "instytucie"),
    "biuro": ("biura", "biurze"),
    "teatr": ("teatru", "teatrze"),
    "filharmonia": ("filharmonii", "filharmonii"),
    "zlobek": ("zlobka", "zlobku"),
    "warsztat": ("warsztatu", "warsztacie"),
    "spolka": ("spolki", "spolce"),
    "kasa": ("kasy", "kasie"),
    "izba": ("izby", "izbie"),
    "ministerstwo": ("ministerstwa", "ministerstwie"),
    "kancelaria": ("kancelarii", "kancelarii"),
    "oddzial": ("oddzialu", "oddziale"),
    "placowka": ("placowki", "placowce"),
    "pogotowie": ("pogotowia", "pogotowiu"),
    "zwiazek": ("zwiazku", "zwiazku"),
    "jednostka": ("jednostki", "jednostce"),
    "bursa": ("bursy", "bursie"),
    "internat": ("internatu", "internacie"),
    "areszt": ("aresztu", "areszcie"),
    "schronisko": ("schroniska", "schronisku"),
    "park": ("parku", "parku"),
}
#: Nouns Polish does not decline: „w Centrum Usług Społecznych”.
_UNDECLINED = frozenset({"centrum", "muzeum", "liceum", "technikum", "gimnazjum"})
#: The endings of the adjectives a head is made of: powiatowy, miejski,
#: wojewódzki, gminny, publiczny, samodzielny, integracyjny.
_ADJECTIVE_ENDINGS = tuple(
    stem + end
    for stem in ("ow", "sk", "ck", "zk", "nn", "czn", "ln", "yjn", "rn", "wn")
    for end in ("y", "i", "a", "e")
) + ("skie", "ckie", "zkie")
#: Participles and -czy adjectives, long enough not to be a noun like „pracy”:
#: ogólnokształcący, rolniczy.
_LONG_ADJECTIVE = re.compile(r"^.{5,}(ac|cz)[yae]$")
#: Words a head runs through as they are: „Miejski i Gminny”, a roman numeral
#: („I Liceum”), the first half of „Miejsko-Gminny” or „Szkolno-Wychowawczy”.
_THROUGH = re.compile(r"^(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|[a-z]{4,}o)$")

#: Abbreviations a name's head is written as, as a word of its own: „GOPS w
#: ...”, „PUP w Opolu”.
_ABBREVIATIONS = (
    ("miejsko gminny osrodek pomocy spolecznej", "mgops"),
    ("gminny osrodek pomocy spolecznej", "gops"),
    ("miejski osrodek pomocy spolecznej", "mops"),
    ("osrodek pomocy spolecznej", "ops"),
    ("powiatowe centrum pomocy rodzinie", "pcpr"),
    ("miejski osrodek pomocy rodzinie", "mopr"),
    ("powiatowy urzad pracy", "pup"),
    ("wojewodzki urzad pracy", "wup"),
    ("miejsko gminny osrodek kultury", "mgok"),
    ("gminny osrodek kultury", "gok"),
    ("miejski osrodek kultury", "mok"),
    ("miejski dom kultury", "mdk"),
    ("gminne centrum kultury", "gck"),
    ("miejskie centrum kultury", "mck"),
    ("miejski osrodek sportu i rekreacji", "mosir"),
    ("gminny osrodek sportu i rekreacji", "gosir"),
    ("osrodek sportu i rekreacji", "osir"),
    ("zaklad gospodarki komunalnej", "zgk"),
    ("przedsiebiorstwo gospodarki komunalnej", "pgk"),
    ("zaklad uslug komunalnych", "zuk"),
    ("przedsiebiorstwo wodociagow i kanalizacji", "pwik"),
    ("zaklad wodociagow i kanalizacji", "zwik"),
    ("miejskie przedsiebiorstwo energetyki cieplnej", "mpec"),
    ("przedsiebiorstwo energetyki cieplnej", "pec"),
    ("miejskie przedsiebiorstwo komunikacyjne", "mpk"),
    ("miejski zaklad komunikacji", "mzk"),
    ("centrum uslug wspolnych", "cuw"),
    ("samodzielny publiczny zaklad opieki zdrowotnej", "spzoz"),
    ("zaklad opieki zdrowotnej", "zoz"),
    ("komenda powiatowa policji", "kpp"),
    ("komenda miejska policji", "kmp"),
    ("komenda powiatowa panstwowej strazy pozarnej", "kp psp"),
    ("komenda miejska panstwowej strazy pozarnej", "km psp"),
    ("powiatowy inspektorat nadzoru budowlanego", "pinb"),
    ("powiatowy inspektorat weterynarii", "piw"),
    ("powiatowa stacja sanitarno epidemiologiczna", "psse"),
    ("zarzad drog powiatowych", "zdp"),
    ("powiatowy zarzad drog", "pzd"),
    ("zarzad drog wojewodzkich", "zdw"),
    ("agencja restrukturyzacji i modernizacji rolnictwa", "arimr"),
    ("kasa rolniczego ubezpieczenia spolecznego", "krus"),
    ("zaklad ubezpieczen spolecznych", "zus"),
    ("krajowy osrodek wsparcia rolnictwa", "kowr"),
    ("wojewodzki osrodek doradztwa rolniczego", "wodr"),
    ("osrodek doradztwa rolniczego", "odr"),
    ("regionalna izba obrachunkowa", "rio"),
    ("urzad miasta i gminy", "umig"),
    ("urzad gminy", "ug"),
    ("urzad miasta", "um"),
    ("urzad miejski", "um"),
    ("szkola podstawowa", "sp"),
    ("zespol szkol", "zs"),
    ("liceum ogolnoksztalcace", "lo"),
)


def _names(name: str) -> tuple[list[tuple[str, bool]], str]:
    """A body's names to look for, folded, each with whether it says the body's
    town; and the town, to find beside the ones that do not.

    Its name, without its legal form; that without a patron; and, where the
    name ends with its town, the name without it („Szkoła Podstawowa nr 5”). The
    table writes the town after a name that does not say it, „Zakład Gospodarki
    Komunalnej (Opole)” (`public_bodies.place_name`); a declaration writes „w
    Opolu”, so that name says no town.
    """
    suffixed = _TOWN_SUFFIX.match(name)
    base, town = (suffixed[1], suffixed[2]) if suffixed else (name, "")
    core = " ".join(re.sub(r"[^a-z0-9]+", " ", fold(base)).split())
    core = _LEGAL_FORM_AT_END.sub("", " ".join(_LEGAL_FORM.sub(" ", core).split()))
    bare = " ".join(_PATRON.sub("", core).split())
    clause = None if suffixed else _TOWN_CLAUSE.search(bare)
    # A patron can be what said the town: „Liceum Ogólnokształcące im. 9
    # Braniewskiej Brygady” without it is any liceum.
    names = [
        (core, not suffixed),
        (bare, bare == core and not suffixed or bool(clause)),
    ]
    if clause:
        names.append((bare[: clause.start()], False))
        town = clause[3]
    return list(dict.fromkeys(names)), town


def _is_adjective(word: str) -> bool:
    return word.endswith(_ADJECTIVE_ENDINGS) or bool(_LONG_ADJECTIVE.match(word))


def _adjective_cases(word: str) -> tuple[str, str]:
    """A head adjective's genitive and locative: powiatowy, powiatowa,
    powiatowe; miejski, miejska, miejskie."""
    if word.endswith(("kie", "gie")):
        return word[:-1] + "go", word[:-2] + "im"
    if word.endswith(("ki", "gi")):
        return word + "ego", word + "m"
    if word.endswith(("ka", "ga")):
        return word[:-1] + "iej", word[:-1] + "iej"
    if word.endswith("a"):
        return word[:-1] + "ej", word[:-1] + "ej"
    return word[:-1] + "ego", word[:-1] + "ym"


def _declined(text: str) -> list[str]:
    """A name with its head in the genitive and in the locative: „urzędu
    miejskiego w Opolu”, „urzędzie miejskim w Opolu”."""
    words = text.split()
    genitive, locative = list(words), list(words)
    noun = False
    for i, word in enumerate(words):
        if not noun and word in _NOUNS:
            genitive[i], locative[i] = _NOUNS[word]
            noun = True
        elif not noun and word in _UNDECLINED:
            noun = True
        elif _is_adjective(word):
            genitive[i], locative[i] = _adjective_cases(word)
        elif not _THROUGH.match(word):
            break
    if not noun:
        return []
    return sorted({" ".join(genitive), " ".join(locative)} - {text})


def _abbreviated(text: str) -> list[str]:
    """A name with its head written short: „gops w hansku”."""
    return [
        f"{short} {text[len(full) :]}".strip()
        for full, short in _ABBREVIATIONS
        if text == full or text.startswith(f"{full} ")
    ]


@dataclass(frozen=True)
class _Entry:
    body: int
    #: The name says the body's town.
    named: bool
    #: An abbreviation: it has to start a word on the band.
    word: bool


class BodyIndex:
    """The public bodies table (`scrapers.map.public_bodies`), indexed to find
    its names in OCR text. Rows with a valid REGON only, and none in private
    ownership."""

    def __init__(self, rows: Iterable[Mapping[str, Any]]) -> None:
        self.bodies: list[Body] = []
        self._keys: dict[str, list[_Entry]] = defaultdict(list)
        self._towns: list[str] = []
        offices: dict[tuple[str, str], list[int]] = defaultdict(list)
        for row in rows:
            body = _body(row)
            if body is None:
                continue
            at = len(self.bodies)
            self.bodies.append(body)
            names, town = _names(body.name)
            self._towns.append(_town_stem(town))
            if body.kind == GMINA_OFFICE:
                names += [
                    (other, named)
                    for text, named in names
                    if (other := _other_urzad(text))
                ]
            for text, named in names:
                self._add(at, text, named)
            if body.kind in OFFICE_KINDS.values():
                offices[(body.kind, body.teryt[:6])].append(at)
        self._offices = {
            key: found[0] for key, found in offices.items() if len(found) == 1
        }
        self._lengths = sorted({len(key) for key in self._keys})
        self._prefixes = {key[:6] for key in self._keys}

    def _add(self, at: int, text: str, named: bool) -> None:
        # The name's own length counts: „Urzędzie Gminy” is no longer a name
        # than „Urząd Gminy”.
        if len(canon(text)) < (MIN_NAME if named else MIN_CORE):
            return
        forms = [(form, False) for form in (text, *_declined(text))]
        forms += [(form, True) for form in _abbreviated(text)]
        for form, word in forms:
            key = canon(form)
            entries = self._keys[key]
            if len(key) >= MIN_NAME and all(entry.body != at for entry in entries):
                entries.append(_Entry(at, named, word))

    def office(self, kind: str, code: str) -> int | None:
        """The one office of that kind for a unit: an urząd by its gmina's six
        digits, a starostwo by its powiat's four, an urząd marszałkowski or
        wojewódzki by the województwo's two."""
        return self._offices.get((kind, code))

    def find(self, band: _Band, unit: _Unit) -> list[_Mention]:
        """The bodies named on the band, one for each place a name is at."""
        text = band.canon
        hits: list[_Hit] = []
        for start in range(len(text)):
            if text[start : start + 6] not in self._prefixes:
                continue
            for length in self._lengths:
                end = start + length
                if end > len(text):
                    break
                entries = self._keys.get(text[start:end])
                if not entries or not band.stands_alone(start, end):
                    continue
                entries = [e for e in entries if not e.word or band.starts_word(start)]
                if entries and not band.private_before(start):
                    hits.append(_Hit(start, end, entries))
        mentions = []
        for cluster in _overlapping(hits):
            body = self._choose(cluster, band, unit)
            if body is not None:
                start = min(hit.start for hit in cluster)
                end = max(hit.end for hit in cluster)
                mentions.append(_Mention(start, end, "body", body=body))
        return mentions

    def _choose(self, cluster: list[_Hit], band: _Band, unit: _Unit) -> int | None:
        """The body overlapping names are: of the names saying their town, the
        longest, nearest the declarant's unit; else of the others, one placed
        by its town or by the unit (`_placed`). None where two bodies tie."""
        named: dict[int, tuple[int, ...]] = {}
        placed: dict[int, tuple[int, ...]] = {}
        for hit in cluster:
            length = hit.end - hit.start
            for entry in hit.entries:
                level = unit.level(self.bodies[entry.body])
                score: tuple[int, ...]
                if entry.named:
                    found, score = named, (-length, level)
                else:
                    how = self._placed(entry.body, hit, band, level)
                    if how is None:
                        continue
                    found, score = placed, (how, -length, level)
                found[entry.body] = min(found.get(entry.body, score), score)
        for found in (named, placed):
            if found:
                ranked = sorted((score, body) for body, score in found.items())
                if len(ranked) > 1 and ranked[1][0] == ranked[0][0]:
                    return None
                return ranked[0][1]
        return None

    def _placed(self, body: int, hit: _Hit, band: _Band, level: int) -> int | None:
        """How a name not saying its town is placed: 0 by its town beside it on
        the band, 1 by the body standing in the declarant's unit or serving
        it, 2 in their powiat, 3 by a national body's long name no other body
        has; None when nothing places it."""
        town = self._towns[body]
        around = slice(max(0, hit.start - TOWN_BEFORE), hit.end + TOWN_AFTER)
        if town and town in band.towns[around]:
            return 0
        if level <= 1:
            return 1 + level
        near = band.canon[around]
        if (
            len(hit.entries) == 1
            and hit.end - hit.start >= UNIQUE_CORE
            and _national(self.bodies[body].kind)
            and not any(word in near for word in _BRANCH)
        ):
            return 3
        return None


@dataclass(frozen=True)
class _Hit:
    start: int
    end: int
    entries: list[_Entry]


def _body(row: Mapping[str, Any]) -> Body | None:
    regon = str(row.get("regon") or "").strip()
    name = str(row.get("name") or "").strip()
    ownership = str(row.get("ownership") or "")
    if not valid_regon(regon) or not name or ownership.startswith("2"):
        return None
    if _PRIVATE_NAME.search(fold(name)):
        return None
    return Body(
        regon,
        name,
        str(row.get("kind") or ""),
        str(row.get("teryt") or ""),
        str(row.get("seat") or ""),
    )


def _national(kind: str) -> bool:
    """A kind of body with one office for the country, whose name needs no
    town: a ministry, a central institution, a ministry's own unit."""
    return kind in ("ministerstwa", "instytucje centralne") or kind.startswith(
        "jednostki organizacyjne"
    )


def _other_urzad(text: str) -> str | None:
    """The other way an urząd's name is written, if any: „Urząd Miasta w
    Opolu” for „Urząd Miejski w Opolu”."""
    for head, other in _URZAD_HEADS.items():
        if text.startswith(head):
            return other + text[len(head) :]
    return None


def _town_stem(town: str) -> str:
    """How a town's first word starts in every case: „Opole” and „w Opolu”
    share "opol"."""
    first = canon(town.split(maxsplit=1)[0]) if town.split() else ""
    if len(first) > 5:
        first = first[:-2]
    elif len(first) == 5:
        first = first[:-1]
    return first if len(first) >= 4 else ""


def _overlapping(hits: list[_Hit]) -> list[list[_Hit]]:
    clusters: list[list[_Hit]] = []
    end = -1
    for hit in sorted(hits, key=lambda hit: (hit.start, -hit.end)):
        if clusters and hit.start < end:
            clusters[-1].append(hit)
            end = max(end, hit.end)
        else:
            clusters.append([hit])
            end = hit.end
    return clusters


def read_bodies(ctx: Context) -> BodyIndex:
    """The public bodies table as the pipeline builds it, indexed."""
    table = PublicBodies().read_or_process(ctx)
    rows = table.astype(object).where(table.notna(), None).to_dict("records")
    return BodyIndex(cast(list[dict[str, Any]], rows))


# -- the declarant's unit ----------------------------------------------------------


@dataclass(frozen=True)
class _Unit:
    """The unit the declarant was elected in, as PKW's six digits: WWPPGG a
    gmina, WWPP00 a powiat, WW0000 a województwo."""

    code: str

    @staticmethod
    def of(teryt: str) -> _Unit:
        digits = re.sub(r"\D", "", teryt or "")
        return _Unit(digits[:6].ljust(6, "0"))

    @property
    def prefix(self) -> str:
        if self.code.endswith("0000"):
            return self.code[:2]
        if self.code.endswith("00"):
            return self.code[:4]
        return self.code

    def level(self, body: Body) -> int:
        """0 a body in the unit or serving all of it, 1 in its powiat, 2 in its
        województwo, 3 elsewhere."""
        codes = [code for code in (body.teryt, body.seat) if code]
        prefix = self.prefix
        if any(code.startswith(prefix) or prefix.startswith(code) for code in codes):
            return 0
        if any(code[:4] == self.code[:4] for code in codes):
            return 1
        if any(code[:2] == self.code[:2] for code in codes):
            return 2
        return 3


# -- the band ----------------------------------------------------------------------

#: A line a stamp or a footer printed: never a post.
_STAMP = re.compile(
    r"wplyn|www|http|signform|podpis|pieczec|upowazn|(^|\s)z ?up(\s|$)|(^|\s)l ?dz\s"
)
_SIGNED_FOR = re.compile(r"(^|\s)z ?up(\s|$)")
#: The name signed under a „Z up.” stamp starts with a degree: „mgr inż. ...”.
_SIGNATURE = re.compile(r"^(mgr|inz|dr|lic|prof)\b")
#: How many short lines under a „Z up.” stamp are its name and title.
_SIGNED_LINES = 2
_SIGNED_WORDS = 4

#: Words titles are made of, to split what OCR glued together and to mend its
#: letters: „ZASTĘPCAWÓJTAGMINY”, „Gtówny Specjatista”, „W6jt”.
_LEXICON = (
    "wojt", "wojta", "burmistrz", "burmistrza", "prezydent", "prezydenta",
    "zastepca", "zastepcy", "wice",
    "starosta", "starosty", "wicestarosta", "wicestarosty",
    "marszalek", "marszalka", "wicemarszalek", "wicemarszalka",
    "wojewoda", "wojewody", "wicewojewoda", "wicewojewody",
    "prezes", "prezesa", "wiceprezes", "wiceprezesa",
    "czlonek", "czlonka", "czlonkini", "zarzadu",
    "sekretarz", "sekretarza", "podsekretarz", "stanu", "skarbnik", "skarbnika",
    "doradca", "doradcy", "dyrektor", "dyrektora", "wicedyrektor", "wicedyrektora",
    "kierownik", "kierownika", "kierowniczka", "naczelnik", "naczelnika",
    "komendant", "komendanta", "koordynator", "prokurent",
    "glowny", "glowna", "glownego", "glownej", "ksiegowy", "ksiegowa",
    "pracownik", "nauczyciel", "nauczycielka", "specjalista", "specjalistka",
    "inspektor", "podinspektor", "referent", "starszy", "starsza", "mlodszy",
    "mlodsza", "wykladowca", "pedagog", "wychowawca", "asystent", "urzednik",
    "rada", "rady", "nadzorcza", "nadzorczej", "komisja", "komisji",
    "rewizyjna", "rewizyjnej", "spoleczna", "spolecznej",
    "radny", "radna", "radnego", "radnej", "przewodniczacy", "przewodniczaca",
    "wiceprzewodniczacy", "wiceprzewodniczaca", "soltys",
    "gminy", "miasta", "powiatu", "wojewodztwa", "wydzialu", "referatu",
    "dzialu", "zakladu", "biura", "filii", "szkoly", "redakcji",
    "stanowisko", "stanowisku", "pelniacy", "pelniaca", "obowiazki",
)  # fmt: skip
_LEXICON_LONGEST = sorted(_LEXICON, key=len, reverse=True)
_LEXICON_SAME = {word: _same(word) for word in _LEXICON}
#: Words an office is named with besides its place: „Wójt Gminy”, „Urzędu”.
_OFFICE_WORDS = frozenset(
    {"urzad", "urzedu", "starostwa", "rzeczypospolitej", "polskiej", "miejskiej"}
)

_LOWER = "a-ząćęłńóśźż"
_UPPER = "A-ZĄĆĘŁŃÓŚŹŻ"
#: Where OCR ran words together their case shows it: „StarostwoPowiatowe”. Not
#: at a lone small letter in a word in capitals: „GtÓWNY” is one word.
_CAMEL = re.compile(rf"(?<=[{_LOWER}]{{2}})(?=[{_UPPER}])|(?<=[0-9])(?=[{_UPPER}])")
_SPACED_DASH = re.compile(r"\s+[-–—]+\s*|[-–—]+\s+")
_TOKEN = re.compile(r"[^\W_]+|[;/|]|[,:()\-–—]")
_PRIVATE_MARKS = tuple(_same(mark) for mark in ("niepubl", "prywat", "nzoz"))
#: What a street's name follows, and a street run together with its number:
#: „ul. Polna 7” is no town Polna.
_STREET = frozenset({"ul", "ulica", "al", "aleja", "aleje", "pl", "plac", "os"})
_HOUSE = re.compile(r"[a-z]+[0-9]+[a-z]?")
#: A deputy or acting title cut off by the line's end.
_DANGLING = re.compile(r"zastepc\w*|z ?c[ay]|p o|pelniac\w*( obowiazki)?|wice")
#: An office's name a title can run onto the next line with.
_LEVEL = re.compile(r"powiatu|gminy|miasta|wojewodztwa|wojewody|starosty")


@dataclass(frozen=True)
class _Word:
    #: Folded letters and digits; a title word's letters mended.
    text: str
    #: What stands before it: 0 a space or nothing, 1 a comma, a spaced dash,
    #: a colon, a bracket or a line break, 2 a semicolon or a slash.
    gap: int = 0
    #: A dash OCR ran into it from the word before: „wOpolu-wicestarosta”.
    dash: bool = False
    #: It starts a line.
    line: bool = False


class _Band:
    """A band's lines as words, and squashed: the text names are found in."""

    def __init__(self, lines: Sequence[str]) -> None:
        self.words: list[_Word] = []
        for line in lines:
            for i, word in enumerate(_line_words(line)):
                gap = max(word.gap, 1) if i == 0 and self.words else word.gap
                self.words.extend(
                    _Word(part, gap, word.dash, i == 0) if j == 0 else _Word(part)
                    for j, part in enumerate(_peel(word.text))
                )
        self.starts: list[int] = []
        at = 0
        for word in self.words:
            self.starts.append(at)
            at += len(word.text)
        self.canon = _same("".join(word.text for word in self.words))
        self.towns = "".join(_without_streets(self.words))
        self._starts = set(self.starts)

    def starts_word(self, at: int) -> bool:
        return at in self._starts

    def stands_alone(self, start: int, end: int) -> bool:
        """A name ending in a number is not the start of a longer number: „nr
        5” is not in „nr 51”."""
        text = self.canon
        return not (
            (end < len(text) and text[end - 1].isdigit() and text[end].isdigit())
            or (start > 0 and text[start].isdigit() and text[start - 1].isdigit())
        )

    def private_before(self, start: int) -> bool:
        """„Niepubliczna Szkoła Podstawowa w ...” is not the public one."""
        before = self.canon[max(0, start - 14) : start]
        return any(mark in before for mark in _PRIVATE_MARKS)

    def segment(self, word: int) -> list[str]:
        """The words from `word` up to the next comma, dash or line break."""
        end = word + 1
        while end < len(self.words) and self.words[end].gap == 0:
            end += 1
        return [w.text for w in self.words[word:end]]

    def title(self, word: int) -> list[str]:
        """The words a title starting at `word` may run to: its segment, and
        the next where the line breaks after a deputy („Zastępca / Dyrektora”)
        or before the office („Członek Zarządu / Powiatu Opolskiego”)."""
        words = self.segment(word)
        after = word + len(words)
        if after < len(self.words) and (
            _DANGLING.fullmatch(" ".join(words))
            or (self.words[after].line and _LEVEL.fullmatch(self.words[after].text))
        ):
            words += self.segment(after)
        return words


def _without_streets(words: Sequence[_Word]) -> Iterator[str]:
    """The band's text as towns are looked for in it: a street's name and
    number blanked out."""
    street = False
    for word in words:
        street = street and word.gap == 0
        blank = street or _HOUSE.fullmatch(word.text)
        yield "#" * len(word.text) if blank else _same(word.text)
        if word.text in _STREET:
            street = True
        elif any(c.isdigit() for c in word.text):
            street = False


def _line_words(line: str) -> list[_Word]:
    text = _SPACED_DASH.sub(" , ", _CAMEL.sub(" ", line))
    words: list[_Word] = []
    gap, dash = 0, False
    for token in _TOKEN.findall(text):
        if token in ";/|":
            gap = 2
        elif token in "-–—":
            dash = True
        elif not token[0].isalnum():
            gap = max(gap, 1)
        else:
            folded = squash(token)
            if folded:
                words.append(_Word(folded, gap, dash))
                gap, dash = 0, False
    return words


def _peel(word: str) -> list[str]:
    """A word OCR glued titles into, apart, and title words with OCR's letters
    mended: „zastepcawojtagminy” is "zastepca wojta gminy", „gtowny” is
    "glowny"."""
    parts: list[str] = []
    rest = word
    while rest:
        same = _same(rest)
        for lexeme in _LEXICON_LONGEST:
            fits = len(rest) == len(lexeme) or len(rest) - len(lexeme) >= 3
            if fits and same.startswith(_LEXICON_SAME[lexeme]):
                parts.append(lexeme)
                rest = rest[len(lexeme) :]
                break
        else:
            parts.append(rest)
            break
    return parts


def _kept(lines: Iterable[str]) -> list[str]:
    """The lines without stamps and footers, nor the name and title signed
    under a „Z up.” stamp."""
    kept: list[str] = []
    signed = 0
    for line in lines:
        folded = " ".join(re.sub(r"[^a-z0-9]+", " ", fold(line)).split())
        if _STAMP.search(folded):
            signed = _SIGNED_LINES if _SIGNED_FOR.search(folded) else 0
            continue
        if signed and (
            len(folded.split()) <= _SIGNED_WORDS or _SIGNATURE.match(folded)
        ):
            signed -= 1
            continue
        signed = 0
        kept.append(line)
    return kept


# -- titles, and what takes a title's place ----------------------------------------

#: A seat on a council, or chairing one: the mandate, not a post.
_MANDATE = re.compile(
    r"^(radn|przewodnicz|wiceprzewodnicz|soltys|lawni|sejmik|czlon\w* "
    r"(rady (gminy|powiatu|miasta|miejskiej|dzielnicy|wojewodztwa|osiedla)|komisji))"
)
#: What an employer line says instead of a post.
_NOT_A_POST = re.compile(
    r"^(umow\w* (zlecen|o dzielo|cywilnopraw)|zleceni|emeryt|rencist|bezrobotn|"
    r"rolnik|wlasciciel|wspolnik|komandytariusz|student|nie dotyczy|"
    r"niezatrudnion|nie pracuj|dzialalnosc|wlasna dzialalnosc)"
)
#: How far before a body a title may end and still be the body's: it runs
#: into the body's name, or a comma stands between them.
_TITLE_BEFORE = 3
#: Words a title follows when it starts an item: „zatrudniony na stanowisku
#: Wójta”, „funkcja - radny”. Within an item, „Kancelaria Prezydenta” holds no
#: prezydent.
_LEADS_INTO = ("stanowisk", "funkcj", "jako", "zatrudnion")
#: „Z-cy Dyrektora” is the „Z-ca” of the chips' patterns, in the genitive.
_DEPUTY_GENITIVE = re.compile(r"^(z ?)cy\b")


@dataclass
class _Mention:
    start: int
    end: int
    #: "body"; "title"; "mandate"; or "other", a contract or a pension.
    what: str
    body: int | None = None
    chip: RoleChip | None = None
    family: str | None = None
    words: tuple[str, ...] = ()
    #: The title starts an item: a line, or after a comma, a dash or „na
    #: stanowisku”.
    leads: bool = False
    taken: bool = False


def _titles(band: _Band, roles: Roles, bodies: list[_Mention]) -> list[_Mention]:
    """The titles, mandates and other answers on the band, each where a word
    starts outside a body's name."""
    inside = {
        word
        for word, start in enumerate(band.starts)
        if any(body.start <= start < body.end for body in bodies)
    }
    found: list[_Mention] = []
    word = 0
    while word < len(band.words):
        if word in inside:
            word += 1
            continue
        segment = band.title(word)
        phrase = _DEPUTY_GENITIVE.sub(r"\1ca", " ".join(segment))
        family, chip = roles.read(phrase)
        after_post = word > 0 and band.words[word - 1].text.startswith("stanowisk")
        what = (
            # „na stanowisku nadleśniczego”: a title, if not one a chip names.
            "title"
            if family or after_post
            else "mandate"
            if _MANDATE.match(phrase)
            else "other"
            if _NOT_A_POST.match(phrase)
            else None
        )
        if what is None:
            word += 1
            continue
        start = band.starts[word]
        end = start + sum(len(text) for text in segment)
        here = band.words[word]
        leads = word == 0 or here.gap > 0 or here.dash
        leads = leads or band.words[word - 1].text.startswith(_LEADS_INTO)
        found.append(
            _Mention(start, end, what, None, chip, family, tuple(segment), leads)
        )
        word += len(segment)
    return found


# -- rows --------------------------------------------------------------------------


@dataclass(frozen=True)
class Suggestion:
    """A row the machine offers readers to accept or reject."""

    regon: str
    #: A role chip's id, never „inne”.
    role: str

    def payload(self) -> dict[str, Any]:
        """As `suggestionSchema` takes it."""
        return {"employer": {"regon": self.regon}, "role": self.role}


def suggest(
    lines: Sequence[str],
    unit: str,
    bodies: BodyIndex,
    *,
    typed: bool,
    roles: Roles | None = None,
) -> list[Suggestion]:
    """At most four rows for a band's OCR lines, in reading order, read by a
    declarant elected in `unit` (PKW's TERYT: WWPPGG, WWPP00 or WW0000), those
    at the unit first. None for a handwritten band."""
    if not typed:
        return []
    roles = roles or read_roles()
    where = _Unit.of(unit)
    band = _Band(_kept(lines))
    employers = bodies.find(band, where)
    mentions = sorted(
        employers + _titles(band, roles, employers), key=lambda m: (m.start, m.what)
    )
    rows: list[tuple[int, int, RoleChip]] = []
    for at, mention in enumerate(mentions):
        if mention.body is not None:
            kind = bodies.bodies[mention.body].kind
            title = _title_of(mentions, at, roles, kind)
            if title is not None and title.chip is not None:
                rows.append((mention.start, mention.body, title.chip))
    for mention in mentions:
        if (
            mention.what == "title"
            and mention.chip
            and mention.leads
            and not mention.taken
        ):
            office = _office(bodies, roles, mention, where)
            if office is not None:
                rows.append((mention.start, office, mention.chip))
    return _ordered(rows, bodies, where)


def _title_of(
    mentions: list[_Mention], at: int, roles: Roles, kind: str
) -> _Mention | None:
    """The title the body at `at`, of that kind, is held in: the first one
    after it, unless a mandate or something else comes first, or a title of
    another office; else one that runs into it."""
    body = mentions[at]
    for mention in mentions[at + 1 :]:
        if mention.what == "body":
            break
        if mention.taken:
            continue
        if mention.what != "title" or not _held_at(roles, mention, kind):
            return None
        mention.taken = True
        return mention
    if at > 0:
        before = mentions[at - 1]
        if (
            before.what == "title"
            and not before.taken
            and before.end >= body.start - _TITLE_BEFORE
            and _held_at(roles, before, kind)
        ):
            before.taken = True
            return before
    return None


def _offices_of(roles: Roles, title: _Mention) -> set[str]:
    """The kinds of office a title is held at, where it says: a wójt's or a
    starosta's own, else those whose level it names („sekretarz powiatu”,
    „członek zarządu województwa”); none for a dyrektor or a kierownik."""
    if title.chip is None:
        return set()
    offered = {
        kind
        for kind in roles.offered_at.get(title.chip.id, frozenset())
        if kind in OFFICE_KINDS
    }
    tail = " ".join(title.words[1:])
    named = {kind for kind in offered if OFFICE_LEVELS[kind].search(tail)}
    return (named or offered) if title.chip.family in OFFICE_FAMILIES else named


def _held_at(roles: Roles, title: _Mention, kind: str) -> bool:
    """Whether a title can be held at a body of that kind: a wójt only at an
    urząd, a „członek zarządu powiatu” only at a starostwo, and an executive
    chip the card offers at offices alone (a doradca, a sekretarz) only at
    one: a „doradca zawodowy” at a PUP is staff, not the wojewoda's adviser."""
    offices = _offices_of(roles, title)
    chip = title.chip
    if not offices and chip is not None and chip.kind == "executive":
        offered = roles.offered_at.get(chip.id, frozenset())
        if offered and offered <= OFFICE_KINDS.keys():
            offices = set(offered)
    return not offices or kind in {OFFICE_KINDS[office] for office in offices}


def _office(
    bodies: BodyIndex, roles: Roles, title: _Mention, unit: _Unit
) -> int | None:
    """The office a title no body took names: the declarant's urząd for a
    wójt, their starostwo for a wicestarosta or a „sekretarz powiatu”, their
    urząd marszałkowski for a marszałek. None where the title names a place
    other than that office's."""
    offices = _offices_of(roles, title)
    if len(offices) != 1:
        return None
    office = offices.pop()
    if office == "urzad_gminy":
        code = unit.code if len(unit.prefix) == 6 else ""
    elif office == "starostwo":
        code = unit.code[:4] if len(unit.prefix) >= 4 else ""
    else:
        code = unit.code[:2]
    found = bodies.office(OFFICE_KINDS[office], code) if code else None
    if found is None or not _agrees(title.words[1:], bodies.bodies[found].name):
        return None
    return found


def _agrees(words: Sequence[str], name: str) -> bool:
    """Whether the place a title names, if any, is the office's: „Wicestarosta
    Opolski” the Starostwo Powiatowe w Opolu, „Wójt Gminy Testiowo” (OCR adds
    a letter) the Urząd Gminy Testowo."""
    office = canon(name)
    office_words = [canon(word) for word in fold(name).split() if len(word) >= 4]
    for word in words:
        same = _same(word)
        if len(word) < 4 or word.isdigit() or word in _OFFICE_WORDS:
            continue
        if any(same.startswith(lexeme) for lexeme in _LEXICON_SAME.values()):
            continue
        if same[:4] in office or any(
            _distance(same[: len(other) + 1], other) <= 1 for other in office_words
        ):
            continue
        return False
    return True


def _distance(a: str, b: str) -> int:
    """Levenshtein's, for words OCR added a letter to."""
    previous = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        current = [i]
        for j, y in enumerate(b, 1):
            current.append(
                min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (x != y))
            )
        previous = current
    return previous[-1]


def _ordered(
    rows: list[tuple[int, int, RoleChip]], bodies: BodyIndex, unit: _Unit
) -> list[Suggestion]:
    """One row for each body and family, those at the declarant's unit first,
    at most four."""
    seen: set[tuple[int, str | None]] = set()
    kept: list[tuple[bool, int, Suggestion]] = []
    for start, body, chip in sorted(rows, key=lambda row: row[0]):
        if chip.id == OTHER_ROLE or (body, chip.family) in seen:
            continue
        seen.add((body, chip.family))
        away = unit.level(bodies.bodies[body]) != 0
        kept.append((away, start, Suggestion(bodies.bodies[body].regon, chip.id)))
    kept.sort(key=lambda row: row[:2])
    return [row for _, _, row in kept][:MAX_SUGGESTIONS]
