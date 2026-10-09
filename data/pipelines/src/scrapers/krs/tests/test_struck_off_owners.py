"""A struck-off company keeps the owner it had when it was struck off.

Read off rejestr.io's historical feeds, the only place a struck-off company's
owners are still listed - see `CompaniesKRS.add_owners_at_strike_off`.
"""

from pandas import DataFrame

from entities.company import KRS, Owner
from scrapers.krs.list import (
    BECAME_PUBLIC,
    CompaniesKRS,
    past_ownership,
    struck_off_after,
)

NO_POSTAL_CODES = DataFrame({"city": [], "postal_code": [], "teryt": []})

ORLEN = "0000028860"
PGNIG_SERWIS = "0000373975"
POLSKA_PRESS = "0000002408"


def org(krs, *connections, struck=None):
    """A company as a rejestr.io feed lists it.

    `struck` is the day of its last entry before the strike-off, or None for a
    company still in the register.
    """
    item = {
        "typ": "organizacja",
        "numery": {"krs": krs},
        "nazwy": {"skrocona": f"SPÓŁKA {krs}"},
        "adres": {"miejscowosc": "Warszawa"},
        "stan": {"czy_wykreslona": struck is not None},
        "krs_powiazania_kwerendowane": list(connections),
    }
    if struck is not None:
        item["krs_wpisy"] = {
            "najnowszy_przed_wykresleniem_data": struck,
            "najnowszy_data": "2025-09-01",
        }
    return item


def holding(kierunek, start, end, typ="KRS_SHAREHOLDER"):
    return {"typ": typ, "kierunek": kierunek, "data_start": start, "data_koniec": end}


def feed(queried, kind):
    return (
        "gs://koryta-pl-crawled/hostname=rejestr.io/api/v2/org/"
        f"{queried}/krs-powiazania/aktualnosc_{kind}/date=2026-09-07"
    )


def public_after(feeds: list[tuple[str, list[dict]]], public: set[str]) -> set[str]:
    """Which companies end up public, given these feeds and these seeds."""
    pipeline = CompaniesKRS()
    for blob_name, items in feeds:
        pipeline.process_rejestrio_blob(blob_name, items, NO_POSTAL_CODES)
    pipeline.add_owners_at_strike_off()
    hardcoded = {krs: KRS(krs, {"SPOLKI_SKARBU_PANSTWA"}) for krs in public}
    seeds = pipeline.compute_public_krss(hardcoded)
    pipeline.propagate_is_public(seeds, pipeline.build_parent_to_children())
    return {krs for krs, c in pipeline.companies.items() if c.is_public}


def parent_feed(child: dict, parent: str = ORLEN) -> list[tuple[str, list[dict]]]:
    """`parent`'s historical feed, listing `child` - and `parent` itself, on a
    current feed of somebody else's, so that it is a company the run knows."""
    return [
        (feed(parent, "historyczne"), [child]),
        (feed("0000000001", "aktualne"), [org(parent)]),
    ]


def test_struck_off_after_reads_the_last_entry_before_the_strike_off():
    assert struck_off_after(org(PGNIG_SERWIS, struck="2025-08-27")) == "2025-08-27"


def test_a_company_still_in_the_register_is_not_struck_off():
    assert struck_off_after(org(PGNIG_SERWIS)) is None


def test_the_direction_says_which_side_held_the_shares():
    child = org(PGNIG_SERWIS, holding("PASYWNY", "2022-11-15", "2025-08-27"))
    parent = org(ORLEN, holding("AKTYWNY", "2022-11-15", "2025-08-27"))

    assert list(past_ownership(ORLEN, child)) == [(ORLEN, PGNIG_SERWIS, "2025-08-27")]
    assert list(past_ownership(PGNIG_SERWIS, parent)) == [
        (ORLEN, PGNIG_SERWIS, "2025-08-27")
    ]


def test_a_board_seat_is_not_a_holding():
    child = org(
        PGNIG_SERWIS, holding("PASYWNY", "2022-11-15", "2025-08-27", "KRS_BOARD")
    )

    assert list(past_ownership(ORLEN, child)) == []


def test_a_subsidiary_merged_into_its_parent_inherits_being_public():
    # PGNiG SERWIS: Orlen's until it was merged in, then struck off.
    child = org(
        PGNIG_SERWIS,
        holding("PASYWNY", "2022-11-15", "2025-08-27"),
        struck="2025-08-27",
    )

    assert public_after(parent_feed(child), {ORLEN}) == {ORLEN, PGNIG_SERWIS}


def test_the_childs_own_feed_names_its_owner_just_as_well():
    owner = org(ORLEN, holding("AKTYWNY", "2022-11-15", "2025-08-27"))
    child = org(PGNIG_SERWIS, struck="2025-08-27")
    feeds = [
        (feed(PGNIG_SERWIS, "historyczne"), [owner]),
        (feed("0000000001", "aktualne"), [child]),
    ]

    assert public_after(feeds, {ORLEN}) == {ORLEN, PGNIG_SERWIS}


def test_an_owner_that_sold_before_the_strike_off_passes_nothing_on():
    child = org(
        PGNIG_SERWIS,
        holding("PASYWNY", "2012-06-14", "2015-03-01"),
        struck="2025-08-27",
    )

    assert public_after(parent_feed(child), {ORLEN}) == {ORLEN}


def test_a_company_still_in_the_register_keeps_only_its_current_owners():
    # Sold, not struck off: the historical holding is history.
    child = org(PGNIG_SERWIS, holding("PASYWNY", "2012-06-14", "2015-03-01"))

    assert public_after(parent_feed(child), {ORLEN}) == {ORLEN}


def test_the_owner_is_recorded_on_the_company():
    child = org(
        PGNIG_SERWIS,
        holding("PASYWNY", "2022-11-15", "2025-08-27"),
        struck="2025-08-27",
    )
    pipeline = CompaniesKRS()
    for blob_name, items in parent_feed(child):
        pipeline.process_rejestrio_blob(blob_name, items, NO_POSTAL_CODES)

    assert pipeline.add_owners_at_strike_off() == 1
    assert pipeline.companies[PGNIG_SERWIS].parents == [Owner(krs=ORLEN, teryt=None)]
    # Listed by both feeds, joined once.
    pipeline.past_owners.append((ORLEN, PGNIG_SERWIS, "2025-08-27"))
    assert pipeline.add_owners_at_strike_off() == 0


def test_an_owner_that_was_private_at_the_time_passes_nothing_on():
    # A Polska Press title struck off years before Orlen bought Polska Press.
    title = "0000123456"
    child = org(
        title, holding("PASYWNY", "2008-10-27", "2015-03-12"), struck="2015-03-12"
    )

    assert "2015-03-12" < BECAME_PUBLIC[POLSKA_PRESS]
    assert public_after(parent_feed(child, POLSKA_PRESS), {POLSKA_PRESS}) == {
        POLSKA_PRESS
    }


def test_a_title_struck_off_after_the_purchase_inherits_it():
    title = "0000123456"
    child = org(
        title, holding("PASYWNY", "2008-10-27", "2023-05-02"), struck="2023-05-02"
    )

    assert public_after(parent_feed(child, POLSKA_PRESS), {POLSKA_PRESS}) == {
        POLSKA_PRESS,
        title,
    }


def test_the_output_says_which_companies_are_struck_off():
    child = org(
        PGNIG_SERWIS,
        holding("PASYWNY", "2022-11-15", "2025-08-27"),
        struck="2025-08-27",
    )
    pipeline = CompaniesKRS()
    for blob_name, items in parent_feed(child):
        pipeline.process_rejestrio_blob(blob_name, items, NO_POSTAL_CODES)

    frame = pipeline.frame(list(pipeline.companies.values()))

    assert dict(zip(frame["krs"], frame["struck_off"])) == {
        PGNIG_SERWIS: True,
        ORLEN: False,
    }
