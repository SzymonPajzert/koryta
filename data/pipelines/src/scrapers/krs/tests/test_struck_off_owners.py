"""A struck-off company keeps the owner it had when it was struck off.

Read off rejestr.io's historical feeds, which list the owners that are
companies - see `CompaniesKRS.add_owners_at_strike_off` - and off the odpis
pełny on file, which names the rest - `CompaniesKRS.add_public_owners_on_file`.
"""

import math

import pandas as pd
import pytest
from pandas import DataFrame

from entities.company import KRS, Owner
from scrapers.krs.list import (
    BECAME_PUBLIC,
    CompaniesKRS,
    held_to_the_end,
    past_ownership,
    struck_off_after,
    struck_off_on_file,
)
from scrapers.krs.odpis_history import PeselKeyMissing
from scrapers.map.jst import SKARB_PANSTWA, JstIndex

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


# ─── an owner that is not a company: read off the odpis on file ────────
#
# The historical feeds list companies with a KRS number and nothing else, so a
# company a gmina, the Treasury or a state agency held to its strike-off had no
# owner at all. The odpis pełny names them, as owner seats (`KrsOdpisSeats`).

GDANSKIE_WODOCIAGI = "0000006553"
PZG = "0000020197"
TDM_ARRTRANS = "0000065042"


def pomorskie() -> JstIndex:
    rows = [
        ("22", None, None, None, "POMORSKIE"),
        ("22", "61", None, None, "Gdańsk"),
        ("22", "61", "01", "1", "Gdańsk"),
    ]
    return JstIndex.from_terc(
        pd.DataFrame(rows, columns=["WOJ", "POW", "GMI", "RODZ", "NAZWA"])
    )


def owner_seat(
    krs,
    name,
    removed_by=None,
    removed_on=None,
    stated_on="2026-10-07",
    role="jedyny_akcjonariusz",
    added_by=None,
):
    """An owner as `KrsOdpisSeats` lists one, its missing cells read back as NaN."""
    return {
        "krs": krs,
        "role": role,
        "surname": name,
        "entry_added": added_by if added_by is not None else math.nan,
        "entry_removed": removed_by if removed_by is not None else math.nan,
        "date_removed": removed_on if removed_on is not None else math.nan,
        "stated_on": stated_on,
    }


def run(feeds: list[tuple[str, list[dict]]], *seats: dict) -> CompaniesKRS:
    """A run over these feeds that then read these owner seats."""
    pipeline = CompaniesKRS()
    pipeline.jst_index = pomorskie()
    for blob_name, items in feeds:
        pipeline.process_rejestrio_blob(blob_name, items, NO_POSTAL_CODES)
    pipeline.add_owners_at_strike_off()
    pipeline.add_public_owners_on_file(pd.DataFrame(list(seats)))
    return pipeline


def struck_off(krs: str, last: str) -> list[tuple[str, list[dict]]]:
    """A feed listing `krs` as struck off, its last entry before that on `last`."""
    return [(feed("0000000001", "historyczne"), [org(krs, struck=last)])]


def public_of(pipeline: CompaniesKRS) -> set[str]:
    seeds = pipeline.compute_public_krss({})
    pipeline.propagate_is_public(seeds, pipeline.build_parent_to_children())
    return {krs for krs, c in pipeline.companies.items() if c.is_public}


def test_a_gmina_that_held_it_to_the_strike_off_makes_it_public():
    # GDAŃSKIE WODOCIĄGI: the city's from entry 80 until entry 102 struck the
    # company off on 2025-07-10; its last entry before that was 2025-06-27.
    pipeline = run(
        struck_off(GDANSKIE_WODOCIAGI, "2025-06-27"),
        owner_seat(GDANSKIE_WODOCIAGI, "GMINA MIASTA GDAŃSKA", "102", "2025-07-10"),
    )

    assert public_of(pipeline) == {GDANSKIE_WODOCIAGI}
    assert pipeline.companies[GDANSKIE_WODOCIAGI].parents == [
        Owner(krs=None, teryt="2261011")
    ]


def test_the_treasury_is_recorded_as_the_owner():
    pipeline = run(
        struck_off(PZG, "2017-04-28"),
        owner_seat(PZG, "SKARB PAŃSTWA - MINISTER SKARBU PAŃSTWA", "34", "2018-01-29"),
    )

    assert public_of(pipeline) == {PZG}
    assert pipeline.companies[PZG].parents == [Owner(krs=None, teryt=SKARB_PANSTWA)]


def test_the_minister_of_the_treasury_is_the_treasury():
    # ZAKŁADY SIECI RYBACKICH: the minister its sole shareholder from entry 1
    # until entry 29 struck the company off on 2016-11-30.
    zsr = "0000036687"
    pipeline = run(
        struck_off(zsr, "2015-12-16"),
        owner_seat(zsr, "MINISTER SKARBU PAŃSTWA W WARSZAWIE", "29", "2016-11-30"),
    )

    assert public_of(pipeline) == {zsr}
    assert pipeline.companies[zsr].parents == [Owner(krs=None, teryt=SKARB_PANSTWA)]


def test_a_state_agency_makes_it_public_with_nothing_to_draw_an_edge_to():
    # TDM "ARRTRANS": KOWR's from 2023 to its strike-off in 2025.
    pipeline = run(
        struck_off(TDM_ARRTRANS, "2025-02-10"),
        owner_seat(
            TDM_ARRTRANS, "KRAJOWY OŚRODEK WSPARCIA ROLNICTWA", "65", "2025-04-29"
        ),
    )

    assert public_of(pipeline) == {TDM_ARRTRANS}
    assert pipeline.companies[TDM_ARRTRANS].parents == []


def test_a_state_institute_among_the_last_owners_makes_it_public():
    # BIOTON: the antibiotics institute held it with Prokom and Bank Austria
    # until entry 10 struck it off on 2004-08-02.
    bioton = "0000121065"
    pipeline = run(
        struck_off(bioton, "2004-07-19"),
        owner_seat(bioton, "PROKOM INVESTMENTS SPÓŁKA AKCYJNA", "10", "2004-08-02"),
        owner_seat(
            bioton, "INSTYTUT BIOTECHNOLOGII I ANTYBIOTYKÓW", "10", "2004-08-02"
        ),
        owner_seat(bioton, "BANK AUSTRIA CREDITANSTALT AG", "10", "2004-08-02"),
    )

    assert public_of(pipeline) == {bioton}
    assert pipeline.companies[bioton].parents == []


def test_an_owner_struck_out_before_the_last_entry_had_sold_it():
    pipeline = run(
        struck_off(TDM_ARRTRANS, "2025-02-10"),
        owner_seat(TDM_ARRTRANS, "SKARB PAŃSTWA", "9", "2004-09-17"),
    )

    assert public_of(pipeline) == set()


def test_an_owner_struck_out_on_a_day_the_odpis_does_not_give_did_not_hold_it():
    pipeline = run(
        struck_off(PZG, "2017-04-28"), owner_seat(PZG, "SKARB PAŃSTWA", removed_by="34")
    )

    assert public_of(pipeline) == set()


def test_an_odpis_older_than_the_last_entries_cannot_say_who_held_it_at_the_end():
    listed_before = owner_seat(PZG, "SKARB PAŃSTWA", stated_on="2016-12-01")
    listed_after = owner_seat(PZG, "SKARB PAŃSTWA", stated_on="2017-05-02")

    assert public_of(run(struck_off(PZG, "2017-04-28"), listed_before)) == set()
    assert public_of(run(struck_off(PZG, "2017-04-28"), listed_after)) == {PZG}


def test_an_owner_the_last_entry_replaced_with_another_had_passed_it_on():
    # POLSKIE KOLEJE LINOWE: entry 27, its last before the strike-off, struck
    # out the Treasury and entered PKP S.A., which held it until entry 28.
    pkl = "0000079964"
    pipeline = run(
        struck_off(pkl, "2008-08-19"),
        owner_seat(pkl, "SKARB PAŃSTWA", "27", "2008-08-19"),
        owner_seat(pkl, "PKP S.A.", "28", "2008-12-16", added_by="27"),
    )

    assert public_of(pipeline) == set()
    assert pipeline.companies[pkl].parents == []


def test_an_owner_entered_again_under_another_name_still_holds_it():
    pipeline = run(
        struck_off(PZG, "2017-04-28"),
        owner_seat(PZG, "SKARB PAŃSTWA", "30", "2017-04-28"),
        owner_seat(
            PZG,
            "SKARB PAŃSTWA - MINISTER SKARBU PAŃSTWA",
            "34",
            "2018-01-29",
            added_by="30",
        ),
    )

    assert public_of(pipeline) == {PZG}
    assert pipeline.companies[PZG].parents == [Owner(krs=None, teryt=SKARB_PANSTWA)]


def test_a_private_owner_at_the_end_passes_nothing_on():
    pipeline = run(
        struck_off(PZG, "2017-04-28"),
        owner_seat(PZG, "DRUKARNIA SPÓŁKA AKCYJNA", "34", "2018-01-29"),
        owner_seat(PZG, "KOWALSKI", "34", "2018-01-29", role="wspolnik"),
    )

    assert public_of(pipeline) == set()


def test_a_board_member_is_not_an_owner():
    pipeline = run(
        struck_off(PZG, "2017-04-28"),
        owner_seat(PZG, "SKARB PAŃSTWA", "34", "2018-01-29", role="reprezentacja"),
    )

    assert public_of(pipeline) == set()


def test_a_company_still_in_the_register_is_left_to_its_current_odpis():
    pipeline = run(
        [(feed("0000000001", "aktualne"), [org(GDANSKIE_WODOCIAGI)])],
        owner_seat(GDANSKIE_WODOCIAGI, "GMINA MIASTA GDAŃSKA"),
    )

    assert public_of(pipeline) == set()


def test_its_subsidiaries_struck_off_while_it_held_them_inherit_it():
    # KOMPANIA WĘGLOWA, the Treasury's until it was struck off in 2017, and a
    # subsidiary it held until that one was struck off in 2012.
    kompania, subsidiary = "0000057506", "0000328385"
    child = org(
        subsidiary, holding("PASYWNY", "2008-01-02", "2012-06-01"), struck="2012-06-01"
    )
    pipeline = run(
        [(feed(kompania, "historyczne"), [child])] + struck_off(kompania, "2017-05-23"),
        owner_seat(kompania, "SKARB PAŃSTWA", "60", "2017-06-29"),
    )

    assert public_of(pipeline) == {kompania, subsidiary}


def test_held_to_the_end_compares_against_the_last_entry_before_the_strike_off():
    assert held_to_the_end("102", "2025-07-10", "2026-10-07", "2025-06-27")
    assert held_to_the_end("101", "2025-06-27", "2026-10-07", "2025-06-27")
    assert not held_to_the_end("80", "2023-01-05", "2026-10-07", "2025-06-27")
    assert not held_to_the_end("102", "", "2026-10-07", "2025-06-27")
    assert held_to_the_end("", "", "2025-06-27", "2025-06-27")
    assert not held_to_the_end("", "", "", "2025-06-27")


def test_without_the_pesel_key_the_run_goes_on_with_the_feeds_alone():
    class NoKey:
        def read_or_process(self, ctx):
            raise PeselKeyMissing("No PESEL key.")

    pipeline = CompaniesKRS()
    pipeline.odpis_seats = NoKey()  # type: ignore[assignment]

    assert pipeline.seats_on_file(ctx=None) is None  # type: ignore[arg-type]


def test_the_sources_read_before_the_run_leave_the_odpisy_to_it():
    # `run_pipeline` reads every source before `process`, and there the seats
    # raised before `seats_on_file` could catch it: without the key and with
    # nothing to restore, CompaniesKRS failed rather than keep to the feeds.
    pipeline = CompaniesKRS()
    read = []
    for name, source in pipeline.dependencies.items():
        source.read_or_process = lambda ctx, name=name: read.append(name)

    def no_key(ctx):
        raise PeselKeyMissing("No PESEL key.")

    pipeline.odpis_seats.read_or_process = no_key
    pipeline.odpis_entries.read_or_process = lambda ctx: pytest.fail("every PDF")

    pipeline.preprocess_sources(ctx=None, policy=None)

    assert set(read) == set(pipeline.dependencies) - {"odpis_seats", "odpis_entries"}


# ─── struck off by the odpis, where rejestr.io has not caught up ────────

MRFP = "0000224180"
STRUCK_OFF_KRS = "WYKREŚLENIE Z KRAJOWEGO REJESTRU SĄDOWEGO"


def entries(krs: str, *rows: tuple[str, str, str]) -> list[dict]:
    """`KrsOdpisEntries` rows of one odpis: (number, day, description)."""
    return [
        {"krs": krs, "number": number, "entry_date": day, "description": what}
        for number, day, what in rows
    ]


def test_the_odpis_strikes_off_with_its_last_entry():
    on_file = pd.DataFrame(
        entries(
            MRFP,
            ("9", "2026-06-30", "ZMIANA DANYCH W REJESTRZE"),
            ("92", "2026-07-02", "ZMIANA DANYCH W REJESTRZE"),
            ("93", "2026-09-10", STRUCK_OFF_KRS),
        )
    )

    # Ordered by number, not as text: "9" is not the entry before "93".
    assert struck_off_on_file(on_file) == {MRFP: "2026-07-02"}


def test_an_odpis_that_goes_on_after_a_strike_off_is_a_live_company():
    on_file = pd.DataFrame(
        entries(
            "0000037375",
            ("22", "2005-05-02", "ZMIANA DANYCH W REJESTRZE"),
            ("23", "2005-06-21", STRUCK_OFF_KRS),
            ("24", "2006-01-10", "ZMIANA DANYCH W REJESTRZE"),
        )
    )

    assert struck_off_on_file(on_file) == {}


def test_leaving_the_register_of_companies_for_associations_is_not_a_strike_off():
    on_file = pd.DataFrame(
        entries(
            "0000002843",
            ("9", "2010-01-04", "ZMIANA DANYCH W REJESTRZE"),
            ("10", "2010-04-13", "WYKREŚLENIE Z REJESTRU PRZEDSIĘBIORCÓW"),
        )
    )

    assert struck_off_on_file(on_file) == {}


def test_a_strike_off_that_is_the_only_entry_stands_in_for_the_one_before():
    on_file = pd.DataFrame(entries(MRFP, ("1", "2004-12-17", STRUCK_OFF_KRS)))

    assert struck_off_on_file(on_file) == {MRFP: "2004-12-17"}


def mazowieckie() -> JstIndex:
    rows = [("14", None, None, None, "MAZOWIECKIE")]
    return JstIndex.from_terc(
        pd.DataFrame(rows, columns=["WOJ", "POW", "GMI", "RODZ", "NAZWA"])
    )


def test_a_company_rejestr_io_still_lists_takes_its_owner_at_the_odpis_strike_off():
    # MAZOWIECKI REGIONALNY FUNDUSZ POŻYCZKOWY: struck off on 2026-09-10, and
    # still in the register on rejestr.io's feeds of 09-28.
    pipeline = CompaniesKRS()
    pipeline.jst_index = mazowieckie()
    pipeline.process_rejestrio_blob(
        feed("0000000001", "aktualne"), [org(MRFP)], NO_POSTAL_CODES
    )
    noted = pipeline.note_struck_off_on_file(
        pd.DataFrame(
            entries(
                MRFP,
                ("92", "2026-07-02", "ZMIANA DANYCH W REJESTRZE"),
                ("93", "2026-09-10", STRUCK_OFF_KRS),
            )
            + entries("0000000999", ("5", "2020-01-01", STRUCK_OFF_KRS))
        )
    )
    pipeline.add_public_owners_on_file(
        pd.DataFrame(
            [
                owner_seat(
                    MRFP,
                    "WOJEWÓDZTWO MAZOWIECKIE",
                    "93",
                    "2026-09-10",
                    "2026-10-02",
                    "wspolnik",
                )
            ]
        )
    )

    # A company the run does not know is not added to it.
    assert noted == 1
    assert pipeline.struck_off == {MRFP: "2026-07-02"}
    assert public_of(pipeline) == {MRFP}
    assert pipeline.companies[MRFP].parents == [Owner(krs=None, teryt="14")]


def test_rejestr_io_and_the_odpis_agreeing_note_the_company_once():
    pipeline = CompaniesKRS()
    pipeline.process_rejestrio_blob(
        feed("0000000001", "historyczne"),
        [org(PGNIG_SERWIS, struck="2025-08-27")],
        NO_POSTAL_CODES,
    )

    noted = pipeline.note_struck_off_on_file(
        pd.DataFrame(
            entries(
                PGNIG_SERWIS,
                ("40", "2025-08-27", "ZMIANA DANYCH W REJESTRZE"),
                ("41", "2025-09-03", STRUCK_OFF_KRS),
            )
        )
    )

    assert noted == 0
    assert pipeline.struck_off == {PGNIG_SERWIS: "2025-08-27"}
