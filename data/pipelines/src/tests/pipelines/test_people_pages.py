"""Person pages, as the pipelines read them, held against the company register.

The export says what a page links and what it holds, never where any of it
came from: an `employed` edge stores its role, its dates and its two ends and
no register entry, and a page's birth date is whatever was typed or uploaded.
So whether a page agrees with the entry it links can only be asked with the
register beside it, which the night's outputs carry and the export does not.

These run in the night's tests step over what the reprocess has just built:
the site as the planner reads it (`SiteSnapshot`, off `KorytaNodes` and
`KorytaEdges`) and the register as the payloads read it (`PeopleKRSCombined`,
rejestr.io with every newer odpis standing in). `KorytaNodes` keeps a page's
`merged_into` and not its `deleted`, so a page is live here unless it was
merged away; every removed person page of the 2026-10-24 export was merged too.
"""

import collections
import dataclasses
import math
import typing

import pandas as pd
import pytest

from analysis.payloads.site import (
    SiteSnapshot,
    born_another_day,
    day_of,
    field,
    iso_birth_date,
    register_entry,
)
from conductor import setup_context
from koryta import Pipeline
from scrapers.koryta.download import KorytaEdges, KorytaNodes
from scrapers.krs.odpis_people import PeopleKRSCombined


def text(value: typing.Any) -> str | None:
    """A register cell as text, or None for an empty one (None, NaN or "")."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    value = str(value).strip()
    return value or None


@dataclasses.dataclass(frozen=True)
class Spell:
    """One register row: who held which role at a company from which day."""

    entry: str | None
    name: str | None
    role: str | None
    start: str | None
    fingerprint: str | None


@dataclasses.dataclass
class Register:
    """`person_krs_combined`, indexed the ways the checks below read it."""

    #: The birth dates each rejestr.io entry's rows give it.
    born: dict[str, set[str]]
    #: The PESEL fingerprints each entry's rows carry. An odpis names a person
    #: by PESEL and not by entry, so a row only an odpis holds has no entry and
    #: is told to be the entry's own by the fingerprint.
    prints: dict[str, set[str]]
    #: The rows at each company, by its KRS number.
    at: dict[str, list[Spell]]

    @classmethod
    def of(cls, rows: pd.DataFrame) -> "Register":
        born: dict[str, set[str]] = collections.defaultdict(set)
        prints: dict[str, set[str]] = collections.defaultdict(set)
        at: dict[str, list[Spell]] = collections.defaultdict(list)
        columns = [
            "id",
            "full_name",
            "employed_krs",
            "employed_role",
            "employed_start",
            "birth_date",
            "pesel_fingerprint",
        ]
        for entry, name, krs, role, start, birth, fingerprint in rows.reindex(
            columns=columns
        ).itertuples(index=False, name=None):
            entry, fingerprint = text(entry), text(fingerprint)
            if entry is not None and (date := day_of(text(birth))) is not None:
                born[entry].add(date)
            if entry is not None and fingerprint is not None:
                prints[entry].add(fingerprint)
            if (krs := text(krs)) is not None:
                at[krs].append(
                    Spell(
                        entry, text(name), text(role), day_of(text(start)), fingerprint
                    )
                )
        return cls(born, prints, at)

    def holds(self, spell: Spell, entry: str) -> bool:
        """Whether a row is the entry's own: under its number, or with no
        number and one of the PESEL fingerprints the entry's rows carry."""
        if spell.entry is not None:
            return spell.entry == entry
        return spell.fingerprint is not None and spell.fingerprint in self.prints.get(
            entry, ()
        )

    def born_apart(self, one: str, other: str) -> bool:
        """Whether two entries are two people by their birth dates: both
        dated, and no date of one the other's. Two entries of one undated
        person - an osoba bez PESEL entered twice - are not."""
        dates, others = self.born.get(one), self.born.get(other)
        if not dates or not others:
            return False
        return all(born_another_day(a, b) for a in dates for b in others)


@pytest.fixture(scope="module")
def ctx():
    return setup_context()[0]


@pytest.fixture(scope="module")
def site_nodes(ctx) -> pd.DataFrame:
    return KorytaNodes().read_or_process(ctx)


@pytest.fixture(scope="module")
def site(ctx, site_nodes) -> SiteSnapshot:
    """The export as `SiteSnapshot.read` gives it to the planner."""
    return SiteSnapshot(site_nodes, KorytaEdges().read_or_process(ctx))


@pytest.fixture(scope="module")
def register(ctx) -> Register:
    combined: PeopleKRSCombined = Pipeline.create(PeopleKRSCombined)
    return Register.of(combined.read_or_process(ctx))


def live_pages(site: SiteSnapshot) -> dict[str, dict]:
    """The person pages not merged into another page."""
    return {
        page_id: page
        for page_id, page in site.people_by_id.items()
        if field(page, "merged_into") is None
    }


def contradicted_birth_dates(site: SiteSnapshot, register: Register) -> list[tuple]:
    """The linked live pages storing a birth date no row of their entry
    gives: (page, name, entry, the page's date, the register's)."""
    contradicted = []
    for page_id, page in sorted(live_pages(site).items()):
        entry = register_entry(field(page, "rejestrIo"))
        stored = iso_birth_date(field(page, "birthDate"))
        dates = register.born.get(entry) if entry is not None else None
        if stored is None or not dates:
            continue
        if all(born_another_day(stored, date) for date in dates):
            contradicted.append(
                (page_id, page.get("name"), entry, stored, sorted(dates))
            )
    return contradicted


def test_a_page_stores_its_register_entry_s_birth_date(site, register, within_budget):
    """A page linking a register entry is born the day the register says.

    The link is the identity: the ingest finds a page by it, after the page
    id and before the name, and the payloads trust it over the name. A page
    whose own birth date contradicts its entry is a typo or a page linking the
    wrong person. Either way the page tells a visitor what the register says
    is false, and the lookup by name and birth date, which is how the people
    only an odpis names are found (`SiteSnapshot._by_name_and_date`), reads
    the wrong day: it misses the page for its own person and can find it for
    a namesake.

    A reviewer signal more than a pipeline one: the night writes a birth date
    only onto a page with none, and a date typed by hand can raise the count
    any day. An entry the register gives no date, and a page storing none,
    contradict nothing.
    """
    # 9 on the 2026-10-25 export against that night's person_krs_combined, the
    # same 9 as on 10-24 (4 published on both days):
    # Nadbereżny 0X7979cKKZjvbn8eVlA2 (1985-05-12, the register 05-21) and
    # Prządka 7bO5InrOtNrgV3dOTTh1 (1962 for 1969), typed on 10-19 and 10-21;
    # Marszałek ODCjdfkn5xpC7SF13zis and Sobolewska sJpYDxkYqXYaWUTO2p8X, typed
    # with the month off; Brodziak-Cisak 5lKDCByJCTLePHRAYIKH, made by hand; and
    # Miłosz 73sYeefSoL6z6TKDjil1, Grzegorczyk E5qr4a7lr3esvSaBu6Ks, Pawlicki
    # oJjR5rI7QQyXbULpAI6t and Konarski PdPDfZ4uDW0boJuABV2r, from uploads of
    # 09-13 to 10-06. Goes down as reviewers correct the dates or the links,
    # and up with a typo.
    KNOWN_CONTRADICTED = 9

    contradicted = contradicted_birth_dates(site, register)

    assert within_budget(len(contradicted), KNOWN_CONTRADICTED), (
        f"{len(contradicted)} linked pages store a birth date their register "
        f"entry contradicts, up from the {KNOWN_CONTRADICTED} known (page, name, "
        f"entry, page's date, register's): {contradicted[:10]}"
    )
