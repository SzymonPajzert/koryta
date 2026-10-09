"""Owners found by hand, and `CompaniesKRS.add_researched_owners`."""

import re

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


def test_a_researched_company_is_public_and_joined_to_its_owner():
    p = pipeline(POSTDATA, POCZTA)

    p.add_researched_owners()

    assert p.companies[POSTDATA].is_public
    assert Owner(krs=POCZTA, teryt=None) in p.companies[POSTDATA].parents
    assert POSTDATA in p.companies[POCZTA].children


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
