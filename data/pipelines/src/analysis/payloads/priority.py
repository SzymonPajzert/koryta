"""Who a capped upload sends first.

While the daily people import is rolled out it sends at most a hundred people
a night, so the order decides who reaches the site at all. Three tiers, each
sent whole before the next:

1. `NEW_HIRE` - somebody the site has no page for, holding a post at a public
   company that began in the last `recent_days` and has not ended: the people
   the site exists to show, at the moment they are news. Created unpublished,
   so they arrive in the queue for a reviewer rather than on the site.
2. `PUBLISHED` - a published page the payload would change. What readers see.
3. `ON_SITE` - an unpublished page the payload would change.

Inside a tier the newest news first: a hire by the start of their newest post,
a page by the newest dated fact the upload would add (`dated_changes`). A
change with no date - a party, a birth date - goes after every dated one.

The new-hire tier is `missing_from_koryta` and the other two
`matching_one_page`, with their guards: nobody here is someone a run of either
scope would not have sent.
"""

import typing
from dataclasses import asdict, dataclass
from datetime import date, timedelta

from analysis.payloads.site import INFORMATIONAL_REASONS, SiteSnapshot, day_of
from entities.composite import Person

NEW_HIRE = "new_hire"
PUBLISHED = "published"
ON_SITE = "on_site"
TIERS = (NEW_HIRE, PUBLISHED, ON_SITE)


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
    today: date,
    recent_days: int,
) -> list[Pick]:
    """Every person a capped run may send, in the order it sends them.

    `new` is what `missing_from_koryta` kept and `on_site` what
    `matching_one_page` kept, both from the same payloads and `snapshot`.
    `published_ids` are the node ids of the published person pages.
    """
    since = (today - timedelta(days=recent_days)).isoformat()
    hires = [
        Pick(person, NEW_HIRE, start)
        for person in new
        if (start := newest_public_start(person, public_krs, since)) is not None
    ]

    published: list[Pick] = []
    unpublished: list[Pick] = []
    for person in on_site:
        payload = asdict(person)
        writes, newest = newest_change(snapshot, payload)
        if not writes:
            continue
        stored = snapshot.person_for(payload)
        if stored is not None and str(stored.get("id")) in published_ids:
            published.append(Pick(person, PUBLISHED, newest))
        else:
            unpublished.append(Pick(person, ON_SITE, newest))

    print(
        f"Priority: {len(hires)} new hires (a public post since {since}), "
        f"{len(published)} published and {len(unpublished)} unpublished pages "
        f"to change"
    )
    return newest_first(hires) + newest_first(published) + newest_first(unpublished)
