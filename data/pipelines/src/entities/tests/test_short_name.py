"""What a company is called once the register's form is off its name."""

import pytest

from entities.company import short_name


@pytest.mark.parametrize(
    "registered, short",
    [
        ("ORLEN SPÓŁKA AKCYJNA", "ORLEN"),
        ('"PKP INTERCITY" SPÓŁKA AKCYJNA', "PKP INTERCITY"),
        (
            "WODOCIĄGI KIELECKIE SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
            "WODOCIĄGI KIELECKIE",
        ),
        ("BANK POLSKA KASA OPIEKI - SPÓŁKA AKCYJNA", "BANK POLSKA KASA OPIEKI"),
        # The register's own spellings: no space after a quote, a typo, a dot.
        ('"ADMINISTRATOR"-SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ', "ADMINISTRATOR"),
        ('"OKNOTAR"SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ', "OKNOTAR"),
        ("GPK GŁOGÓW SPÓŁKA Z OGRANICZONA ODPOWIEDZIALNOŚCIĄ", "GPK GŁOGÓW"),
        ("LOTOS EKOENERGIA SPÓLKA AKCYJNA", "LOTOS EKOENERGIA"),
        (
            "MIEJSKIE PRZEDSIĘBIORSTWO ENERGETYKI CIEPLNEJ "
            "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ.",
            "MIEJSKIE PRZEDSIĘBIORSTWO ENERGETYKI CIEPLNEJ",
        ),
        # A limited partnership names its general partner, form and all.
        (
            "NORDZUCKER POLSKA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ "
            "SPÓŁKA KOMANDYTOWA",
            "NORDZUCKER POLSKA",
        ),
        # How an article or a person writes it.
        ("Orlen S.A.", "Orlen"),
        ("Polska Grupa Zbrojeniowa SA", "Polska Grupa Zbrojeniowa"),
        ("Tramwaje Śląskie sp. z o.o.", "Tramwaje Śląskie"),
    ],
)
def test_the_commercial_form_comes_off(registered, short):
    assert short_name(registered) == short


@pytest.mark.parametrize(
    "registered",
    [
        # rejestr.io's short names for these were "OPOLSKA", "KRAJOWA" and
        # "POWIATOWY": it drops whatever the legal form is, and here the form
        # is what the name is.
        "OPOLSKA IZBA GOSPODARCZA",
        "KRAJOWA IZBA GOSPODARCZA",
        "POWIATOWY SAMODZIELNY PUBLICZNY ZAKŁAD OPIEKI ZDROWOTNEJ",
        "ART SPORT FUNDACJA",
        "LEGNICKI MIĘDZYZAKŁADOWY ZWIĄZEK ZAWODOWY",
        "DRUKARNIA NR 1 PRZEDSIĘBIORSTWO PAŃSTWOWE",
    ],
)
def test_a_form_that_is_the_name_stays(registered):
    assert short_name(registered) == registered


@pytest.mark.parametrize(
    "name",
    [
        # The old suffix list cut "SA" off anything ending in it: ZAKSA was
        # "ZAK", EKSTRAKLASA "EKSTRAKLA" and EUROREGION NYSA "EUROREGION NY".
        "ZAKSA",
        "EKSTRAKLASA",
        "EUROREGION NYSA",
        "PHN PRYMASA",
        "AGENCJA INWESTYCYJNA CORP-SA",
    ],
)
def test_sa_is_a_form_only_as_a_word_of_its_own(name):
    assert short_name(name) == name
    assert short_name(f"{name} SPÓŁKA AKCYJNA") == name


@pytest.mark.parametrize(
    "registered, short",
    [
        (
            'POLSKIE RADIO - REGIONALNA ROZGŁOŚNIA W SZCZECINIE "PR SZCZECIN" '
            "SPÓŁKA AKCYJNA W LIKWIDACJI",
            'POLSKIE RADIO - REGIONALNA ROZGŁOŚNIA W SZCZECINIE "PR SZCZECIN" '
            "W LIKWIDACJI",
        ),
        ("PKP CARGO SPÓŁKA AKCYJNA W RESTRUKTURYZACJI", "PKP CARGO W RESTRUKTURYZACJI"),
        (
            "CHEMADEX SPÓŁKA AKCYJNA W LIKWIDACJI W UPADŁOŚCI LIKWIDACYJNEJ",
            "CHEMADEX W LIKWIDACJI W UPADŁOŚCI LIKWIDACYJNEJ",
        ),
        (
            "PRZEDSIĘBIORSTWO KOMUNIKACJI SAMOCHODOWEJ W KROŚNIE S.A. W LIKWIDACJI",
            "PRZEDSIĘBIORSTWO KOMUNIKACJI SAMOCHODOWEJ W KROŚNIE W LIKWIDACJI",
        ),
        # Spelled every way the register spells it.
        (
            'LUBUSKIE FABRYKI MEBLI SPÓŁKA AKCYJNA " W LIKWIDACJI"',
            "LUBUSKIE FABRYKI MEBLI W LIKWIDACJI",
        ),
        (
            'SŁUPSKIE PRZEDSIĘBIORSTWO CERAMIKI BUDOWLANEJ W LĘBORKU "W LIKWIDACJI"',
            "SŁUPSKIE PRZEDSIĘBIORSTWO CERAMIKI BUDOWLANEJ W LĘBORKU W LIKWIDACJI",
        ),
        (
            "FUNDACJA NA RZECZ POLITECHNIKI ŚLĄSKIEJ - W LIKWIDACJI",
            "FUNDACJA NA RZECZ POLITECHNIKI ŚLĄSKIEJ W LIKWIDACJI",
        ),
    ],
)
def test_the_status_stays(registered, short):
    """rejestr.io's short name dropped it with the form, and it is the one
    thing on a page that says the company is being wound up."""
    assert short_name(registered) == short


def test_a_partner_being_wound_up_is_not_the_company():
    # The general partner is in liquidation, not the limited partnership, so
    # nothing here can be cut without saying the wrong one is.
    name = (
        "TARASY OSIEDLE SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ W LIKWIDACJI "
        "SPÓŁKA KOMANDYTOWA"
    )
    assert short_name(name) == name


@pytest.mark.parametrize(
    "registered, short",
    [
        ('"FUNDACJA DLA POLSKI"', "FUNDACJA DLA POLSKI"),
        (
            '"PRZEDSIĘBIORSTWO KOMUNALNE "SANIKOM"" '
            "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
            'PRZEDSIĘBIORSTWO KOMUNALNE "SANIKOM"',
        ),
        (
            "„TERMA - DOM - NIERUCHOMOŚCI” SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
            "TERMA - DOM - NIERUCHOMOŚCI",
        ),
        # Two quoted names, not one name in quotes.
        (
            '"ELPOEKO" SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ - GRUPA "FRANSPOL"',
            '"ELPOEKO" SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ - GRUPA "FRANSPOL"',
        ),
        (
            'GMINNA SPÓŁDZIELNIA "SAMOPOMOC CHŁOPSKA" W LIKWIDACJI',
            'GMINNA SPÓŁDZIELNIA "SAMOPOMOC CHŁOPSKA" W LIKWIDACJI',
        ),
    ],
)
def test_quotes_round_the_whole_name_come_off(registered, short):
    assert short_name(registered) == short


def test_the_register_breaking_a_name_over_lines_is_not_part_of_it():
    assert (
        short_name(
            'SPOŁECZNA INICJATYWA MIESZKANIOWA "KZN - LUBUSKIE TRÓJMIASTO" '
            "SPÓŁKA Z OGRANICZONĄ\n                        ODPOWIEDZIALNOŚCIĄ"
        )
        == 'SPOŁECZNA INICJATYWA MIESZKANIOWA "KZN - LUBUSKIE TRÓJMIASTO"'
    )


@pytest.mark.parametrize("name", ["SPÓŁKA AKCYJNA", "W LIKWIDACJI", '""'])
def test_nothing_is_cut_down_to_nothing(name):
    assert short_name(name) == name


@pytest.mark.parametrize("name", [None, ""])
def test_no_name_stays_none(name):
    assert short_name(name) == name


@pytest.mark.parametrize(
    "registered",
    [
        "ORLEN SPÓŁKA AKCYJNA",
        'POLSKIE RADIO - REGIONALNA ROZGŁOŚNIA W SZCZECINIE "PR SZCZECIN" '
        "SPÓŁKA AKCYJNA W LIKWIDACJI",
        '"ABC SPÓŁKA AKCYJNA W LIKWIDACJI"',
        "TARASY OSIEDLE SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ W LIKWIDACJI "
        "SPÓŁKA KOMANDYTOWA",
        '"KREDYT BANK SPÓŁKA AKCYJNA I TOWARZYSTWO UBEZPIECZEŃ I REASEKURACJI '
        'WARTA SPÓŁKA AKCYJNA" SPÓŁKA JAWNA',
    ],
)
def test_shortening_a_short_name_changes_nothing(registered):
    """`CompaniesKRS` shortens the register's names and `Companies` shortens
    whatever it is handed again, so the second pass must find nothing to do."""
    once = short_name(registered)
    assert short_name(once) == once
