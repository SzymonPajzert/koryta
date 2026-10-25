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
from util.polish import names_agree


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
def companies(site_nodes) -> dict[str, str]:
    """Every company page's KRS number, by its node id. Read off the nodes
    rather than `SiteSnapshot.companies`, which keeps one page per number."""
    places = site_nodes[site_nodes["type"] == "place"]
    return {
        str(node): krs
        for node, number in zip(places["id"], places["krsNumber"])
        if (krs := text(number)) is not None
    }


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


def namesake_jobs(
    site: SiteSnapshot, companies: dict[str, str], register: Register
) -> list[tuple]:
    """The live jobs on linked pages the register gives to a namesake:
    (edge, page, name, the page's entry, the namesakes', krs, role, start)."""
    pages = live_pages(site)
    jobs = []
    for edges in site.edges.values():
        for edge in edges:
            if edge.get("type") != "employed" or edge.get("deleted") == 1:
                continue
            page = pages.get(str(edge.get("source")))
            entry = register_entry(field(page, "rejestrIo")) if page else None
            krs = companies.get(str(edge.get("target")))
            if page is None or entry is None or krs is None:
                continue
            rows = register.at.get(krs, ())
            if any(register.holds(row, entry) for row in rows):
                # The entry was at the company: in another role or from
                # another day this is a question of dates, not of who.
                continue
            role, start = field(edge, "name"), day_of(field(edge, "start_date"))
            holders = sorted(
                {
                    row.entry
                    for row in rows
                    if row.entry is not None
                    and (row.role, row.start) == (role, start)
                    and names_agree(row.name, page.get("name"))
                    and register.born_apart(row.entry, entry)
                }
            )
            if holders:
                jobs.append(
                    (
                        edge.get("id"),
                        page.get("id"),
                        page.get("name"),
                        entry,
                        holders,
                        krs,
                        role,
                        start,
                    )
                )
    return sorted(jobs, key=lambda job: (str(job[1]), str(job[0])))


def test_a_page_holds_no_namesake_s_job(site, companies, register, within_budget):
    """A job on a linked page is the linked entry's, not a namesake's.

    The register names who held each spell, and a page links one entry. So a
    job on the page that the register gives, with that role from that day, to
    another entry under an agreeing name, born another day, while the page's
    own entry was never at the company, is either a namesake's job that
    reached the page by the name rather than the entry, or a page linking the
    wrong entry: the register cannot tell which, and the page shows a
    stranger's job either way. remove-namesake-jobs removes or moves the ones
    in its plan.

    Counted only where the register can tell: an entry with a row at the
    company in another role or from another day is the page's own spell with
    other dates; a row only an odpis holds is the entry's own when its PESEL
    fingerprint is one the entry's rows carry, and nobody's otherwise; and two
    entries no birth date tells apart may be one osoba bez PESEL entered twice.
    The strict check needs the ingest to record the entry each job came from,
    which no edge stores yet.
    """
    # 275 on 127 pages on the 2026-10-25 export against that night's
    # person_krs_combined, the same jobs as on 10-24: 33 published jobs, and 38
    # jobs on 20 published pages. It was 268 on 10-15: it drifts up by about one
    # a day, so the 10 of room last about two weeks. Expected to fall to about
    # 134 once remove-namesake-jobs has run, which removes or moves the 141 jobs
    # in its plan (111 removals, 30 moves).
    KNOWN_NAMESAKE_JOBS = 275

    jobs = namesake_jobs(site, companies, register)
    pages = {job[1] for job in jobs}

    assert within_budget(len(jobs), KNOWN_NAMESAKE_JOBS), (
        f"{len(jobs)} jobs on {len(pages)} linked pages are a namesake's by the "
        f"register, up from the {KNOWN_NAMESAKE_JOBS} known (edge, page, name, "
        f"page's entry, namesakes' entries, krs, role, start): {jobs[:10]}"
    )
