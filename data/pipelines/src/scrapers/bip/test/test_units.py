import pandas as pd
import pytest

from scrapers.bip.registry import RegistryEntry
from scrapers.bip.units import (
    catalogue_unit,
    land_powiat_of_city,
    office_kind,
    office_level,
    registry_unit,
    scope_of,
    terc_index,
    unit_seeds,
)

TERC = pd.DataFrame(
    [
        # WOJ, POW, GMI, RODZ, NAZWA
        ("14", "", "", "", "MAZOWIECKIE"),
        ("14", "03", "", "", "garwoliński"),
        ("14", "03", "01", "1", "Garwolin"),
        ("14", "03", "02", "2", "Garwolin"),
        ("14", "03", "05", "3", "Łaskarzew"),
        ("14", "03", "05", "4", "Łaskarzew"),
        ("14", "03", "05", "5", "Łaskarzew"),
        ("14", "65", "", "", "Warszawa"),
        ("14", "65", "01", "1", "Warszawa"),
        ("14", "65", "02", "8", "Bemowo"),
        ("18", "", "", "", "PODKARPACKIE"),
        ("18", "07", "", "", "krośnieński"),
        ("18", "07", "01", "2", "Chorkówka"),
        ("18", "61", "", "", "Krosno"),
        ("18", "61", "01", "1", "Krosno"),
        ("12", "", "", "", "MAŁOPOLSKIE"),
        ("12", "61", "", "", "Kraków"),
        ("12", "61", "01", "1", "Kraków"),
        ("12", "01", "", "", "bocheński"),
        ("12", "01", "02", "2", "Bochnia"),
        ("12", "01", "01", "1", "Bochnia"),
    ],
    columns=["WOJ", "POW", "GMI", "RODZ", "NAZWA"],
)


@pytest.fixture
def terc():
    return terc_index(TERC)


def entry(name, teryt, url):
    host = url.split("/")[2].removeprefix("www.")
    return RegistryEntry(
        entry_id="1", name=name, url=url, host=host, teryt=teryt, place="", email=""
    )


def test_office_level_and_kind():
    assert office_level("Urząd Gminy Garwolin") == "gmina"
    assert office_level("Urząd Miasta i Gminy Łaskarzew") == "gmina"
    assert office_level("Urząd Dzielnicy Bemowo m.st. Warszawy") == "gmina"
    assert office_level("Starostwo Powiatowe w Krośnie") == "powiat"
    assert (
        office_level("Urząd Marszałkowski Województwa Mazowieckiego") == "wojewodztwo"
    )
    assert office_level("Gminny Ośrodek Pomocy Społecznej") is None
    assert office_level("Szkoła Podstawowa nr 1") is None
    assert office_kind("Urząd Gminy Garwolin") == "2"
    assert office_kind("Urząd Miasta Garwolina") == "1"
    assert office_kind("Urząd Miasta i Gminy Łaskarzew") is None
    assert office_kind("Urząd Gminy i Miasta Łaskarzew") is None


def test_rural_office_standing_in_the_town_serves_the_rural_gmina(terc):
    office = entry("Urząd Gminy Garwolin", "1403011", "http://bip.garwolin-gmina.pl")
    assert registry_unit(office, terc) == "140302"
    town = entry("Urząd Miasta Garwolina", "1403011", "http://bip.garwolin.pl")
    assert registry_unit(town, terc) == "140301"
    mixed = entry(
        "Urząd Miasta i Gminy Łaskarzew", "1403054", "http://bip.laskarzew.pl"
    )
    assert registry_unit(mixed, terc) == "140305"


def test_starostwo_in_a_city_serves_the_land_powiat(terc):
    starostwo = entry(
        "Starostwo Powiatowe w Krośnie", "1861011", "http://bip.powiat.krosno.pl"
    )
    assert registry_unit(starostwo, terc) == "180700"


def test_land_powiat_seated_in_a_city_comes_from_the_table():
    terc = terc_index(
        pd.DataFrame(
            [
                ("06", "", "", "", "LUBELSKIE"),
                ("06", "08", "", "", "lubartowski"),
                ("06", "09", "", "", "lubelski"),
                ("06", "63", "", "", "Lublin"),
                ("10", "", "", "", "ŁÓDZKIE"),
                ("10", "06", "", "", "łódzki wschodni"),
                ("10", "07", "", "", "łowicki"),
                ("10", "61", "", "", "Łódź"),
                ("32", "", "", "", "ZACHODNIOPOMORSKIE"),
                ("32", "15", "", "", "szczecinecki"),
                ("32", "62", "", "", "Szczecin"),
            ],
            columns=["WOJ", "POW", "GMI", "RODZ", "NAZWA"],
        )
    )
    assert land_powiat_of_city(terc, "0663", "Lublin") == "0609"
    assert land_powiat_of_city(terc, "1061", "Łódź") == "1006"
    # powiat szczecinecki's starostwo is in Szczecinek; Szczecin has no land powiat
    assert land_powiat_of_city(terc, "3262", "Szczecin") is None


def test_gmina_miejska_is_the_town_and_a_rural_office_in_its_city_is_the_rural_gmina():
    terc = terc_index(
        pd.DataFrame(
            [
                ("28", "", "", "", "WARMIŃSKO-MAZURSKIE"),
                ("28", "06", "", "", "giżycki"),
                ("28", "06", "01", "1", "Giżycko"),
                ("28", "06", "02", "2", "Giżycko"),
                ("06", "", "", "", "LUBELSKIE"),
                ("06", "03", "", "", "chełmski"),
                ("06", "03", "05", "2", "Chełm"),
                ("06", "62", "", "", "Chełm"),
                ("06", "62", "01", "1", "Chełm"),
            ],
            columns=["WOJ", "POW", "GMI", "RODZ", "NAZWA"],
        )
    )
    assert office_kind("Gmina Miejska Giżycko") == "1"
    town = entry("Gmina Miejska Giżycko", "2806011", "http://bip.gizycko.pl")
    assert registry_unit(town, terc) == "280601"
    # Urząd Gminy Chełm stands in the city of Chełm (0662); the gmina is in chełmski
    rural = entry("Urząd Gminy Chełm", "0662011", "http://bip.gmina.chelm.pl")
    assert registry_unit(rural, terc) == "060305"
    row = catalogue_row(
        "urzędy miast i gmin",
        "Urząd Gminy Chełm",
        "LUBELSKIE",
        "Chełm",
        "Chełm",
        "www.x.pl",
    )
    assert catalogue_unit(row, terc) == "060305"


def test_dzielnica_without_an_office_falls_back_to_the_city(terc):
    seeds = unit_seeds(
        [entry("Urząd m.st. Warszawy", "1465011", "https://bip.warszawa.pl")],
        None,
        terc,
    )
    assert seeds["146502"].bip_urls == ["https://bip.warszawa.pl"]


def test_marshal_and_dzielnica_offices(terc):
    assert (
        registry_unit(
            entry(
                "Urząd Marszałkowski Województwa Mazowieckiego",
                "1465011",
                "http://bip.mazovia.pl",
            ),
            terc,
        )
        == "140000"
    )
    assert (
        registry_unit(
            entry("Urząd Dzielnicy Bemowo", "1465028", "http://bip.bemowo.waw.pl"), terc
        )
        == "146502"
    )
    assert (
        registry_unit(entry("Gminny Ośrodek Kultury", "1403022", "http://gok.pl"), terc)
        is None
    )


def catalogue_row(typ, name, woj, powiat, gmina, www):
    return {
        "Typ podmiotu": typ,
        "Nazwa podmiotu": name,
        "Województwo siedziby": woj,
        "Powiat siedziby": powiat,
        "Gmina siedziby": gmina,
        "Strona www": www,
    }


def test_catalogue_offices_resolve_to_units(terc):
    rural = catalogue_row(
        "urzędy miast i gmin",
        "Urząd Gminy Bochnia",
        "MAŁOPOLSKIE",
        "bocheński",
        "Bochnia",
        "www.gmina.bochnia.pl",
    )
    town = catalogue_row(
        "urzędy miast i gmin",
        "Urząd Miasta Bochnia",
        "MAŁOPOLSKIE",
        "bocheński",
        "Bochnia",
        "www.bochnia.pl",
    )
    city = catalogue_row(
        "urzędy miast i gmin",
        "Urząd Miasta Krakowa",
        "MAŁOPOLSKIE",
        "Kraków",
        "Kraków-Śródmieście",
        "www.krakow.pl",
    )
    starostwo = catalogue_row(
        "starostwa powiatowe",
        "Starostwo Powiatowe w Krośnie",
        "PODKARPACKIE",
        "Krosno",
        "Krosno",
        "www.powiat.krosno.pl",
    )
    marshal = catalogue_row(
        "urzędy marszałkowskie",
        "Urząd Marszałkowski",
        "MAZOWIECKIE",
        "Warszawa",
        "Warszawa",
        "www.mazovia.pl",
    )
    other = catalogue_row(
        "gminy", "GMINA BOCHNIA", "MAŁOPOLSKIE", "bocheński", "Bochnia", "www.x.pl"
    )
    assert catalogue_unit(rural, terc) == "120102"
    assert catalogue_unit(town, terc) == "120101"
    assert catalogue_unit(city, terc) == "126101"
    assert catalogue_unit(starostwo, terc) == "180700"
    assert catalogue_unit(marshal, terc) == "140000"
    assert catalogue_unit(other, terc) is None


def test_scopes_keep_a_unit_to_its_path_on_shared_hosts():
    shared = {"bip.malopolska.pl", "samorzad.gov.pl"}
    assert (
        scope_of("http://bip.malopolska.pl/ugtomice", shared)
        == "bip.malopolska.pl/ugtomice"
    )
    assert (
        scope_of("http://bip.malopolska.pl/ugtomice,m,1,start.html", shared)
        == "bip.malopolska.pl"
    )
    assert (
        scope_of("https://samorzad.gov.pl/web/gmina-x", shared)
        == "samorzad.gov.pl/web/gmina-x"
    )
    assert (
        scope_of("http://www.bip.garwolin.pl/bip/index.php", shared)
        == "bip.garwolin.pl"
    )


def test_unit_seeds_merge_both_lists(terc):
    entries = [
        entry("Urząd Gminy Garwolin", "1403011", "http://bip.malopolska.pl/uggarwolin"),
        entry(
            "Urząd Miasta Garwolina", "1403011", "http://bip.malopolska.pl/umgarwolin"
        ),
    ]
    catalogue = pd.DataFrame(
        [
            catalogue_row(
                "urzędy miast i gmin",
                "Urząd Gminy Garwolin",
                "MAZOWIECKIE",
                "garwoliński",
                "Garwolin",
                "www.garwolin-gmina.pl",
            ),
            catalogue_row(
                "urzędy miast i gmin",
                "Urząd Gminy Chorkówka",
                "PODKARPACKIE",
                "krośnieński",
                "Chorkówka",
                "www.chorkowka.pl",
            ),
        ]
    )
    seeds = unit_seeds(entries, catalogue, terc)
    assert seeds["140302"].bip_urls == ["http://bip.malopolska.pl/uggarwolin"]
    assert seeds["140302"].www_urls == ["http://www.garwolin-gmina.pl"]
    assert seeds["140302"].scopes == ["bip.malopolska.pl/uggarwolin"]
    assert seeds["140301"].scopes == ["bip.malopolska.pl/umgarwolin"]
    assert seeds["180701"].bip_urls == [] and seeds["180701"].www_urls == [
        "http://www.chorkowka.pl"
    ]


def test_unit_names_for_people(terc):
    assert terc.unit_name("140302") == "Garwolin (gmina wiejska)"
    assert terc.unit_name("140305") == "Łaskarzew (gmina miejsko-wiejska)"
    assert terc.unit_name("146502") == "Bemowo (dzielnica)"
    assert terc.unit_name("140300") == "powiat garwoliński"
    assert terc.unit_name("140000") == "województwo mazowieckie"
    assert terc.unit_name("999999") == ""
