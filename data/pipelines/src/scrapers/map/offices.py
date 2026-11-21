"""The urząd that runs each region, named by REGON.

A wójt, a burmistrz and their deputies are employed by the urząd gminy, a
starosta by the starostwo, a marszałek by the urząd marszałkowski - none of
which is in KRS, so none of which the site has a page for or a number to find
one by. The site lets a contributor record such a post from a person's page by
picking the region, and this is what tells it which institution that means:
`koryta_uploader --type region` puts each region's rows on its node, where
`shared/offices.ts` reads them.

The source is the Katalog Podmiotów Publicznych from dane.gov.pl, the list of
public bodies behind e-Doręczenia, which `CompaniesHardcoded` already downloads.
It carries each office's REGON and NIP, and its seat as three names - the
województwo, the powiat and the gmina the building stands in. It carries no
TERYT code, so the work here is turning the seat into the region the office
serves, which is not always the one it stands in:

- **A gmina wiejska is often run from the town it surrounds.** Urząd Gminy
  Wejherowo stands in Wejherowo, and so does Urząd Miejski w Wejherowie; a town
  and the ring of villages around it share a name, in one powiat, 143 times.
  What the office calls itself says which one it serves - "Urząd Gminy" is the
  rural gmina's, "Urząd Miasta" or "Urząd Miejski" the town's.
- **Sometimes the ring has a different name.** Urząd Gminy Ryńsk stands in
  Wąbrzeźno and Urząd Gminy Redzikowo in Słupsk, a different powiat; neither
  name is the seat's. Five urzędy are like this, and their own names find them.
- **A powiat is often run from the city in its middle.** Starostwo Powiatowe w
  Słupsku serves powiat słupski from Słupsk, a miasto na prawach powiatu with
  no starostwo of its own. 45 starostwa stand in such a city. For 42 the
  catalogue's entry for the powiat itself, at the same address, names which
  powiat it is; the other three are found by the powiat's name.
- **A miasto na prawach powiatu is a gmina and a powiat at once**, and the site
  has a region for each - Gdańsk is both teryt2261 and teryt2261011. Its urząd
  is listed under both, since there is no starostwo to find under the first.

Measured on the catalogue of August 2025 against TERC of 2025-11-15: an office
for each of the 2,479 gminy, the 380 powiaty and the 18 Warsaw dzielnice, and
two for each województwo - the marszałek's and the wojewoda's. No gmina or
powiat has two.

The names are the catalogue's, which is what an urząd calls itself, with three
repairs. Two urzędy call themselves only "URZĄD GMINY" and "URZĄD MIASTA I
GMINY", which tells a contributor picking one out of a powiat's twenty nothing,
so they get their gmina's name after it; "URZĄDGMINY" gets its space back; and
a name printed in capitals, as a quarter of them are, is written in normal
case, which is how the site stores the place made for it.
Each row also carries TERC's name for its region, which is the only name the
site has for the gminy it has no region node for - most of them.
"""

import collections
import re

import pandas as pd

from scrapers.krs.data import PUBLIC_BODIES_CATALOGUE
from scrapers.map.jst import normalise, stem_key
from scrapers.map.teryt import normalize_unit_name, teryt_data
from scrapers.stores import Context, Pipeline

#: The catalogue's `Typ podmiotu` for each kind of office this lists.
GMINA_OFFICE = "urzędy miast i gmin"
POWIAT_OFFICE = "starostwa powiatowe"
MARSHAL_OFFICE = "urzędy marszałkowskie"
VOIVODE_OFFICE = "urzędy wojewódzkie"
DISTRICT_OFFICE = "urzędy dzielnicowe m. st. Warszawy"

#: The catalogue's own entry for a powiat as a legal person, which shares its
#: starostwo's address - see `_powiat_by_address`.
JST_TYPE = "jednostki samorządu terytorialnego"
JST_POWIAT = "powiaty"

#: TERYT's RODZ for the three kinds of real gmina, and for a Warsaw dzielnica.
RODZ_MIEJSKA = "1"
RODZ_WIEJSKA = "2"
RODZ_MIEJSKO_WIEJSKA = "3"
RODZ_DZIELNICA = "8"

#: TERYT numbers the powiaty that are a city on their own from 61 up.
FIRST_CITY_POWIAT = 61

#: How an urząd of a gmina wiejska names itself. "Urząd Gminy i Miasta" is a
#: miejsko-wiejska's, which is why the prefix alone is not enough.
_RURAL_PREFIX = "URZAD GMINY"
_MIXED_PREFIXES = ("URZAD GMINY I MIASTA", "URZAD GMINY I MIASTO")

#: The words an urząd miasta or gminy is named with, whichever gmina it is.
#: A name made of nothing else - "URZĄD GMINY" - names no place at all.
_OFFICE_WORDS = frozenset(
    {"URZAD", "GMINY", "GMINA", "MIASTA", "MIASTO", "MIEJSKI", "I", "W", "WE"}
)

#: "URZĄDGMINY RADZIECHOWY-WIEPRZ", the catalogue's one run-together urząd;
#: and a patron or a number run into the word before it, "IM.JANA", "NR1".
_GLUED = re.compile(r"\b(URZĄD)(GMINY|MIASTA|MIEJSKI)\b", re.IGNORECASE)
_GLUED_PATRON = re.compile(r"\b(IM\.)(?=[^\W\d_])", re.IGNORECASE)
_GLUED_NUMBER = re.compile(r"\b(NR\.?)(?=\d)", re.IGNORECASE)

#: The words a name in normal case keeps lower: "Urząd Miasta i Gminy w Rui",
#: "Nowe Miasto nad Pilicą", "Dom Pomocy Społecznej dla Dzieci".
_LOWER_WORDS = frozenset(
    {"w", "we", "i", "nad", "pod", "na", "z", "ze", "o", "przy", "dla", "do", "oraz"}
)

#: Abbreviations Polish writes lower inside a name: "Szkoła Podstawowa nr 5
#: im. ks. Jana Twardowskiego", "Państwowa Szkoła Muzyczna II st.".
_LOWER_ABBREVIATIONS = frozenset(
    {
        "nr",
        "nr.",
        "im",
        "im.",
        "św",
        "św.",
        "ks",
        "ks.",
        "gen.",
        "bryg.",
        "prof.",
        "dr",
        "dr.",
        "dra",
        "st.",
        "mjr",
        "mjr.",
        "płk",
        "płk.",
        "ppłk",
        "ppłk.",
        "kpt.",
        "kard.",
        "bł.",
        "rtm.",
        "hm.",
        "kmdr",
        "kmdr.",
        "bp",
        "bp.",
        "abp",
        "abp.",
        "ps.",
        "hr.",
        "kpr.",
        "inż.",
        "mgr",
        "ds.",
        "pw.",
        "z/s",
        "ul.",
        "al.",
        "pl.",
        "os.",
    }
)

#: Acronyms with a vowel, which cannot be told from a word the way one without
#: can ("DPS", "PCPR"), and those Polish writes with a small i.
_ACRONYMS = {
    word: word
    for word in (
        "SPZOZ",
        "ZOZ",
        "PGE",
        "AK",
        "CKU",
        "SOSW",
        "ZOL",
        "SIM",
        "PEC",
        "OHP",
        "KRUS",
        "ZUS",
        "USK",
        "ZAZ",
        "LO",
        "SA",
        "OPS",
        "MOPS",
        "GOPS",
        "MGOPS",
        "MOPR",
        "PKO",
        "PZU",
    )
} | {
    "OSIR": "OSiR",
    "MOSIR": "MOSiR",
    "GOSIR": "GOSiR",
    "CKZIU": "CKZiU",
    "PGKIM": "PGKiM",
    "ZGKIM": "ZGKiM",
    "PWIK": "PWiK",
    "MPWIK": "MPWiK",
    "ZWIK": "ZWiK",
    "ARIMR": "ARiMR",
}

_ROMAN = re.compile(r"C{0,3}(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})")
_VOWELS = re.compile("[AEIOUYĄĘÓaeiouyąęó]")
#: A patron's initials run together: "J.H." in "IM. J.H. DĄBROWSKIEGO".
_INITIALS = re.compile(r"([^\W\d_]\.){2,}")
#: What follows an "I" that is a numeral and not "and": "Branżowa Szkoła I
#: Stopnia", "Szkoła Muzyczna I i II Stopnia".
_DEGREE = frozenset({"STOPNIA", "STOPIEŃ", "ST.", "ST"})
#: An oddział numbered in a town: "Zakład Ubezpieczeń Społecznych I Oddział w
#: Poznaniu", where "Szkoła Podstawowa i Oddział Przedszkolny" joins two.
_NUMBERED_BRANCH = frozenset({("ODDZIAŁ", "W"), ("ODDZIAŁ", "WE")})
#: What a quoted or bracketed part of a name opens with: '"BAJKA"'.
_OPENING = "\"„“”«'("
_CLOSING = ".,;:)\"„“”»'"

#: The legal forms after a company's name, as Polish writes them inside one.
_COMPANY_FORMS = (
    (re.compile(r"\bsp\. ?z ?o\. ?o\.?(?=\W|$)", re.IGNORECASE), "sp. z o.o."),
    (
        re.compile(r"(?<=\S )Spółka z Ograniczoną Odpowiedzialnością\b"),
        "spółka z ograniczoną odpowiedzialnością",
    ),
    (re.compile(r"(?<=\S )Spółka Akcyjna\b"), "spółka akcyjna"),
    (re.compile(r"\bS\.a\.(?=\W|$)"), "S.A."),
    (re.compile(r"(?<=\S )m\. ?st\.", re.IGNORECASE), "m.st."),
)

COLUMNS = ["teryt", "region", "name", "regon", "nip"]


class LocalGovernmentOffices(Pipeline):
    """One row per office and region it serves: `teryt, region, name, regon, nip`.

    `teryt` is the region's code as the site stores it - two digits for a
    województwo, four for a powiat, seven for a gmina - so `teryt<code>` is the
    region's node id. `region` is TERC's name for it, as TERC writes it:
    "Wejherowo", "wejherowski", "POMORSKIE".
    """

    filename = "local_government_offices"
    # Zero-padded codes and numbers, meaningless without the zeros - see
    # `PostalCodes` for what an unpinned read does to them.
    dtype = {"teryt": str, "regon": str, "nip": str}

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
        offices = offices_by_region(catalogue, terc)
        print(f"Found {len(offices)} offices for {offices['teryt'].nunique()} regions")
        return offices


def offices_by_region(catalogue: pd.DataFrame, terc: pd.DataFrame) -> pd.DataFrame:
    """The offices in `catalogue`, each against the region it serves.

    Withdrawn entries and entries with no REGON are left out: the one names an
    office nobody works in any more under that number, and the other cannot be
    told apart from a second copy of itself once it is on the site.
    """
    units = Units(terc)
    active = catalogue[
        (catalogue["Status"] == "ACTIVE") & catalogue["REGON"].notna()
    ].fillna("")
    # Before anything reads the names: run together, "URZĄDGMINY" does not
    # start the way a rural urząd's name does.
    active = active.assign(**{"Nazwa podmiotu": active["Nazwa podmiotu"].map(unglued)})

    rows: list[dict[str, str | None]] = []

    def add(teryt: str | None, entry: pd.Series, name: str | None = None):
        if not teryt:
            return
        rows.append(
            {
                "teryt": teryt,
                "region": units.names.get(teryt),
                "name": recased(name or entry["Nazwa podmiotu"]),
                "regon": entry["REGON"].strip(),
                "nip": entry["NIP"].strip() or None,
            }
        )

    by_address = _powiat_by_address(active, units)
    for _, entry in active.iterrows():
        kind = entry["Typ podmiotu"]
        woj = units.wojewodztwo(entry["Województwo siedziby"])
        if not woj:
            continue
        if kind == GMINA_OFFICE:
            gmina = units.gmina_of_office(entry, woj)
            if not gmina:
                continue
            name = _placed(entry["Nazwa podmiotu"], units.names[gmina])
            add(gmina, entry, name)
            # The city's powiat region as well, which has no starostwa.
            if int(gmina[2:4]) >= FIRST_CITY_POWIAT:
                add(gmina[:4], entry, name)
        elif kind == POWIAT_OFFICE:
            add(units.powiat_of_office(entry, woj, by_address), entry)
        elif kind in (MARSHAL_OFFICE, VOIVODE_OFFICE):
            # A voivode's delegatura is a branch of the one urząd, not an
            # office of a region of its own.
            if entry["Podtyp podmiotu"] in ("", "ogólne"):
                add(woj, entry)
        elif kind == DISTRICT_OFFICE:
            add(units.dzielnica(entry["Gmina siedziby"]), entry)

    return pd.DataFrame(rows, columns=COLUMNS).sort_values(
        ["teryt", "regon"], ignore_index=True
    )


def unglued(name: str) -> str:
    """The name single-spaced, with "URZĄDGMINY", "IM.JANA" and "NR1" as the
    words they are."""
    name = _GLUED.sub(r"\1 \2", " ".join(name.split()))
    return _GLUED_NUMBER.sub(r"\1 ", _GLUED_PATRON.sub(r"\1 ", name))


def recased(name: str) -> str:
    """A name the catalogue prints in capitals, in normal case: "URZĄD MIASTA
    OPOLA" is "Urząd Miasta Opola". A name in any other case is the office's
    own spelling and is kept.

    A new place on the site is stored under this name, in normal case rather
    than the register's capitals (decision on 2026-11-11). Each word
    and each part of a hyphenated one starts with a capital, as in
    "Warmińsko-Mazurski", except the words in `_LOWER_WORDS` and the
    abbreviations in `_LOWER_ABBREVIATIONS`; Roman numerals and acronyms stay
    in capitals: "Szkoła Podstawowa nr 5 im. Jana Pawła II", "SPZOZ".
    """
    if not name.isupper():
        return name
    words = name.split(" ")
    text = " ".join(_recased_word(words, index) for index in range(len(words)))
    for form, written in _COMPANY_FORMS:
        text = form.sub(written, text)
    return text


def _recased_word(words: list[str], index: int) -> str:
    word = words[index]
    opening = len(word) - len(word.lstrip(_OPENING))
    if opening:
        # The first word of a quoted or bracketed name: "Przedszkole "Pod
        # Topolą"", "(SPZOZ)".
        return word[:opening] + _recased_word([word[opening:]], 0)
    lower = word.lower()
    if index > 0 and lower in _LOWER_ABBREVIATIONS:
        return lower
    letters = word.strip(_CLOSING)
    if len(letters) > 1 and _ROMAN.fullmatch(letters):
        return word
    if letters in _ACRONYMS:
        return word.replace(letters, _ACRONYMS[letters])
    if _INITIALS.fullmatch(word):
        return word
    # An acronym, unless it ends in a dot: "DPS" is one, "WLKP." is short
    # for a word.
    if (
        len(letters) > 1
        and letters.isalpha()
        and not word.endswith(".")
        and not _VOWELS.search(letters)
    ):
        return word
    if index > 0 and lower in _LOWER_WORDS:
        return "I" if word == "I" and _is_numeral(words, index) else lower
    return _capitalised(word)


def _capitalised(word: str) -> str:
    return "-".join(part.capitalize() for part in word.split("-"))


def _is_numeral(words: list[str], index: int) -> bool:
    """Whether the "I" at `index`, not the first word, is a numeral and not
    "and": the last word ("Komenda Rejonowa Policji Warszawa I"), after "nr",
    before a degree ("I Stopnia", "I i II Stopnia") or a numbered oddział."""
    following = [word.strip(_CLOSING) for word in words[index + 1 : index + 3]]
    if not following or words[index - 1].strip(_CLOSING) == "NR":
        return True
    if following[0] in _DEGREE or tuple(following) in _NUMBERED_BRANCH:
        return True
    return (
        len(following) == 2
        and following[0] == "I"
        and bool(_ROMAN.fullmatch(following[1]))
        and len(following[1]) > 1
    )


def _placed(name: str, gmina: str) -> str:
    """A gmina's urząd's name, with the gmina's after it where it names none:
    "URZĄD GMINY" is "URZĄD GMINY RYPIN".

    In the name's own case, so that a name in capitals stays in capitals.
    """
    if not set(normalise(name).replace("-", " ").split()) <= _OFFICE_WORDS:
        return name
    return f"{name} {gmina.upper() if name.isupper() else gmina}"


def _says_rural(name: str) -> bool:
    """Whether an urząd names itself as a gmina wiejska's."""
    text = normalise(name)
    return text.startswith(_RURAL_PREFIX) and not text.startswith(_MIXED_PREFIXES)


def _rural_core(name: str) -> str:
    """The gmina an urząd names itself after: "RYNSK" for "Urząd Gminy Ryńsk"."""
    text = normalise(name)[len(_RURAL_PREFIX) :].strip(" -,.")
    return text[2:] if text.startswith("W ") else text


def _address(entry: pd.Series) -> tuple[str, ...]:
    return tuple(
        normalise(entry[column])
        for column in (
            "Województwo siedziby",
            "Miasto siedziby",
            "Ulica siedziby",
            "Numer budynku siedziby",
        )
    )


def _powiat_by_address(active: pd.DataFrame, units: "Units") -> dict:
    """Powiat codes keyed by the address of the powiat's own catalogue entry.

    The entry for "POWIAT SŁUPSKI" is the legal person, not the office, but it
    is registered where its starostwo is - which is what says which powiat a
    starostwo standing in a city serves.
    """
    powiaty = active[
        (active["Typ podmiotu"] == JST_TYPE) & (active["Podtyp podmiotu"] == JST_POWIAT)
    ]
    codes: dict[tuple[str, ...], set[str]] = collections.defaultdict(set)
    for _, entry in powiaty.iterrows():
        woj = units.wojewodztwo(entry["Województwo siedziby"])
        name = entry["Nazwa podmiotu"].strip()
        if not woj or not name.upper().startswith("POWIAT "):
            continue
        code = units.powiat(woj, name[len("POWIAT ") :])
        if code:
            codes[_address(entry)].add(code)
    return codes


class Units:
    """TERC, indexed the ways the catalogue's seat names need."""

    def __init__(self, terc: pd.DataFrame) -> None:
        #: TERC's name for every code, at every level.
        self.names: dict[str, str] = {}
        self._wojewodztwa: dict[str, str] = {}
        self._powiaty: dict[tuple[str, str], str] = {}
        self.powiat_names: dict[str, str] = {}
        self._gminy: dict[tuple[str, str], list[tuple[str, str]]] = (
            collections.defaultdict(list)
        )
        self._rural_by_stem: dict[tuple[str, str], list[str]] = collections.defaultdict(
            list
        )
        self._dzielnice: dict[str, str] = {}

        columns = terc[["WOJ", "POW", "GMI", "RODZ", "NAZWA"]]
        for woj, pow_, gmi, rodz, name in columns.itertuples(index=False, name=None):
            if pd.isna(pow_):
                self._wojewodztwa[normalise(name)] = woj
                self.names[woj] = name
            elif pd.isna(gmi):
                code = woj + pow_
                self._powiaty[(woj, normalize_unit_name(name))] = code
                self.powiat_names[code] = name
                self.names[code] = name
            else:
                code = woj + pow_ + gmi + rodz
                self.names[code] = name
                if rodz in (RODZ_MIEJSKA, RODZ_WIEJSKA, RODZ_MIEJSKO_WIEJSKA):
                    key = (woj, normalize_unit_name(name))
                    self._gminy[key].append((code, rodz))
                if rodz == RODZ_WIEJSKA:
                    stem = stem_key(normalise(name))
                    self._rural_by_stem[(woj, stem)].append(code)
                if rodz == RODZ_DZIELNICA:
                    self._dzielnice[normalize_unit_name(name)] = code

    def wojewodztwo(self, name: str) -> str | None:
        return self._wojewodztwa.get(normalise(name)) if name else None

    def powiat(self, woj: str, name: str) -> str | None:
        return self._powiaty.get((woj, normalize_unit_name(name)))

    def dzielnica(self, name: str) -> str | None:
        return self._dzielnice.get(normalize_unit_name(name))

    def gminy(self, woj: str, name: str) -> list[tuple[str, str]]:
        """The real gminy of that name in a województwo, as `(code, rodz)`:
        two where a town and the villages around it share the name."""
        return self._gminy.get((woj, normalize_unit_name(name)), [])

    def gmina_of_office(self, entry: pd.Series, woj: str) -> str | None:
        """The gmina an urząd miasta or gminy serves, or None if unsure.

        By its seat first, then by what it calls itself where the seat is a
        town and the name says it serves the villages around it.
        """
        name = entry["Nazwa podmiotu"]
        rural = _says_rural(name)
        # The seat's gmina, or where that is a district of a city ("Poznań-Stare
        # Miasto" is a delegatura, not a gmina) the city.
        candidates = self._gminy.get(
            (woj, normalize_unit_name(entry["Gmina siedziby"]))
        ) or self._gminy.get((woj, normalize_unit_name(entry["Miasto siedziby"])), [])

        if len(candidates) > 1:
            wanted = (RODZ_WIEJSKA,) if rural else (RODZ_MIEJSKA, RODZ_MIEJSKO_WIEJSKA)
            candidates = [c for c in candidates if c[1] in wanted] or candidates
        if len(candidates) > 1:
            seat = self.powiat(woj, entry["Powiat siedziby"])
            candidates = [c for c in candidates if seat and c[0].startswith(seat)]

        if len(candidates) == 1 and not (rural and candidates[0][1] == RODZ_MIEJSKA):
            return candidates[0][0]

        # A rural gmina run from a town of another name - or nothing found at
        # all. Only the rural "Urząd Gminy X" names its gmina in the nominative,
        # which is the only form the stem can be trusted to match.
        if rural:
            found = self._rural_by_stem.get((woj, stem_key(_rural_core(name))), [])
            if len(found) == 1:
                return found[0]
        return None

    def powiat_of_office(
        self, entry: pd.Series, woj: str, by_address: dict
    ) -> str | None:
        """The powiat a starostwo serves, or None if unsure."""
        seat = self.powiat(woj, entry["Powiat siedziby"])
        if seat and int(seat[2:]) < FIRST_CITY_POWIAT:
            return seat
        # Standing in a city that is its own powiat, so serving the one around
        # it: the powiat's own entry at this address names it.
        found = by_address.get(_address(entry), set())
        if len(found) == 1:
            return next(iter(found))
        # Konin, Gorzów Wielkopolski and Ostrołęka have no such entry. The
        # powiat around a city is named after it - koniński, gorzowski,
        # ostrołęcki - so the one land powiat in the województwo whose name
        # starts the way the city's does. Six letters, because five would find
        # ostrowski beside ostrołęcki.
        if seat:
            city = normalise(self.powiat_names[seat]).split()[0][:6]
            around = [
                code
                for code, powiat in self.powiat_names.items()
                if code[:2] == woj
                and int(code[2:]) < FIRST_CITY_POWIAT
                and normalise(powiat).startswith(city)
            ]
            if len(around) == 1:
                return around[0]
        return None
