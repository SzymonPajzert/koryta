"""Which party a candidacy puts somebody in."""

import pandas as pd
import pytest

from analysis.payloads.person import (
    _extract_elections,
    in_two_places,
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


def placed(committee: str | None, year: str, teryt: str | None, kind="Samorząd"):
    return Election(
        election_type=kind, committee=committee, election_year=year, teryt=teryt
    )


SLD = "KOMITET WYBORCZY SOJUSZ LEWICY DEMOKRATYCZNEJ"
PIS = "KOMITET WYBORCZY PRAWO I SPRAWIEDLIWOŚĆ"
PSL = "KOMITET WYBORCZY POLSKIE STRONNICTWO LUDOWE"


def test_a_candidacy_in_two_places_at_once_names_no_party():
    """Rafał Mucha of Gryfino, a PiS Sejm candidate, and one from Miechów.

    PKW has the two as one record, which `split_records_by_place` splits, and
    the page gets both parts for a reviewer to take the other man's off. In
    2010 the record stands in powiat miechowski and powiat gryfiński at once,
    and nothing here says which run is his. `parties` goes live with any
    update to a live page, before a reviewer has looked, so the SLD of the
    Miechów run cannot go into it.
    """
    assert parties_from_committees(
        [
            placed(SLD, "2010", "1208"),
            placed("KWW BEZPARTYJNY BLOK SAMORZĄDOWY", "2010", "3206"),
            placed(PIS, "2015", "32", kind="Sejm"),
        ]
    ) == ["PiS"]


def test_both_halves_of_a_clash_name_no_party():
    """Nothing says which of the two is the person's, so neither speaks."""
    assert (
        parties_from_committees(
            [placed(SLD, "2010", "1208"), placed(PSL, "2010", "3206")]
        )
        == []
    )


def test_a_sejmik_and_a_council_in_one_region_are_one_place():
    """The sejmik is filed under the województwo, which the powiat starts with."""
    assert parties_from_committees(
        [placed(PIS, "2010", "32"), placed(PSL, "2010", "3206")]
    ) == ["PSL", "PiS"]


def test_two_places_in_different_elections_are_a_career():
    assert parties_from_committees(
        [
            placed(SLD, "2010", "1208"),
            placed(PSL, "2014", "3206"),
            # Two kinds of election in one year are two contests: 2019 held
            # the European election and the parliamentary one.
            placed(PIS, "2019", "12", kind="Parlament Europejski"),
            placed(PIS, "2019", "26", kind="Senat"),
        ]
    ) == ["PSL", "PiS", "SLD"]


TRZECIA_DROGA = "KKW TRZECIA DROGA PSL-PL2050 SZYMONA HOŁOWNI"


def test_two_offices_of_one_local_election_are_one_election():
    """Kamil Klimek, a Suwałki councillor, and a Warsaw namesake.

    PKW has the two as one record, „KLIMEK Kamil Paweł 1984”: in 2024 it
    stands for Rada miasta in Suwałki and for Rada dzielnicy in Warszawa, on
    the Trzecia Droga list. The payload names the office as the election type,
    and keyed by it the two runs never met, so the Warsaw committee's PSL and
    Polska 2050 went into his page's parties on 2026-10-26. Every office of
    one year's local election is one election.
    """
    row = pd.Series(
        {
            "elections": [
                {
                    "election_type": "samorządu",
                    "office": "Rada dzielnicy",
                    "party": TRZECIA_DROGA,
                    "election_year": 2024,
                    "teryt_candidacy_powiat": "1465",
                },
                {
                    "election_type": "samorządu",
                    "office": "Rada miasta",
                    "party": "KWW „RAZEM DLA SUWAŁK - CZESŁAW RENKIEWICZ”",
                    "election_year": 2024,
                    "teryt_candidacy_powiat": "2063",
                },
                {
                    "election_type": "samorządu",
                    "office": "Rada miasta",
                    "party": "KOMITET WYBORCZY WYBORCÓW ŁĄCZĄ NAS "
                    "SUWAŁKI-CZESŁAW RENKIEWICZ",
                    "election_year": 2018,
                    "teryt_candidacy_powiat": "2063",
                },
            ]
        }
    )

    elections = _extract_elections(row)

    assert [e.election_type for e in elections] == [
        "Rada dzielnicy",
        "Rada miasta",
        "Rada miasta",
    ]
    assert in_two_places(elections) == {0, 1}
    assert parties_from_committees(elections) == []


def test_the_sejm_and_the_senat_of_one_year_are_one_election():
    """Łukasz Mikołajczyk, elected to the Senat for PiS in wielkopolskie in 2015.

    His undated PKW record, „MIKOŁAJCZYK Łukasz ?”, also holds a 2015 Sejm
    run on the PSL list in dolnośląskie, likely a namesake's from there: the
    Sejm and the Senat are filled in one election, and nobody stands for both.
    Keyed by the chamber, the two never met and the payload named PSL for him.
    Neither 2015 run speaks for a party now, and his PiS stands on his others.
    """
    row = pd.Series(
        {
            "elections": [
                {
                    "election_type": "sejmu",
                    "party": "Komitet Wyborczy Polskie Stronnictwo Ludowe",
                    "election_year": 2015,
                    "teryt_candidacy_powiat": "02",
                },
                {
                    "election_type": "senatu",
                    "party": "Komitet Wyborczy Prawo i Sprawiedliwość",
                    "election_year": 2015,
                    "teryt_candidacy_powiat": "30",
                },
                {
                    "election_type": "senatu",
                    "party": PIS,
                    "election_year": 2019,
                    "teryt_candidacy_powiat": "30",
                },
            ]
        }
    )

    elections = _extract_elections(row)

    assert in_two_places(elections) == {0, 1}
    assert parties_from_committees(elections) == ["PiS"]
    assert parties_from_committees(elections[:2]) == []


def test_a_candidacy_with_no_place_is_in_no_second_place():
    """The European lists of 2009, 2014 and 2024 carry no code.

    It clashes with nothing, even in a year two of the person's other
    candidacies clash in, and its party stands.
    """
    assert parties_from_committees(
        [
            placed(PIS, "2014", None, kind="Parlament Europejski"),
            placed(SLD, "2014", "1208"),
            placed(PSL, "2014", "3206"),
        ]
    ) == ["PiS"]


def test_the_payload_reads_places_as_the_split_does():
    """A sejmik candidacy arrives as XX0000, which is the region XX, not a
    powiat beside the person's council: the rule must not see two places
    where `split_records_by_place` saw one."""
    row = pd.Series(
        {
            "elections": [
                {
                    "election_type": "samorządu",
                    "party": PIS,
                    "election_year": 2010,
                    "teryt_candidacy_powiat": "3200",
                },
                {
                    "election_type": "samorządu",
                    "party": PSL,
                    "election_year": 2010,
                    "teryt_candidacy_powiat": "3206",
                },
                {
                    "election_type": "samorządu",
                    "party": SLD,
                    "election_year": 2010,
                    "teryt_candidacy_powiat": "1208",
                },
            ]
        }
    )

    elections = _extract_elections(row)

    assert in_two_places(elections) == {0, 1, 2}
    assert in_two_places(elections[:2]) == set()
    assert parties_from_committees(elections[:2]) == ["PSL", "PiS"]


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
