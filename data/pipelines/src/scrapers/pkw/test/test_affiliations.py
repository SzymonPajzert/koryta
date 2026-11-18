"""Which parties PKW's membership and backing statements name.

Every statement below is one PKW wrote, in the year noted.
"""

import pytest

from scrapers.pkw.affiliations import (
    membership_and_backing,
    parties_of_statement,
    unclassified_names,
)
from scrapers.pkw.elections import OTHER_PARTY
from scrapers.pkw.process import extract_data
from util.polish import PkwFormat


@pytest.mark.parametrize(
    ("statement", "parties"),
    [
        # 2024, backing
        ("popierana przez partię polityczną: Prawo i Sprawiedliwość", ["PiS"]),
        (
            "popierany przez partię polityczną: Polska 2050 Szymona Hołowni",
            ["Polska 2050"],
        ),
        ("popierany przez organizację: Stowarzyszenie Polska 2050", ["Polska 2050"]),
        # 2023, a Trzecia Droga candidate
        ("popierana przez partię polityczną: PL2050 Szymona Hołowni", ["Polska 2050"]),
        # 2014, in the accusative
        ("pop. przez: Platformę Obywatelską RP", ["PO"]),
        ("pop. przez: SLD", ["SLD"]),
        # 2010
        ("popierany przez Polskie Stronnictwo Ludowe", ["PSL"]),
        # 2006, bare names and the abbreviation
        ("PORP", ["PO"]),
        ("Samoobrona Rzeczpospolitej Polskiej", [OTHER_PARTY]),
        # 2007, quoted
        ('popierany przez "Prawo i Sprawiedliwość"', ["PiS"]),
        # 1998: SdRP backing an SLD list is the SLD of the list
        ("SdRP", ["SLD"]),
        # Membership, in the genitive
        ("członek Prawa i Sprawiedliwości", ["PiS"]),
        ("członek Polskiego Stronnictwa Ludowego", ["PSL"]),
        ("członek partii Platforma Obywatelska RP", ["PO"]),
        ("członek partii politycznej: Nowa Lewica", ["Nowa Lewica"]),
        ("członek partii politycznej: Lewica Razem", ["Razem"]),
        # „Partii” is part of this name, not the kind of body.
        ("członek Partii Kobiet", [OTHER_PARTY]),
        # A non-member backed by a party, in one cell (2015 Sejm).
        (
            "nie należy do partii politycznej, pop. Nowoczesna Ryszarda Petru",
            ["Nowoczesna"],
        ),
        # A committee written into the column reads as the committee does.
        ("KW Platforma Obywatelska RP", ["PO"]),
        # Two backers
        ("Samoobrona RP, PSL", ["PSL", OTHER_PARTY]),
        # 2024, written without spaces
        (
            "popierany przez partię polityczną: "
            "PlatformaObywatelskaRzeczypospolitejPolskiej",
            ["PO"],
        ),
        # 2001, misspelt
        ("popierany przez Prawo i Sprawiedliowść", ["PiS"]),
        ("popierana przez Polskie Stronictwo Ludowe", ["PSL"]),
    ],
)
def test_a_statement_names_its_party(statement, parties):
    assert parties_of_statement(statement) == parties


@pytest.mark.parametrize(
    "statement",
    [
        "nie należy do partii politycznej",
        "nie należy",
        "Nie zgłoszono przynależności do partii",
        "pop. przez: brak oznaczenia",
        # The 1997 Sejm file's party code.
        "1",
        # Associations and unions stand for no party.
        "popierany przez organizację: Stowarzyszenie Miasto Jest Nasze",
        "Związek Nauczycielstwa Polskiego",
        # Local lists borrowing a party's word are not the party.
        "KWW Idziemy Razem",
        "Porozumienie Ponad Podziałami RAZEM",
        None,
        "",
    ],
)
def test_a_statement_naming_no_party_gives_none(statement):
    assert parties_of_statement(statement) == []


@pytest.mark.parametrize(
    ("cell", "membership", "backing"),
    [
        # 2015 Sejm: a membership and a backing in one cell.
        (
            "nie należy do partii politycznej, pop. Nowoczesna Ryszarda Petru",
            "nie należy do partii politycznej",
            "pop. Nowoczesna Ryszarda Petru",
        ),
        # 2011 Sejm, with no space after the comma.
        (
            "nie należy do partii politycznej,popierany przez PSL",
            "nie należy do partii politycznej",
            "popierany przez PSL",
        ),
        ("nie należy popierany przez PSL", "nie należy", "popierany przez PSL"),
        (
            "nie należy do partii polit.popierany przez Polską Wspólnotę Narod.",
            "nie należy do partii polit.",
            "popierany przez Polską Wspólnotę Narod.",
        ),
        # 2001 Sejm: a backing alone, also in quotes and capitalised.
        (
            "popierany przez Prawo i Sprawiedliwość",
            None,
            "popierany przez Prawo i Sprawiedliwość",
        ),
        (
            '"popierany przez Prawo i Sprawiedliwość"',
            None,
            "popierany przez Prawo i Sprawiedliwość",
        ),
        ("Popierany przez PSL", None, "Popierany przez PSL"),
        # A membership is left as it is.
        (
            "członek partii politycznej: Nowa Lewica",
            "członek partii politycznej: Nowa Lewica",
            None,
        ),
        (
            "członek Polskiego Stronnictwa Ludowego",
            "członek Polskiego Stronnictwa Ludowego",
            None,
        ),
        ("nie należy do partii politycznej", "nie należy do partii politycznej", None),
        (None, None, None),
    ],
)
def test_a_membership_cell_gives_up_the_backing_written_into_it(
    cell, membership, backing
):
    assert membership_and_backing(cell) == (membership, backing)


def test_a_backing_in_the_membership_column_names_no_membership():
    membership, backing = membership_and_backing(
        "nie należy do partii politycznej, popierany przez SLD"
    )
    assert parties_of_statement(membership) == []
    assert parties_of_statement(backing) == ["SLD"]
    assert unclassified_names(membership) == []


def test_a_backing_written_as_a_membership_is_stored_as_a_backing():
    person = extract_data(
        "2015",
        "sejmu",
        PkwFormat.UNKNOWN,
        first_name="Jan",
        last_name="Kowalski",
        party_member="nie należy do partii politycznej, pop. Nowoczesna Ryszarda Petru",
    )

    assert (person.party_member, person.supported_by) == (
        "nie należy do partii politycznej",
        "pop. Nowoczesna Ryszarda Petru",
    )


def test_a_backing_column_is_never_overwritten_by_the_membership_one():
    person = extract_data(
        "2024",
        "samorządu",
        PkwFormat.UNKNOWN,
        first_name="Jan",
        last_name="Kowalski",
        party_member="nie należy do partii politycznej, pop. SLD",
        supported_by="popierany przez partię polityczną: Nowa Lewica",
    )

    assert person.party_member == "nie należy do partii politycznej, pop. SLD"
    assert person.supported_by == "popierany przez partię polityczną: Nowa Lewica"


def test_unclassified_names_are_what_the_table_may_be_missing():
    assert unclassified_names(
        "popierany przez organizację: Stowarzyszenie Miasto Jest Nasze"
    ) == ["stowarzyszenie miasto jest nasze"]


@pytest.mark.parametrize(
    "statement",
    [
        "nie należy do partii politycznej",
        "1",
        "popierana przez partię polityczną: Prawo i Sprawiedliwość",
        None,
    ],
)
def test_no_party_and_named_parties_are_not_reported(statement):
    assert unclassified_names(statement) == []
