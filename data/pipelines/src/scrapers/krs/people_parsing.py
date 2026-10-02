"""Parsing of censored people from api-krs.ms.gov.pl JSON responses.

api-krs serves personal data masked: every name arrives as its first character
followed by one asterisk per remaining character, so "Kaliszewski" comes back
as ``K**********``. What survives is the initial and the length, which is
enough to tell two board members apart and - see `scrapers.krs.names` - enough
to recognise the same person in a rejestr.io response.

Which sections hold people is a table, `PERSON_PATHS`, rather than a function
per dzial. The register puts people in sixteen places across six dzialy and
spells the containers three different ways, and reading a section as the wrong
shape finds nobody without saying so: `prokurenci` is a bare list, was read as
an organ with a ``sklad``, and 8,020 proxy appointments went unseen. A company
whose only change was to its proxies then never looked like it had changed at
all, so nothing re-queried it. `unread_person_paths` walks a response looking
for people outside the table, so a section the register adds later shows up as
a failing invariant rather than as silence.

A person's `role` is the table's word for the section, and after a colon
whatever the register says in more detail - the function they hold, or, for a
supervisory organ, which organ it is (see `scrapers.krs.organs`). That detail
is part of what `censored.hash_people_set` hashes, so widening it rewrites the
hash of every company that has one: 5,600 of the 7,840 in the crawl gained a
"nadzor: rada_nadzorcza" or "nadzor: rada_spoleczna" where they used to say
"nadzor". That is not a false change signal - `KRSCensoredPeople.process`
rebuilds every (krs, date) row in one pass, so all of a company's dates move
together and the diff between them is unchanged - but it does mean the output
has to be regenerated wholesale, ``--refresh KRSCensoredPeople``, rather than
compared against rows written before the change.
"""

import typing
from dataclasses import dataclass

from scrapers.krs.organs import organ_kind


class PersonPath(typing.NamedTuple):
    """One place an OdpisAktualny keeps people, and how to read a role there.

    The register spells a role out in one of two places and it is not the same
    place both times. For ``reprezentacja`` the detail is on the person -
    33,129 of them carry a ``funkcjaWOrganie`` of "PREZES ZARZĄDU" or "CZŁONEK
    ZARZĄDU" - and the organ around them has no ``nazwa`` at all. For
    ``organNadzoru`` it is exactly the other way round: not one of the 52,146
    supervisory members carries a ``funkcjaWOrganie``, and what tells them
    apart - a paid rada nadzorcza from an unpaid rada społeczna - is the
    organ's own ``nazwa``. Hence two fields rather than one: `role_field` reads
    off the person, `organ_field` off the organ they sit in.

    A row is a NamedTuple rather than a bare tuple so that every reader names
    the field it wants. Two of them used to unpack from the *end* - ``{role
    for *_, role, _ in PERSON_PATHS}`` - and a table that grew a column would
    have gone on passing while they read `role_field` as the role.
    """

    dzial: str
    key: str
    #: The key inside a container that holds the people, or None where the
    #: container is itself a person.
    inner: str | None
    role: str
    #: Field on the person naming their role in detail.
    role_field: str = ""
    #: Field on the containing organ saying which organ this is. Its value is
    #: normalised by `scrapers.krs.organs.organ_kind` before it reaches a role,
    #: because the register writes it as free text - 117 spellings across the
    #: crawl, typos and all - and a role string gets compared and hashed.
    organ_field: str = ""


#: Where an OdpisAktualny keeps people, as `PersonPath` rows.
#:
#: Three container shapes occur and each entry covers whichever it meets: a
#: bare list of people (``prokurenci``), an organ wrapping them in a ``sklad``
#: (``reprezentacja``, and ``organNadzoru`` which is a *list* of organs), and a
#: single person dict (``reprezentacjaIBIGBPPSPZOZ``). The proceedings in
#: dzial6 nest one further: a list of proceedings, each holding the list of
#: people appointed by it.
PERSON_PATHS = tuple(
    PersonPath(*row)
    for row in (
        ("dzial1", "wspolnicySpzoo", None, "wspolnik", ""),
        ("dzial1", "wspolnicyPartnerzy", None, "wspolnik_partner", ""),
        ("dzial1", "komitetZalozycielski", None, "komitet_zalozycielski", ""),
        ("dzial1", "jedynyAkcjonariusz", None, "jedyny_akcjonariusz", ""),
        ("dzial2", "reprezentacja", "sklad", "reprezentacja", "funkcjaWOrganie"),
        ("dzial2", "organNadzoru", "sklad", "nadzor", "funkcjaWOrganie", "nazwa"),
        ("dzial2", "prokurenci", None, "prokurent", "rodzajProkury"),
        ("dzial2", "pelnomocnicy", None, "pelnomocnik", ""),
        ("dzial2", "osobyReprezentujacePZ", None, "osoba_pz", ""),
        ("dzial2", "reprezentacjaIBIGBPPSPZOZ", None, "kierownik_pzoz", ""),
        ("dzial5", "kurator", None, "kurator", ""),
        ("dzial6", "likwidacja", "likwidatorzy", "likwidator", ""),
        ("dzial6", "postepowanieUpadlosciowe", "daneSyndyka", "syndyk", ""),
        (
            "dzial6",
            "postepowanieUpadlosciowe",
            "daneOsobyReprezentujacejUpadlego",
            "reprezentant_upadlego",
            "",
        ),
        (
            "dzial6",
            "zarzadKomisarycznyPrzymusowyPowierzenieZarzadzania",
            "zarzadcyPrzedstawiciele",
            "zarzadca_komisaryczny",
            "",
        ),
        (
            "dzial6",
            "postepowanieRestrukturyzacyjneNaprawczePrzymusowaRestrukturyzacja",
            "nadzorcaZarzadcaReprezentujacyAdministratorPelnomocnik",
            "nadzorca_restrukturyzacyjny",
            "",
        ),
        (
            "dzial6",
            "postepowanieRestrukturyzacyjneNaprawczePrzymusowaRestrukturyzacja"
            "UporzadkowanaLikwidacja",
            "nadzorcaZarzadcaReprezentujacyAdministratorZastepcaPelnomocnik"
            "ZarzadcaNadzwyczajny",
            "nadzorca_restrukturyzacyjny",
            "",
        ),
    )
)

#: The keys that make an object a person rather than a partner company, which
#: carries a ``nazwa`` and a ``krs`` instead.
PERSON_KEYS = ("nazwisko", "imiona")


@dataclass(frozen=True, order=True)
class CensoredPerson:
    """One person as api-krs masks them, with the role they hold.

    ``surname`` keeps the components apart because the register does:
    "Kałuża Swoboda" arrives as ``nazwiskoICzlon`` plus ``nazwiskoIICzlon``,
    and folding the two into one string would make her indistinguishable from
    a "Kałuża" who holds a different seat.

    ``born`` is the one field here the register does not mask. It is carried
    for the same reason as ``pesel``: for 347 people in the crawl it is the
    only identifier there is, and without it two masked namesakes in the same
    role hash alike and a replacement of one by the other is invisible.
    """

    surname: tuple[str, ...]
    given: str
    second_given: str
    pesel: str
    born: str
    role: str

    def as_row(self) -> list[str]:
        """A JSON-serialisable form, for a pipeline column."""
        return [
            "|".join(self.surname),
            self.given,
            self.second_given,
            self.pesel,
            self.born,
            self.role,
        ]

    @staticmethod
    def from_row(row) -> "CensoredPerson":
        surname, given, second_given, pesel, born, role = row
        return CensoredPerson(
            # "|" rather than a space: a censored component is asterisks, but
            # nothing promises the register never puts a space inside one, and
            # a separator that cannot occur makes the round trip total.
            surname=tuple(s for s in str(surname).split("|") if s),
            given=str(given),
            second_given=str(second_given),
            pesel=str(pesel),
            born=str(born),
            role=str(role),
        )


def is_person(entry) -> bool:
    """Whether an object in an odpis describes a person rather than a company."""
    return isinstance(entry, dict) and any(
        isinstance(entry.get(key), dict) for key in PERSON_KEYS
    )


def parse_person(p: dict, role: str) -> CensoredPerson | None:
    """Parse a single person dict into a CensoredPerson, or None."""
    if not isinstance(p, dict):
        return None

    nazwisko = p.get("nazwisko")
    surname: tuple[str, ...] = ()
    if isinstance(nazwisko, dict):
        surname = tuple(
            str(nazwisko[key])
            for key in ("nazwiskoICzlon", "nazwiskoIICzlon")
            if nazwisko.get(key)
        )

    imiona = p.get("imiona")
    if not isinstance(imiona, dict):
        imiona = {}
    imie = str(imiona.get("imie", "") or "")
    imie2 = str(imiona.get("imieDrugie", "") or "")

    identyfikator = p.get("identyfikator")
    if not isinstance(identyfikator, dict):
        identyfikator = {}
    pesel = str(identyfikator.get("pesel", "") or "")
    born = str(identyfikator.get("dataUrodzenia", "") or "")

    if not (surname or imie or pesel or born):
        return None
    return CensoredPerson(
        surname=surname,
        given=imie,
        second_given=imie2,
        pesel=pesel,
        born=born,
        role=role,
    )


def _entries(node) -> list:
    """A section as a list, whether the register spelled it as one or not."""
    if isinstance(node, list):
        return node
    if isinstance(node, dict):
        return [node]
    return []


def people_at(dane: dict, path: PersonPath) -> list[CensoredPerson]:
    """The people one `PERSON_PATHS` entry points at."""
    dzial = dane.get(path.dzial)
    if not isinstance(dzial, dict):
        return []

    containers = _entries(dzial.get(path.key))
    # Each person is kept paired with the organ they were found in, rather
    # than flattened into one list of people. Flattening is what threw the
    # organ's ``nazwa`` away, and with it every supervisory member's only
    # evidence of whether the seat is a paid one - see `PersonPath`.
    entries: list[tuple[object, dict]]
    if path.inner is None:
        entries = [(entry, {}) for entry in containers]
    else:
        entries = [
            (entry, container)
            for container in containers
            if isinstance(container, dict)
            for entry in _entries(container.get(path.inner))
        ]

    people = []
    for entry, container in entries:
        if not isinstance(entry, dict):
            continue
        detail = str(entry.get(path.role_field, "") or "") if path.role_field else ""
        if path.organ_field:
            # The organ first, because it is the part of the role that decides
            # whether the seat is paid; anything the person adds refines it.
            kind = organ_kind(container.get(path.organ_field))
            detail = f"{kind}, {detail}" if detail else kind
        parsed = parse_person(entry, f"{path.role}: {detail}" if detail else path.role)
        if parsed:
            people.append(parsed)
    return people


def response_data(data) -> dict:
    """The ``dane`` of an odpis, or an empty dict for anything else."""
    if not is_odpis(data):
        return {}
    dane = data["odpis"].get("dane", {})
    return dane if isinstance(dane, dict) else {}


def extract_censored_people(data: dict) -> set[CensoredPerson]:
    """Extract all censored people from an api-krs JSON response.

    Returns an empty set for anything that is not an odpis - api-krs answers a
    query against the wrong register with a 404 body, which parses as JSON and
    would otherwise read as a company with nobody in it.
    """
    dane = response_data(data)
    if not dane:
        return set()
    return {person for path in PERSON_PATHS for person in people_at(dane, path)}


def unread_person_paths(data) -> set[str]:
    """Dotted paths in this response that hold people `PERSON_PATHS` misses.

    The register has sixteen places for a person and gains one occasionally.
    One it gains and we do not read is a change that never registers as a
    change, which is silent in exactly the way the `prokurenci` bug was.
    """
    dane = response_data(data)
    if not dane:
        return set()

    known = {(path.dzial, path.key) for path in PERSON_PATHS}
    known_inner = {
        (path.dzial, path.key, path.inner) for path in PERSON_PATHS if path.inner
    }
    found: set[str] = set()

    def walk(node, path: str, depth: tuple[str, ...]) -> None:
        if isinstance(node, list):
            for entry in node:
                walk(entry, f"{path}[]", depth)
            return
        if not isinstance(node, dict):
            return
        if is_person(node):
            container = depth[:3] if len(depth) >= 3 else depth
            if len(container) >= 3 and container[:3] in known_inner:
                return
            if len(container) >= 2 and container[:2] in known:
                return
            found.add(path)
            return
        for key, value in node.items():
            walk(value, f"{path}.{key}", (*depth, key))

    for dzial_name, body in dane.items():
        walk(body, dzial_name, (dzial_name,))
    return found


def last_entry_number(data) -> int | None:
    """How many times the register has written to this entry, per api-krs.

    ``numerOstatniegoWpisu`` counts entries, so it only ever goes up, and
    rejestr.io publishes its own view of the same number as
    ``krs_wpisy.najnowszy_numer``. Comparing the two says whether rejestr.io
    had caught up when we asked it - exactly, and without matching a single
    name.
    """
    if not is_odpis(data):
        return None
    number = data["odpis"]["naglowekA"].get("numerOstatniegoWpisu")
    try:
        return int(number)
    except (TypeError, ValueError):
        return None


def is_not_found(data) -> bool:
    """Whether the register answered that the company is not in it.

    The counterpart to `is_odpis`, and the reason both exist: a company is
    asked for against both registers because nothing free says which one it
    is in, and the one it is not in answers 404 with a JSON body. That is an
    answer about the company - a permanent one - where a crawl that did not
    come back is an answer about the crawl.

    Both fields are checked because it is read as permanent. All 4,152 of the
    404 bodies in the crawl carry both, and each is exactly 168 bytes.

    A 204 says the same - no current entry under this number - with no body at
    all, and the scrape stores it in the 404's shape with its own status
    (`jobs.krs_common.NO_CURRENT_ENTRY`).
    """
    if not isinstance(data, dict):
        return False
    title = data.get("title")
    if not isinstance(title, str):
        return False
    return data.get("status") in (404, 204) and title.strip().lower() == "not found"


def is_odpis(data) -> bool:
    """Whether a parsed api-krs response actually carries a register entry.

    Checks the header and the body, not just the envelope. A query against the
    wrong register answers 404 with a JSON body, which has no ``odpis`` at all;
    but an ``odpis`` present and empty would pass a shallower check and become
    a snapshot of a company with nobody in it - which is exactly how the 404
    body used to read as the whole board resigning. Every one of the 13,139
    real entries in the crawl carries both of these.
    """
    if not isinstance(data, dict):
        return False
    odpis = data.get("odpis")
    if not isinstance(odpis, dict):
        return False
    header = odpis.get("naglowekA")
    if not isinstance(header, dict) or not header.get("numerKRS"):
        return False
    dane = odpis.get("dane")
    return isinstance(dane, dict) and bool(dane)
