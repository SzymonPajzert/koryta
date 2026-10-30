"""Owners found by hand, and `CompaniesKRS.add_researched_owners`."""

import csv
import re
from pathlib import Path

import pandas as pd

from entities.company import Company as KrsCompany
from entities.company import Owner
from scrapers.krs.list import CompaniesKRS
from scrapers.krs.researched_owners import RESEARCHED_OWNERS
from scrapers.map.jst import JstIndex

POSTDATA = "0000117218"
POCZTA = "0000334972"
PODBESKIDZIE = "0000390966"
CZH = "0000075706"
EUROTERMINAL = "0000353127"
OSTROLEKA = "0000061837"
ENERGA_WYTWARZANIE = "0000512140"


def bielsko_biala() -> JstIndex:
    rows = [
        ("24", None, None, None, "ŚLĄSKIE"),
        ("24", "61", None, None, "Bielsko-Biała"),
        ("24", "61", "01", "1", "Bielsko-Biała"),
    ]
    return JstIndex.from_terc(
        pd.DataFrame(rows, columns=["WOJ", "POW", "GMI", "RODZ", "NAZWA"])
    )


def pipeline(*krss: str, jst: JstIndex | None = None) -> CompaniesKRS:
    p = CompaniesKRS()
    p.jst_index = jst
    for krs in krss:
        p.add_company(KrsCompany(krs=krs, teryt_code="2461"))
    return p


def test_every_entry_names_its_source_and_an_owner():
    for krs, researched in RESEARCHED_OWNERS.items():
        assert re.fullmatch(r"\d{10}", krs), krs
        assert researched.source.startswith("https://"), krs
        assert researched.owners, krs
        for owner in researched.owners:
            assert owner.krs is None or re.fullmatch(r"\d{10}", owner.krs), krs


def test_a_researched_company_keeps_no_known_gap():
    """No company found by hand keeps a known gap in the expected public companies.

    `add_researched_owners` marks every company here public whatever its
    owners resolve to, so its row in expected_public_companies.csv passes the
    night it lands. A `known_gap` on that row makes it an expected failure,
    and a strict one: the row passes, and the night's tests step goes red and
    holds the upload. That is what PCO and PIT-RADWAR did on 2026-10-24, still
    waiting on mark-pgz-subsidiaries-public after they were added here. Every
    row of such a company is held to it, enforced by the night or not: a row
    the night skips today (a proposal, a correction not applied yet) is
    enforced once the reason goes. Read here, at review time, rather than by
    the night over the pipeline's output.
    """
    expected = (
        Path(__file__).parents[3] / "tests/pipelines/expected_public_companies.csv"
    )
    with expected.open(newline="", encoding="utf-8") as file:
        gaps = {
            row["krs"]: row["known_gap"]
            for row in csv.DictReader(file)
            if row["krs"] in RESEARCHED_OWNERS and row["known_gap"].strip()
        }

    assert not gaps, (
        f"{len(gaps)} companies with researched owners carry a known_gap in "
        f"{expected.name}, but the pipeline marks each of them public, so the "
        f"row passes and fails the night as a strict expected failure. Take the "
        f"gap off (krs, task): {sorted(gaps.items())}"
    )


def test_a_researched_company_is_public_and_joined_to_its_owner():
    p = pipeline(POSTDATA, POCZTA)

    p.add_researched_owners()

    assert p.companies[POSTDATA].is_public
    assert Owner(krs=POCZTA, teryt=None) in p.companies[POSTDATA].parents
    assert POSTDATA in p.companies[POCZTA].children


def test_a_company_public_already_still_gains_its_owner():
    # Energa Elektrownie Ostrołęka is public by REGON's code and the hardcoded
    # list, so marking it changes nothing: the edge to Energa Wytwarzanie is
    # what its entry is for, and the page had no owner without it.
    p = pipeline(OSTROLEKA, ENERGA_WYTWARZANIE)
    p.companies[OSTROLEKA].is_public = True

    p.add_researched_owners()

    assert p.companies[OSTROLEKA].parents == [Owner(krs=ENERGA_WYTWARZANIE, teryt=None)]
    assert OSTROLEKA in p.companies[ENERGA_WYTWARZANIE].children


def test_an_owner_the_crawl_does_not_describe_is_left_out():
    p = pipeline(POSTDATA)

    p.add_researched_owners()

    assert p.companies[POSTDATA].is_public
    assert p.companies[POSTDATA].parents == []
    assert p.awaiting_relations == {}


def test_a_government_owner_is_resolved_by_name():
    p = pipeline(PODBESKIDZIE, jst=bielsko_biala())

    p.add_researched_owners()

    assert p.companies[PODBESKIDZIE].parents == [Owner(krs=None, teryt="2461011")]


def test_running_it_twice_joins_nothing_twice():
    p = pipeline(POSTDATA, POCZTA, PODBESKIDZIE, jst=bielsko_biala())

    p.add_researched_owners()
    p.add_researched_owners()

    assert p.companies[POSTDATA].parents.count(Owner(krs=POCZTA, teryt=None)) == 1
    assert len(p.companies[PODBESKIDZIE].parents) == 1


def test_the_flag_carries_down_to_what_the_company_owns():
    # Grupa CZH's terminal at Sławków names CZH as its owner in the register.
    p = pipeline(CZH, EUROTERMINAL)
    p.add_relation(CZH, EUROTERMINAL)

    p.add_researched_owners()
    public = p.compute_public_krss({})
    p.propagate_is_public(public, p.build_parent_to_children())

    assert p.companies[EUROTERMINAL].is_public
