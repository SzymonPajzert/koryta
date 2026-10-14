"""Which register entries `CompaniesPublicByRegister` calls publicly owned."""

import io

import pandas as pd

from scrapers.krs.public_owners import (
    REASON_FOUNDING_ORGAN,
    REASON_JST,
    REASON_PUBLIC_BODY,
    REASON_PUBLIC_PARENT,
    REASON_PUBLIC_REGON,
    REASON_SKARB_PANSTWA,
    classify,
    direct_public_owner,
    ledger_records,
    public_body,
)
from scrapers.krs.register import STATUS_OK, STATUS_STRUCK_OFF
from scrapers.map.jst import SKARB_PANSTWA, JstIndex


def pomorskie() -> JstIndex:
    rows = [
        ("22", None, None, None, "POMORSKIE"),
        ("22", "61", None, None, "Gdańsk"),
        ("22", "61", "01", "1", "Gdańsk"),
    ]
    return JstIndex.from_terc(
        pd.DataFrame(rows, columns=["WOJ", "POW", "GMI", "RODZ", "NAZWA"])
    )


def entry(krs: str, *owners: dict, status=STATUS_OK, **fields) -> dict:
    return {
        "krs": krs,
        "status": status,
        "name": f"SPÓŁKA {krs}",
        "wojewodztwo": "POMORSKIE",
        "owners": list(owners),
        "founding_organ": False,
        **fields,
    }


def owner(
    name: str, krs: str | None = None, shares: str | None = None, regon=None
) -> dict:
    return {"name": name, "krs": krs, "regon": regon, "shares": shares, "whole": False}


def test_a_voivodeship_owns_pomorski_fundusz_pozyczkowy():
    found = direct_public_owner(
        entry(
            "0000225512",
            owner(
                "WOJEWÓDZTWO POMORSKIE",
                shares="23.086 UDZIAŁÓW O ŁĄCZNEJ WARTOŚCI 23.247.602,00 ZŁ.",
            ),
            capital=25673465.0,
        ),
        pomorskie(),
    )

    assert found == (REASON_JST, "WOJEWÓDZTWO POMORSKIE", "22", 0.9055)


def test_a_city_owns_its_company():
    found = direct_public_owner(
        entry("0000000001", owner("GMINA MIASTA GDAŃSKA")), pomorskie()
    )

    assert found is not None
    assert found[:3] == (REASON_JST, "GMINA MIASTA GDAŃSKA", "2261011")


def test_the_treasury_however_it_is_represented():
    found = direct_public_owner(
        entry(
            "0000000001",
            owner("SKARB PAŃSTWA REPREZENTOWANY PRZEZ MINISTRA AKTYWÓW PAŃSTWOWYCH"),
        ),
        pomorskie(),
    )

    assert found is not None
    assert found[0] == REASON_SKARB_PANSTWA
    assert found[2] == SKARB_PANSTWA


def test_a_state_agency_without_a_krs_number():
    # The one public owner among the 137 unplaceable names in the sample.
    found = direct_public_owner(
        entry("0000000001", owner("KRAJOWY OŚRODEK WSPARCIA ROLNICTWA")), pomorskie()
    )

    assert found is not None
    assert found[0] == REASON_PUBLIC_BODY


def test_the_state_housing_land_bank_is_public():
    # The only owner the register names for SIM "KZN-Zachodni" (0000920074).
    found = direct_public_owner(
        entry(
            "0000920074",
            owner("KRAJOWY ZASÓB NIERUCHOMOŚCI Z SIEDZIBĄ W WARSZAWIE"),
        ),
        pomorskie(),
    )

    assert found is not None
    assert found[0] == REASON_PUBLIC_BODY


def test_an_agency_is_not_a_state_agency_by_its_first_word():
    assert not public_body('AGENCJA REKLAMOWA "GRAFITI" SPÓŁKA Z O.O.')
    assert not public_body("DOLCE VITA FUNDACJA RODZINNA")
    assert public_body('"GÓRNOŚLĄSKO - ZAGŁĘBIOWSKA METROPOLIA"')


#: The REGON of Politechnika Łódzka, a state legal person (112).
POLITECHNIKA_LODZKA = "000001583"


def test_an_owner_regon_calls_public_without_a_krs_number():
    # TULVENTURE, the university's spin-off. Neither a government nor a body
    # `public_bodies` names, so before its REGON nothing here saw it.
    university = owner("POLITECHNIKA ŁÓDZKA", regon="00000158300000")
    spin_off = entry("0000333386", university)

    assert direct_public_owner(spin_off, pomorskie()) is None
    assert direct_public_owner(
        spin_off, pomorskie(), frozenset({POLITECHNIKA_LODZKA})
    ) == (REASON_PUBLIC_REGON, "POLITECHNIKA ŁÓDZKA", None, None)


def test_an_owner_with_a_krs_number_is_left_to_the_parent_test():
    with_krs = owner("POLITECHNIKA ŁÓDZKA", krs="0000000001", regon="00000158300000")

    assert (
        direct_public_owner(
            entry("0000333386", with_krs), pomorskie(), frozenset({POLITECHNIKA_LODZKA})
        )
        is None
    )


def test_classify_reads_owners_by_their_regon_and_follows_them_down():
    university = owner("POLITECHNIKA ŁÓDZKA", regon="00000158300000")
    found = classify(
        [
            entry("0000333386", university),
            entry("0000000777", owner("TULVENTURE", krs="0000333386")),
        ],
        pomorskie(),
        known_public=set(),
        public_regons=frozenset({POLITECHNIKA_LODZKA}),
    )

    assert [(row.krs, row.reason) for row in found] == [
        ("0000000777", REASON_PUBLIC_PARENT),
        ("0000333386", REASON_PUBLIC_REGON),
    ]


def test_an_owner_written_without_its_krs_number_is_found_by_its_regon():
    # ZEM ŁABĘDY names Huta Łabędy by REGON only; the ledger has Huta Łabędy
    # under its KRS number, public.
    huta = owner("HUTA ŁABĘDY SPÓŁKA AKCYJNA", regon="27371618400000")
    found = classify(
        [
            entry("0000076693", regon="273716184"),
            entry("0000079400", huta),
        ],
        pomorskie(),
        known_public={"0000076693"},
    )

    assert [(row.krs, row.reason, row.owner_id) for row in found] == [
        ("0000079400", REASON_PUBLIC_PARENT, "0000076693"),
    ]


def test_an_owner_regon_can_come_from_the_crawl_as_well():
    huta = owner("HUTA ŁABĘDY SPÓŁKA AKCYJNA", regon="27371618400000")
    found = classify(
        [entry("0000079400", huta)],
        pomorskie(),
        known_public={"0000076693"},
        owners_by_regon={"273716184": "0000076693"},
    )

    assert [row.krs for row in found] == ["0000079400"]


def test_a_founding_organ_is_public():
    found = direct_public_owner(entry("0000043516", founding_organ=True), pomorskie())

    assert found is not None
    assert found[0] == REASON_FOUNDING_ORGAN


def test_people_and_private_companies_are_not():
    assert (
        direct_public_owner(
            entry("0000000001", owner("ALBA POLSKA SP. Z O.O.", krs="0000192143")),
            pomorskie(),
        )
        is None
    )


def test_a_parent_the_crawl_knows_is_public_passes_it_down():
    found = classify(
        [entry("0000076705", owner("PKP S.A.", krs="0000019193"))],
        pomorskie(),
        known_public={"0000019193"},
    )

    assert [(row.krs, row.reason, row.owner_id) for row in found] == [
        ("0000076705", REASON_PUBLIC_PARENT, "0000019193")
    ]


def test_a_chain_only_the_register_holds_is_followed_to_the_end():
    """A gmina's holding, its subsidiary, and that one's subsidiary.

    None of the three is in the crawl, so nothing outside the ledger can say
    the last two are public - only the chain can, and only if it is followed
    past the first link.
    """
    found = classify(
        [
            entry("0000000003", owner("SPÓŁKA 2", krs="0000000002")),
            entry("0000000002", owner("SPÓŁKA 1", krs="0000000001")),
            entry("0000000001", owner("GMINA MIASTA GDAŃSKA")),
        ],
        pomorskie(),
        known_public=set(),
    )

    assert {row.krs: row.reason for row in found} == {
        "0000000001": REASON_JST,
        "0000000002": REASON_PUBLIC_PARENT,
        "0000000003": REASON_PUBLIC_PARENT,
    }


def test_an_entry_struck_off_is_left_out():
    found = classify(
        [entry("0000225512", owner("WOJEWÓDZTWO POMORSKIE"), status=STATUS_STRUCK_OFF)],
        pomorskie(),
        known_public=set(),
    )

    assert found == []


def test_a_ledger_read_back_from_jsonl_is_classified():
    """What the pipeline reads is a jsonl round trip, where a missing seat is NaN.

    FH ORTHO's Polish branch (KRS 0000016486) has no seat at all, and
    `CompaniesPublicByRegister` stopped on it the first time it read a real
    ledger.
    """
    written = pd.DataFrame(
        [
            entry(
                "0000225512",
                owner(
                    "WOJEWÓDZTWO POMORSKIE",
                    shares="23.086 UDZIAŁÓW O ŁĄCZNEJ WARTOŚCI 23.247.602,00 ZŁ.",
                ),
                capital=25673465.0,
            ),
            entry("0000016486", name=None, wojewodztwo=None, capital=None),
        ]
    )
    buffer = io.StringIO()
    written.to_json(buffer, orient="records", lines=True)
    buffer.seek(0)
    read_back = pd.read_json(buffer, lines=True, dtype={"krs": str})

    found = classify(ledger_records(read_back), pomorskie(), known_public=set())

    assert [(row.krs, row.reason, row.share) for row in found] == [
        ("0000225512", REASON_JST, 0.9055)
    ]
