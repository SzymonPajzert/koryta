"""Suggestions for printed employer bands: made-up bodies in made-up towns, and
bands written as OCR reads them. No real declaration, name or public body."""

from __future__ import annotations

import re

import pandas as pd
import pytest

from jobs.bip_declarations import suggest as module
from jobs.bip_declarations.suggest import (
    EMPLOYEE_ROLE,
    MAX_SUGGESTIONS,
    OTHER_ROLE,
    BodyIndex,
    Suggestion,
    read_bodies,
    read_title,
    suggest,
    valid_regon,
)
from scrapers.map.offices import (
    GMINA_OFFICE,
    MARSHAL_OFFICE,
    POWIAT_OFFICE,
    VOIVODE_OFFICE,
)
from util import declaration_roles
from util.declaration_roles import ROLES_FILE, read_roles

SHARED = ROLES_FILE.parent / "declarationEmployment.ts"


def regon(n: int) -> str:
    """A nine-digit REGON with its check digit."""
    stem = f"{n:08d}"
    remainder = sum(int(d) * w for d, w in zip(stem, (8, 9, 2, 3, 4, 5, 6, 7))) % 11
    return stem + str(0 if remainder == 10 else remainder)


# Województwo 01 and its units do not exist: powiat 0101 with the gminy Testowo
# (0101012), Przykładowo (0101023) and Testowice (0101032); Innowo (0202013)
# and Lipowo (0303013) far from it.
ROWS = {
    "ug_testowo": ("Urząd Gminy Testowo", GMINA_OFFICE, "0101012"),
    "um_przykladowo": ("Urząd Miejski w Przykładowie", GMINA_OFFICE, "0101023"),
    "ug_testowice": ("Urząd Gminy Testowice", GMINA_OFFICE, "0101032"),
    "starostwo": ("Starostwo Powiatowe w Przykładowie", POWIAT_OFFICE, "0101"),
    "marshal": ("Urząd Marszałkowski Województwa Testowego", MARSHAL_OFFICE, "01"),
    "voivode": ("Testowy Urząd Wojewódzki w Przykładowie", VOIVODE_OFFICE, "01"),
    "sp5": (
        "Szkoła Podstawowa nr 5 im. Jana Testowego w Przykładowie",
        "szkoły podstawowe",
        "0101023",
    ),
    "sp5_innowo": ("Szkoła Podstawowa nr 5 w Innowie", "szkoły podstawowe", "0202013"),
    "gops": (
        "Gminny Ośrodek Pomocy Społecznej w Testowie",
        "ośrodki pomocy społecznej",
        "0101012",
    ),
    "zgk_testowo": (
        "Zakład Gospodarki Komunalnej (Testowo)",
        "zakłady usług komunalnych",
        "0101012",
    ),
    "zgk_innowo": (
        "Zakład Gospodarki Komunalnej (Innowo)",
        "zakłady usług komunalnych",
        "0202013",
    ),
    "zgk_lipowo": (
        "Zakład Gospodarki Komunalnej spółka z ograniczoną odpowiedzialnością (Lipowo)",
        "zakłady usług komunalnych",
        "0303013",
    ),
    "odr": (
        "Ośrodek Doradztwa Rolniczego w Testowie",
        "ośrodki doradztwa rolniczego",
        "01",
    ),
    "culture": ("Dom Kultury (Testowo)", "instytucje kultury", "0101012"),
    "ministry": ("Ministerstwo Testowych Spraw (Warszawa)", "ministerstwa", "1465108"),
    "forests": (
        "Testowa Dyrekcja Generalna Lasów (Warszawa)",
        "instytucje centralne",
        "1465108",
    ),
    "pup": ("Powiatowy Urząd Pracy w Przykładowie", "urzędy pracy", "0101"),
    "mops": (
        "Miejski Ośrodek Pomocy Społecznej w Przykładowie",
        "ośrodki pomocy społecznej",
        "0101023",
    ),
    "kindergarten": (
        "Przedszkole Miejskie nr 1 w Przykładowie",
        "przedszkola",
        "0101023",
    ),
    "lo1": ("I Liceum Ogólnokształcące w Przykładowie", "szkoły średnie", "0101023"),
    # Far away, in towns whose stems sit inside everyday words of a band:
    # „kole” in „Szkoleń”, „koln” in „Szkolnictwa” (t read as l), „slaw” in
    # „Podstawowa”, „olec” and „leczn” in „Społecznej”, „slar” in „Starszy”.
    "starostwo_kole": ("Starostwo Powiatowe (Kole Testowe)", POWIAT_OFFICE, "0202"),
    "starostwo_kolno": ("Starostwo Powiatowe (Kolno Testowe)", POWIAT_OFFICE, "0303"),
    "kindergarten_kole": (
        "Przedszkole Miejskie nr 1 (Kole Testowe)",
        "przedszkola",
        "0202011",
    ),
    "sp_slawa": (
        "Szkoła Podstawowa w Sławie Testowej",
        "szkoły podstawowe",
        "0303011",
    ),
    "mops_olecko": (
        "Miejski Ośrodek Pomocy Społecznej w Olecku Testowym",
        "ośrodki pomocy społecznej",
        "0202011",
    ),
    "mops_leczna": (
        "Miejski Ośrodek Pomocy Społecznej w Łęcznie Testowej",
        "ośrodki pomocy społecznej",
        "0303011",
    ),
    "pup_stary": ("Powiatowy Urząd Pracy w Starym Testowie", "urzędy pracy", "0202"),
}
REGONS = {key: regon(10_000_000 + i) for i, key in enumerate(ROWS)}
#: The gmina a body serving a powiat or a województwo stands in.
SEATS = {"01": "0101023", "0101": "0101023", "0202": "0202011", "0303": "0303011"}


def table() -> list[dict[str, str | None]]:
    rows: list[dict[str, str | None]] = [
        {
            "regon": REGONS[key],
            "name": name,
            "kind": kind,
            "teryt": teryt,
            "seat": SEATS.get(teryt, teryt),
            "ownership": "113",
        }
        for key, (name, kind, teryt) in ROWS.items()
    ]
    rows += [
        # In private hands, whatever the catalogue files it under.
        {
            "regon": regon(20_000_001),
            "name": "Szpital Testowy w Testowie",
            "kind": "podmioty lecznicze",
            "teryt": "0101012",
            "seat": "0101012",
            "ownership": "215",
        },
        # A REGON without its check digit names nobody.
        {
            "regon": "123456789",
            "name": "Biblioteka Publiczna w Testowie",
            "kind": "biblioteki",
            "teryt": "0101012",
            "seat": "0101012",
            "ownership": "113",
        },
    ]
    return rows


@pytest.fixture(scope="module")
def bodies() -> BodyIndex:
    return BodyIndex(table())


def rows(
    bodies: BodyIndex, lines: list[str], unit: str, office: str | None = None
) -> list[tuple[str, str]]:
    """What is suggested, as (key in ROWS, role)."""
    names = {number: key for key, number in REGONS.items()}
    return [
        (names.get(s.regon, s.regon), s.role)
        for s in suggest(lines, unit, bodies, typed=True, office=office)
    ]


# -- parity with the site ------------------------------------------------------------


def test_the_site_reads_the_same_chips_file():
    source = SHARED.read_text(encoding="utf-8")
    assert f'import rolesFile from "./{ROLES_FILE.name}";' in source
    assert re.search(rf"export const MAX_SUGGESTIONS = {MAX_SUGGESTIONS};", source)
    assert f'export const OTHER_ROLE = "{OTHER_ROLE}";' in source


def test_the_chips_are_the_files():
    roles = read_roles()
    ids = [chip.id for chip in roles.chips]
    assert len(ids) == len(set(ids))
    assert roles.chip(OTHER_ROLE) is not None
    assert roles.chip(OTHER_ROLE).family is None
    employee = roles.chip(EMPLOYEE_ROLE)
    assert employee is not None and employee.kind == "staff"
    assert {chip.kind for chip in roles.chips} == {
        "elected",
        "executive",
        "managerial",
        "staff",
        None,
    }


def test_the_suggestions_read_the_shared_roles(bodies):
    """Titles fold with the reader the night's checks use, the way the site
    folds them (src/util/tests/test_declaration_roles.py holds the two
    together): „Z-cy” is the roles file's deputy, not a patch of the job's."""
    band = ["Powiatowy Urząd Pracy w Przykładowie, na stanowisku Z-cy Dyrektora"]
    roles = declaration_roles.read_roles()
    found = suggest(band, "010102", bodies, typed=True, roles=roles)
    assert found == [Suggestion(REGONS["pup"], "zastepca_dyrektora")]


def test_every_chip_is_named_by_its_own_label():
    """What the machine reads a chip's label as is that chip, so every chip a
    reader can pick is one the machine can suggest."""
    for chip in read_roles().chips:
        if chip.family is not None:
            assert read_title(read_roles(), chip.label) == (chip.family, chip), chip.id


@pytest.mark.parametrize(
    ("title", "chip"),
    [
        ("p.o. Zastępcy Dyrektora Wydziału", "zastepca_dyrektora"),
        ("Z-cy Dyrektora", "zastepca_dyrektora"),
        ("zastępca prezesa", "wiceprezes"),
        ("wicewójt", "zastepca_wojta"),
        ("Zastępca Starosty", "wicestarosta"),
        ("Starszy Inspektor", EMPLOYEE_ROLE),
        ("nauczycielka", "nauczyciel"),
        ("Przewodnicząca Rady Nadzorczej", "rada_nadzorcza"),
        ("Wiceprzewodniczący Rady Nadzorczej", "rada_nadzorcza"),
        ("komendant powiatowy", "dyrektor"),
        ("podsekretarz stanu", None),
        # A deputy no chip is a deputy's gets none, never its head's.
        ("Z-ca Naczelnika Wydziału Inwestycji", None),
        ("Z-cy Naczelnika Wydziału", None),
        ("Zastępca Kierownika Referatu", None),
        ("zastępca komendanta", None),
    ],
)
def test_a_title_reads_as_the_chip_a_reader_would_pick(title, chip):
    _, found = read_title(read_roles(), title)
    assert (found.id if found else None) == chip


def test_a_deputy_gets_no_row_where_no_chip_is_a_deputys(bodies):
    band = ["Starostwo Powiatowe w Przykładowie - Z-ca Naczelnika Wydziału Testów"]
    assert rows(bodies, band, "010100") == []
    band = ["Urząd Miejski w Przykładowie - Zastępca Kierownika Referatu"]
    assert rows(bodies, band, "010102") == []


def test_a_regon_checks_as_the_site_checks_it():
    # The fixtures of frontend/tests/shared/declarationEmployment.test.ts.
    assert valid_regon("123456785")
    assert valid_regon("987654326")
    assert valid_regon("12345678500002")
    assert not valid_regon("123456789")
    assert not valid_regon("12345678500003")
    assert not valid_regon("1234567")


def test_the_pipelines_table_reads_without_its_gaps(monkeypatch):
    """A row the table has no seat or teryt for is placed nowhere, not in a
    unit called "nan"."""
    frame = pd.DataFrame(table()).astype(object)
    frame.loc[0, ["seat", "teryt", "ownership"]] = float("nan")
    monkeypatch.setattr(module.PublicBodies, "read_or_process", lambda self, ctx: frame)
    index = read_bodies(ctx=None)  # type: ignore[arg-type]
    assert index.bodies[0].regon == REGONS["ug_testowo"]
    assert (index.bodies[0].teryt, index.bodies[0].seat) == ("", "")
    assert len(index.bodies) == len(ROWS)


def test_a_suggestion_is_what_the_site_takes():
    row = Suggestion(REGONS["starostwo"], "wicestarosta")
    assert row.payload() == {
        "employer": {"regon": REGONS["starostwo"]},
        "role": "wicestarosta",
    }


# -- reading the band ------------------------------------------------------------------


def test_a_body_and_the_title_after_it(bodies):
    band = ["Urząd Miejski w Przykładowie - Naczelnik Wydziału Testów"]
    assert rows(bodies, band, "010102") == [("um_przykladowo", "naczelnik")]


def test_ocr_squashed_and_misread_lines_still_name_the_body(bodies):
    # ł read as t, spaces gone, the head in the locative.
    band = ["ZatrudnionawUrzedzieMiejskimwPrzyktadowie-NaczelnikWydziatu"]
    assert rows(bodies, band, "010102") == [("um_przykladowo", "naczelnik")]


def test_a_title_before_the_body_it_runs_into(bodies):
    band = ["Pracownik Urzędu Gminy Testowo"]
    assert rows(bodies, band, "010101") == [("ug_testowo", EMPLOYEE_ROLE)]
    band = [
        "P.O. DYREKTORA SZKOŁY PODSTAWOWEJ NR 5 IM. JANA TESTOWEGO",
        "W PRZYKŁADOWIE",
    ]
    assert rows(bodies, band, "010102") == [("sp5", "dyrektor")]


def test_titles_glued_together_are_read_apart(bodies):
    band = ["URZADGMINYTESTOWO", "ZASTEPCAWOJTAGMINYTESTOWO"]
    assert rows(bodies, band, "010101") == [("ug_testowo", "zastepca_wojta")]
    band = ["Powiatowy Urząd Pracy w Przykładowie - Zastępca", "Dyrektora Urzędu"]
    assert rows(bodies, band, "010102") == [("pup", "zastepca_dyrektora")]
    band = ["Powiatowy Urząd Pracy w Przykładowie, na stanowisku Z-cy Dyrektora"]
    assert rows(bodies, band, "010102") == [("pup", "zastepca_dyrektora")]


def test_a_title_running_into_a_body_is_that_bodys(bodies):
    """Not the body before it: the declarant heads the GOPS, not the urząd."""
    band = [
        "Urząd Gminy Testowo, Kierownik Gminnego Ośrodka Pomocy Społecznej w Testowie"
    ]
    assert rows(bodies, band, "010101") == [("gops", "kierownik")]
    band = [
        "URZĄD GMINY TESTOWO",
        "Nauczyciel w Szkole Podstawowej nr 5 w Przykładowie",
    ]
    assert rows(bodies, band, "010101") == [("sp5", "nauczyciel")]
    band = ["Szkoła Podstawowa nr 5 w Przykładowie - Dyrektor Szkoły Podstawowej nr 5"]
    assert rows(bodies, band, "010102") == [("sp5", "dyrektor")]
    # Each line's title is its own body's, though the next line's name is
    # found from the last letter of the title before it: „nauczycie|l” and
    # „Liceum” read as „I Liceum”.
    band = [
        "Szkoła Podstawowa nr 5 w Przykładowie - nauczyciel",
        "Liceum Ogólnokształcące w Przykładowie - pedagog",
    ]
    assert rows(bodies, band, "010102") == [
        ("sp5", "nauczyciel"),
        ("lo1", EMPLOYEE_ROLE),
    ]


def test_a_gmina_ending_in_wice_is_no_wicewojt(bodies):
    """A gmina ending in „-wice” run into „Wójt”: the pilot taught it."""
    assert rows(bodies, ["Urzad GminyTestowice;Wojt"], "010103") == [
        ("ug_testowice", "wojt")
    ]
    assert rows(bodies, ["UrzadGminyTestowice", "TestowiceWójt"], "010103") == [
        ("ug_testowice", "wojt")
    ]


def test_a_title_alone_names_its_own_office(bodies):
    """Where the declarant can hold that post in their own unit: a mayor in
    their urząd, a powiat's or a sejmik's councillor on its zarząd."""
    band = ["W6jt Gminy Testowo"]
    assert rows(bodies, band, "010101", office="Wójt") == [("ug_testowo", "wojt")]
    band = ["Wicestarosta Przykładowski, Radny Powiatu Przykładowskiego"]
    assert rows(bodies, band, "010100") == [("starostwo", "wicestarosta")]
    assert rows(bodies, ["Starosta Przykładowski"], "010100") == [
        ("starostwo", "starosta")
    ]
    band = ["Członek Zarządu Powiatu Przykładowskiego"]
    assert rows(bodies, band, "010100") == [("starostwo", "czlonek_zarzadu")]
    assert rows(bodies, ["Marszałek Województwa Testowego"], "010000") == [
        ("marshal", "marszalek")
    ]
    band = ["Członek Zarządu Województwa Testowego"]
    assert rows(bodies, band, "010000") == [("marshal", "czlonek_zarzadu")]


@pytest.mark.parametrize(
    ("title", "unit", "office"),
    [
        # A councillor of the gmina is no wójt, nor a burmistrz a wójt.
        ("Wójt Gminy Testowo", "010101", None),
        ("Wójt Gminy Testowo", "010101", "Rada gminy"),
        ("Wójt Gminy Testowo", "010101", "Burmistrz"),
        # Staff of the office: a councillor may not work there.
        ("Sekretarz Gminy", "010101", "Rada gminy"),
        ("Skarbnik Gminy", "010101", "Rada gminy"),
        ("Zastępca Wójta", "010101", "Wójt"),
        ("Zastępca Burmistrza", "010102", "Rada miasta"),
        ("Naczelnik Wydziału Testów", "010102", "Rada miasta"),
        ("Kierownik Referatu Testów", "010101", "Rada gminy"),
        ("Sekretarz Powiatu", "010100", "Rada powiatu"),
        ("Skarbnik Województwa", "010000", "Sejmik"),
        ("Doradca Wojewody Testowego", "010000", "Sejmik"),
        # Another unit's zarząd.
        ("Wicestarosta Przykładowski", "010101", "Rada gminy"),
        ("Członek Zarządu Powiatu", "010000", "Sejmik"),
        ("Marszałek Województwa Testowego", "010100", "Rada powiatu"),
    ],
)
def test_a_title_alone_names_no_post_the_declarant_cannot_hold(
    bodies, title, unit, office
):
    assert rows(bodies, [title], unit, office=office) == []


def test_a_title_alone_names_no_office_it_cannot_tell(bodies):
    # Another gmina's wójt; a sekretarz of no named office; a prezydent inside
    # an institution's name; a manager's title.
    assert rows(bodies, ["Wójt Gminy Innowo"], "010101") == []
    assert rows(bodies, ["Sekretarz"], "010101") == []
    assert (
        rows(bodies, ["Kancelaria Prezydenta Testowej - specjalista"], "010102") == []
    )
    assert rows(bodies, ["Kierownik Biura Powiatowego w Testowie"], "010101") == []


def test_an_office_title_is_not_held_at_another_body(bodies):
    band = [
        "Testowa Dyrekcja Generalna Lasów, Członek Zarządu",
        "Powiatu Przykładowskiego",
    ]
    assert rows(bodies, band, "010100") == [("starostwo", "czlonek_zarzadu")]


def test_the_mandate_is_no_post(bodies):
    assert rows(bodies, ["Radny Rady Gminy Testowo"], "010101") == []
    # The council meets at the starostwo: its address, not a workplace.
    band = ["StarostwoPowiatowewPrzykladowiePlacTestowy 1RadnyRadyPowiatu,"]
    assert rows(bodies, band, "010100") == []
    band = ["umowa zlecenia - Urząd Gminy Testowo"]
    assert rows(bodies, band, "010101") == []


@pytest.mark.parametrize(
    "band",
    [
        "emeryt, były dyrektor Szkoły Podstawowej nr 5 im. Jana Testowego",
        "emerytka - do 31.08.2023 dyrektor Szkoły Podstawowej nr 5 w Przykładowie",
        "Emerytowany nauczyciel Szkoły Podstawowej nr 5 w Przykładowie",
        "Urząd Gminy Testowo - Wójt w latach 2014-2024, obecnie radny",
        "Urząd Gminy Testowo - Wójt (obecnie radny)",
        "Urząd Gminy Testowo - inspektor, obecnie emeryt",
        "Urząd Gminy Testowo - inspektor (do 2023 r.)",
        "Urząd Gminy Testowo - inspektor do dnia 30.06.2024",
        "URZĄDGMINYTESTOWO-INSPEKTOR(do30czerwca2024roku)",
    ],
)
def test_a_post_the_line_says_is_over_gets_no_row(bodies, band):
    """„Radny, emeryt” is „Brak” on the card, and so is a post held once."""
    assert rows(bodies, [band], "010102") == []


def test_a_post_held_now_keeps_its_row(bodies):
    ug = [("ug_testowo", EMPLOYEE_ROLE)]
    assert rows(bodies, ["Urząd Gminy Testowo - inspektor od 2020 r."], "010101") == ug
    band = ["Urząd Gminy Testowo - inspektor do chwili obecnej"]
    assert rows(bodies, band, "010101") == ug
    assert rows(bodies, ["Urząd Gminy Testowo - obecnie inspektor"], "010101") == ug
    band = ["Urząd Gminy Testowo - inspektor", "emeryt"]
    assert rows(bodies, band, "010101") == ug
    # The form's own words after the title are another clause.
    band = ["Urząd Gminy Testowo - Wójt, składane co roku do dnia 30 kwietnia"]
    assert rows(bodies, band, "010101") == [("ug_testowo", "wojt")]
    # A line's dates are its own item's.
    band = [
        "Urząd Gminy Testowo - Wójt (do 30.04.2024)",
        "GOPS w Testowie - główny specjalista",
        "od 20.05.2024 do 31.07.2024 pełnomocnik zarządu",
        "Szkoła Podstawowa nr 5 w Przykładowie - dyrektor (od 01.09.2024)",
    ]
    assert rows(bodies, band, "010101") == [
        ("gops", EMPLOYEE_ROLE),
        ("sp5", "dyrektor"),
    ]


def test_an_unknown_title_after_na_stanowisku_takes_its_bodys_place(bodies):
    band = [
        "Zatrudniony w Urzędzie Miejskim w Przykładowie na stanowisku leśniczego,",
        "od 2025 r. w Testowej Fundacji na stanowisku głównego specjalisty",
    ]
    assert rows(bodies, band, "010102") == []


def test_a_name_without_its_town_needs_the_town_or_the_unit(bodies):
    band = ["ZAKLADGOSPODARKIKOMUNALNEJWTESTOWIE-KIEROWNIK"]
    assert rows(bodies, band, "090901") == [("zgk_testowo", "kierownik")]
    band = ["Zakład Gospodarki Komunalnej - kierownik"]
    assert rows(bodies, band, "010101") == [("zgk_testowo", "kierownik")]
    # Nothing places it: the three are as likely.
    assert rows(bodies, band, "090901") == []


@pytest.mark.parametrize(
    ("band", "unit", "found"),
    [
        (
            "Starostwo Powiatowe - Kierownik Referatu Szkoleń",
            "010100",
            [("starostwo", "kierownik")],
        ),
        (
            "Starostwo Powiatowe - Kierownik Referatu Szkolnictwa",
            "010100",
            [("starostwo", "kierownik")],
        ),
        (
            "Przedszkole Miejskie nr 1 - nauczyciel",
            "010102",
            [("kindergarten", "nauczyciel")],
        ),
        ("Przedszkole Miejskie nr 1 - nauczyciel", "090901", []),
        ("Szkoła Podstawowa - nauczyciel", "090901", []),
        (
            "Miejski Ośrodek Pomocy Społecznej - kierownik działu",
            "010102",
            [("mops", "kierownik")],
        ),
        (
            "Powiatowy Urząd Pracy - starszy referent",
            "010102",
            [("pup", EMPLOYEE_ROLE)],
        ),
    ],
)
def test_a_town_is_where_a_word_starts_and_not_inside_the_name(
    bodies, band, unit, found
):
    """A town's stem inside a word of the line, or of the name itself, places
    nothing: „Szkoleń” holds „kole”, „Przedszkole” too, „Podstawowa” „slaw”."""
    assert rows(bodies, [band], unit) == found


def test_a_town_found_elsewhere_is_no_match_for_the_declarants_unit(bodies):
    """The name is the declarant's unit's, the town beside it another's: the
    machine cannot tell which, so it suggests neither."""
    band = ["Zakład Gospodarki Komunalnej w Innowie - kierownik"]
    assert rows(bodies, band, "010101") == []
    # Where the unit has no such body, the town says which it is.
    assert rows(bodies, band, "090901") == [("zgk_innowo", "kierownik")]
    # And where the town is the unit's, the two agree, though a town far away
    # starts the same.
    band = ["Zakład Gospodarki Komunalnej w Testowie - kierownik"]
    assert rows(bodies, band, "010101") == [("zgk_testowo", "kierownik")]
    far = {
        "regon": regon(20_000_002),
        "name": "Zakład Gospodarki Komunalnej (Testowo Małe)",
        "kind": "zakłady usług komunalnych",
        "teryt": "0303013",
        "seat": "0303013",
        "ownership": "113",
    }
    assert rows(BodyIndex([*table(), far]), band, "010101") == [
        ("zgk_testowo", "kierownik")
    ]


def test_a_street_is_no_town(bodies):
    band = ["Zakład Gospodarki Komunalnej w Testowie, ul. Lipowa 7 - kierownik"]
    assert rows(bodies, band, "090901") == [("zgk_testowo", "kierownik")]
    band = ["Zakład Gospodarki Komunalnej, ul.Lipowo7 - kierownik"]
    assert rows(bodies, band, "090901") == []


def test_a_name_without_its_town_has_twelve_letters_or_more(bodies):
    """„Dom Kultury” is in every town."""
    assert rows(bodies, ["Dom Kultury w Testowie - dyrektor"], "010101") == []


def test_a_national_body_is_named_alone_but_not_by_its_branch(bodies):
    band = ["Ministerstwo Testowych Spraw - starszy specjalista"]
    assert rows(bodies, band, "090901") == [("ministry", EMPLOYEE_ROLE)]
    band = ["Ministerstwo Testowych Spraw, Kierownik Biura Powiatowego"]
    assert rows(bodies, band, "090901") == []


def test_a_shared_name_is_the_one_at_the_declarants_unit(bodies):
    band = ["SZKOŁA PODSTAWOWA NR 5-PEDAGOG"]
    assert rows(bodies, band, "010102") == [("sp5", EMPLOYEE_ROLE)]
    assert rows(bodies, band, "020201") == [("sp5_innowo", EMPLOYEE_ROLE)]
    # „nr 5” is not in „nr 51”.
    assert rows(bodies, ["Szkoła Podstawowa nr 51 - nauczyciel"], "010102") == []


def test_a_short_key_only_as_a_word(bodies):
    """„odr” is in „odrębny”, „pec” in „specjalista”."""
    band = ["ODR w Testowie - dyrektor"]
    assert rows(bodies, band, "010101") == [("odr", "dyrektor")]
    assert rows(bodies, ["Kodr w Testowie - dyrektor"], "010101") == []
    band = ["GOPS w Testowie - starszy pracownik socjalny"]
    assert rows(bodies, band, "010101") == [("gops", EMPLOYEE_ROLE)]


def test_stamps_and_footers_are_never_suggested(bodies):
    assert rows(bodies, ["www.signform.pl Sp. z o.o."], "010101") == []
    band = [
        "Urząd Miejski w Przykładowie - Inspektor",
        "Z up. STAROSTY",
        "mgr inż. Jan Testowy",
        "SEKRETARZ POWIATU",
    ]
    assert rows(bodies, band, "010102") == [("um_przykladowo", EMPLOYEE_ROLE)]
    band = ["Wpłynęło dnia 30.04.2025", "Urząd Gminy Testowo - Wójt"]
    assert rows(bodies, band, "010101") == [("ug_testowo", "wojt")]


@pytest.mark.parametrize(
    "stamp",
    [
        "URZĄD GMINY TESTOWO Data wpływu 29.04.2024",
        "Urząd Gminy Testowo, wpł. 29.04.2024 r.",
    ],
)
def test_a_receipt_stamp_names_no_employer(bodies, stamp):
    assert rows(bodies, [stamp, "nauczyciel"], "010101") == []


def test_private_employers_are_never_suggested(bodies):
    band = ["Niepubliczna Szkoła Podstawowa nr 5 im. Jana Testowego w Przykładowie"]
    assert rows(bodies, [*band, "nauczyciel"], "010102") == []
    assert rows(bodies, ["Szpital Testowy w Testowie - lekarz"], "010101") == []
    assert rows(bodies, ["Testowa Sp. z o.o. - prezes zarządu"], "010101") == []
    # A REGON without its check digit is never sent.
    assert rows(bodies, ["Biblioteka Publiczna w Testowie - kierownik"], "010101") == []


@pytest.mark.parametrize(
    "band",
    [
        ["Społeczna Szkoła Podstawowa nr 5 im. Jana Testowego w Przykładowie"],
        ["KATOLICKASZKOŁAPODSTAWOWANR5WPRZYKŁADOWIE"],
        ["STO Szkoła Podstawowa nr 5 w Przykładowie"],
        ["Stowarzyszenie Testowe Szkoła Podstawowa nr 5 w Przykładowie"],
        ["Fundacja Testowa Przedszkole Miejskie nr 1 w Przykładowie"],
        ["Katolickie", "Przedszkole Miejskie nr 1 w Przykładowie"],
    ],
)
def test_a_school_a_society_or_the_church_runs_is_not_the_public_one(bodies, band):
    """A non-public school takes the public one's name with a mark before it:
    „Społeczna” (STO's), „Katolicka”, a stowarzyszenie's or a fundacja's."""
    assert rows(bodies, [*band, "nauczyciel"], "010102") == []


def test_a_mark_elsewhere_on_the_line_makes_no_school_private(bodies):
    band = [
        "Społeczna Komisja Testowa, Szkoła Podstawowa nr 5 w Przykładowie - pedagog"
    ]
    assert rows(bodies, band, "010102") == [("sp5", EMPLOYEE_ROLE)]
    band = ["Fundacja Testowa / Przedszkole Miejskie nr 1 w Przykładowie - nauczyciel"]
    assert rows(bodies, band, "010102") == [("kindergarten", "nauczyciel")]
    # „Społecznej” in a name is that name's.
    band = ["Miejski Ośrodek Pomocy Społecznej w Przykładowie - kierownik"]
    assert rows(bodies, band, "010102") == [("mops", "kierownik")]


def test_a_school_secretary_is_no_sekretarz(bodies):
    """The chips' families leave out „sekretarz szkoły”, also as OCR reads it."""
    band = [
        "Sekretarz Szkoty w Szkole Podstawowej nr 5 im. Jana Testowego w Przykładowie"
    ]
    assert rows(bodies, band, "010102") == []


def test_an_executive_title_of_offices_only_is_held_at_one(bodies):
    """The roles file offers the doradca and the sekretarz at offices alone: a
    PUP's „doradca” is no wojewoda's adviser, a school's sekretarz no gmina's.
    A „doradca zawodowy” is staff, as the file reads it."""
    band = ["Powiatowy Urząd Pracy w Przykładowie - doradca zawodowy"]
    assert rows(bodies, band, "010102") == [("pup", EMPLOYEE_ROLE)]
    band = ["Powiatowy Urząd Pracy w Przykładowie - doradca"]
    assert rows(bodies, band, "010102") == []
    band = ["Szkoła Podstawowa nr 5 im. Jana Testowego w Przykładowie - sekretarz"]
    assert rows(bodies, band, "010102") == []
    band = ["Urząd Gminy Testowice - Sekretarz Gminy"]
    assert rows(bodies, band, "010103") == [("ug_testowice", "sekretarz")]


def test_the_declarants_unit_first_and_four_at_most(bodies):
    band = [
        "Powiatowy Urząd Pracy w Przykładowie - specjalista",
        "Ośrodek Doradztwa Rolniczego w Testowie - specjalista",
        "Szkoła Podstawowa nr 5 w Innowie - nauczyciel",
        "Urząd Gminy Testowice - Sekretarz Gminy",
        "GOPS w Testowie - kierownik",
        "Urząd Gminy Testowo - inspektor",
    ]
    found = rows(bodies, band, "010101")
    assert len(found) == MAX_SUGGESTIONS
    assert found == [
        ("pup", EMPLOYEE_ROLE),
        ("odr", EMPLOYEE_ROLE),
        ("gops", "kierownik"),
        ("ug_testowo", EMPLOYEE_ROLE),
    ]


def test_a_handwritten_band_gets_none(bodies):
    band = ["Urząd Miejski w Przykładowie - Naczelnik Wydziału Testów"]
    assert suggest(band, "010102", bodies, typed=False) == []


def test_suggestions_are_chips_of_the_file(bodies):
    chips = {chip.id for chip in read_roles().chips} - {OTHER_ROLE}
    band = [
        "Urząd Miejski w Przykładowie - Naczelnik Wydziału Testów",
        "Wicestarosta Przykładowski",
        "GOPS w Testowie - starszy pracownik socjalny",
    ]
    found = suggest(band, "010102", bodies, typed=True)
    assert found and all(row.role in chips for row in found)
    assert all(valid_regon(row.regon) for row in found)
