"""Reading `udziałowcy` out of a company infobox, and saying who each entry is.

Every field here is a real one, from the 2026-08 dump - the shapes are the
point, and nobody would think to invent most of them.
"""

import pytest

from entities.company import WikiShareholder
from scrapers.wiki.shareholders import (
    WikiLinks,
    clean_krs,
    is_skarb_panstwa,
    normalize_teryt,
    normalize_title,
    parse_shareholders,
)


def entries(value: str) -> list[tuple[str, str | None, float | None]]:
    return [(s.name, s.article, s.share) for s in parse_shareholders(value)]


def test_energa():
    """A link with its stake on the next line, and the minority beside it."""
    value = (
        "[[Polski Koncern Naftowy Orlen|PKN ORLEN S.A.]]<br />(90,92%)"
        "<ref>{{Cytuj |tytuł=Akcjonariat |url= https://ir.energa.pl}}</ref>, "
        "mniejszościowi akcjonariusze indywidualni i instytucjonalni (9,08%)"
    )

    assert entries(value) == [
        ("PKN ORLEN S.A.", "Polski Koncern Naftowy Orlen", 90.92),
        ("mniejszościowi akcjonariusze indywidualni i instytucjonalni", None, 9.08),
    ]


def test_polimex_mostostal():
    """Commas between owners, one of them not linked."""
    value = (
        "[[Enea|ENEA SA]], [[Energa|ENERGA SA]], "
        "[[PGE Polska Grupa Energetyczna|PGE SA]], "
        "PGNiG Technologie Spółka Akcyjna, [[Bank Polska Kasa Opieki]]"
        "<ref>{{Cytuj stronę | url = http://www.polimex-mostostal.pl}}</ref>"
    )

    assert entries(value) == [
        ("ENEA SA", "Enea", None),
        ("ENERGA SA", "Energa", None),
        ("PGE SA", "PGE Polska Grupa Energetyczna", None),
        ("PGNiG Technologie Spółka Akcyjna", None, None),
        ("Bank Polska Kasa Opieki", "Bank Polska Kasa Opieki", None),
    ]


def test_the_stake_before_the_name():
    value = (
        "94,17% – Urząd Marszałkowski Województwa Pomorskiego<br>\n"
        '5,83% – Gmina Miasta Gdańska<ref name="bip" />'
    )

    assert entries(value) == [
        ("Urząd Marszałkowski Województwa Pomorskiego", None, 94.17),
        ("Gmina Miasta Gdańska", None, 5.83),
    ]


def test_a_stake_in_words_after_a_dash():
    value = (
        "[[Agencja Mienia Wojskowego|AMW]] – 30,44 proc.<br>"
        "[[Województwo mazowieckie|Sam. woj.]] – 38,44 proc."
    )

    assert entries(value) == [
        ("AMW", "Agencja Mienia Wojskowego", 30.44),
        ("Sam. woj.", "Województwo mazowieckie", 38.44),
    ]


def test_a_stake_on_a_line_of_its_own_belongs_to_the_owner_above():
    value = (
        "[[Skarb Państwa]]<br><small>(83,46%)</small>{{r|sf-2023}}<br>"
        "[[Polskie Koleje Państwowe|PKP S.A.]]<br><small>(16,54%)</small>"
    )

    assert entries(value) == [
        ("Skarb Państwa", "Skarb Państwa", 83.46),
        ("PKP S.A.", "Polskie Koleje Państwowe", 16.54),
    ]


def test_a_comma_inside_parentheses_ends_nothing():
    value = "[[Zygmunt Solorz-Żak]] (pośrednio, 65,96%)<br />Pozostali (16,06%)"

    assert entries(value) == [
        ("Zygmunt Solorz-Żak (pośrednio)", "Zygmunt Solorz-Żak", 65.96),
        ("Pozostali", None, 16.06),
    ]


def test_a_conjunction_splits_two_links_and_nothing_else():
    assert entries(
        "[[Katowice| Miasto Katowice]] i [[Górnośląsko-Zagłębiowska Metropolia|GZM]]"
    ) == [
        ("Miasto Katowice", "Katowice", None),
        ("GZM", "Górnośląsko-Zagłębiowska Metropolia", None),
    ]
    assert entries("Miasto i Gmina Grodków") == [("Miasto i Gmina Grodków", None, None)]


def test_the_words_around_a_link_are_part_of_the_name():
    assert entries("Gmina Miasta [[Toruń]]") == [("Gmina Miasta Toruń", "Toruń", None)]


def test_a_count_of_shares_and_an_amount_of_capital_are_not_names():
    value = (
        "WASKO SA 459 000 akcji (85%)<br />Skarb Państwa 81&nbsp;000 akcji (15%)"
        "<br />Autogiełda Majski – 6,7 mln zł"
    )

    assert entries(value) == [
        ("WASKO SA", None, 85.0),
        ("Skarb Państwa", None, 15.0),
        ("Autogiełda Majski", None, None),
    ]


def test_an_owner_with_no_polish_article_yet():
    value = "50,14% – {{link-interwiki |Ferrovial |Q=Q1408037}}\n9,40% – Allianz OFE"

    assert entries(value) == [("Ferrovial", None, 50.14), ("Allianz OFE", None, 9.4)]


def test_a_legal_form_split_off_by_a_comma_goes_back():
    assert entries("AeroRegional Paraguaya, S.A.") == [
        ("AeroRegional Paraguaya, S.A.", None, None)
    ]


def test_an_entry_built_from_two_links_is_neither_of_them():
    """The Norwegian treasury, written as Poland's plus a country."""
    [norway] = parse_shareholders("[[skarb państwa]] [[Norwegia|Norwegii]]")

    assert norway.name == "skarb państwa Norwegii"
    assert norway.article is None


@pytest.mark.parametrize(
    "name,expected",
    [
        ("Skarb Państwa", True),
        ("Skarb państwa", True),
        ("SKARB PAŃSTWA RP", True),
        ("Skarb Państwa (Minister Aktywów Państwowych)", True),
        ("skarb państwa Estonii", False),
        ("skarb państwa Norwegii", False),
        ("Ministerstwo Skarbu Państwa", False),
    ],
)
def test_the_treasury_is_ours_only_by_its_whole_name(name, expected):
    assert is_skarb_panstwa(name) is expected


def test_titles_resolve_the_way_mediawiki_does():
    assert normalize_title("skarb_państwa") == "Skarb państwa"
    assert normalize_title("Porty lotnicze w Polsce#Przedsiębiorstwo") == (
        "Porty lotnicze w Polsce"
    )
    assert normalize_title("Plik:Logo.svg") is None
    assert normalize_title(":en:Ferrovial") is None


def test_krs_numbers_come_out_padded():
    assert clean_krs("0000271591") == "0000271591"
    assert clean_krs("271591") == "0000271591"
    assert clean_krs("KRS 0000271591") == "0000271591"
    assert clean_krs("") is None
    assert clean_krs("2006") is None
    assert clean_krs(None) is None


def test_a_town_in_a_mixed_gmina_is_the_gmina():
    """Grodkow's own code is the town half; its companies are the gmina's."""
    assert normalize_teryt("1601034") == "1601033"
    assert normalize_teryt("3062011") == "3062011"
    assert normalize_teryt("1601") == "1601"
    assert normalize_teryt("14") == "14"
    # A Warsaw dzielnica owns nothing.
    assert normalize_teryt("1465038") is None


@pytest.fixture
def links():
    return WikiLinks(
        redirects={
            "Polski Koncern Naftowy Orlen": "Orlen",
            "PKP": "Polskie Koleje Państwowe",
            "Skarb państwa": "Skarb Państwa",
        },
        krs={
            "Orlen": "0000028860",
            "Polskie Koleje Państwowe": "0000019193",
            "Agencja Rozwoju Przemysłu": "0000037957",
            "Energa": "0000271591",
        },
        teryt={"Konin": "3062011", "Województwo pomorskie": "22"},
    )


def test_a_link_through_a_redirect_reaches_the_krs_number(links):
    owner = links.resolve(
        WikiShareholder("PKN ORLEN S.A.", "Polski Koncern Naftowy Orlen", 90.92)
    )

    assert owner.krs == "0000028860"
    assert owner.share == 90.92


def test_a_link_to_a_town_reaches_its_unit(links):
    assert links.resolve(WikiShareholder("Miasto Konin", "Konin")).teryt == "3062011"


def test_a_name_with_no_link_is_tried_as_a_title(links):
    """With its legal form off, and in another case if nothing else fits."""
    assert links.resolve(WikiShareholder("PKP S.A.")).krs == "0000019193"
    assert (
        links.resolve(WikiShareholder("Agencja Rozwoju Przemysłu S.A.")).krs
        == "0000037957"
    )
    assert links.resolve(WikiShareholder("ORLEN S.A.")).krs == "0000028860"
    assert links.resolve(WikiShareholder("Województwo Pomorskie")).teryt == "22"


def test_the_treasury_is_resolved_by_name_not_by_link(links):
    ours = links.resolve(WikiShareholder("Skarb Państwa", "Skarb państwa", 100.0))
    estonia = links.resolve(WikiShareholder("skarb państwa Estonii", "Skarb państwa"))

    assert ours.skarb_panstwa is True
    assert estonia.skarb_panstwa is False
    assert (estonia.krs, estonia.teryt) == (None, None)


def test_a_company_does_not_own_itself(links):
    owner = links.resolve(WikiShareholder("Energa", "Energa"), own_krs="0000271591")

    assert owner.krs is None


def test_a_person_stays_a_name(links):
    owner = links.resolve(WikiShareholder("Zygmunt Solorz-Żak", "Zygmunt Solorz-Żak"))

    assert (owner.krs, owner.teryt, owner.skarb_panstwa) == (None, None, False)
