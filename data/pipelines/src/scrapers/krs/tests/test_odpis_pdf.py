"""That the odpis parser still reads the shapes the register actually uses.

The fixture below is assembled from real documents (KRS 0000006301 and
0000002414), with each of the traps that cost a wrong answer while this was
being written kept in deliberately:

* the board and the supervisory board spell their person fields differently;
* the supervisory board has no funkcja field at all;
* a page footer splits over two lines and interrupts a person mid-block;
* one label carries several versions of its value;
* ``Prokurenci`` and ``Dane jedynego akcjonariusza`` hold their people with no
  ``Podrubryka`` around them;
* the rubryka separator is a soft hyphen.

Every PESEL here is synthetic -- constructed to pass its own check digit so the
decode path runs, and belonging to nobody.
"""

import re

import pytest

from scrapers.krs.odpis_pdf import (
    parse_people,
    role_of,
    unread_person_rubryki,
)


def pesel(first_ten: str) -> str:
    weights = (1, 3, 7, 9, 1, 3, 7, 9, 1, 3)
    total = sum(int(d) * w for d, w in zip(first_ten, weights))
    return first_ten + str((10 - total % 10) % 10)


#: 1953-08-10, male; 1948-05-16, female; 1970-02-08, male; 1965-03-04, female.
BOARD_FORMER = pesel("5308101231")
BOARD_CURRENT = pesel("7002082345")
SUPERVISOR = pesel("4805162340")
PROXY = pesel("6503042341")
#: 1988-06-22, female -- a third board member, so person 2's funkcja really
#: is followed by an L.p. counter the way a stowarzyszenie's zarzad is.
THIRD = pesel("8806224566")
SHAREHOLDER_REGON = "000524832"

ODPIS = f"""
Dział 1
Rubryka 1 ­ Dane podmiotu
Numer i nazwa pola
Nr wpisu
Zawartość
wprow
.
wykr.
1.Oznaczenie formy prawnej
1
-
SPÓŁKA AKCYJNA
2.Numer REGON/NIP
2
-
REGON: 000524832, NIP: 6791862817
3.Firma, pod którą spółka działa
1
-
TESTOWY HOLDING SPÓŁKA AKCYJNA
Rubryka 7 ­ Dane jedynego akcjonariusza
L.p.
Numer i nazwa pola
Nr wpisu
Zawartość
1
1.Nazwisko / Nazwa lub Firma
1
-
GMINA MIEJSKA TESTOWA
2.Imiona
-
-
3.Numer PESEL/REGON lub data
urodzenia
1
-
------, {SHAREHOLDER_REGON}
4.Czy akcjonariusz posiada
całość akcji spółki?
1
-
TAK
Dział 2
Rubryka 1 ­ Organ uprawniony do reprezentacji podmiotu
L.p.
Numer i nazwa pola
Nr wpisu
Zawartość
wprow
.
wykr.
1
1.Nazwa organu uprawnionego do
reprezentowania podmiotu
1
-
ZARZĄD
2.Sposób reprezentacji podmiotu
1
3
SAMODZIELNIE - ZARZĄD JEDNOOSOBOWY
3
-
DWAJ CZŁONKOWIE ZARZĄDU DZIAŁAJĄCY ŁĄCZNIE
Podrubryka 1
Dane osób wchodzących w skład organu
L.p.
Numer i nazwa pola
Nr wpisu
Zawartość
wprow
.
wykr.
1
1.Nazwisko / Nazwa lub Firma
1
20
KOWALSKI
2.Imiona
1
20
TADEUSZ WAWRZYNIEC
3.Numer PESEL/REGON lub data
urodzenia
1
20
{BOARD_FORMER}, ------
4.Numer KRS
-
-
*****
5.Funkcja w organie
reprezentującym
1
12
WICEPREZES ZARZĄDU
12
20
PREZES ZARZĄDU
6.Czy osoba wchodząca w skład
zarządu została zawieszona w
czynnościach?
1
20
NIE
2
1.Nazwisko / Nazwa lub Firma
20
-
NOWAK
Strona 43 z
60

2.Imiona
20
-
GRZEGORZ PIOTR
3.Numer PESEL/REGON lub data
urodzenia
20
-
{BOARD_CURRENT}, ------
5.Funkcja w organie
reprezentującym
20
-
PREZES ZARZĄDU
3
1.Nazwisko / Nazwa lub Firma
20
-
LEWANDOWSKA
2.Imiona
20
-
EWA
3.Numer PESEL/REGON lub data
urodzenia
20
-
{THIRD}, ------
5.Funkcja w organie
reprezentującym
20
-
CZŁONEK ZARZĄDU
Rubryka 2 ­ Organ nadzoru
L.p.
Numer i nazwa pola
Nr wpisu
Zawartość
wprow
.
wykr.
1
1.Nazwa organu
1
-
RADA SPOŁECZNA
Podrubryka 1
Dane osób wchodzących w skład organu
L.p.
Numer i nazwa pola
Nr wpisu
Zawartość
wprow
.
wykr.
1
1.Nazwisko
1
-
WIŚNIEWSKA
2.Imiona
1
-
HALINA
3.Numer PESEL lub data urodzenia
1
-
{SUPERVISOR}, ------
Rubryka 3 ­ Prokurenci
L.p.
Numer i nazwa pola
Nr wpisu
Zawartość
1
1.Nazwisko
1
-
ZIELIŃSKA
2.Imiona
1
-
ANNA MARIA
3.Numer PESEL
1
-
{PROXY}
4.Rodzaj prokury
1
-
PROKURA SAMOISTNA
Dział 3
Rubryka 1 ­ Przedmiot działalności
1.Przedmiot przeważającej
działalności przedsiębiorcy
1
-
35, 11, Z
"""


@pytest.fixture
def people():
    return parse_people(ODPIS, krs="0000000001")


def find(people, surname):
    return next(person for person in people if person.surname == surname)


def test_finds_everybody_in_every_rubryka(people):
    assert {p.surname for p in people} == {
        "KOWALSKI",
        "NOWAK",
        "LEWANDOWSKA",
        "WIŚNIEWSKA",
        "ZIELIŃSKA",
        "GMINA MIEJSKA TESTOWA",
    }


def test_a_rubryka_without_a_podrubryka_still_yields_its_people(people):
    """Prokurenci and the sole shareholder hold people directly.

    Collecting only inside a Podrubryka is what lost the sole shareholder of
    KRS 0000006301 until the JSON cross-check reported 1 against 0.
    """
    assert find(people, "ZIELIŃSKA").role == "prokurent"
    assert find(people, "GMINA MIEJSKA TESTOWA").role == "jedyny_akcjonariusz"


def test_the_struck_out_column_separates_former_from_sitting(people):
    former, sitting = find(people, "KOWALSKI"), find(people, "NOWAK")
    assert former.entry_added == "1"
    assert former.entry_removed == "20"
    assert not former.current
    assert sitting.entry_added == "20"
    assert sitting.entry_removed is None
    assert sitting.current


def test_the_board_and_the_supervisory_board_are_read_from_different_labels(people):
    board, supervisory = find(people, "NOWAK"), find(people, "WIŚNIEWSKA")
    assert board.role == "reprezentacja"
    assert board.organ_name == "ZARZĄD"
    assert supervisory.role == "nadzor"
    assert supervisory.organ_name == "RADA SPOŁECZNA"
    assert supervisory.given_names == "HALINA"
    assert supervisory.surname == "WIŚNIEWSKA"


def test_a_supervisory_organ_is_classified_and_a_board_is_not(people):
    """`organ_kind` answers "which supervisory organ", so only asking it there.

    A rada społeczna is unpaid by statute where a rada nadzorcza is as a rule
    paid, which is the distinction worth carrying; running the same function
    over "ZARZĄD" returns "inny" and reads as a fact about the company.
    """
    assert find(people, "WIŚNIEWSKA").organ == "rada_spoleczna"
    assert find(people, "NOWAK").organ is None


def test_the_supervisory_board_carries_no_funkcja(people):
    assert find(people, "WIŚNIEWSKA").funkcja is None
    assert find(people, "NOWAK").funkcja == "PREZES ZARZĄDU"


def test_a_multi_version_field_takes_the_version_that_still_stands(people):
    """The funkcja changed from wiceprezes to prezes under one label.

    Concatenating the versions yields "WICEPREZES ZARZĄDU PREZES ZARZĄDU".
    """
    assert find(people, "KOWALSKI").funkcja == "PREZES ZARZĄDU"


def test_a_page_footer_interrupting_a_person_is_not_read_as_data(people):
    """"Strona 43 z" / "60" falls between NOWAK's surname and given names.

    Dropping only the first line leaves the page count as a bare number, which
    is indistinguishable from an entry cell: it landed in the value as
    "MAREK BUDZIK 60" on a real document.
    """
    sitting = find(people, "NOWAK")
    assert sitting.surname == "NOWAK"
    assert sitting.given_names == "GRZEGORZ PIOTR"
    assert "60" not in sitting.full_name


def test_the_next_persons_lp_counter_is_not_glued_to_the_funkcja(people):
    """A person's last field is followed by the next person's `L.p.` number.

    It is a lone bare number with no second entry cell after it, so the triple
    walk does not stop on it and it lands at the end of the value: "CZŁONEK
    ZARZĄDU 2", "WICEPREZES 4", "SEKRETARZ 5". Those read as plausible
    functions, which is what made it survive a first pass over real documents
    -- 533 of 1,782 people carried one.
    """
    for person in people:
        assert not re.search(r"\s\d+$", person.funkcja or ""), person.funkcja
        assert not re.search(r"\s\d+$", person.surname), person.surname
        assert not re.search(r"\s\d+$", person.given_names), person.given_names

    # NOWAK's funkcja is the last field of their block and is followed
    # directly by "3", LEWANDOWSKA's L.p. counter.
    assert find(people, "NOWAK").funkcja == "PREZES ZARZĄDU"
    assert find(people, "LEWANDOWSKA").funkcja == "CZŁONEK ZARZĄDU"


def test_a_value_that_is_only_a_number_survives(people):
    """`3.Numer PESEL` under Prokurenci is eleven digits and nothing else.

    So the trailing-number strip has to be guarded on the value having
    something else in it, or every prokurent loses their identifier.
    """
    proxy = find(people, "ZIELIŃSKA")
    assert proxy.birth_date == "1965-03-04"
    assert proxy.has_pesel


def test_the_pesel_becomes_a_birth_date_and_sex(people):
    sitting = find(people, "NOWAK")
    assert sitting.birth_date == "1970-02-08"
    assert sitting.sex == "M"
    assert sitting.has_pesel
    assert not sitting.is_company

    supervisory = find(people, "WIŚNIEWSKA")
    assert supervisory.birth_date == "1948-05-16"
    assert supervisory.sex == "F"


def test_a_seat_held_by_a_body_has_a_regon_and_no_birth_date(people):
    shareholder = find(people, "GMINA MIEJSKA TESTOWA")
    assert not shareholder.has_pesel
    assert shareholder.is_company
    assert shareholder.birth_date is None
    assert shareholder.sex is None


def test_no_pesel_is_ever_carried_on_the_record(people):
    """The decode happens in memory; the number must not survive it."""
    for person in people:
        assert not hasattr(person, "pesel")
        for value in (person.surname, person.given_names, person.funkcja or ""):
            for number in (BOARD_FORMER, BOARD_CURRENT, SUPERVISOR, PROXY):
                assert number not in value


def test_the_soft_hyphen_does_not_hide_a_rubryka(people):
    """The register writes "Rubryka 2 ­ Organ nadzoru" with U+00AD."""
    assert "­" in ODPIS  # the fixture really does use it
    assert any(person.role == "nadzor" for person in people)


@pytest.mark.parametrize(
    "title, expected",
    [
        ("Organ uprawniony do reprezentacji podmiotu", "reprezentacja"),
        ("Organ nadzoru", "nadzor"),
        ("Prokurenci", "prokurent"),
        ("Dane jedynego akcjonariusza", "jedyny_akcjonariusz"),
        ("Likwidacja", "likwidator"),
        ("Informacja o postępowaniu upadłościowym", "syndyk"),
        ("Kapitał spółki", None),
        ("Przedmiot działalności", None),
        ("Dane podmiotu", None),
    ],
)
def test_role_of_reads_the_rubryka_title(title, expected):
    assert role_of(title) == expected


def test_a_person_bearing_rubryka_we_do_not_know_is_reported():
    """The guard that `people_parsing.unread_person_paths` provides for JSON.

    A rubryka the register adds later would otherwise cost us everybody in it
    with no error and no count to notice -- which is how this very check found
    "Informacja o postępowaniu upadłościowym" on a real run.
    """
    odpis = """
Dział 6
Rubryka 9 ­ Zupełnie nowa rubryka o czymś
L.p.
Numer i nazwa pola
1
1.Nazwisko
1
-
NIEZNANY
2.Imiona
1
-
KTOŚ
3.Numer PESEL lub data urodzenia
1
-
90010112345, ------
"""
    assert unread_person_rubryki(odpis) == {"Zupełnie nowa rubryka o czymś"}
    # And nothing is silently emitted for it.
    assert parse_people(odpis, krs="0000000002") == []


def test_a_known_rubryka_is_not_reported_as_unread():
    assert unread_person_rubryki(ODPIS) == set()


def test_a_partnership_representation_rubryka_has_a_role():
    """A partnership has no zarząd, so its form titles the rubryka differently.

    `unread_person_rubryki` found it on a real run: the sp. z o.o./SA prefix
    "organ uprawniony do reprezentacji" finds nobody under "Uprawnieni do
    reprezentowania spółki", which for a spółka jawna or komandytowa is the
    only place its controllers are named at all.
    """
    assert role_of("Uprawnieni do reprezentowania spółki") == "reprezentacja"
    assert role_of("Organ uprawniony do reprezentacji podmiotu") == "reprezentacja"
