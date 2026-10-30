"""Reading dates, names and PKW's windows: no OCR, no files."""

from __future__ import annotations

from datetime import date

import pytest

from jobs.bip_declarations.reading import (
    birth_window,
    born_in_text,
    date_in,
    declaration_year,
    in_windows,
    name_in_text,
    name_matches,
    parse_date,
)


@pytest.mark.parametrize(
    ("text", "born"),
    [
        ("12.03.1965", date(1965, 3, 12)),
        ("12-3-1965 r.", date(1965, 3, 12)),
        ("1965-03-12", date(1965, 3, 12)),
        ("3 wrzesnia 1971 r.", date(1971, 9, 3)),
        ("3 ix 1971", date(1971, 9, 3)),
        # The form quotes the act of 8 March 1990: not anybody's birthday.
        ("ustawy z dnia 8.03.1990 r.", None),
        # A declaration's own date is too recent to be a councillor's birth.
        ("31.12.2023", None),
    ],
)
def test_parse_date(text, born):
    assert parse_date(text) == born


def test_date_in_forgives_what_ocr_does_to_digits():
    assert date_in("urodzony 12 .03 1965 r") == date(1965, 3, 12)
    assert date_in("l2.O3.1965") == date(1965, 3, 12)
    assert date_in("nie dotyczy") is None


def test_born_in_text_reads_the_field_after_the_label():
    text = (
        "Ja, nizej podpisany(a), Jan Testowy (imiona i nazwisko)\n"
        "urodzony(a) 12.03.1965 r. w Testowie\n"
        "(miejsce zatrudnienia) ... ustawy z dnia 8 marca 1990 r."
    )
    born, field = born_in_text(text)
    assert born == date(1965, 3, 12)
    assert field.startswith("12.03.1965")


def test_born_in_text_skips_a_hiring_notice():
    born, _ = born_in_text("dla osob urodzonych 1 sierpnia 1972 r. lub pozniej")
    assert born is None


def test_name_in_text():
    text = "Ja, nizej podpisany(a), Jan Testowy\r\n(imiona i nazwisko oraz nazwisko)"
    assert name_in_text(text) == "Jan Testowy"
    assert name_in_text("Ja, nizej podpisany(a), ........ (imiona i nazwisko)") == ""


def test_birth_window_is_pkws_age_on_its_reference_day():
    # 2024's ages are as on 2025-03-17: 60 then means born 1964-03-18 to 1965-03-17.
    assert birth_window(2024, 60) == (date(1964, 3, 18), date(1965, 3, 17))
    # 2018's are as on election day, 2018-10-21.
    assert birth_window(2018, 53) == (date(1964, 10, 22), date(1965, 10, 21))
    assert birth_window(2010, 50) is None  # a mix of rules, no exact window
    assert birth_window(2024, None) is None


def test_in_windows_wants_every_window():
    born = date(1965, 3, 12)
    windows = [w for w in (birth_window(2024, 60), birth_window(2018, 53)) if w]
    assert in_windows(born, windows) == "yes"
    assert in_windows(born, [*windows, (date(1966, 1, 1), date(1966, 12, 31))]) == "no"
    assert in_windows(born, []) == "none"
    assert in_windows(None, windows) == "none"


@pytest.mark.parametrize(
    ("read", "first", "last", "matches"),
    [
        ("Jan Testowy", "Jan", "Testowy", True),
        ("TESTOWY JAN", "Jan", "Testowy", True),  # signed surname first
        ("Jan Testowv", "Jan", "Testowy", True),  # one letter misread
        ("Anna Maria Probna-Testowa", "Anna", "Probna-Testowa", True),
        ("Anna Testowa", "Anna", "Probna-Testowa", False),  # half the surname
        ("Łukasz Żółtkowy", "Lukasz", "Zoltkowy", True),
        ("Jan Przykladowy", "Jan", "Testowy", False),
        ("", "Jan", "Testowy", False),
    ],
)
def test_name_matches(read, first, last, matches):
    assert name_matches(read, first, last) is matches


def test_declaration_year():
    assert declaration_year("wedlug stanu na dzien 31.12.2023 r.") == 2023
    assert declaration_year("według stanu na dzień 31 grudnia 2019 r.") == 2019
    assert declaration_year("OSWIADCZENIE MAJATKOWE radnego gminy") is None
