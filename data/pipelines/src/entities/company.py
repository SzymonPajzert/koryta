"""Data classes for representing companies and KRS entities."""

import re
from dataclasses import dataclass, field
from typing import Literal, Optional


@dataclass(frozen=True)
class Source:
    """Represents a source of information for a company."""

    # TODO make sure you're supporting all the sources.
    source: Literal["wiki", "rejestr-io", "hardcoded", "api-krs"]
    source_krs: str | None = None
    reason: str | None = None

    def sort_key(self) -> tuple[str, str, str]:
        """The order a company's sources are listed in. They are collected in
        a set, which iterates in a different order every run."""
        return (self.source, self.source_krs or "", self.reason or "")


@dataclass(frozen=True)
class Owner:
    krs: Optional[str]
    teryt: Optional[str]
    #: Where the owner was read from. None is the register itself; "wiki" is
    #: the `udziałowcy` of the company's Wikipedia article, which `Companies`
    #: falls back to only where the register names no owner at all.
    source: Literal["wiki"] | None = None


#: The commercial company forms, spelled out, as a name in the register ends
#: with them. Spelled loosely because the register is: "SPÓLKA AKCYJNA",
#: "OGRANICZONA ODPOWIEDZIALNOŚCIĄ" and "KOMANDYTOWA- AKCYJNA" all occur in it.
_COMMERCIAL_FORMS = (
    r"(?:PROSTA\s+)?SP[ÓO][ŁL]KA\s+AKCYJNA",
    r"SP[ÓO][ŁL]KA\s+KOMANDYTOW[OA]\s*-?\s*AKCYJNA",
    r"SP[ÓO][ŁL]KA\s+Z\s+OGRANICZON[ĄA]\s+ODPOWIEDZIALNO[ŚS]CI[ĄA]",
    r"SP[ÓO][ŁL]KA\s+Z\s+O\.\s*O\.?",
    r"SP[ÓO][ŁL]KA\s+KOMANDYTOWA",
    r"SP[ÓO][ŁL]KA\s+JAWNA",
    r"SP[ÓO][ŁL]KA\s+PARTNERSKA",
)

#: The same, abbreviated, the way an article or a person writes them - and
#: now and then the register, "KIELECKA GIEŁDA ROLNA S.A.".
_ABBREVIATED_FORMS = (
    r"SP\.\s*Z\s*O\.\s*O\.?",
    r"SP\.\s*K\.?",
    r"SP\.\s*J\.?",
    r"S\.\s*K\.\s*A\.?",
    r"S\.\s*A\.?",
    r"SA",
)

#: One of them at the very end of a name. A form spelled out may follow a
#: space, a dash, a comma or a closing quote - '"OKNOTAR"SPÓŁKA Z OGRANICZONĄ
#: ODPOWIEDZIALNOŚCIĄ' is how the register spells that one. An abbreviation
#: only a space or a comma: "AGENCJA INWESTYCYJNA CORP-SA" is a name, and
#: "ZAKSA" a volleyball club rather than "ZAK" plus "SA".
_TRAILING_FORM = re.compile(
    r"(?:(?:\s*[-–—,]\s*|\s+|(?<=[\"”]))(?:"
    + "|".join(_COMMERCIAL_FORMS)
    + r")|(?:\s*,\s*|\s+)(?:"
    + "|".join(_ABBREVIATED_FORMS)
    + r"))\.?\s*$",
    re.IGNORECASE,
)

#: What the register appends to a company being wound up: part of its name for
#: as long as that lasts (KSH art. 274), and worth a reader's knowing.
_TRAILING_STATUS = re.compile(
    r"(?:\s*[-–—,]\s*|\s+|(?<=[\"”]))(?P<quoted>[\"„”]\s*)?"
    r"(?P<status>W\s+(?:LIKWIDACJI|RESTRUKTURYZACJI"
    r"|UPAD[ŁL]O[ŚS]CI(?:\s+(?:LIKWIDACYJNEJ|UK[ŁL]ADOWEJ))?))"
    r"(?(quoted)[\"”])\.?\s*$",
    re.IGNORECASE,
)


def _nested(text: str, opening: str, closing: str) -> bool:
    """Whether the quotes in `text` open and close in pairs.

    One character can open and close, as '"' does, so a quote after a space
    (or at the start) is read as opening one and any other as closing one."""
    depth = 0
    for i, char in enumerate(text):
        if opening == closing == char:
            if i == 0 or text[i - 1].isspace() or text[i - 1] in "(-":
                depth += 1
            else:
                depth -= 1
        elif char == opening:
            depth += 1
        elif char == closing:
            depth -= 1
        if depth < 0:
            return False
    return depth == 0


#: Quotes that wrap a whole name, opening and closing.
_QUOTES = (('"', '"'), ("„", "”"), ("„", '"'), (",,", "''"))


def _unquoted(name: str) -> str:
    """The name inside one pair of quotes that wraps all of it, else the name.

    '"PKP INTERCITY"' is PKP INTERCITY, and '"PRZEDSIĘBIORSTWO KOMUNALNE
    "SANIKOM""' is PRZEDSIĘBIORSTWO KOMUNALNE "SANIKOM", but '"KZN" -
    "LUBUSKIE"' is two quoted words and stays as it is."""
    for opening, closing in _QUOTES:
        if not (name.startswith(opening) and name.endswith(closing)):
            continue
        inner = name[len(opening) : len(name) - len(closing)].strip()
        if inner and _nested(inner, '"', '"') and _nested(inner, "„", "”"):
            return inner
    return name


def short_name(name: str | None) -> str | None:
    """A company's registered name, without the commercial form it ends with.

    "ORLEN SPÓŁKA AKCYJNA" is ORLEN, and "PKP INTERCITY" SPÓŁKA AKCYJNA is PKP
    INTERCITY: the form is a suffix the register requires and a reader does not
    need, and the quotes are the register's way of setting a name off from it.

    Only the commercial forms go. rejestr.io's own short name drops whatever
    the register files as the legal form, wherever it is the end of the name,
    and that is the noun of a good many names: OPOLSKA IZBA GOSPODARCZA came
    out as "OPOLSKA", KRAJOWA IZBA GOSPODARCZA as "KRAJOWA", POWIATOWY
    SAMODZIELNY PUBLICZNY ZAKŁAD OPIEKI ZDROWOTNEJ as "POWIATOWY". A chamber,
    a foundation, an association or an SPZOZ keeps its whole name here.

    It also dropped the status, and that is kept. "W LIKWIDACJI" is part of a
    name for as long as the company is being wound up, and the one thing on a
    page that says so: POLSKIE RADIO - REGIONALNA ROZGŁOŚNIA W SZCZECINIE "PR
    SZCZECIN" SPÓŁKA AKCYJNA W LIKWIDACJI is "... "PR SZCZECIN" W LIKWIDACJI".

    Whitespace is collapsed, since the register breaks long names over lines.
    A name that would be left empty is returned whole.
    """
    if not name:
        return name
    base = " ".join(name.split())
    statuses: list[str] = []
    while True:
        before = base
        while (status := _TRAILING_STATUS.search(base)) and base[
            : status.start()
        ].strip():
            statuses.insert(0, " ".join(status["status"].split()))
            base = base[: status.start()].strip()
        # Not when what is left ends in a status of its own: in "TARASY
        # OSIEDLE SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ W LIKWIDACJI SPÓŁKA
        # KOMANDYTOWA" it is the partner being wound up, not the company.
        if (form := _TRAILING_FORM.search(base)) and (
            rest := base[: form.start()].strip()
        ):
            if not _TRAILING_STATUS.search(rest):
                base = rest
        base = _unquoted(base)
        if base == before:
            return " ".join([base, *statuses])


def display_name(name: str | None, city: str | None) -> str | None:
    """What to call a company, given that its name may not be its own.

    Municipal companies are named after what they do, and every town has one:
    24 companies are called "Przedsiębiorstwo Energetyki Cieplnej", 19 "Zakład
    Gospodarki Komunalnej", and three separate registrations - 0000095420,
    0000825316 and 0000030563 - are all called exactly "Zakład Utylizacji
    Odpadów". 96 names are shared by more than one company. Nothing about them
    is duplicated in the register; they simply cannot be told apart on a page,
    which is what the note reading "Zakład utylizacji odpadów jest wypisany dwa
    razy" is about.

    The town settles it, so the town goes in the name where the name does not
    already carry it. The check is a plain substring one, which catches the
    common "... w Olsztynie" wording but not "... w Łodzi", where Polish
    declension changes the stem. Getting that wrong repeats the town, which is
    untidy rather than wrong.
    """
    if not name:
        return name
    if not city:
        return name
    if city.upper() in name.upper():
        return name
    return f"{name} ({city})"


@dataclass
class Company:
    """Represents a company entry from a KRS (National Court Register) search.

    It is the standard model of the company in our pipeline."""

    krs: str
    name: str | None = None
    city: str | None = None
    teryt_code: str | None = None
    nip: str | None = None
    regon: str | None = None
    activity: list[str] = field(default_factory=list)
    #: The register's `formaPrawna`, verbatim. Carried because it is the only
    #: thing that identifies the 243 `samodzielny publiczny zaklad opieki
    #: zdrowotnej` hospitals: they sit in the associations register, which has
    #: no `przedmiotDzialalnosci`, so they reach the site with an empty
    #: `activity` and no PKD rule can ever place them. See
    #: `entities.company_categories`.
    form: str | None = None
    sources: list[Source] = field(default_factory=list)
    children: list[str] = field(default_factory=list)
    parents: list[Owner] = field(default_factory=list)
    is_public: bool = False
    #: Which kind of organ supervises the company, normalised - see
    #: `scrapers.krs.organs.SUPERVISION_KINDS`. None is "no odpis was read
    #: for this company", which is not the same as its "brak", meaning the
    #: odpis listed no supervisory organ at all.
    #:
    #: Distinct from `entities.company_bodies.supervisory_body`, which reads
    #: the *legal form* and answers whether a seat is paid. This reads the
    #: register's own `dzial2.organNadzoru`, which is finer but incomplete -
    #: 719 of 1,192 SPZOZ file no organ at all - so it reports rather than
    #: decides. See `scrapers.krs.organs`.
    supervisory_organ: str | None = None
    #: The company's own article on pl.wikipedia.org, when one gives its KRS
    #: number and agrees about its name - see `wiki_articles_for` in
    #: `analysis.interesting`.
    #: Only `Companies` sets it; the register knows nothing of Wikipedia.
    wikipedia: str | None = None
    #: That article's categories, without the "Kategoria:" prefix: the
    #: sector a reader filed the company under, which
    #: `entities.company_categories` reads beside the PKD codes.
    wiki_categories: list[str] = field(default_factory=list)

    def __post_init__(self):
        """Ensures the KRS ID is zero-padded to 10 digits."""
        self.krs = str(self.krs).zfill(10)


@dataclass
class KorytaCompany:
    """A company (place node) already submitted to koryta.pl.

    Read back from a Firestore export so that migrations can target only the
    companies that already exist on the site, mirroring `entities.person.Koryta`.
    """

    id: str
    krs: str | None = None
    # Whether the node is currently published on koryta (has a current revision).
    is_approved: bool = False

    def __post_init__(self):
        if self.krs is not None:
            self.krs = str(self.krs).zfill(10)


@dataclass
class WikiShareholder:
    """One owner a Wikipedia infobox lists under `udziałowcy`.

    `name` is the entry as the article writes it, with its links reduced to
    their text and its references and stake taken out. `article` is the article
    it links to, when it links to exactly one, and `share` the stake in per
    cent, when the article gives one.

    The last three say who the entry is, and at most one of them is set:
    `skarb_panstwa` for the Polish Treasury, `krs` for a company whose own
    article gives its KRS number, `teryt` for a gmina, powiat or wojewodztwo.
    `scrapers.wiki.shareholders` fills them from the dump - through the link,
    or through an article titled the way the entry is written - and `Companies`
    tries what is left against the TERYT register by name. An entry none of
    them reaches is a person, a fund or a foreign company, and stays a name.
    """

    name: str
    article: str | None = None
    share: float | None = None
    krs: str | None = None
    teryt: str | None = None
    skarb_panstwa: bool = False


@dataclass
class Wikipedia:
    name: str
    content_score: int
    krs: str | None
    city: str | None = None
    #: The article's title, as the dump has it. Two articles can give the same
    #: KRS number - a power station names its operator's - and the title is
    #: half of what tells them apart.
    title: str | None = None
    #: The article's address, built the way `entities.person.Wikipedia.source`
    #: is.
    source: str | None = None
    #: The infobox's `udziałowcy`, entry by entry, in the article's order.
    shareholders: list[WikiShareholder] = field(default_factory=list)
    #: The article's categories, without the "Kategoria:" prefix.
    categories: list[str] = field(default_factory=list)


@dataclass
class KRS:
    """
    Represents a manually curated KRS entry, often from multiple sources.
    Provides methods for merging and handling different representations.
    """

    # TODO migrate id to krs for consistency
    id: str

    sources: set[str] = field(default_factory=set)
    teryts: set[str] = field(default_factory=set)
    ministry: str | None = None

    def __post_init__(self):
        """Ensures the KRS ID is zero-padded to 10 digits."""
        self.id = str(self.id).zfill(10)

    def parse(self, id: int | str) -> "KRS":
        """Creates a KRS instance from an ID."""
        return KRS(str(id).zfill(10))

    @staticmethod
    def from_blob_name(blob_name: str) -> "KRS":
        """Creates a KRS instance from a GCS blob name."""
        return KRS(blob_name.split("org/", maxsplit=1)[1].split("/", maxsplit=1)[0])

    def merge(self, other: "KRS") -> "KRS":
        """
        Merges another KRS instance into this one.

        Raises:
            ValueError: If the IDs or ministries are conflicting.
        """
        try:
            assert self.id == other.id
            assert (
                self.ministry == other.ministry
                or self.ministry is None
                or other.ministry is None
            )
        except AssertionError as e:
            raise ValueError(f"Failed to merge KRS: {self} {other}") from e
        return KRS(
            self.id,
            self.sources | other.sources,
            self.teryts | other.teryts,
            self.ministry or other.ministry,
        )

    def __str__(self) -> str:
        return f"{self.id}"

    def full_str(self) -> str:
        return f"KRS(id={self.id}, sources={self.sources}, teryts={self.teryts}"

    def __repr__(self) -> str:
        return self.__str__()

    def __hash__(self) -> int:
        return hash(self.id)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, KRS) and self.id == other.id
