"""Who a capped upload sends first.

While the daily people import is rolled out it sends at most a hundred people
a night, so the order decides who reaches the site at all. Six tiers, each
sent whole before the next:

1. `NEW_HIRE` - somebody the site has no page for, holding a post at a public
   company that began in the last `recent_days` and has not ended: the people
   the site exists to show, at the moment they are news. Created unpublished,
   so they arrive in the queue for a reviewer rather than on the site.
2. `BOUGHT` - a page the payload would change, of somebody whose rejestr.io
   feed was bought lately (`bought`). The night pays for the feeds of the
   people somebody marked interesting so that what they hold reaches the
   site; behind the published pages they waited weeks for it - on 2026-10-08
   the nine in the night's plan stood between 154th and 8,196th of 10,301, at
   a hundred a night. A page only: the feeds are bought by name
   (`ScrapeRejestrIO.people_to_scrape`), so one bought for somebody without a
   page is likely a namesake's - 8 of the 17 people bought 2026-10-06 to 10-08
   were - and nobody but a new hire gets a page here.
3. `NOTED_MISSING` - a page the payload would change, on which a reader noted
   that data is missing ("Brakuje danych") and no admin has closed the entry:
   on the page itself, or on the page of a company the payload names. The
   notes ask for an election, a post, a party, a Wikipedia link - what the
   payloads carry - and some of them have waited since May: on 2026-10-09 the
   27 in the night's plan stood between 26th and 8,536th of 10,312, at a
   hundred a night.
4. `NOTED` - the same for any other note entry still open: a correction
   somebody wants made ("Do poprawy"), or an entry an admin marked
   unresolved. A source is not one until an admin says so: it is something to
   read, not a request (`noteNeedsAction` in `frontend/shared/model.ts`).
5. `PUBLISHED` - a published page the payload would change. What readers see.
6. `ON_SITE` - an unpublished page the payload would change.

Inside a tier the newest news first: a hire by the start of their newest post,
a page by the newest dated fact the upload would add (`dated_changes`). A
change with no date - a party, a birth date - goes after every dated one.

A company counts through its people because the night sends no company
payloads: what a company learns arrives as its people's posts.

The new-hire tier is `missing_from_koryta` and the other five
`matching_one_page`, with their guards: nobody here is someone a run of either
scope would not have sent.
"""

import typing
from dataclasses import asdict, dataclass
from datetime import date, timedelta

from analysis.payloads.site import INFORMATIONAL_REASONS, SiteSnapshot, day_of
from entities.composite import Person

NEW_HIRE = "new_hire"
BOUGHT = "bought"
NOTED_MISSING = "noted_missing"
NOTED = "noted"
PUBLISHED = "published"
ON_SITE = "on_site"
TIERS = (NEW_HIRE, BOUGHT, NOTED_MISSING, NOTED, PUBLISHED, ON_SITE)

#: The kind of note entry that says data is missing ("Brakuje danych").
MISSING = "missing"


@dataclass(frozen=True)
class Pick:
    """One person to send, with why and how urgently."""

    person: Person
    tier: str
    #: The day the news dates from - the newest post's start, the newest
    #: dated fact a page would learn - or None when it has no date.
    since: str | None


def newest_public_start(
    person: Person, public_krs: typing.Container[str], since: str
) -> str | None:
    """The start of the person's newest current public post begun on or after
    `since`, or None when they hold no such post."""
    starts = [
        started
        for company in person.companies
        if company.krs is not None
        and str(company.krs) in public_krs
        and day_of(company.end) is None
        and (started := day_of(company.start)) is not None
        and started >= since
    ]
    return max(starts, default=None)


def register_id(person: Person) -> str | None:
    """The rejestr.io id a payload is filed under: the end of its `rejestrIo`
    link, `https://rejestr.io/osoby/<id>`."""
    if not person.rejestrIo:
        return None
    return person.rejestrIo.rstrip("/").rsplit("/", 1)[-1]


def note_tier(
    person: Person,
    stored: typing.Mapping[str, typing.Any] | None,
    snapshot: SiteSnapshot,
    noted: typing.Mapping[str, typing.Collection[str]],
) -> str | None:
    """`NOTED_MISSING`, `NOTED`, or None: what the open notes ask for on the
    person's page and on the pages of the companies the payload names.

    `noted` holds the kinds of the entries still open, by the page they are on.
    """
    pages = [str(stored.get("id"))] if stored is not None else []
    pages += [
        company_id
        for company in person.companies
        if company.krs is not None
        and (company_id := snapshot.companies.get(str(company.krs))) is not None
    ]
    kinds = {kind for page in pages for kind in noted.get(page, ())}
    if MISSING in kinds:
        return NOTED_MISSING
    return NOTED if kinds else None


def newest_change(
    snapshot: SiteSnapshot, payload: typing.Mapping[str, typing.Any]
) -> tuple[bool, str | None]:
    """Whether the payload writes anything, and the newest day what it writes
    dates from. Informational reasons are not writes (`only_changed`)."""
    writes = [
        (reason, day)
        for reason, day in snapshot.dated_changes(payload)
        if reason not in INFORMATIONAL_REASONS
    ]
    days = [day for _, day in writes if day is not None]
    return bool(writes), max(days, default=None)


def newest_first(picks: list[Pick]) -> list[Pick]:
    """By `since`, newest first, the undated last; ties keep their order."""
    return sorted(
        picks, key=lambda p: (p.since is not None, p.since or ""), reverse=True
    )


def prioritised(
    new: list[Person],
    on_site: list[Person],
    snapshot: SiteSnapshot,
    *,
    public_krs: typing.Container[str],
    published_ids: typing.Container[str],
    bought: typing.Container[str],
    noted: typing.Mapping[str, typing.Collection[str]],
    today: date,
    recent_days: int,
) -> list[Pick]:
    """Every person a capped run may send, in the order it sends them.

    `new` is what `missing_from_koryta` kept and `on_site` what
    `matching_one_page` kept, both from the same payloads and `snapshot`.
    `published_ids` are the node ids of the published person pages, `bought`
    the rejestr.io ids of the people whose feed was bought lately, `noted` the
    kinds of the note entries still open, by the page they are on.
    """
    since = (today - timedelta(days=recent_days)).isoformat()
    hires = [
        Pick(person, NEW_HIRE, start)
        for person in new
        if (start := newest_public_start(person, public_krs, since)) is not None
    ]

    paid_for: list[Pick] = []
    missing: list[Pick] = []
    asked: list[Pick] = []
    published: list[Pick] = []
    unpublished: list[Pick] = []
    for person in on_site:
        payload = asdict(person)
        writes, newest = newest_change(snapshot, payload)
        if not writes:
            continue
        stored = snapshot.person_for(payload)
        if register_id(person) in bought:
            paid_for.append(Pick(person, BOUGHT, newest))
        elif (tier := note_tier(person, stored, snapshot, noted)) is not None:
            (missing if tier == NOTED_MISSING else asked).append(
                Pick(person, tier, newest)
            )
        elif stored is not None and str(stored.get("id")) in published_ids:
            published.append(Pick(person, PUBLISHED, newest))
        else:
            unpublished.append(Pick(person, ON_SITE, newest))

    print(
        f"Priority: {len(hires)} new hires (a public post since {since}), "
        f"{len(paid_for)} pages of people bought from rejestr.io, "
        f"{len(missing)} with a note that data is missing, {len(asked)} with "
        f"another open note, {len(published)} published and {len(unpublished)} "
        f"unpublished pages to change"
    )
    return (
        newest_first(hires)
        + newest_first(paid_for)
        + newest_first(missing)
        + newest_first(asked)
        + newest_first(published)
        + newest_first(unpublished)
    )
