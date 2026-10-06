"""Which party a candidacy puts somebody in."""

import pytest

from analysis.payloads.person import (
    parties_from_committees,
    party_of_candidacy,
    unmapped_committees,
)
from entities.composite import Election
from scrapers.pkw.elections import parties_of_committee


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
