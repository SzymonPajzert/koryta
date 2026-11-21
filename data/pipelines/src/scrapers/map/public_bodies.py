"""Every public body in the catalogue, and the unit each one serves.

A post read off a BIP declaration is an `employed` edge to a place, and most
employers a declaration names are not in KRS: a school, a GOPS, a powiatowy
urząd pracy, a starostwo. The catalogue `offices.py` reads for the urzędy lists
all of them, each with the REGON a place made for it is keyed by. This is that
catalogue as a table to pick an employer from and to make a place out of:
`public_bodies.jsonl`, one row per body.

The rows are every PUBLIC, ACTIVE entry with a REGON, except the gminy and the
powiaty themselves ("gminy", "jednostki samorządu terytorialnego"): nobody is
employed by a gmina, a wójt works in its urząd. 70,490 rows in the catalogue of
August 2025.

`teryt` is the unit a body serves, and `seat` the gmina it stands in, which is
not always the same:

1. **The unit its name states.** CENTRUM USŁUG SPOŁECZNYCH GMINY REDZIKOWO
   stands in Słupsk and serves the gmina wiejska Redzikowo; POWIATOWY URZĄD
   PRACY ŁÓDŹ-WSCHÓD stands in Łódź and serves powiat łódzki wschodni; POWIATOWY
   INSPEKTORAT NADZORU BUDOWLANEGO DLA MIASTA PRZEMYŚLA serves the city. A
   gminny unit in a town that shares its name with the gmina wiejska around it
   - GMINNY OŚRODEK POMOCY SPOŁECZNEJ W TARNOWIE - is that gmina's, as an urząd
   gminy there is in `offices.py`. A Warsaw unit that names its dzielnica is
   the dzielnica's, one that names only the city the city's.
2. **A powiat's unit in a city on powiat rights serves the land powiat whose
   starostwo stands there**: POWIATOWE CENTRUM POMOCY RODZINIE W PRZEMYŚLU is
   powiat przemyski's. Unless another unit of its kind in that city is that
   powiat's by name - then this one is the city's, as POWIATOWY URZĄD PRACY W
   ŁODZI is beside POWIATOWY URZĄD PRACY ŁÓDŹ-WSCHÓD.
3. **Else the gmina it stands in.**

The urzędy keep the region `offices.py` gives each of them, and its name, so
that a place made from either table is the same place under the same name.
`rule` says which of these decided `teryt`.

`krs` is the live number the register (`KRSRegisterEntries`) gives the row's
REGON, else the row's own: a company the catalogue files without one is still
the company the site may have a page for, and the catalogue still gives some
companies the number they had before a transformation, which the register has
struck off. Where the register gives the REGON two numbers, the row keeps its
own if it is one of them and has none if not, for an admin to place.

`legal_form` and `ownership` are the GUS codes the catalogue prints before each
form's name - "117" for a spółka z o.o., "113" for a JST's property, 2xx for
private - which is what tells a body that belongs in KRS, or in private hands,
from one a place can be made for. A local unit - a REGON of fourteen digits,
the first nine its parent's - is part of its parent, so it takes the parent's
number, form and ownership where it has none: a company's branch in another
town is still the company.

Names are in normal case by `offices.py`'s rule, with the town after a name
that does not name it, as `display_name` does for a KRS company. Without the
town 1,978 rows share 743 names; with it 1,077 share 502 - eight units in one
city called "Dom Pomocy Społecznej w Krakowie", or a village name many gminy
have - which a place made from the table has to be told apart from.
"""

import collections
import re
import typing
from dataclasses import dataclass

import pandas as pd

from entities.company import display_name
from scrapers.krs.columns import padded_krs
from scrapers.krs.data import PUBLIC_BODIES_CATALOGUE
from scrapers.krs.register import STATUS_OK, KRSRegisterEntries
from scrapers.map.jst import normalise
from scrapers.map.offices import (
    FIRST_CITY_POWIAT,
    JST_TYPE,
    POWIAT_OFFICE,
    RODZ_DZIELNICA,
    RODZ_MIEJSKA,
    RODZ_MIEJSKO_WIEJSKA,
    RODZ_WIEJSKA,
    Units,
    offices_by_region,
    recased,
    unglued,
)
from scrapers.map.teryt import teryt_data
from scrapers.stores import Context, Pipeline

#: The gmina and the powiat as legal persons, which employ nobody.
LEFT_OUT = frozenset({"gminy", JST_TYPE})

#: What decided a row's `teryt` - see the module doc.
RULE_OFFICE = "office"
RULE_NAME = "name"
RULE_LAND_POWIAT = "land_powiat"
RULE_SEAT = "seat"

#: Warsaw's powiat, whose catalogue rows give a dzielnica as their gmina.
WARSAW = "1465"

#: `offices.py`'s region and name for an urząd, by its REGON.
_Offices = dict[str, tuple[str, str]]

COLUMNS = [
    "regon",
    "name",
    "kind",
    "nip",
    "krs",
    "legal_form",
    "ownership",
    "teryt",
    "seat",
    "rule",
]


class PublicBodies(Pipeline):
    """One row per public body: `regon, name, kind, nip, krs, legal_form,
    ownership, teryt, seat, rule` - see the module doc.

    `teryt` and `seat` are codes as the site stores a region's: two digits for
    a województwo, four for a powiat, seven for a gmina or a Warsaw dzielnica.
    """

    filename = "public_bodies"
    # Zero-padded codes and numbers, meaningless without the zeros.
    dtype = {
        column: str
        for column in (
            "regon",
            "nip",
            "krs",
            "legal_form",
            "ownership",
            "teryt",
            "seat",
        )
    }
    #: Derived in seconds from the catalogue, TERC and the register's ledger,
    #: so it is not copied to the shared cache.
    backup_to_shared_cache = False

    register: KRSRegisterEntries

    def process(self, ctx: Context):
        terc = (
            ctx.io.read_data(teryt_data)
            .read_zip("TERC_Urzedowy_2025-11-15.csv")
            .read_dataframe(
                "csv",
                csv_sep=";",
                dtype={"WOJ": str, "POW": str, "GMI": str, "RODZ": str},
            )
        )
        with ctx.io.read_data(PUBLIC_BODIES_CATALOGUE).read_file() as f:
            catalogue = pd.read_csv(f, sep=";", dtype=str, low_memory=False)
        register = krs_by_regon(self.register.read_or_process(ctx))
        bodies = public_bodies(catalogue, terc, register)
        print(
            f"Found {len(bodies)} public bodies, by what decided the unit they "
            f"serve: {bodies['rule'].value_counts(dropna=False).to_dict()}; "
            f"{bodies['krs'].notna().sum()} with a KRS number"
        )
        return bodies


def public_bodies(
    catalogue: pd.DataFrame,
    terc: pd.DataFrame,
    register: dict[str, frozenset[str]] | None = None,
) -> pd.DataFrame:
    """The table, from the catalogue, TERC, and the live KRS numbers the
    register gives each REGON (`krs_by_regon`)."""
    places = _Places(Units(terc))
    offices = _offices(catalogue, terc)
    bodies = [_Body.of(entry, places) for entry in _in_scope(catalogue)]
    land = _land_powiaty(bodies, offices)
    for body in bodies:
        body.serve(places, offices, land)
    _serve_land_powiaty(bodies, land)
    rows = [body.row(register or {}) for body in bodies]
    _from_parents(rows)
    return pd.DataFrame(rows, columns=COLUMNS).sort_values("regon", ignore_index=True)


def krs_by_regon(ledger: pd.DataFrame | None) -> dict[str, frozenset[str]]:
    """The live KRS numbers the register gives each REGON: one for a company,
    two where it was registered again.

    The register writes a company's REGON as fourteen digits ending in zeros,
    the catalogue as nine, and a local unit's as fourteen of its own;
    `_entity_regon` makes them meet.
    """
    if ledger is None or ledger.empty:
        return {}
    answered = ledger[ledger["status"] == STATUS_OK]
    numbers: dict[str, set[str]] = collections.defaultdict(set)
    for regon, krs in zip(answered["regon"], padded_krs(answered["krs"])):
        if isinstance(regon, str) and regon.strip() and krs:
            numbers[_entity_regon(regon)].add(krs)
    return {regon: frozenset(found) for regon, found in numbers.items()}


def _krs_number(own: str | None, live: frozenset[str]) -> str | None:
    """A body's KRS number, from the catalogue's and the live ones the register
    gives its REGON.

    The register's one number wins: the catalogue still names companies the
    register struck off when they were transformed, whose places a post must
    not go to. The catalogue's stands where the register does not know the
    REGON, or lists it among several. A REGON the register gives several other
    numbers has none rather than a wrong one, for an admin to place.
    """
    if len(live) == 1:
        return next(iter(live))
    if not live or own in live:
        return own
    return None


def _entity_regon(regon: str) -> str:
    """The legal person's REGON: the first nine of fourteen digits, which are
    a local unit's number or, ending in zeros, the register's way of writing a
    company's."""
    regon = regon.strip()
    return regon[:9] if len(regon) == 14 else regon


#: What a local unit shares with the legal person it is part of.
_PARENT_COLUMNS = ("krs", "legal_form", "ownership")


def _from_parents(rows: list[dict[str, str | None]]) -> None:
    """A local unit's KRS number, legal form and ownership, where its row has
    none, from its parent's row: a company's branch is the company, so a post
    there belongs to the company's place."""
    parents = {row["regon"]: row for row in rows if len(str(row["regon"])) == 9}
    for row in rows:
        regon = str(row["regon"])
        parent = parents.get(_entity_regon(regon)) if len(regon) == 14 else None
        if parent:
            for column in _PARENT_COLUMNS:
                row[column] = row[column] or parent[column]


def _in_scope(catalogue: pd.DataFrame) -> list[dict[str, str]]:
    rows = catalogue[
        (catalogue["Status"] == "ACTIVE")
        & (catalogue["Kategoria podmiotu"] == "PUBLIC")
        & catalogue["REGON"].notna()
    ].fillna("")
    # The catalogue writes some kinds with a space after them.
    rows = rows.assign(
        **{
            "Typ podmiotu": rows["Typ podmiotu"].str.strip(),
            "Nazwa podmiotu": rows["Nazwa podmiotu"].map(unglued),
        }
    )
    rows = rows[
        ~rows["Typ podmiotu"].isin(LEFT_OUT) & (rows["REGON"].str.strip() != "")
    ]
    return typing.cast(list[dict[str, str]], rows.to_dict("records"))


def _offices(catalogue: pd.DataFrame, terc: pd.DataFrame) -> _Offices:
    """`offices.py`'s region and name for each urząd, by REGON.

    A city's urząd is listed there under the city's powiat and its gmina; the
    gmina is the one kept, as for every other body in a gmina.
    """
    found: _Offices = {}
    for office in offices_by_region(catalogue, terc).itertuples():
        regon, teryt, name = str(office.regon), str(office.teryt), str(office.name)
        if len(found.get(regon, ("",))[0]) < len(teryt):
            found[regon] = (teryt, name)
    return found


def _land_powiaty(bodies: list["_Body"], offices: _Offices) -> dict[str, str]:
    """The land powiat whose starostwo stands in each city on powiat rights."""
    land: dict[str, set[str]] = collections.defaultdict(set)
    for body in bodies:
        served = offices.get(body.regon, ("",))[0]
        if body.kind == POWIAT_OFFICE and len(served) == 4 and _is_city(body.seat):
            land[typing.cast(str, body.seat)[:4]].add(served)
    return {city: powiaty.pop() for city, powiaty in land.items() if len(powiaty) == 1}


def _serve_land_powiaty(bodies: list["_Body"], land: dict[str, str]) -> None:
    """Rule 2, then rule 3 for what is left.

    A unit of a kind whose land-powiat namesake in the same city says so by
    name is the city's: Łódź has a powiatowy urząd pracy for each.
    """
    named = {
        (body.kind, body.seat[:4])
        for body in bodies
        if body.rule == RULE_NAME
        and body.seat
        and body.teryt == land.get(body.seat[:4])
    }
    for body in bodies:
        if body.rule:
            continue
        city = body.seat[:4] if body.seat else ""
        if city in land and body.powiat_unit and (body.kind, city) not in named:
            body.teryt, body.rule = land[city], RULE_LAND_POWIAT
        elif body.seat:
            body.teryt, body.rule = body.seat, RULE_SEAT


def _is_city(code: str | None) -> bool:
    """Whether a code is in a city on powiat rights."""
    return code is not None and len(code) >= 4 and int(code[2:4]) >= FIRST_CITY_POWIAT


@dataclass
class _Body:
    entry: dict[str, str]
    tokens: list[str]
    woj: str | None
    seat: str | None
    teryt: str | None = None
    rule: str | None = None
    #: The urząd's name in `offices.py`, which names it as its place.
    office_name: str | None = None

    @staticmethod
    def of(entry: dict[str, str], places: "_Places") -> "_Body":
        woj = places.units.wojewodztwo(entry["Województwo siedziby"])
        return _Body(
            entry,
            _tokens(entry["Nazwa podmiotu"]),
            woj,
            places.seat(entry, woj) if woj else None,
        )

    @property
    def regon(self) -> str:
        return self.entry["REGON"].strip()

    @property
    def kind(self) -> str:
        return self.entry["Typ podmiotu"]

    @property
    def powiat_unit(self) -> bool:
        """Whether the name calls it a powiat's: POWIATOWY, POWIATU, STAROSTWO.

        Not POWIATOWO-GMINNY or POWIATÓW, which is a union of several.
        """
        return (
            any(
                token in ("STAROSTWO", "POWIECIE")
                or (
                    token.startswith("POWIAT")
                    and token not in ("POWIATOW", "POWIATOWO")
                )
                for token in self.tokens
            )
            and "POWIATOWO" not in self.tokens
        )

    def serve(self, places: "_Places", offices: _Offices, land: dict[str, str]) -> None:
        """Rules 1 and the urzędy; rules 2 and 3 need every row's first."""
        if self.regon in offices:
            self.teryt, self.office_name = offices[self.regon]
            self.rule = RULE_OFFICE
        elif self.woj:
            stated = places.stated(self, land)
            if stated:
                self.teryt, self.rule = stated, RULE_NAME

    def row(self, register: dict[str, frozenset[str]]) -> dict[str, str | None]:
        entry = self.entry
        return {
            "regon": self.regon,
            "name": self.office_name or self.place_name(),
            "kind": self.kind,
            "nip": entry["NIP"].strip() or None,
            "krs": _krs_number(
                _krs(entry["KRS"]),
                register.get(_entity_regon(self.regon), frozenset()),
            ),
            "legal_form": _code(entry["Forma prawna"]),
            "ownership": _code(entry["Forma własności"]),
            "teryt": self.teryt,
            "seat": self.seat,
            "rule": self.rule,
        }

    def place_name(self) -> str:
        """The name in normal case, and its town where it does not name it."""
        name = recased(self.entry["Nazwa podmiotu"])
        town = recased(" ".join(self.entry["Miasto siedziby"].split()))
        words = _tokens(town)
        if self.rule == RULE_NAME or not words or _names_town(self.tokens, words):
            return name
        return typing.cast(str, display_name(name, town))


def _krs(value: str) -> str | None:
    digits = value.strip()
    return digits.zfill(10) if digits.isdigit() else None


def _code(form: str) -> str | None:
    """The GUS code a form's name starts with: 113 for "113 - WŁASNOŚĆ
    JEDNOSTEK SAMORZĄDU TERYTORIALNEGO"."""
    found = re.match(r"\s*(\d+)\s*-", form)
    return found[1] if found else None


#: "M.ST. WARSZAWY" and "W M. RADOMIU", the city written short. Only after
#: W or DLA, since "IM. M. KOPERNIKA" is a patron's initial.
_CAPITAL_SHORT = re.compile(r"\bM\.\s*ST\.?\s*")
_CITY_SHORT = re.compile(r"\b(W|DLA) M\.\s*")


def _tokens(name: str) -> list[str]:
    """The words of a name, uppercase and without diacritics."""
    text = _CAPITAL_SHORT.sub("MIASTA STOLECZNEGO ", normalise(name))
    text = _CITY_SHORT.sub(r"\1 MIASTA ", text)
    return re.findall(r"[A-Z0-9]+", text)


#: Case forms a stem does not lead to.
_IRREGULAR = {
    "WIES": ("WSI",),
    "MIASTO": ("MIESCIE",),
    "BIALYSTOK": ("BIALYMSTOKU", "BIALEGOSTOKU"),
    "KRASNYSTAW": ("KRASNYMSTAWIE", "KRASNEGOSTAWU"),
}

#: Ends that change before a case ending: w Sopocie, w Ostrołęce, w Pradze,
#: w Przysusze, w Złotoryi.
_SOFTENED = (("T", "C"), ("K", "C"), ("G", "DZ"), ("CH", "SZ"), ("J", ""))


def _stems(word: str) -> list[str]:
    """What `word` starts with in every case: GÓR for "w Górze", and WŁOCŁAWK
    for "we Włocławku", whose e drops out as in "w Sosnowcu" or "w Łobzie"."""
    stem = word.rstrip("AEIOUY") or word
    stems = [stem]
    fleeting = re.fullmatch(r"(.+?)I?E([^AEIOUY]+)", stem)
    if fleeting:
        stems.append(fleeting[1] + fleeting[2])
    for end, softened in _SOFTENED:
        if stem.endswith(end):
            stems.append(stem[: -len(end)] + softened)
    return [s for s in stems if len(s) >= 3]


def _ending(token: str, word: str) -> int | None:
    """How long a case ending `token` puts on `word`, 0 for the word itself,
    or None if it is not `word` in any case: "PRZEMYŚLA" is Przemyśl with one,
    and "SŁUPSKIEGO" the powiat słupski with four. Not a word made of it with a
    suffix of its own - "KRAKOWSKI" is not Kraków, nor "LUBAWSKIEGO" Lubawa."""
    if token == word or token in _IRREGULAR.get(word, ()):
        return 0
    return min(
        (
            len(token) - len(stem)
            for stem in _stems(word)
            if token.startswith(stem)
            and len(token) - len(stem) <= 4
            and not re.search("[SC]K", token[len(stem) :])
        ),
        default=None,
    )


def _declined(token: str, word: str) -> bool:
    """Whether `token` is `word` in some case - see `_ending`."""
    return _ending(token, word) is not None


def _run_at(tokens: list[str], start: int, words: tuple[str, ...]) -> int | None:
    """How long the case endings are that make `words` the tokens from `start`
    on, or None if those tokens are not `words` in any case."""
    if start + len(words) > len(tokens):
        return None
    total = 0
    for token, word in zip(tokens[start:], words):
        ending = _ending(token, word)
        if ending is None:
            return None
        total += ending
    return total


def _names(tokens: list[str], words: list[str]) -> bool:
    """Whether the words of a place are anywhere in a name, in whatever case."""
    return bool(words) and any(
        _run_at(tokens, start, tuple(words)) is not None for start in range(len(tokens))
    )


#: First words too many towns share to name one alone: Nowa Wieś, Stara Wieś.
_COMMON_FIRST_WORDS = frozenset(
    {
        "NOWA",
        "NOWE",
        "NOWY",
        "STARA",
        "STARE",
        "STARY",
        "WIELKA",
        "WIELKIE",
        "WIELKI",
        "DOLNA",
        "DOLNE",
        "GORNA",
        "GORNE",
        "ZIELONA",
        "BIALA",
        "BIALE",
        "BIALY",
        "CZARNA",
        "CZARNE",
        "CZARNY",
        "SUCHA",
        "SUCHY",
        "WYSOKA",
        "WYSOKIE",
        "KOLONIA",
        "OSIEDLE",
    }
)


def _names_town(tokens: list[str], town: list[str]) -> bool:
    """Whether a name already says which town it is in: in any case, by the
    first word of a longer name ("w Gorzowie Wlkp."), or by an adjective made
    of it ("Gubiński Dom Kultury")."""
    if _names(tokens, town):
        return True
    first = town[0]
    if len(town) > 1 and (len(first) < 5 or first in _COMMON_FIRST_WORDS):
        return False
    return any(_declined(t, first) or _adjective_of(t, first) for t in tokens)


def _adjective_of(token: str, word: str) -> bool:
    """Whether `token` is an adjective made of `word`: GUBIŃSKI of Gubin,
    ZABRZAŃSKA of Zabrze, MALBORSKIE of Malbork."""
    return any(
        len(stem) >= 4
        and token.startswith(stem)
        and re.fullmatch(r"[A-Z]{0,3}[SC]K[A-Z]{0,5}", token[len(stem) :])
        for stem in [*_stems(word), word[:-1]]
    )


#: The word before a gmina's name, and before a city's or a powiat's.
_GMINA_WORDS = frozenset({"GMINA", "GMINY", "GMINIE", "GMINE"})
_CITY_WORDS = frozenset({"MIASTO", "MIASTA"})
_POWIAT_WORDS = frozenset({"POWIAT", "POWIATU", "POWIECIE", "POWIATEM", "POWIATOWI"})
#: What a gmina's word may be followed by before its name, and the kind of
#: gmina it then is: "GMINY MIEJSKIEJ X", "GMINY I MIASTA X".
_GMINA_KINDS = {
    ("MIEJSKIEJ",): RODZ_MIEJSKA,
    ("MIEJSKA",): RODZ_MIEJSKA,
    ("MIASTO",): RODZ_MIEJSKA,
    ("MIASTA",): RODZ_MIEJSKA,
    ("WIEJSKIEJ",): RODZ_WIEJSKA,
    ("WIEJSKA",): RODZ_WIEJSKA,
    ("I", "MIASTA"): RODZ_MIEJSKO_WIEJSKA,
    ("I", "MIASTO"): RODZ_MIEJSKO_WIEJSKA,
    ("MIEJSKO", "WIEJSKIEJ"): RODZ_MIEJSKO_WIEJSKA,
    ("MIEJSKO", "WIEJSKA"): RODZ_MIEJSKO_WIEJSKA,
}
#: A powiat named after the city it is run from, and a side of it.
_SIDES = {"WSCHOD": "WSCHODNI", "ZACHOD": "ZACHODNI"}


class _Places:
    """TERC's gminy and land powiaty, by the words of their names, and how the
    catalogue's seat names find them."""

    def __init__(self, units: Units) -> None:
        self.units = units
        self._gminy: dict[str, list[tuple[tuple[str, ...], str]]] = (
            collections.defaultdict(list)
        )
        self._powiaty: dict[str, list[tuple[tuple[str, ...], str]]] = (
            collections.defaultdict(list)
        )
        self._dzielnice: dict[str, list[tuple[tuple[str, ...], str]]] = (
            collections.defaultdict(list)
        )
        for code, name in units.names.items():
            words = tuple(_tokens(name))
            if len(code) == 7 and code[6] in (
                RODZ_MIEJSKA,
                RODZ_WIEJSKA,
                RODZ_MIEJSKO_WIEJSKA,
            ):
                self._gminy[code[:2]].append((words, code))
            elif len(code) == 7 and code[6] == RODZ_DZIELNICA:
                self._dzielnice[code[:2]].append((words, code))
            elif len(code) == 4 and not _is_city(code):
                self._powiaty[code[:2]].append((words, code))

    def seat(self, entry: dict[str, str], woj: str) -> str | None:
        """The gmina a body stands in; its powiat or województwo where the
        catalogue's gmina is not one TERC knows.

        Where a town and the villages around it are two gminy of one name, the
        town is the one when the body stands in the town itself.
        """
        powiat = self.units.powiat(woj, entry["Powiat siedziby"])
        dzielnica = self.units.dzielnica(entry["Gmina siedziby"])
        if powiat == WARSAW and dzielnica:
            return dzielnica
        # A city's delegatura - "Łódź-Widzew" - is no gmina: the city is.
        found = self.units.gminy(woj, entry["Gmina siedziby"]) or self.units.gminy(
            woj, entry["Miasto siedziby"]
        )
        if powiat:
            found = [gmina for gmina in found if gmina[0].startswith(powiat)]
        if len(found) > 1:
            in_town = normalise(entry["Miasto siedziby"]) == normalise(
                entry["Gmina siedziby"]
            )
            kinds = (RODZ_MIEJSKA, RODZ_MIEJSKO_WIEJSKA) if in_town else (RODZ_WIEJSKA,)
            found = [gmina for gmina in found if gmina[1] in kinds]
        if len(found) == 1:
            return found[0][0]
        return powiat or woj

    def stated(self, body: _Body, land: dict[str, str]) -> str | None:
        """The unit a body's name states, if it states one - rule 1."""
        tokens, woj = body.tokens, typing.cast(str, body.woj)
        if any(token.startswith("DZIELNIC") for token in tokens):
            dzielnica = self._dzielnica_in(tokens, woj)
            if dzielnica:
                return dzielnica
        for index, token in enumerate(tokens):
            found = None
            if token in _GMINA_WORDS:
                found = self._gmina_after(tokens, index, woj, body.seat)
            elif token in _CITY_WORDS:
                found = self._city_after(tokens, index, woj, body.seat)
            elif token in _POWIAT_WORDS:
                found = self._powiat_after(tokens, index, woj, body.seat, land)
            if found:
                return found
        if body.powiat_unit:
            return self._side_of_city(tokens, woj)
        return self._rural_namesake(body, woj, land)

    def _gmina_after(
        self, tokens: list[str], index: int, woj: str, seat: str | None
    ) -> str | None:
        """GMINY REDZIKOWO, W GMINIE WŁOCŁAWEK, GMINY MIASTO ŚWINOUJŚCIE."""
        kind = None
        start = index + 1
        if tokens[max(0, index - 2) : index] in (["MIASTA", "I"], ["MIASTO", "I"]):
            kind = RODZ_MIEJSKO_WIEJSKA
        for words, said in _GMINA_KINDS.items():
            if tuple(tokens[start : start + len(words)]) == words:
                kind, start = said, start + len(words)
                break
        return self._gmina_at(tokens, start, woj, kind, seat)

    def _city_after(
        self, tokens: list[str], index: int, woj: str, seat: str | None
    ) -> str | None:
        """DLA MIASTA PRZEMYŚLA, MIASTA STOŁECZNEGO WARSZAWY, MIASTA NA PRAWACH
        POWIATU W GDAŃSKU - and MIASTA I GMINY X, which is the gmina's."""
        start = index + 1
        following = tokens[start : start + 3]
        if following[:2] == ["I", "GMINY"] or following[:2] == ["I", "GMINA"]:
            return self._gmina_at(tokens, start + 2, woj, RODZ_MIEJSKO_WIEJSKA, seat)
        if following == ["NA", "PRAWACH", "POWIATU"]:
            return seat if _is_city(seat) else None
        if following[:1] == ["STOLECZNEGO"]:
            start += 1
        return self._gmina_at(tokens, start, woj, RODZ_MIEJSKA, seat)

    def _powiat_after(
        self,
        tokens: list[str],
        index: int,
        woj: str,
        seat: str | None,
        land: dict[str, str],
    ) -> str | None:
        """POWIATU SŁUPSKIEGO, W POWIECIE WARSZAWSKIM ZACHODNIM; POWIATU
        GRODZKIEGO is the city's and POWIAT ZIEMSKI the land powiat's."""
        following = tokens[index + 1 : index + 2]
        if following and following[0].startswith("GRODZK"):
            return seat if _is_city(seat) else None
        if following and following[0].startswith("ZIEMSK"):
            return land.get(seat[:4]) if seat else None
        found = self._longest(self._powiaty[woj], tokens, index + 1)
        return found[0] if len(found) == 1 else None

    def _dzielnica_in(self, tokens: list[str], woj: str) -> str | None:
        """The Warsaw dzielnica a dzielnica's unit names, wherever in its name:
        "OŚRODEK SPORTU I REKREACJI M.ST. WARSZAWY W DZIELNICY ŻOLIBORZ" is
        Żoliborz's, though the city comes first."""
        found = {
            code
            for start in range(len(tokens))
            for code in self._longest(self._dzielnice[woj], tokens, start)
        }
        return found.pop() if len(found) == 1 else None

    def _side_of_city(self, tokens: list[str], woj: str) -> str | None:
        """POWIATOWY URZĄD PRACY ŁÓDŹ-WSCHÓD: powiat łódzki wschodni."""
        for index in range(1, len(tokens)):
            side = _SIDES.get(tokens[index])
            if not side:
                continue
            for words, code in self._powiaty[woj]:
                if (
                    len(words) == 2
                    and words[1] == side
                    and any(
                        words[0].startswith(stem) for stem in _stems(tokens[index - 1])
                    )
                ):
                    return code
        return None

    def _rural_namesake(
        self, body: _Body, woj: str, land: dict[str, str]
    ) -> str | None:
        """A gminny unit standing in a town is the gmina wiejska's of that name,
        where one is around it: Tarnów's GOPS serves the villages, not the city.
        """
        seat, tokens = body.seat, body.tokens
        if not seat or len(seat) != 7 or seat[-1] != RODZ_MIEJSKA:
            return None
        # Not a MIEJSKO-GMINNY one, nor a union of several.
        if any(token.startswith("ZWIAZ") for token in tokens) or not any(
            token.startswith("GMINN")
            and (index == 0 or tokens[index - 1] not in ("MIEJSKO", "POWIATOWO"))
            for index, token in enumerate(tokens)
        ):
            return None
        around = {seat[:4], land.get(seat[:4])}
        rural = [
            code
            for code, kind in self.units.gminy(woj, body.entry["Miasto siedziby"])
            if kind == RODZ_WIEJSKA and code[:4] in around
        ]
        return rural[0] if len(rural) == 1 else None

    def _gmina_at(
        self,
        tokens: list[str],
        start: int,
        woj: str,
        kind: str | None,
        seat: str | None,
    ) -> str | None:
        """The gmina whose name begins at `start`, of the kind the words before
        it said. A bare "GMINY TARNÓW" is the gmina wiejska where a town shares
        its name, since the town's would say MIASTA."""
        found = self._longest(self._gminy[woj], tokens, start)
        if kind == RODZ_MIEJSKA:
            found = [c for c in found if c[-1] == RODZ_MIEJSKA] or [
                c for c in found if c[-1] == RODZ_MIEJSKO_WIEJSKA
            ]
        elif kind:
            found = [c for c in found if c[-1] == kind]
        elif any(c[-1] == RODZ_WIEJSKA for c in found):
            found = [c for c in found if c[-1] == RODZ_WIEJSKA]
        elif seat not in found and all(c[-1] == RODZ_MIEJSKA for c in found):
            # A bare "GMINY SŁUPSK" outside the town is the gmina wiejska of
            # that name, renamed since (Redzikowo): the seat says more.
            return None
        if len(found) > 1 and seat:
            found = [c for c in found if c[:4] == seat[:4]]
        return found[0] if len(found) == 1 else None

    @staticmethod
    def _longest(
        units: list[tuple[tuple[str, ...], str]], tokens: list[str], start: int
    ) -> list[str]:
        """The codes of the units with the longest name that begins at `start`:
        "NOWA WIEŚ WIELKA" over "NOWA WIEŚ". Of those, the ones the name
        writes with the shortest case ending, the name itself first: "GMINY
        CZYŻEW" is Czyżew, though Czyże declines to CZYŻEW as well."""
        found = []
        for words, code in units:
            ending = _run_at(tokens, start, words)
            if ending is not None:
                found.append(((-len(words), ending), code))
        best = min((rank for rank, _ in found), default=None)
        return [code for rank, code in found if rank == best]
