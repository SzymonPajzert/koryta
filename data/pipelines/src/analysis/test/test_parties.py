"""Which party a candidacy puts somebody in."""

import pandas as pd
import pytest

from analysis.payloads.person import (
    _extract_elections,
    parties_from_committees,
    party_of_candidacy,
    unmapped_committees,
)
from entities.composite import Election
from scrapers.pkw.elections import OTHER_PARTY, parties_of_committee


def candidacy(committee: str | None) -> Election:
    return Election(election_type="Samorząd", committee=committee)


@pytest.mark.parametrize(
    ("committee", "expected"),
    [
        ("KOMITET WYBORCZY PRAWO I SPRAWIEDLIWOŚĆ", ["PiS"]),
        ("KOALICYJNY KOMITET WYBORCZY KOALICJA OBYWATELSKA", ["PO"]),
        ("KOALICYJNY KOMITET WYBORCZY KOALICJA OBYWATELSKA PO .N IPL ZIELONI", ["PO"]),
        ("KOMITET WYBORCZY POLSKIE STRONNICTWO LUDOWE", ["PSL"]),
        ("KOMITET WYBORCZY NOWA LEWICA", ["Nowa Lewica"]),
        ("KOMITET WYBORCZY SOJUSZ LEWICY DEMOKRATYCZNEJ", ["SLD"]),
        ("KOMITET WYBORCZY KONFEDERACJA WOLNOŚĆ I NIEPODLEGŁOŚĆ", ["Konfederacja"]),
    ],
)
def test_the_national_committees_are_recognised(committee, expected):
    """These five cover about a third of every candidate in 2024."""
    assert parties_of_committee(committee) == expected


def test_a_joint_list_counts_as_both_parties():
    assert parties_of_committee(
        "KOALICYJNY KOMITET WYBORCZY TRZECIA DROGA POLSKA 2050 SZYMONA HOŁOWNI"
        " - POLSKIE STRONNICTWO LUDOWE"
    ) == ["PSL", "Polska 2050"]


@pytest.mark.parametrize(
    ("committee", "expected"),
    [
        ("KOMITET WYBORCZY WYBORCÓW PLATFORMA OBYWATELSKA", ["PO"]),
        ('KOMITET WYBORCZY "PRAWO I SPRAWIEDLIWOŚĆ"', ["PiS"]),
        ("POLSKIE STRONNICTWO LUDOWE", ["PSL"]),
        ("SOJUSZ LEWICY DEMOKRATYCZNEJ", ["SLD"]),
        ("KOALICYJNY KOMITET WYBORCZY LEWICA I DEMOKRACI SLD+SDPL+PD+UP", ["SLD"]),
        (
            "KOALICYJNY KOMITET WYBORCZY ZJEDNOCZONA LEWICA SLD+TR+PPS+UP+ZIELONI",
            ["SLD"],
        ),
        ("KOMITET WYBORCZY PARTIA RAZEM", ["Razem"]),
        ("KOMITET WYBORCZY NOWOCZESNA RYSZARDA PETRU", ["Nowoczesna"]),
        ("KOMITET WYBORCZY BEZPARTYJNI SAMORZĄDOWCY", ["Bezpartyjni Samorządowcy"]),
    ],
)
def test_the_older_lists_of_the_same_parties_are_recognised(committee, expected):
    """The 2001, 2007 and 2015 Sejm lists, and the ones before 1998 that were
    named after the party alone."""
    assert parties_of_committee(committee) == expected


@pytest.mark.parametrize(
    ("committee", "expected"),
    [
        (
            "KOALICYJNY KW PLATFORMA OBYWATELSKA - PRAWO I SPRAWIEDLIWOŚĆ",
            ["PO", "PiS"],
        ),
        (
            "KWW KONFEDERACJA I BEZPARTYJNI SAMORZĄDOWCY",
            ["Konfederacja", "Bezpartyjni Samorządowcy"],
        ),
    ],
)
def test_other_joint_lists_count_as_both_parties(committee, expected):
    assert parties_of_committee(committee) == expected


def test_a_separate_party_with_a_similar_name_gets_no_party():
    """PSL-Porozumienie Ludowe was its own party, which ran against PSL in 1993."""
    assert (
        parties_of_committee("POLSKIE STRONNICTWO LUDOWE - POROZUMIENIE LUDOWE") == []
    )


@pytest.mark.parametrize(
    "committee",
    [
        # AWS's 1998 samorząd and 1997 Sejm lists, and the Senat 1997 spelling.
        "KOMITET WYBORCZY AKCJA WYBORCZA SOLIDARNOŚĆ",
        "KOMITET WYBORCZY AKCJA WYBORCZA SOLIDARNOSC",
        'KOMITET WYBORCZY "AKCJA WYBORCZA SOLIDARNOŚĆ" (AWS)',
        "KOALICYJNY KOMITET WYBORCZY - AKCJA WYBORCZA SOLIDARNOŚĆ PRAWICY",
        "KW SAMOOBRONA RZECZYPOSPOLITEJ POLSKIEJ",
        "KOMITET WYBORCZY SAMOOBRONA RZECZPOSPOLITEJ POLSKIEJ",
        "SAMOOBRONA - LEPPERA",
        "KOMITET WYBORCZY NASZ DOM POLSKA - SAMOOBRONA ANDRZEJA LEPPERA",
        "ZARZĄD UNII WOLNOŚCI",
        "KOMITET WYBORCZY UNII WOLNOŚCI",
        "KW LIGA POLSKICH RODZIN",
        "KOMITET WYBORCZY LIGA POLSKICH RODZIN",
        "KOMITET WYBORCZY WYBORCÓW „KUKIZ'15”",
        "KOMITET WYBORCZY WYBORCÓW KUKIZ'15",
        "KOMITET WYBORCZY RUCH PATRIOTYCZNY OJCZYZNA",
        # ROP's 1997 Sejm and Senat lists, and the 2005 federation it joined.
        "ZARZĄD GŁÓWNY RUCHU ODBUDOWY POLSKI",
        "Zarzad Glowny Ruchu Odbudowy Polski",
        "RUCH ODBUDOWY POLSKI",
        "KOMITET WYBORCZY RUCH PATRIOTYCZNY",
        "KONFEDERACJA POLSKI NIEPODLEGŁEJ",
        "KW KONSERWATYWNO-LIBERALNA PARTIA UNIA POLITYKI REALNEJ",
        "KOMITET WYBORCZY POLSKA PARTIA PRACY - SIERPIEŃ 80",
        "KOMITET WYBORCZY RUCH PALIKOTA",
        "KOMITET WYBORCZY TWÓJ RUCH",
        "KW KRAJOWEJ PARTII EMERYTÓW I RENCISTÓW",
        "KOMITET WYBORCZY SOLIDARNA POLSKA ZBIGNIEWA ZIOBRO",
        "KOMITET WYBORCZY POROZUMIENIE JAROSŁAWA GOWINA",
    ],
)
def test_a_party_the_site_does_not_name_is_inne(committee):
    """Real national parties, which the site files under „Inne” rather than
    leaving the people who stood for them with no party at all."""
    assert parties_of_committee(committee) == [OTHER_PARTY]


def test_pjn_is_not_pis():
    """Polska Jest Najważniejsza split from PiS in 2010 and stood against it in
    2011, so lineage is the wrong reading of it."""
    assert parties_of_committee("KOMITET WYBORCZY POLSKA JEST NAJWAŻNIEJSZA") == [
        OTHER_PARTY
    ]


@pytest.mark.parametrize(
    "committee",
    [
        'KOMITET WYBORCZY "UNIA WOLNOŚCI I UNIA POLITYKI REALNEJ"',
        "KOMITET WYBORCZY RS AWS-UW",
        "KOALICYJNY KOMITET WYBORCZY PRAWICA RZECZYPOSPOLITEJ - UPR",
    ],
)
def test_a_joint_list_of_parties_the_site_does_not_name_is_inne(committee):
    assert parties_of_committee(committee) == [OTHER_PARTY]


def test_a_joint_list_with_a_named_party_keeps_that_party():
    """KPEiR stood on Przymierze Społeczne, but the list is PSL's, and saying
    „Inne” beside PSL would add a tie nobody can name."""
    assert parties_of_committee(
        "KRAJOWY KOMITET WYBORCZY PRZYMIERZE SPOŁECZNE: PSL-UP-KPEIR"
    ) == ["PSL"]


def test_an_inne_candidacy_carries_inne_on_its_edge_and_is_vouched_for():
    """The edge says „Inne”, and the ingest may write it without review.

    A hit in the curated table is what `party_from_committee` means, and these
    committees were classified by hand, the same as PiS's.
    """
    row = pd.Series(
        {
            "elections": [
                {
                    "election_type": "samorządu",
                    "party": "KOMITET WYBORCZY AKCJA WYBORCZA SOLIDARNOŚĆ",
                    "election_year": 1998,
                    "teryt_candidacy": "146501",
                }
            ]
        }
    )

    [election] = _extract_elections(row)

    assert election.party == OTHER_PARTY
    assert election.party_from_committee is True


def test_a_person_who_also_stood_for_a_named_party_keeps_it():
    """„Inne” goes beside PiS rather than instead of it - and after it."""
    assert parties_from_committees(
        [
            candidacy("KOMITET WYBORCZY AKCJA WYBORCZA SOLIDARNOŚĆ"),
            candidacy("KOMITET WYBORCZY PRAWO I SPRAWIEDLIWOŚĆ"),
        ]
    ) == ["PiS", OTHER_PARTY]


def test_inne_comes_after_every_named_party():
    """The site draws a person's chips in this order, and by name alone „Inne”
    would lead ahead of Konfederacja, PO, PSL, PiS and SLD. The named parties
    keep the order by name they always had."""
    assert parties_from_committees(
        [
            candidacy("KW LIGA POLSKICH RODZIN"),
            candidacy("KOMITET WYBORCZY SOJUSZ LEWICY DEMOKRATYCZNEJ"),
            candidacy("KOMITET WYBORCZY KONFEDERACJA WOLNOŚĆ I NIEPODLEGŁOŚĆ"),
            candidacy("KOMITET WYBORCZY BEZPARTYJNI SAMORZĄDOWCY"),
            candidacy("KOMITET WYBORCZY PLATFORMA OBYWATELSKA RP"),
        ]
    ) == ["Bezpartyjni Samorządowcy", "Konfederacja", "PO", "SLD", OTHER_PARTY]


@pytest.mark.parametrize(
    "committee",
    [
        "komitet wyborczy prawo i sprawiedliwość",
        "Komitet Wyborczy Prawo i Sprawiedliwość",
        "KOMITET  WYBORCZY   PRAWO I SPRAWIEDLIWOŚĆ",
        "  KOMITET WYBORCZY PRAWO I SPRAWIEDLIWOŚĆ  ",
    ],
)
def test_case_and_spacing_do_not_matter(committee):
    """PKW writes it differently in every file, and both columns feed `party`."""
    assert parties_of_committee(committee) == ["PiS"]


@pytest.mark.parametrize(
    "committee",
    [
        # Local committees that borrow a national brand. Matching on a fragment
        # would hand these people a party they never stood for.
        "KOMITET WYBORCZY WYBORCÓW POROZUMIENIE SŁUŻY LUDZIOM - TRZECIA DROGA",
        "KOMITET WYBORCZY WYBORCÓW KONFEDERACI BEZPARTYJNI POLSKA JEST JEDNA"
        " DLA POMORZA",
        "KOMITET WYBORCZY WYBORCÓW RAZEM DLA GMINY OPATÓWEK",
        "KOMITET WYBORCZY WYBORCÓW WSPÓLNY KALISZ",
        # Gmina and powiat lists only, never a sejmik one, in 2024.
        "KWW PSL TRZECIA DROGA",
        "KWW KO TRZECIA DROGA LUBUSKIE",
        # A party's town branch on a list with a group of the town's own.
        'KOMITET WYBORCZY "ZIEMIA KAMIEŃSKA AWS-UPR-UW-RPN"',
        "KOMITET WYBORCZY UNII WOLNOŚCI I UPR KIELCE NASZE MIASTO",
        "KOMITET WYBORCZY WYBORCÓW PRAWE MIASTO I KUKIZ'15",
        "KOMITET WYBORCZY NIEZALEŻNY RUCH PATRIOTYCZNY OJCZYZNA",
        # Not Lepper's party at all.
        'SAMOOBRONA EKOLOGICZNA ROLNIKÓW "PRONATURA"',
    ],
)
def test_a_local_committee_borrowing_a_name_gets_no_party(committee):
    assert parties_of_committee(committee) == []


def test_a_candidacy_with_no_committee_gets_no_party():
    assert parties_of_committee(None) == []
    assert parties_of_committee("") == []


def test_a_person_is_every_party_they_stood_for():
    assert parties_from_committees(
        [
            candidacy("KOMITET WYBORCZY PRAWO I SPRAWIEDLIWOŚĆ"),
            candidacy("KOMITET WYBORCZY WYBORCÓW WSPÓLNY KALISZ"),
            candidacy("KOALICYJNY KOMITET WYBORCZY KOALICJA OBYWATELSKA"),
        ]
    ) == ["PO", "PiS"]


def test_an_unambiguous_committee_names_the_candidacys_party():
    assert party_of_candidacy("KOMITET WYBORCZY PRAWO I SPRAWIEDLIWOŚĆ") == "PiS"


def test_a_joint_list_names_no_single_party_on_the_edge():
    """The person is both parties; the candidacy is neither on its own.

    `parties_from_committees` still gives them both on the node - it is only
    the edge's one `party` field that has nowhere to put a coalition.
    """
    committee = (
        "KOALICYJNY KOMITET WYBORCZY TRZECIA DROGA POLSKA 2050 SZYMONA HOŁOWNI"
        " - POLSKIE STRONNICTWO LUDOWE"
    )
    assert party_of_candidacy(committee) is None
    assert parties_from_committees([candidacy(committee)]) == ["PSL", "Polska 2050"]


def test_an_unrecognised_committee_names_no_party():
    assert party_of_candidacy("KOMITET WYBORCZY WYBORCÓW WSPÓLNY KALISZ") is None
    assert party_of_candidacy(None) is None


def test_the_unrecognised_committees_are_the_ones_worth_reporting():
    assert unmapped_committees(
        [
            candidacy("KOMITET WYBORCZY PRAWO I SPRAWIEDLIWOŚĆ"),
            candidacy("KOMITET WYBORCZY WYBORCÓW WSPÓLNY KALISZ"),
            candidacy(None),
        ]
    ) == ["KOMITET WYBORCZY WYBORCÓW WSPÓLNY KALISZ"]
