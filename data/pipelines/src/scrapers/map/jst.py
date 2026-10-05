"""Turning a government shareholder's name in KRS into the TERYT unit it is.

KRS names the owners of a spolka z o.o. in `dzial1.wspolnicySpzoo`, and 1,674 of
those entries across the site are a gmina, a powiat, a wojewodztwo or the Skarb
Panstwa. Each is a string and nothing else - there is no TERYT code in the
register - so an ownership edge can only be drawn once the string is resolved to
a unit.

Before this module the code did not resolve it at all: it took the *company's
own* seat TERYT and truncated it to the length the prefix implied, so "GMINA
MIASTA GDANSK" holding 10.7% of a Gdynia-seated company became Gdynia. Measured
over the register, that is wrong for 150 of 1,402 gmina entries and, worse, it
collapses every co-owner onto one value: KRS 0000094136 has sixteen owner gminas
and got one, Sadeckie Wodociagi has four and got one.

The two things that make the resolution work:

**The prefix names the RODZ.** TERYT distinguishes a gmina miejska (RODZ 1), a
gmina wiejska (2) and a gmina miejsko-wiejska (3), and 230 gmina names are shared
by two units that differ only in RODZ. The register's own prefix says which:
"GMINA MIEJSKA X" and "GMINA MIASTA X" are RODZ 1, "GMINA WIEJSKA X" is 2,
"MIASTO I GMINA X" is 3. A bare "GMINA X" does not say, which is why
`AMBIGUOUS` exists.

**Polish declension has to be undone.** "GMINA MIASTA NOWEGO MIASTA
LUBAWSKIEGO" is genitive and TERYT writes "Nowe Miasto Lubawskie"; powiat names
are adjectival ("bytowski" for Bytow). Stripping the genitive endings gets a key
both spellings agree on. Measured hit rate over the 1,564 resolvable entries:
97.0% exact, 98.5% with stemming, 99.6% with a fuzzy pass restricted to the
company's own wojewodztwo.

REGON is *not* a better key, though the register carries one: 925 distinct REGONs
describe only 752 units, because the register mixes the JST's number with its
urzad's and with pre-2000 nine-digit ones. Warszawa has five. One REGON is
attached to both GMINA JAWOR and GMINA ZLOTORYJA.
"""

import difflib
import re
import unicodedata
from dataclasses import dataclass
from typing import Literal

#: What a resolution can be asked for. `gmina` is the default because 1,407 of
#: the 1,564 resolvable entries are one.
Level = Literal["wojewodztwo", "powiat", "gmina"]

#: TERYT's RODZ for the three kinds of gmina that are real units. 4 (miasto) and
#: 5 (obszar wiejski) are the halves of a miejsko-wiejska and 8/9 are Warsaw
#: dzielnice and delegatury; none of them owns anything.
RODZ_MIEJSKA = "1"
RODZ_WIEJSKA = "2"
RODZ_MIEJSKO_WIEJSKA = "3"
REAL_GMINA_RODZ = (RODZ_MIEJSKA, RODZ_WIEJSKA, RODZ_MIEJSKO_WIEJSKA)

#: Returned instead of a code when the name resolves to more than one unit and
#: nothing in it says which. 41 entries end here, all of them a bare "GMINA X"
#: where a miejska and a wiejska share the name; the prior is 180:182, so
#: guessing would be a coin flip. The caller decides whether to drop them or
#: round them up to the powiat, which is lossless for 36 of the 41.
AMBIGUOUS = "AMBIGUOUS"

#: The Treasury, which is not a territory and must never be given a TERYT code -
#: it would then compete with real regions for a company's seat.
SKARB_PANSTWA = "SKARB PANSTWA"

#: Longest first, because "GMINA MIEJSKA" has to win over "GMINA". Each maps to
#: the level it names and, for a gmina, the RODZ it implies.
_PREFIXES: tuple[tuple[str, Level, str | None], ...] = (
    ("MIASTO NA PRAWACH POWIATU", "gmina", RODZ_MIEJSKA),
    ("MIASTO STOLECZNE", "gmina", RODZ_MIEJSKA),
    ("MIASTO I GMINA", "gmina", RODZ_MIEJSKO_WIEJSKA),
    ("GMINA I MIASTO", "gmina", RODZ_MIEJSKO_WIEJSKA),
    ("GMINA MIEJSKA", "gmina", RODZ_MIEJSKA),
    ("GMINA WIEJSKA", "gmina", RODZ_WIEJSKA),
    ("GMINA MIASTA", "gmina", RODZ_MIEJSKA),
    ("GMINA MIASTO", "gmina", RODZ_MIEJSKA),
    ("GMINA - MIASTO", "gmina", RODZ_MIEJSKA),
    ("GMINA-MIASTO", "gmina", RODZ_MIEJSKA),
    ("MIASTO-GMINA", "gmina", RODZ_MIEJSKO_WIEJSKA),
    ("WOJEWODZTWO", "wojewodztwo", None),
    ("POWIAT", "powiat", None),
    ("MIASTO", "gmina", RODZ_MIEJSKA),
    ("GMINA", "gmina", None),
)

#: Everything after one of these is the owner's representative, its address or
#: its legal boilerplate, none of which is part of the name.
_TAIL_MARKERS = (
    " REPREZENTOWAN",
    " W IMIENIU",
    " DZIALAJAC",
    " Z SIEDZIBA",
    " ZARZAD",
    " MARSZALEK",
    " PREZYDENT",
    " BURMISTRZ",
    " WOJT",
    " STAROSTA",
    " UL ",
    " UL.",
    " JEDNOOSOBOW",
    " SPOLKA",
    " Z SIEDZIB",
)

#: A run of digits is a street number or a postal code, never part of a name -
#: "GMINA SKARZYSKO-KAMIENNA SIKORSKIEGO 18 26-110 SKARZYSKO-KAMIENNA" is one
#: entry in the register. Everything from the first digit on is cut.
_DIGIT_RUN = re.compile(r"\s\d")

#: Suffixes the register glues on that TERYT does not carry.
_DROPPED_SUFFIXES = (
    " MIASTO NA PRAWACH POWIATU",
    "-MIASTO NA PRAWACH POWIATU",
    " MIASTO NA PRWACH POWIATU",
    " NA PRAWACH POWIATU",
    " - MIASTO",
    " MIASTO",
)

#: Says the owner is a gmina miejska without using a prefix that does. Stripped
#: like the others, but it sets the RODZ on the way out rather than losing it -
#: "GMINA ZAGAN O STATUSIE MIEJSKIM" is otherwise indistinguishable from the
#: bare "GMINA ZAGAN" that sits next to a gmina wiejska of the same name.
_MIEJSKA_SUFFIX = " O STATUSIE MIEJSKIM"

#: A miasto na prawach powiatu is a gmina miejska that is also a powiat, and the
#: register often names one by that status alone, written after the town rather
#: than before it: "WLOCLAWEK - MIASTO NA PRAWACH POWIATU". `clean` cuts the
#: status off like the other suffixes, which leaves a bare town name - and a name
#: with no prefix is read as a company, so the ten companies owned this way,
#: MPEC Wloclawek and Wodociagi Slupsk among them, all came out private. The
#: status is what says the owner is the town and not the gmina wiejska of the
#: same name that Wloclawek and Chelm both have.
_POWIAT_STATUS = ("NA PRAWACH POWIATU", "NA PRWACH POWIATU")

#: Abbreviations and outright typos in the register, and the aliases where the
#: unit has been renamed since the entry was filed. Applied to the normalised
#: form, so no diacritics.
_FIXUPS = (
    ("WLKP.", "WIELKOPOLSKI"),
    ("WLKP", "WIELKOPOLSKI"),
    ("LUB.", "LUBELSKI"),
    ("N/NOTECIA", "NAD NOTECIA"),
    ("N. NOTECIA", "NAD NOTECIA"),
    ("MIAST0", "MIASTO"),
    ("STARGARD SZCZECINSKI", "STARGARD"),
    ("SIEMIANOWICE", "SIEMIANOWICE SLASKIE"),
)

#: Genitive and adjectival endings, longest first. Chopped to build a key that a
#: declined form and TERYT's nominative both reduce to: "NOWEGO MIASTA
#: LUBAWSKIEGO" and "NOWE MIASTO LUBAWSKIE" both become "NOW MIAST LUBAWSK".
_ENDINGS = (
    "OWEGO",
    "IEGO",
    "OWEJ",
    "EGO",
    "IEJ",
    "IEM",
    "EJ",
    "IE",
    "A",
    "E",
    "I",
    "O",
    "U",
    "Y",
)

#: How much of a word must survive being stemmed. Three is what makes
#: "NOWEGO" -> "NOW" and "NOWE" -> "NOW" agree; at four they do not meet and
#: "GMINA MIASTA NOWEGO MIASTA LUBAWSKIEGO" never finds "Nowe Miasto Lubawskie".
_MIN_STEM = 3


def normalise(value: str) -> str:
    """Uppercase, without diacritics, single-spaced.

    Diacritics go because the register is inconsistent about them - it holds
    "MIAST0 CHELM" with a digit zero, so it is not a source that can be trusted
    to spell L-with-stroke either.
    """
    decomposed = unicodedata.normalize("NFD", value.upper())
    stripped = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    stripped = stripped.replace("Ł", "L").replace("ł", "L")
    return re.sub(r"\s+", " ", stripped).strip()


def clean(value: str) -> str:
    """The name with the register's boilerplate taken off."""
    text = normalise(value)
    for old, new in _FIXUPS:
        text = text.replace(old, new)
    for marker in _TAIL_MARKERS:
        index = text.find(marker)
        if index > 0:
            text = text[:index]
    match = _DIGIT_RUN.search(text)
    if match and match.start() > 0:
        text = text[: match.start()]
    text = text.strip(" -,.")
    for suffix in _DROPPED_SUFFIXES:
        if text.endswith(suffix):
            text = text[: -len(suffix)].strip(" -,.")
    return text


def classify(name: str) -> tuple[Level | None, str | None, str]:
    """`(level, rodz, core)` for a shareholder name.

    `level` is None when the name is not a JST at all, which is how a corporate
    or private shareholder is told apart from a government one. `core` is the
    name with the prefix removed, still uppercase and undecorated.
    """
    text = clean(name)
    forced_rodz = None
    if text.endswith(_MIEJSKA_SUFFIX):
        text = text[: -len(_MIEJSKA_SUFFIX)].strip(" -,.")
        forced_rodz = RODZ_MIEJSKA
    if text.startswith(SKARB_PANSTWA):
        return None, None, SKARB_PANSTWA
    for prefix, level, rodz in _PREFIXES:
        if (
            text == prefix
            or text.startswith(prefix + " ")
            or text.startswith(prefix + "-")
        ):
            core = text[len(prefix) :].strip(" -")
            # "GMINA MIEJSKA W TCZEWIE" - a locative the prefix table cannot see
            if core.startswith("W "):
                core = core[2:].strip()
            return level, forced_rodz or rodz, core
    if any(status in normalise(name) for status in _POWIAT_STATUS):
        return "gmina", RODZ_MIEJSKA, text
    return None, None, text


def stem_key(core: str) -> str:
    """A key a declined name and its nominative both reduce to.

    Each word loses its genitive or adjectival ending, but only if enough of the
    word survives - chopping "OWEGO" off a five-letter word leaves nothing to
    match on, and short names collide with each other far too easily.
    """
    words = []
    for word in core.split():
        for ending in _ENDINGS:
            if word.endswith(ending) and len(word) - len(ending) >= _MIN_STEM:
                word = word[: -len(ending)]
                break
        words.append(word)
    return " ".join(words)


@dataclass(frozen=True)
class Unit:
    """One TERYT unit, as this module needs it."""

    teryt: str
    name: str
    level: Level
    rodz: str | None
    #: The two-digit code of the wojewodztwo it is in, used to break ties.
    wojewodztwo: str


class JstIndex:
    """Name-to-TERYT for every wojewodztwo, powiat and gmina.

    Built from the TERC file the `Teryt` pipeline already downloads. Only real
    gminy are indexed (RODZ 1, 2, 3): the miasto/obszar-wiejski halves of a
    miejsko-wiejska carry the same name as their parent and would double every
    lookup for units that cannot own anything.
    """

    def __init__(self, units: list[Unit]) -> None:
        self.units = units
        self._exact: dict[tuple[Level, str], list[Unit]] = {}
        self._stemmed: dict[tuple[Level, str], list[Unit]] = {}
        for unit in units:
            key = normalise(unit.name)
            self._exact.setdefault((unit.level, key), []).append(unit)
            self._stemmed.setdefault((unit.level, stem_key(key)), []).append(unit)

    @classmethod
    def from_terc(cls, data) -> "JstIndex":
        """Build from the TERC_Urzedowy dataframe.

        Columns are `WOJ;POW;GMI;RODZ;NAZWA`. A row with no POW and no GMI is a
        wojewodztwo, a row with POW and no GMI is a powiat, and a row with all
        three is a gmina - whose id is WOJ+POW+GMI+RODZ, seven characters,
        because RODZ is part of what identifies it.
        """
        units: list[Unit] = []
        for row in data.itertuples():
            woj, pow_, gmi, rodz = row.WOJ, row.POW, row.GMI, row.RODZ
            name = str(row.NAZWA)
            if _missing(pow_) and _missing(gmi):
                units.append(Unit(str(woj), name, "wojewodztwo", None, str(woj)))
            elif not _missing(pow_) and _missing(gmi):
                units.append(Unit(f"{woj}{pow_}", name, "powiat", None, str(woj)))
            elif not _missing(pow_) and not _missing(gmi):
                if str(rodz) not in REAL_GMINA_RODZ:
                    continue
                units.append(
                    Unit(f"{woj}{pow_}{gmi}{rodz}", name, "gmina", str(rodz), str(woj))
                )
        return cls(units)

    def wojewodztwo_code(self, name: str | None) -> str | None:
        """The two-digit code for a wojewodztwo named in the register.

        The register writes its `siedziba.wojewodztwo` as a clean uppercase
        nominative ("POMORSKIE"), which is exactly TERYT's own spelling, so this
        is a lookup rather than a resolution.
        """
        if not name:
            return None
        key = normalise(name)
        for unit in self.units:
            if unit.level == "wojewodztwo" and normalise(unit.name) == key:
                return unit.teryt
        return None

    def resolve(self, name: str, within_wojewodztwo: str | None = None) -> str | None:
        """The TERYT code the shareholder name names.

        `within_wojewodztwo` is the two-digit code of the *company's* seat, used
        only to narrow a tie - never to answer on its own, which is the mistake
        this module exists to undo. A gmina may own a company seated somewhere
        else entirely, and 252 of them do.

        Returns None when the name is not a JST, `SKARB_PANSTWA` for the
        Treasury, `AMBIGUOUS` when two units fit and nothing chooses, and a
        TERYT code otherwise.
        """
        level, rodz, core = classify(name)
        if core == SKARB_PANSTWA:
            return SKARB_PANSTWA
        if level is None or not core:
            return None

        candidates = self._lookup(level, core)
        if not candidates:
            # The register glues addresses, representatives and river
            # disambiguators onto the name with nothing to cut on: "GMINA
            # SKARZYSKO-KAMIENNA SIKORSKIEGO 18", "POWIAT NAKIELSKI NAD
            # NOTECIA". The name always comes first, so try shorter and shorter
            # leading runs of words - longest first, so the fullest name that
            # matches wins rather than the shortest.
            words = core.split()
            for length in range(len(words) - 1, 0, -1):
                candidates = self._lookup(level, " ".join(words[:length]))
                if candidates:
                    break
        if not candidates:
            candidates = self._fuzzy(level, core, within_wojewodztwo)
        if not candidates:
            return None

        if rodz is not None:
            narrowed = [u for u in candidates if u.rodz == rodz]
            # A miejsko-wiejska is a town too: "GMINA MIASTA X" resolves to it
            # when there is no separate gmina miejska of that name.
            if not narrowed and rodz == RODZ_MIEJSKA:
                narrowed = [u for u in candidates if u.rodz == RODZ_MIEJSKO_WIEJSKA]
            if narrowed:
                candidates = narrowed

        if len(candidates) == 1:
            return candidates[0].teryt
        if within_wojewodztwo:
            in_woj = [u for u in candidates if u.wojewodztwo == within_wojewodztwo]
            if len(in_woj) == 1:
                return in_woj[0].teryt
            if in_woj:
                candidates = in_woj
        # A bare "GMINA X" where a miejska and a wiejska share the name. They
        # are almost always the town and the ring of villages around it, in one
        # powiat - so naming the powiat says less than the register did but says
        # nothing false, which beats a coin flip between two units.
        powiaty = {u.teryt[:4] for u in candidates if u.level == "gmina"}
        if len(powiaty) == 1:
            return powiaty.pop()
        return AMBIGUOUS

    def _lookup(self, level: Level, core: str) -> list["Unit"]:
        """Exact name, then the stemmed key."""
        if not core:
            return []
        return self._exact.get((level, core)) or self._stemmed.get(
            (level, stem_key(core)), []
        )

    def _fuzzy(
        self, level: Level, core: str, within_wojewodztwo: str | None
    ) -> list[Unit]:
        """Closest name inside one wojewodztwo, above 0.80.

        Restricted to the seat's wojewodztwo on purpose: unrestricted, a fuzzy
        match over 2,479 gmina names finds a plausible wrong answer for almost
        anything. Without a wojewodztwo to search in there is no fuzzy pass at
        all - a miss is better than a confident mistake about who owns a company.
        """
        if not within_wojewodztwo:
            return []
        pool = [
            u
            for u in self.units
            if u.level == level and u.wojewodztwo == within_wojewodztwo
        ]
        if not pool:
            return []
        names = {normalise(u.name): u for u in pool}
        matches = difflib.get_close_matches(core, list(names), n=1, cutoff=0.80)
        return [names[matches[0]]] if matches else []


def _missing(value) -> bool:
    """Whether a TERC cell is empty. Pandas gives NaN, which is not a string."""
    return value is None or (isinstance(value, float)) or str(value) in ("nan", "")
