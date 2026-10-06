"""The payloads one page's button asks for: a company's people, or one person.

The datascience group can ask, from a company's page or a person's, for
everything the pipelines know about it to be sent to the site now rather than
whenever a night gets round to it (`jobs.people_import --request`). The people
are the ones `PeoplePayloads` would send anyway, picked by the page instead of
by a tier, and kept to the same guards as the nightly runs:

- a company: everybody with a post at that KRS - its own posts, not its
  subsidiaries', which have pages and buttons of their own. Somebody the site
  lacks gets a page (`missing_from_koryta`, which leaves out namesakes it
  cannot tell apart), somebody it has gets the payload only where it would
  change the page (`matching_one_page`, then `only_changed`'s test);
- a person: the one payload that lands on the page the button was on. Its
  `korytaId` is set to that page, so the ingest updates it rather than looking
  anybody up by name. Two payloads landing there, or the page's register link
  naming somebody whose data the site files on another page, send nothing:
  which of them the page is about is not something a button press says.

Built offline against the export, so a page made since this morning's export
is not in it: a person there is matched by the page's own register link alone.
"""

from __future__ import annotations

import typing
from dataclasses import asdict, dataclass, field, replace

import numpy as np

from analysis.payloads.priority import ON_SITE
from analysis.payloads.site import INFORMATIONAL_REASONS, SiteSnapshot
from analysis.payloads.site import field as stated
from entities.composite import Person

#: The tier of a person a company's run creates a page for. Any other tier
#: landing as "created" is the identity lookup missing somebody.
NEW = "new"

TargetKind = typing.Literal["company", "person"]


@dataclass(frozen=True)
class PageTarget:
    """The page a button was pressed on."""

    kind: TargetKind
    node_id: str
    name: str = ""
    #: A company's KRS number, zero-padded.
    krs: str | None = None
    #: A person's rejestr.io number, from their page's link.
    register: str | None = None


@dataclass
class Targeted:
    """What a page's run sends, and what it leaves and why."""

    #: People the site has no page for: one is created for each.
    new: list[Person] = field(default_factory=list)
    #: Pages the payload would change.
    changed: list[Person] = field(default_factory=list)
    #: Payloads about the target at all.
    matched: int = 0
    #: On the site already, with nothing to add.
    up_to_date: int = 0
    #: Left out: namesakes the payloads cannot tell apart, or - a person -
    #: data the site files on another page.
    left_out: int = 0
    #: Why the run sends nothing, when that is not simply "nothing new".
    reason: str = ""

    def plan(self) -> list[tuple[Person, str]]:
        """What to send, in order, with each one's tier: the pages first, as
        the cheaper mistake, then the people the site lacks."""
        return [(person, ON_SITE) for person in self.changed] + [
            (person, NEW) for person in self.new
        ]


def employment_krs(value: typing.Any) -> list[str]:
    """The KRS numbers of an `employment` cell's posts."""
    if not isinstance(value, (list, tuple, np.ndarray)):
        return []
    found = []
    for post in value:
        if isinstance(post, dict):
            krs = post.get("employed_krs") or post.get("krs")
            if krs is not None:
                found.append(str(krs))
    return found


def works_at(person: Person, krs: str) -> bool:
    """Whether the person has, or had, a post at this company."""
    return any(
        company.krs is not None and str(company.krs) == krs
        for company in person.companies
    )


def writes(snapshot: SiteSnapshot, person: Person) -> bool:
    """Whether sending the payload would write anything (`only_changed`)."""
    return bool(set(snapshot.changes(asdict(person))) - INFORMATIONAL_REASONS)


def register_number(link: typing.Any) -> str | None:
    """`383093` from `https://rejestr.io/osoby/383093/jan-kowalski`."""
    if not isinstance(link, str):
        return None
    marker = "osoby/"
    if marker not in link:
        return None
    number = link.split(marker, 1)[1].split("/", 1)[0]
    return number if number.isdigit() else None


def register_of(person: Person) -> str | None:
    return register_number(person.rejestrIo)


def for_company(payloads: list[Person], snapshot: SiteSnapshot, krs: str) -> Targeted:
    """A company's people, new and changed."""
    # Imported here: person.py imports this module for `PeoplePayloads`.
    from analysis.payloads.person import (  # noqa: PLC0415
        matching_one_page,
        missing_from_koryta,
    )

    people = [person for person in payloads if works_at(person, krs)]
    new = missing_from_koryta(people, snapshot)
    on_site = matching_one_page(people, snapshot)
    changed = [person for person in on_site if writes(snapshot, person)]
    return Targeted(
        new=new,
        changed=changed,
        matched=len(people),
        up_to_date=len(on_site) - len(changed),
        left_out=len(people) - len(new) - len(on_site),
    )


def for_person(
    payloads: list[Person], snapshot: SiteSnapshot, target: PageTarget
) -> Targeted:
    """The one payload about a person's page, if one can be told."""
    from analysis.payloads.person import matching_one_page  # noqa: PLC0415

    on_site = matching_one_page(payloads, snapshot)
    here: list[Person] = []
    elsewhere: list[str] = []
    for person in on_site:
        stored = snapshot.person_for(asdict(person))
        assert stored is not None  # matching_one_page kept only these
        if str(stored.get("id")) == target.node_id:
            here.append(person)
        elif _names_this_page(person, target):
            elsewhere.append(str(stored.get("id")))
    # A page newer than the export: nothing in it resolves there, so the page's
    # own link is the one thing to go on - never the name.
    if target.node_id not in snapshot.people_by_id:
        here += [
            person
            for person in payloads
            if snapshot.person_for(asdict(person)) is None
            and _names_this_page(person, target)
        ]

    # A payload that lands here by its page id but names another register
    # entry than the page's would overwrite the page's link with it - two
    # links are two humans (task stop-korytaid-overwriting-published-link).
    page = snapshot.people_by_id.get(target.node_id)
    page_register = (
        register_number(stated(page, "rejestrIo")) if page else target.register
    )
    conflicting = [
        person
        for person in here
        if page_register
        and register_of(person)
        and register_of(person) != page_register
    ]
    here = [person for person in here if person not in conflicting]

    result = Targeted(matched=len(here) + len(elsewhere) + len(conflicting))
    if conflicting and not here:
        result.left_out = len(conflicting)
        others = ", ".join(sorted({str(register_of(p)) for p in conflicting}))
        result.reason = (
            f"dane wskazują inny wpis rejestr.io ({others}) niż ta strona "
            f"({page_register}) - nic nie wysłano"
        )
        return result
    if len(here) > 1:
        result.left_out = len(here)
        result.reason = (
            f"{len(here)} osoby z danych trafiłyby na tę stronę - nie wiadomo, "
            f"o której z nich jest"
        )
        return result
    if not here:
        result.left_out = len(elsewhere)
        result.reason = (
            f"dane tej osoby są na innej stronie ({', '.join(elsewhere)})"
            if elsewhere
            else "w danych nie ma nikogo, kogo dałoby się przypisać do tej strony"
        )
        return result

    person = replace(here[0], korytaId=target.node_id)
    if target.node_id not in snapshot.people_by_id or writes(snapshot, person):
        result.changed = [person]
    else:
        result.up_to_date = 1
    return result


def _names_this_page(person: Person, target: PageTarget) -> bool:
    """Whether the payload says itself which page it is: the page's id, or the
    page's register link."""
    if person.korytaId and str(person.korytaId) == target.node_id:
        return True
    return target.register is not None and register_of(person) == target.register
