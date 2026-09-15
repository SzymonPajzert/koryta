"""Reading people, and the organ each one sat in, out of an odpis pełny PDF.

Why the PDF at all: ``api-krs.ms.gov.pl`` serves the same register as JSON and
masks every personal field -- a person arrives as ``{"nazwisko":
{"nazwiskoICzlon": "F*****"}, "identyfikator": {"pesel": "7**********"}}``. The
ministry's public search service serves the odpis as a PDF and does *not* mask
it, because the register is public by statute (ustawa o KRS art. 8 ust. 1). So
the JSON says how many people an organ has and the PDF says who they are, which
is also what lets the two check each other -- see
``src/scripts/krs_odpis_check.py``.

The odpis is a form, not prose. Extracted to text it comes out one cell per
line: a numbered label, then for each version of that value a ``wprow.``
number, a ``wykr.`` number and the value itself.

    Rubryka 2 - Organ nadzoru
    1.Nazwa organu
    1
    -
    RADA NADZORCZA
    Podrubryka 1
    Dane osób wchodzących w skład organu
    1
    1.Nazwisko
    1
    15
    SKRZYPEK
    2.Imiona
    1
    15
    JERZY
    3.Numer PESEL lub data urodzenia
    1
    15
    52091312345, ------

Four things about that shape are load-bearing, and each one fails silently when
got wrong:

**The two numbers are the register entries that introduced and struck out the
value.** ``wykr.`` of ``-`` means the value still stands; a number means it
does not. That is the whole reason to fetch an odpis *pełny* rather than an
odpis *aktualny* -- it keeps the struck-out rows, so a board member who left in
2019 is still in the document, marked. A pattern that requires ``-`` in that
position quietly narrows the output to people serving today. On KRS 0000006301
that is the difference between 11 people and 50.

**One label carries many values.** A funkcja that changed from wiceprezes to
prezes is two triples under one label, and concatenating them yields
``"PREZES ZARZĄDU WICEPREZES ZARZĄDU"``. Hence `FieldGroup`: a label and its
versions, with `FieldGroup.effective` picking the one that still stands.

**The field labels differ between organs.** The board's person fields are
``1.Nazwisko / Nazwa lub Firma``, ``3.Numer PESEL/REGON lub data urodzenia``
and ``5.Funkcja w organie reprezentującym``. The supervisory board's are
``1.Nazwisko``, ``3.Numer PESEL lub data urodzenia``, and no funkcja at all --
the same asymmetry `scrapers.krs.organs` documents for the JSON, where what
tells a paid rada nadzorcza from an unpaid rada społeczna is the organ's own
``nazwa`` and never the person. So the organ name is read from the rubryka and
the function from the person, and neither substitutes for the other.

**Some rubryki nest their people in a ``Podrubryka`` and some do not.**
``Organ uprawniony do reprezentacji podmiotu`` and ``Organ nadzoru`` do;
``Prokurenci``, ``Dane jedynego akcjonariusza`` and ``Kurator`` put the person
fields straight in the rubryka. Collecting only inside a Podrubryka loses the
latter -- which is how the sole shareholder of KRS 0000006301 went missing until
the JSON cross-check reported 1 against 0.

Two smaller traps: the dash in ``Rubryka 2 ­ Organ nadzoru`` is a **soft
hyphen** (U+00AD), and ``Strona 49 z`` / ``60`` page footers plus repeated
column headers interleave with the data at arbitrary points, including inside a
person's block -- so they are dropped by matching, not by position.
"""

import io
import re
import typing
import unicodedata
from dataclasses import dataclass
from dataclasses import field as dataclass_field

from pypdf import PdfReader

from scrapers.krs.organs import organ_kind
from util import pesel as pesel_util

#: U+00AD, which the odpis uses in "Rubryka 2 ­ Organ nadzoru".
SOFT_HYPHEN = "­"

_DZIAL_RE = re.compile(r"^Dzia[łl]\s+(\d+)\s*$")
_RUBRYKA_RE = re.compile(r"^Rubryka\s+(\d+)\s*(?:[-–]\s*(.*))?$")
_PODRUBRYKA_RE = re.compile(r"^Podrubryka\s+(\d+)\s*$")
_FIELD_RE = re.compile(r"^(\d+)\.(.*)$")

#: A ``wprow.``/``wykr.`` cell: an entry number, or "-" for "not struck out".
_ENTRY_RE = re.compile(r"^(?:\d+|-)$")

#: Column headers. Matched rather than skipped by position because a page break
#: can put them anywhere, including mid-person.
_NOISE_RE = re.compile(
    r"^(?:L\.p\.|Nr\s+wpisu|Nr|wprow|wykr\.?|\.|Zawartość|Zawartosc"
    r"|kolejn|y\s+w|Numer\s+i\s+nazwa\s+pola|\*+|\s*)$"
)

#: The page footer, which pdf text extraction splits over two lines --
#: ``"Strona 49 z "`` and then ``"60"`` on its own.
#:
#: It has to be removed as a *unit*, before anything is read line by line. Drop
#: only the first line and the page count is left behind as a bare number,
#: which is indistinguishable from a ``wprow.`` cell and lands in whatever
#: value the footer interrupted: "MAREK BUDZIK 60", "CZŁONEK ZARZĄDU 60",
#: "JACEK WŁADYSŁAW 60 GRYZŁO". Silent, and it corrupts a person's name.
_PAGE_FOOTER_RE = re.compile(r"Strona\s+\d+\s+z\s*\n\s*\d+\s*(?:\n|$)")


def fold(text: str) -> str:
    """Lowercase, undiacriticked, single-spaced -- for matching a label.

    The labels are printed text whose spacing and case vary between documents,
    so folding lets the tables below name a concept once rather than once per
    rendering.
    """
    decomposed = unicodedata.normalize("NFD", text.replace(SOFT_HYPHEN, ""))
    bare = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    bare = bare.replace("ł", "l").replace("Ł", "L")
    return re.sub(r"\s+", " ", bare).strip().lower()


#: Rubryka titles (folded, and matched as a prefix) that hold people, mapped to
#: the role vocabulary `scrapers.krs.people_parsing` already uses -- so a
#: PDF-derived person and a JSON-derived one need no translation table to be
#: compared.
ROLE_BY_RUBRYKA: tuple[tuple[str, str], ...] = (
    ("organ uprawniony do reprezentacji", "reprezentacja"),
    # A partnership has no zarzad, so its form titles Dzial 2 Rubryka 1
    # differently and the sp. z o.o./SA prefix above finds nobody in it. This
    # is the *only* place a spolka jawna's or komandytowa's controllers appear:
    # found by `unread_person_rubryki` in 2 of 28 stored odpisy -- the three
    # SZPANSCY partners of KRS 0000157870, and CLIMAMEDIC sp. z o.o. with
    # PANEK at KRS 0000352529, a sp.k. whose general partner is a company.
    ("uprawnieni do reprezentowania spolki", "reprezentacja"),
    ("organ nadzoru", "nadzor"),
    ("prokurenci", "prokurent"),
    ("pelnomocnicy", "pelnomocnik"),
    ("dane jedynego akcjonariusza", "jedyny_akcjonariusz"),
    ("jedyny akcjonariusz", "jedyny_akcjonariusz"),
    ("wspolnicy", "wspolnik"),
    ("dane wspolnikow", "wspolnik"),
    ("komitet zalozycielski", "komitet_zalozycielski"),
    ("kurator", "kurator"),
    ("likwidacja", "likwidator"),
    ("zarzad komisaryczny", "zarzadca_komisaryczny"),
    ("organ sprawujacy nadzor", "nadzor"),
    # Dzial 6. Found by `unread_person_rubryki` on a real run rather than by
    # reading the form: "Informacja o postepowaniu upadlosciowym" holds the
    # syndyk and the debtor's representative, which `PERSON_PATHS` reads from
    # the JSON as two paths under ``postepowanieUpadlosciowe``.
    ("informacja o postepowaniu upadlosciowym", "syndyk"),
    ("informacja o postepowaniu ukladowym", "nadzorca_ukladu"),
    ("informacje o postepowaniach restrukturyzacyjnych", "nadzorca_restrukturyzacyjny"),
    ("informacja o postepowaniu restrukturyzacyjnym", "nadzorca_restrukturyzacyjny"),
)

#: The rubryka whose organ name decides a supervisory organ's kind. Applied
#: only here: running `organ_kind` over "ZARZĄD" would classify the management
#: board as "inny", which reads as a fact about the company rather than as the
#: function being asked the wrong question.
_SUPERVISORY_ROLES = frozenset({"nadzor"})


def _is_person_label(folded: str, prefixes: tuple[str, ...]) -> bool:
    return any(folded.startswith(prefix) for prefix in prefixes)


_SURNAME_PREFIXES = ("nazwisko",)
_GIVEN_PREFIXES = ("imiona", "imie")
_IDENTIFIER_PREFIXES = ("numer pesel",)
_FUNKCJA_PREFIXES = ("funkcja", "rodzaj prokury")


@dataclass(frozen=True)
class Field:
    """One version of a field's value, with the entries that bracket it."""

    #: The register entry that introduced this value, or None where the odpis
    #: printed "-".
    added: str | None
    #: The entry that struck it out, or None where it still stands.
    removed: str | None
    value: str

    @property
    def current(self) -> bool:
        return self.removed is None


@dataclass(frozen=True)
class FieldGroup:
    """A numbered label and every version of its value, in document order."""

    number: int
    label: str
    versions: tuple[Field, ...] = ()

    @property
    def effective(self) -> Field | None:
        """The version that still stands, else the last one recorded.

        Falling back to the last rather than to None matters for a struck-out
        person: every one of their fields is struck out, so "current" would
        leave a former board member with no name.
        """
        for version in self.versions:
            if version.current and version.value:
                return version
        populated = [v for v in self.versions if v.value]
        return populated[-1] if populated else None


@dataclass(frozen=True)
class OdpisPerson:
    """A person the odpis names, and where in the register they sit."""

    krs: str
    dzial: int
    rubryka: str
    #: The role vocabulary shared with `scrapers.krs.people_parsing`.
    role: str
    #: The organ's own name as the register spells it, e.g. "ZARZĄD" or
    #: "RADA SPOŁECZNA PRZY SP ZOZ W LASKOWEJ".
    organ_name: str | None
    #: One of `scrapers.krs.organs.ORGAN_KINDS`, set only for a supervisory
    #: organ -- see `_SUPERVISORY_ROLES`.
    organ: str | None
    position: int
    surname: str
    given_names: str
    funkcja: str | None
    #: Decoded from the PESEL. The number itself is deliberately *not* a field
    #: here -- it is read, decoded and dropped inside `parse_people`, so a
    #: record cannot carry it even by accident.
    birth_date: str | None
    sex: str | None
    #: HMAC of the PESEL under the caller's key, or None when no key was
    #: given. Stands in for the number as a join key across runs: stable for as
    #: long as the key is, and safe to publish in a way a digest of the number
    #: itself would not be. See `util.pesel.fingerprint`.
    pesel_fingerprint: str | None
    #: Whether the identifier field held a PESEL at all. False both for a seat
    #: held by another company and for a person the register has no PESEL for;
    #: `is_company` separates those.
    has_pesel: bool
    is_company: bool
    entry_added: str | None
    entry_removed: str | None

    @property
    def current(self) -> bool:
        """Whether they still hold the seat."""
        return self.entry_removed is None

    @property
    def full_name(self) -> str:
        return f"{self.given_names} {self.surname}".strip()


def extract_text(source: bytes | typing.BinaryIO) -> str:
    handle = io.BytesIO(source) if isinstance(source, bytes) else source
    reader = PdfReader(handle)
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def _split_versions(region: list[str]) -> tuple[Field, ...]:
    """Read a label's region as a run of (wprow, wykr, value) triples."""
    versions: list[Field] = []
    index = 0

    def pair_at(position: int) -> bool:
        return (
            position + 1 < len(region)
            and _ENTRY_RE.match(region[position]) is not None
            and _ENTRY_RE.match(region[position + 1]) is not None
        )

    while index < len(region):
        if not pair_at(index):
            index += 1
            continue
        added = None if region[index] == "-" else region[index]
        removed = None if region[index + 1] == "-" else region[index + 1]
        index += 2
        value_parts: list[str] = []
        while index < len(region) and not pair_at(index):
            value_parts.append(region[index])
            index += 1

        # The last field of a person is followed by the *next* person's `L.p.`
        # counter, which is a lone bare number with no second entry cell after
        # it -- so `pair_at` does not stop on it and it lands at the end of the
        # value: "CZŁONEK ZARZĄDU 2", "WICEPREZES 4", "SEKRETARZ 5". It read as
        # a plausible funkcja on 533 of 1,782 people before this.
        #
        # Guarded on there being something else in the value, because a value
        # can legitimately *be* a bare number: `3.Numer PESEL` under
        # ``Prokurenci`` is eleven digits and nothing else.
        while len(value_parts) > 1 and _ENTRY_RE.match(value_parts[-1]):
            value_parts.pop()

        versions.append(
            Field(
                added=added,
                removed=removed,
                value=re.sub(r"\s+", " ", " ".join(value_parts)).strip(),
            )
        )
    return tuple(versions)


@dataclass
class _Section:
    dzial: int = 0
    rubryka: str = ""
    organ_name: str | None = None
    groups: list[FieldGroup] = dataclass_field(default_factory=list)


def iter_sections(text: str) -> typing.Iterator[_Section]:
    """The odpis as a sequence of rubryki, each with its field groups.

    The label's own text wraps across lines ("3.Numer PESEL/REGON lub data" /
    "urodzenia"), so a label ends at the first ``wprow.`` cell rather than at
    the end of its line.
    """
    normalised = _PAGE_FOOTER_RE.sub("\n", text.replace(SOFT_HYPHEN, "-"))
    lines = [line.strip() for line in normalised.splitlines()]
    section = _Section()
    index = 0
    pending_label: tuple[int, list[str]] | None = None
    region: list[str] = []

    def close_label() -> None:
        nonlocal pending_label, region
        if pending_label is not None:
            number, label_parts = pending_label
            section.groups.append(
                FieldGroup(
                    number=number,
                    label=re.sub(r"\s+", " ", " ".join(label_parts)).strip(),
                    versions=_split_versions(region),
                )
            )
        pending_label, region = None, []

    while index < len(lines):
        line = lines[index]

        if dzial := _DZIAL_RE.match(line):
            close_label()
            if section.groups or section.rubryka:
                yield section
            section = _Section(dzial=int(dzial.group(1)))
            index += 1
            continue

        if rubryka := _RUBRYKA_RE.match(line):
            close_label()
            if section.groups or section.rubryka:
                yield section
            section = _Section(
                dzial=section.dzial, rubryka=(rubryka.group(2) or "").strip()
            )
            index += 1
            continue

        if _PODRUBRYKA_RE.match(line):
            close_label()
            index += 1
            continue

        if match := _FIELD_RE.match(line):
            close_label()
            pending_label = (int(match.group(1)), [match.group(2)])
            index += 1
            continue

        if pending_label is not None:
            if _NOISE_RE.match(line):
                index += 1
                continue
            # Still inside the wrapped label until the first entry cell.
            if not region and not _ENTRY_RE.match(line):
                pending_label[1].append(line)
            else:
                region.append(line)
        index += 1

    close_label()
    if section.groups or section.rubryka:
        yield section


def role_of(rubryka: str) -> str | None:
    folded = fold(rubryka)
    for prefix, role in ROLE_BY_RUBRYKA:
        if folded.startswith(prefix):
            return role
    return None


def _identifier(value: str) -> tuple[str | None, bool]:
    """The PESEL from the identifier field, and whether a company holds the seat.

    The field prints ``<pesel>, <regon>`` with ``------`` for whichever is
    absent, so which half is filled is what separates a natural person from a
    corporate board member.
    """
    parts = [part.strip() for part in value.split(",")] or [value]
    for part in parts:
        digits = re.sub(r"\D", "", part)
        if pesel_util.looks_like_pesel(digits):
            return digits, False
    for part in parts:
        digits = re.sub(r"\D", "", part)
        if len(digits) in (9, 14):
            return None, True
    return None, False


def _fingerprint(
    pesel: str | None, salt: str | None, sink: dict[str, str] | None
) -> str | None:
    """The fingerprint, and the one place a PESEL can be handed to a caller.

    `sink` exists so `--keep-pesel` can build a local lookup table without the
    number ever becoming a field on `OdpisPerson`. That distinction is the
    reason a PESEL cannot reach the published artifact by accident: the record
    has nowhere to put one.
    """
    if not pesel or not salt:
        return None
    digest = pesel_util.fingerprint(pesel, salt)
    if sink is not None:
        sink[digest] = pesel
    return digest


def parse_people(
    text: str,
    krs: str,
    salt: str | None = None,
    pesel_sink: dict[str, str] | None = None,
) -> list[OdpisPerson]:
    """Every person the odpis names, in document order.

    :param salt: key for `util.pesel.fingerprint`. Omit it and the records
        carry a birth date and a sex but no fingerprint -- enough to match
        against `PeopleMerged`, which is what most callers want.
    :param pesel_sink: filled with ``fingerprint -> PESEL`` when given. The
        only route by which a PESEL leaves this function, and it never reaches
        an `OdpisPerson`; whatever a caller does with it must stay local.
    """
    people: list[OdpisPerson] = []

    for section in iter_sections(text):
        role = role_of(section.rubryka)
        if role is None:
            continue

        organ_name: str | None = None
        for group in section.groups:
            if fold(group.label).startswith("nazwa organu"):
                effective = group.effective
                if effective and effective.value:
                    organ_name = effective.value

        position = 0
        current: dict[str, FieldGroup] = {}

        def flush() -> None:
            nonlocal current
            surname_group = current.get("surname")
            if surname_group is None:
                current = {}
                return
            surname = surname_group.effective
            if surname is None or not surname.value:
                current = {}
                return

            identifier_group = current.get("identifier")
            identifier = identifier_group.effective if identifier_group else None
            pesel, is_company = (
                _identifier(identifier.value) if identifier else (None, False)
            )
            facts = pesel_util.facts(pesel)

            given_group = current.get("given")
            given = given_group.effective if given_group else None
            funkcja_group = current.get("funkcja")
            funkcja = funkcja_group.effective if funkcja_group else None

            people.append(
                OdpisPerson(
                    krs=krs,
                    dzial=section.dzial,
                    rubryka=section.rubryka,
                    role=role,
                    organ_name=organ_name,
                    organ=(
                        organ_kind(organ_name)
                        if organ_name and role in _SUPERVISORY_ROLES
                        else None
                    ),
                    position=position,
                    surname=surname.value,
                    given_names=given.value if given else "",
                    funkcja=funkcja.value if funkcja and funkcja.value else None,
                    birth_date=facts.birth_date if facts else None,
                    sex=facts.sex if facts else None,
                    pesel_fingerprint=_fingerprint(pesel, salt, pesel_sink),
                    has_pesel=pesel is not None,
                    is_company=is_company,
                    entry_added=surname.added,
                    entry_removed=surname.removed,
                )
            )
            current = {}

        for group in section.groups:
            label = fold(group.label)
            if _is_person_label(label, _SURNAME_PREFIXES):
                flush()
                position += 1
                current["surname"] = group
            elif _is_person_label(label, _GIVEN_PREFIXES):
                current["given"] = group
            elif _is_person_label(label, _IDENTIFIER_PREFIXES):
                current["identifier"] = group
            elif _is_person_label(label, _FUNKCJA_PREFIXES):
                current["funkcja"] = group
        flush()

    return people


def unread_person_rubryki(text: str) -> set[str]:
    """Rubryki that hold person fields but that `ROLE_BY_RUBRYKA` does not name.

    The same guard `scrapers.krs.people_parsing.unread_person_paths` provides
    for the JSON, and for the same reason: a rubryka the register adds later,
    or spells differently in the register of associations, would otherwise cost
    us everybody in it with no error and no count to notice.
    """
    unread: set[str] = set()
    for section in iter_sections(text):
        if role_of(section.rubryka) is not None:
            continue
        for group in section.groups:
            label = fold(group.label)
            if _is_person_label(label, _IDENTIFIER_PREFIXES) or _is_person_label(
                label, _SURNAME_PREFIXES
            ):
                unread.add(section.rubryka)
    return unread


def parse_pdf(
    content: bytes,
    krs: str,
    salt: str | None = None,
    pesel_sink: dict[str, str] | None = None,
) -> list[OdpisPerson]:
    return parse_people(
        extract_text(content), krs, salt=salt, pesel_sink=pesel_sink
    )
