"""Tying a sole trader to somebody koryta.pl already tracks.

The whole value of the CEIDG half of this pipeline is one question: did anybody
in public life take flood aid through a business of their own? The whole
difficulty is that the only thing the two registers share is a name.

Measured on the real data, on 2026-08-18: of the 2045 flood-aid beneficiaries
the biała lista resolved to a natural person, 21 carry the name of one of the
6113 people on koryta.pl - and **all 21 are in a different powiat from that
person**. Grzegorz Lach's business took 514 k PLN in powiat nyski; the councillor
of that name sits in powiat płocki. Tomasz Duda: powiat nyski against łódzkie.
Andrzej Adamczyk, Krzysztof Nowak, Joanna Nowak, Anna Górska - twenty-one
coincidences and no findings.

So a name is a candidate and never a link. `match` requires the person to be
tied to the powiat the business is registered in, which on today's data
proposes nothing at all. That is the right answer rather than a failure: the
people koryta.pl holds for the flooded powiats are not the ones whose names
collide. When the person corpus grows into 0206, 0207, 0208, 0261, 1607 and 1610
- where this aid went - the same rule will start proposing links, and each one
will already have the corroboration a reviewer would otherwise have to find.

Nothing here creates a person. A sole trader who matches nobody stays out of the
database: they are a private individual who had a flood, which is not what the
site is for.
"""

import re
import typing
import unicodedata

#: The Polish letters that are their own codepoint rather than a base plus a
#: combining mark, so NFKD leaves them alone. Without this "Małgorzata" folds to
#: "MA GORZATA" - two tokens where there is one name, which is how a normaliser
#: quietly starts matching different people to each other.
_STROKES = str.maketrans("ŁłŚśŻżŹźĆćŃńÓóĘęĄą", "LlSsZzZzCcNnOoEeAa")


def normalize_name(name: str) -> str:
    """A name reduced to what two spellings of it have in common.

    Case, diacritics and punctuation only. Word order is kept: "Jan Kowalski"
    and "Kowalski Jan" stay different, because the registers do not disagree
    about the order and treating them as one would fold a name into its own
    reversal.
    """
    folded = (name or "").translate(_STROKES)
    decomposed = unicodedata.normalize("NFKD", folded.upper())
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return " ".join(re.sub(r"[^A-Z]", " ", stripped).split())


def powiat_of(teryt: str) -> str:
    """The powiat part of a TERYT code.

    SUDOP reports a seven-digit gmina code and CEIDG a seven-digit TERC; both
    start with the two digits of the województwo and the two of the powiat,
    which is the level koryta.pl's region nodes are complete at.
    """
    digits = re.sub(r"\D", "", teryt or "")
    return digits[:4] if len(digits) >= 4 else ""


class Person(typing.NamedTuple):
    """A person on koryta.pl, as much of one as the match needs."""

    node_id: str
    name: str
    #: Powiats they are tied to by any edge to a region node - where they stood
    #: for office, or where a company they hold a post in is seated.
    powiats: frozenset[str]


def index(people: typing.Iterable[Person]) -> dict[str, list[Person]]:
    index: dict[str, list[Person]] = {}
    for person in people:
        index.setdefault(normalize_name(person.name), []).append(person)
    return index


def match(
    owner_name: str,
    business_teryt: str,
    people: dict[str, list[Person]],
) -> Person | None:
    """The person this business's owner is, or None - which is the usual answer.

    Both conditions are necessary and neither is sufficient:

    - the normalised names are equal, and
    - the person is tied to the powiat the business is registered in.

    An ambiguous hit - two people of that name, both in the powiat - returns
    None. There is nothing here to tell them apart, and picking one would be
    inventing the answer to the only question that matters.
    """
    powiat = powiat_of(business_teryt)
    if not powiat:
        return None

    candidates = [
        person
        for person in people.get(normalize_name(owner_name), [])
        if powiat in person.powiats
    ]
    return candidates[0] if len(candidates) == 1 else None
