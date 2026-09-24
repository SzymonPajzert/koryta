import pandas as pd
from pandas import DataFrame

from entities.company import KRS
from entities.company import Company as KrsCompany
from entities.company_categories import SPZOZ
from scrapers.krs.data import REGON_PUBLIC_OWNERSHIP
from scrapers.krs.list import (
    CompaniesKRS,
    company_from_api_krs,
    company_from_rejestrio,
    get_teryt,
    names_an_owner,
    normalize_city,
    parse_activity_from_api_krs,
)
from scrapers.map.jst import JstIndex


class StubTeryt:
    """Just the one method `company_from_api_krs` reaches for.

    The real `Teryt` is a `Pipeline` that downloads the TERC register, and
    what these tests are about is which fields an odpis yields - the seat is
    settled by `test_teryt.py` and by the `get_teryt` cases below.
    """

    def parse_siedziba(self, wojewodztwo: str, powiat: str, gmina: str) -> str:
        return ""


NO_TERYT = StubTeryt()

# A random entry from api-krs data for a given company
TEST_DZIAL3 = {
    "przedmiotDzialalnosci": {
        "przedmiotPrzewazajacejDzialalnosci": [
            {
                "opis": "WYNAJEM I ZARZĄDZANIE NIERUCHOMOŚCIAMI WŁASNYMI LUB DZIERŻAWIONYMI",  # noqa: E501
                "kodDzial": "68",
                "kodKlasa": "20",
                "kodPodklasa": "Z",
            }
        ],
        "przedmiotPozostalejDzialalnosci": [
            {
                "opis": "ZARZĄDZANIE NIERUCHOMOŚCIAMI WYKONYWANE NA ZLECENIE",
                "kodDzial": "68",
                "kodKlasa": "32",
                "kodPodklasa": "Z",
            },
            {
                "opis": "KUPNO I SPRZEDAŻ NIERUCHOMOŚCI NA WŁASNY RACHUNEK",
                "kodDzial": "68",
                "kodKlasa": "10",
                "kodPodklasa": "Z",
            },
            {
                "opis": "ROZBIÓRKA I BURZENIE OBIEKTÓW BUDOWLANYCH",
                "kodDzial": "43",
                "kodKlasa": "11",
                "kodPodklasa": "Z",
            },
            {
                "opis": "PRZYGOTOWANIE TERENU POD BUDOWĘ",
                "kodDzial": "43",
                "kodKlasa": "12",
                "kodPodklasa": "Z",
            },
            {
                "opis": "ROBOTY BUDOWLANE ZWIĄZANE ZE WZNOSZENIEM BUDYNKÓW MIESZKALNYCH I NIEMIESZKALNYCH",  # noqa: E501
                "kodDzial": "41",
                "kodKlasa": "20",
                "kodPodklasa": "Z",
            },
            {
                "opis": "WYKONYWANIE INSTALACJI ELEKTRYCZNYCH",
                "kodDzial": "43",
                "kodKlasa": "21",
                "kodPodklasa": "Z",
            },
            {
                "opis": "WYKONYWANIE INSTALACJI WODNO-KANALIZACYJNYCH, CIEPLNYCH, GAZOWYCH I KLIMATYZACYJNYCH",  # noqa: E501
                "kodDzial": "43",
                "kodKlasa": "22",
                "kodPodklasa": "Z",
            },
            {
                "opis": "WYKONYWANIE POZOSTAŁYCH INSTALACJI BUDOWLANYCH",
                "kodDzial": "43",
                "kodKlasa": "29",
                "kodPodklasa": "Z",
            },
            {
                "opis": "POZOSTAŁE SPECJALISTYCZNE ROBOTY BUDOWLANE, GDZIE INDZIEJ NIESKLASYFIKOWANE",  # noqa: E501
                "kodDzial": "43",
                "kodKlasa": "99",
                "kodPodklasa": "Z",
            },
        ],
    },
    "wzmiankiOZlozonychDokumentach": {
        "wzmiankaOZlozeniuRocznegoSprawozdaniaFinansowego": [
            {"dataZlozenia": "01.10.2002", "zaOkresOdDo": "01.01.2001 DO 31.12.2001"},
            {"dataZlozenia": "11.07.2003", "zaOkresOdDo": "01.01.2002 DO 31.12.2002"},
            {"dataZlozenia": "10.08.2004", "zaOkresOdDo": "01.01.2003 DO 31.12.2003"},
            {
                "dataZlozenia": "29.04.2005",
                "zaOkresOdDo": "01.01.2004R. DO 31.12.2004R.",
            },
            {
                "dataZlozenia": "12.07.2006",
                "zaOkresOdDo": "01.01.2005 R. -31.12.2005 R.",
            },
            {
                "dataZlozenia": "28.06.2007",
                "zaOkresOdDo": "01.01.2006R. - 31.12.2006R.",
            },
            {"dataZlozenia": "15.09.2008", "zaOkresOdDo": "01.01.2007 - 31.12.2007"},
            {"dataZlozenia": "02.07.2009", "zaOkresOdDo": "01.01.2008-31.12.2008"},
            {"dataZlozenia": "25.06.2010", "zaOkresOdDo": "01.01.2009 - 31.12.2009"},
            {"dataZlozenia": "27.06.2011", "zaOkresOdDo": "01.01.2010 - 31.12.2010"},
            {"dataZlozenia": "29.06.2012", "zaOkresOdDo": "01.01.2011 - 31.12.2011"},
            {"dataZlozenia": "24.06.2013", "zaOkresOdDo": "01.01.2012 - 31.12.2012"},
            {
                "dataZlozenia": "09.07.2014",
                "zaOkresOdDo": "OD 01.01.2013 DO 31.12.2013",
            },
            {
                "dataZlozenia": "05.07.2015",
                "zaOkresOdDo": "OD 01.01.2014 DO 31.12.2014",
            },
            {
                "dataZlozenia": "29.06.2016",
                "zaOkresOdDo": "OD 01.01.2015 DO 31.12.2015",
            },
            {
                "dataZlozenia": "03.07.2017",
                "zaOkresOdDo": "OD 01.01.2016 DO 31.12.2016",
            },
            {
                "dataZlozenia": "05.07.2018",
                "zaOkresOdDo": "OD 01.01.2017 DO 31.12.2017",
            },
            {
                "dataZlozenia": "09.07.2019",
                "zaOkresOdDo": "OD 01.01.2018 DO 31.12.2018",
            },
            {
                "dataZlozenia": "21.07.2020",
                "zaOkresOdDo": "OD 01.01.2019 DO 31.12.2019",
            },
            {
                "dataZlozenia": "08.10.2021",
                "zaOkresOdDo": "OD 01.01.2020 DO 31.12.2020",
            },
            {
                "dataZlozenia": "27.09.2022",
                "zaOkresOdDo": "OD 01.01.2021 DO 31.12.2021",
            },
            {
                "dataZlozenia": "20.06.2023",
                "zaOkresOdDo": "OD 01.01.2022 DO 31.12.2022",
            },
            {
                "dataZlozenia": "04.07.2024",
                "zaOkresOdDo": "OD 01.01.2023 DO 31.12.2023",
            },
            {
                "dataZlozenia": "18.06.2025",
                "zaOkresOdDo": "OD 01.01.2024 DO 31.12.2024",
            },
        ],
        "wzmiankaOZlozeniuOpiniiBieglegoRewidentaSprawozdaniaZBadania": [
            {"zaOkresOdDo": "01.01.2002 DO 31.12.2002"},
            {"zaOkresOdDo": "01.01.2004R. DO 31.12.2004R."},
            {"zaOkresOdDo": "01.01.2005 R. -31.12.2005 R."},
            {"zaOkresOdDo": "01.01.2007 - 31.12.2007"},
            {"zaOkresOdDo": "01.01.2008-31.12.2008"},
        ],
        "wzmiankaOZlozeniuUchwalyPostanowieniaOZatwierdzeniuRocznegoSprawozdaniaFinansowego": [  # noqa: E501
            {"zaOkresOdDo": "01.01.2001 DO 31.12.2001"},
            {"zaOkresOdDo": "01.01.2002 DO 31.12.2002"},
            {"zaOkresOdDo": "01.01.2003 DO 31.12.2003"},
            {"zaOkresOdDo": "01.01.2004R. DO 31.12.2004R."},
            {"zaOkresOdDo": "01.01.2005 R. -31.12.2005 R."},
            {"zaOkresOdDo": "01.01.2006R. - 31.12.2006R."},
            {"zaOkresOdDo": "01.01.2007 - 31.12.2007"},
            {"zaOkresOdDo": "01.01.2008-31.12.2008"},
            {"zaOkresOdDo": "01.01.2009 - 31.12.2009"},
            {"zaOkresOdDo": "01.01.2010 - 31.12.2010"},
            {"zaOkresOdDo": "01.01.2011 - 31.12.2011"},
            {"zaOkresOdDo": "01.01.2012 - 31.12.2012"},
            {"zaOkresOdDo": "OD 01.01.2013 DO 31.12.2013"},
            {"zaOkresOdDo": "OD 01.01.2014 DO 31.12.2014"},
            {"zaOkresOdDo": "OD 01.01.2015 DO 31.12.2015"},
            {"zaOkresOdDo": "OD 01.01.2016 DO 31.12.2016"},
            {"zaOkresOdDo": "OD 01.01.2017 DO 31.12.2017"},
            {"zaOkresOdDo": "OD 01.01.2018 DO 31.12.2018"},
            {"zaOkresOdDo": "OD 01.01.2019 DO 31.12.2019"},
            {"zaOkresOdDo": "OD 01.01.2020 DO 31.12.2020"},
            {"zaOkresOdDo": "OD 01.01.2021 DO 31.12.2021"},
            {"zaOkresOdDo": "OD 01.01.2022 DO 31.12.2022"},
            {"zaOkresOdDo": "OD 01.01.2023 DO 31.12.2023"},
            {"zaOkresOdDo": "OD 01.01.2024 DO 31.12.2024"},
        ],
        "wzmiankaOZlozeniuSprawozdaniaZDzialalnosci": [
            {"zaOkresOdDo": "01.01.2001 DO 31.12.2001"},
            {"zaOkresOdDo": "01.01.2002 DO 31.12.2002"},
            {"zaOkresOdDo": "01.01.2003 DO 31.12.2003"},
            {"zaOkresOdDo": "01.01.2004R. DO 31.12.2004R."},
            {"zaOkresOdDo": "01.01.2005 R. -31.12.2005 R."},
            {"zaOkresOdDo": "01.01.2006R. - 31.12.2006R."},
            {"zaOkresOdDo": "01.01.2007 - 31.12.2007"},
            {"zaOkresOdDo": "01.01.2008-31.12.2008"},
            {"zaOkresOdDo": "01.01.2009 - 31.12.2009"},
            {"zaOkresOdDo": "01.01.2010 - 31.12.2010"},
            {"zaOkresOdDo": "01.01.2011 - 31.12.2011"},
            {"zaOkresOdDo": "01.01.2012 - 31.12.2012"},
            {"zaOkresOdDo": "OD 01.01.2013 DO 31.12.2013"},
            {"zaOkresOdDo": "OD 01.01.2014 DO 31.12.2014"},
            {"zaOkresOdDo": "OD 01.01.2015 DO 31.12.2015"},
            {"zaOkresOdDo": "OD 01.01.2016 DO 31.12.2016"},
            {"zaOkresOdDo": "OD 01.01.2017 DO 31.12.2017"},
            {"zaOkresOdDo": "OD 01.01.2018 DO 31.12.2018"},
            {"zaOkresOdDo": "OD 01.01.2019 DO 31.12.2019"},
            {"zaOkresOdDo": "OD 01.01.2020 DO 31.12.2020"},
            {"zaOkresOdDo": "OD 01.01.2021 DO 31.12.2021"},
            {"zaOkresOdDo": "OD 01.01.2022 DO 31.12.2022"},
            {"zaOkresOdDo": "OD 01.01.2023 DO 31.12.2023"},
            {"zaOkresOdDo": "OD 01.01.2024 DO 31.12.2024"},
        ],
    },
    "informacjaODniuKonczacymRokObrotowy": {
        "dzienKonczacyPierwszyRokObrotowy": "31.12.2001"
    },
}

TEST_DZIAL3_PARTIAL = {
    "przedmiotDzialalnosci": {
        "przedmiotPrzewazajacejDzialalnosci": [
            {
                "opis": "WYNAJEM I ZARZĄDZANIE NIERUCHOMOŚCIAMI WŁASNYMI LUB DZIERŻAWIONYMI",  # noqa: E501
                "kodDzial": "68",
                "kodKlasa": "20",
                "kodPodklasa": "Z",
            }
        ],
    }
}

# KRS: 0000000142
# UNIWERSYTECKI SZPITAL KLINICZNY W RADOMSKU
TEST_DZIAL3_STOWARZYSZENIE = {
    "celDzialaniaOrganizacji": {
        "celDzialania": "CELEM FUNKCJONOWANIA SZPITALA JEST ZACHOWANIE."
    }
}


def test_parse_activity_from_api_krs_company():
    activities = parse_activity_from_api_krs(TEST_DZIAL3)
    assert len(activities) == 10
    assert "68.20.Z" == activities[0]
    assert "68.32.Z" in activities


def test_parse_activity_from_api_krs_partial():
    activities = parse_activity_from_api_krs(TEST_DZIAL3_PARTIAL)
    assert len(activities) == 1


def test_parse_activity_from_api_krs_organization():
    activities = parse_activity_from_api_krs(TEST_DZIAL3_STOWARZYSZENIE)
    assert len(activities) == 0


#: A slice of the GeoNames postal code table, in the shape `PostalCodes`
#: leaves it: city lowercased, TERYT at gmina level.
POSTAL_CODES = pd.DataFrame(
    [
        # Warszawa spans hundreds of codes and one gmina.
        {"postal_code": "02-412", "city": "warszawa", "teryt": "146501"},
        {"postal_code": "04-128", "city": "warszawa", "teryt": "146501"},
        # Kudowa-Zdrój shares 57-350 with three hamlets in two other gminy, so
        # no code is dominant and only the spelling can settle it.
        {"postal_code": "57-350", "city": "kudowa-zdrój", "teryt": "020803"},
        {"postal_code": "57-350", "city": "karłów", "teryt": "020812"},
        {"postal_code": "57-350", "city": "pasterka", "teryt": "020812"},
        {"postal_code": "57-350", "city": "jerzykowice wielkie", "teryt": "020809"},
        # Krynica-Zdrój's code covers only its own gmina, whatever the row.
        {"postal_code": "33-380", "city": "krynica-zdrój", "teryt": "121007"},
        {"postal_code": "33-380", "city": "berest", "teryt": "121007"},
        {"postal_code": "33-380", "city": "czyrna", "teryt": "121007"},
        # Świdnik is five towns of that name in five gminy.
        {"postal_code": "21-047", "city": "świdnik", "teryt": "061701"},
        {"postal_code": "58-410", "city": "świdnik", "teryt": "020704"},
        {"postal_code": "34-606", "city": "świdnik", "teryt": "120708"},
    ]
)


def test_normalize_city_strips_the_registers_city_prefixes():
    assert normalize_city("M. NOWY SĄCZ") == "nowy sącz"
    assert normalize_city("M.ST. WARSZAWA") == "warszawa"
    assert normalize_city("Miasto Stołeczne Warszawa") == "warszawa"
    # Not a prefix: dropping a bare "m" would make this "iechów".
    assert normalize_city("MIECHÓW") == "miechów"


def test_normalize_city_settles_the_hyphen():
    assert normalize_city("Bielsko- Biała") == "bielsko-biała"
    assert normalize_city("KĘDZIERZYN - KOŹLE") == "kędzierzyn-koźle"
    assert normalize_city("Kudowa Zdrój") == "kudowa-zdrój"
    assert normalize_city("jastrzębie zdrój") == "jastrzębie-zdrój"


def test_get_teryt_prefers_the_exact_row():
    assert get_teryt(POSTAL_CODES, "warszawa", "02-412") == "146501"
    # Even against a `fallback`, which is coarser here.
    assert get_teryt(POSTAL_CODES, "warszawa", "02-412", fallback="1465") == "146501"


def test_get_teryt_matches_on_the_normalized_name():
    assert get_teryt(POSTAL_CODES, "KUDOWA ZDRÓJ", "57-350") == "020803"


def test_get_teryt_falls_back_to_the_registered_seat():
    # Świdnik with no postal code is unresolvable from the table alone: five
    # towns of that name, none of them dominant.
    assert get_teryt(POSTAL_CODES, "świdnik", None) == ""
    assert get_teryt(POSTAL_CODES, "świdnik", None, fallback="061701") == "061701"


def test_get_teryt_takes_a_coarse_seat_only_once_the_table_is_out():
    """An entry that named a powiat TERYT has never had, or none at all.

    The register contradicted itself, so it loses to the table wherever the
    table has an answer - and is still worth returning where it does not.
    """
    # The table places Kudowa-Zdrój exactly; a bare województwo does not.
    assert get_teryt(POSTAL_CODES, "kudowa-zdrój", "99-999", fallback="02") == "020803"
    assert get_teryt(POSTAL_CODES, "gdzieś", "99-999", fallback="02") == "02"


def test_get_teryt_falls_back_to_the_postal_code_alone():
    # "Warszawa-Włochy" is a district: no table names it, every table has
    # its postal code.
    assert get_teryt(POSTAL_CODES, "warszawa-włochy", "04-128") == "146501"
    # A code all of whose rows agree resolves even where the name does not.
    assert get_teryt(POSTAL_CODES, "krynica", "33-380") == "121007"


def test_get_teryt_falls_back_to_the_city_alone():
    assert get_teryt(POSTAL_CODES, "kudowa-zdrój", "99-999") == "020803"


def test_get_teryt_gives_up_on_an_address_it_cannot_place():
    assert get_teryt(POSTAL_CODES, "", "") == ""


def test_company_from_rejestrio_reads_the_postal_code_it_is_given():
    """rejestr.io names the field `kod`, and it is the only key on the table."""
    company = company_from_rejestrio(
        {
            "numery": {"krs": "0000000001"},
            "nazwy": {"skrocona": "SPÓŁKA"},
            "adres": {"miejscowosc": "Świdnik", "kod": "21-047"},
        },
        POSTAL_CODES,
    )
    assert company.teryt_code == "061701"


# ─── what a hospital is told apart by ──────────────────────
#
# A publicly owned hospital is either an SPZOZ, whose rada społeczna sits for
# nothing, or a spółka, whose rada nadzorcza is as a rule paid. Neither the
# form nor the organ used to leave this function, so on the site the two were
# the same thing.

# No postal codes: this exercises the fields the odpis carries, and get_teryt
# answers "" for a town it cannot place, which is not what is under test.
NO_POSTAL_CODES = DataFrame({"city": [], "postal_code": [], "teryt": []})


# 86.10 Działalność szpitali - the code the site categorises hospitals by, and
# the one an SPZOZ never has, because dzial3 exists only in RejP.
HOSPITAL_PKD = {
    "przedmiotDzialalnosci": {
        "przedmiotPrzewazajacejDzialalnosci": [
            {"kodDzial": "86", "kodKlasa": "10", "kodPodklasa": "Z"}
        ]
    }
}


def odpis(rejestr="RejS", forma=SPZOZ, dzial2=None, dzial3=None):
    dane_podmiotu = {"nazwa": "SZPITAL POWIATOWY"}
    if forma is not None:
        dane_podmiotu["formaPrawna"] = forma
    return {
        "odpis": {
            "naglowekA": {"numerKRS": "0000000110", "rejestr": rejestr},
            "dane": {
                "dzial1": {"danePodmiotu": dane_podmiotu},
                "dzial2": dzial2 or {},
                "dzial3": dzial3 or {},
            },
        }
    }


def organ(nazwa):
    return {"organNadzoru": [{"nazwa": nazwa, "sklad": []}]}


def test_an_spzoz_carries_its_legal_form_because_it_has_no_pkd():
    """The only thing an SPZOZ can be categorised as a hospital by.

    All 1,192 of them are in the associations register, and dzial3 - where the
    PKD codes the site reads live - is only parsed for RejP.
    """
    company = company_from_api_krs(
        NO_POSTAL_CODES, NO_TERYT, odpis(dzial2=organ("RADA SPOŁECZNA"))
    )

    assert company is not None
    assert company.activity == []
    assert company.form == SPZOZ
    assert company.supervisory_organ == "rada_spoleczna"


def test_a_hospital_spolka_carries_the_board_that_gets_paid():
    company = company_from_api_krs(
        NO_POSTAL_CODES,
        NO_TERYT,
        odpis(
            rejestr="RejP",
            forma="SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ",
            dzial2=organ("RADA NADZORCZA"),
            dzial3=HOSPITAL_PKD,
        ),
    )

    assert company is not None
    assert company.supervisory_organ == "rada_nadzorcza"
    assert company.activity == ["86.10.Z"]


def test_a_company_with_no_organ_registered_says_brak():
    """Which is the usual case for an SPZOZ and says nothing about pay."""
    company = company_from_api_krs(NO_POSTAL_CODES, NO_TERYT, odpis())

    assert company is not None
    assert company.supervisory_organ == "brak"


def test_a_company_with_no_forma_prawna_carries_none():
    company = company_from_api_krs(NO_POSTAL_CODES, NO_TERYT, odpis(forma=None))

    assert company is not None
    assert company.form is None


def test_a_rejestrio_blob_read_first_does_not_pin_the_fields_empty():
    """rejestr.io serves neither field, and a merge keeps the first answer."""
    pipeline = CompaniesKRS()
    pipeline.add_company(KrsCompany(krs="0000000110", name="SZPITAL POWIATOWY"))

    pipeline.add_company(
        company_from_api_krs(
            NO_POSTAL_CODES, NO_TERYT, odpis(dzial2=organ("RADA SPOŁECZNA"))
        )
    )

    merged = pipeline.companies["0000000110"]
    assert merged.form == SPZOZ
    assert merged.supervisory_organ == "rada_spoleczna"


def test_a_later_blob_without_them_does_not_clear_them():
    pipeline = CompaniesKRS()
    pipeline.add_company(
        company_from_api_krs(
            NO_POSTAL_CODES, NO_TERYT, odpis(dzial2=organ("RADA SPOŁECZNA"))
        )
    )

    pipeline.add_company(KrsCompany(krs="0000000110", city="racibórz"))

    merged = pipeline.companies["0000000110"]
    assert merged.form == SPZOZ
    assert merged.supervisory_organ == "rada_spoleczna"


# ─── when the register says nothing about the owner ────────
#
# KRS publishes the shareholders of a spolka akcyjna only when there is exactly
# one, so for most SAs dzial 1 has no owner in it at all, and `is_public`, which
# is read off that section, came out false. REGON's ownership code is the only
# other machine-readable answer, and it is allowed to speak only there.

SA = "SPÓŁKA AKCYJNA"
SPZOO = "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ"

# Rows as the register writes them. A person arrives masked.
A_PERSON = {
    "nazwisko": {"nazwiskoICzlon": "W****"},
    "imiona": {"imie": "Z****"},
    "identyfikator": {"pesel": "5**********"},
    "posiadaneUdzialy": "7596 UDZIAŁÓW O ŁĄCZNEJ WYSOKOŚCI 379800,00 ZŁ",
}
GPW = {
    "nazwa": "GÓRNOŚLĄSKIE PRZEDSIĘBIORSTWO WODOCIĄGÓW SPÓŁKA AKCYJNA",
    "krs": {"krs": "0000247533"},
}
GZM = {"nazwa": '"GÓRNOŚLĄSKO - ZAGŁĘBIOWSKA METROPOLIA"', "krs": {"krs": "0000000000"}}
BIELSKO = {"nazwa": "GMINA BIELSKO-BIAŁA", "krs": {"krs": "0000000000"}}


def owned(krs, forma, wspolnicy=(), akcjonariusz=()):
    """An odpis of `krs` whose dzial 1 names these owners and no others."""
    dzial1 = {"danePodmiotu": {"nazwa": f"SPÓŁKA {krs}", "formaPrawna": forma}}
    if wspolnicy:
        dzial1["wspolnicySpzoo"] = list(wspolnicy)
    if akcjonariusz:
        dzial1["jedynyAkcjonariusz"] = list(akcjonariusz)
    return {
        "odpis": {
            "naglowekA": {"numerKRS": krs, "rejestr": "RejP"},
            "dane": {"dzial1": dzial1, "dzial3": HOSPITAL_PKD},
        }
    }


def bielsko_biala() -> JstIndex:
    rows = [
        ("24", None, None, None, "ŚLĄSKIE"),
        ("24", "61", None, None, "Bielsko-Biała"),
        ("24", "61", "01", "1", "Bielsko-Biała"),
    ]
    return JstIndex.from_terc(
        pd.DataFrame(rows, columns=["WOJ", "POW", "GMI", "RODZ", "NAZWA"])
    )


def test_an_sa_with_several_shareholders_names_no_owner():
    # Karkonoska Agencja Rozwoju Regionalnego: no shareholder section at all
    assert not names_an_owner(owned("0000073772", SA))


def test_a_person_is_an_owner_on_record():
    assert names_an_owner(owned("0000687765", SPZOO, wspolnicy=[A_PERSON]))


def test_a_company_named_by_its_krs_is_an_owner_on_record():
    # EKOENERGIA SILESIA, wholly owned by GPW
    assert names_an_owner(owned("0000408185", SPZOO, wspolnicy=[GPW]))
    assert names_an_owner(owned("0000408185", SA, akcjonariusz=[GPW]))


def test_a_government_is_an_owner_on_record():
    # PK "THERMA", owned by the city
    assert names_an_owner(
        owned("0000081135", SPZOO, wspolnicy=[BIELSKO]), bielsko_biala()
    )


def test_a_name_nothing_here_can_place_is_not():
    # PKM Swierklaniec belongs to the metropolitan union, which is neither a
    # gmina, a powiat, a wojewodztwo nor a company with a KRS number.
    assert not names_an_owner(
        owned("0000019110", SPZOO, wspolnicy=[GZM]), bielsko_biala()
    )


def public_after(odpisy: list[dict], regon_public: set[str]) -> set[str]:
    """Which KRS numbers `CompaniesKRS` marks public, for these odpisy.

    `regon_public` are the companies REGON records as publicly owned. Every
    company is in the catalogue, the way a private one providing a public
    service is too.
    """
    pipeline = CompaniesKRS()
    pipeline.teryt = NO_TERYT  # type: ignore[assignment]
    pipeline.jst_index = None
    for data in odpisy:
        krs = data["odpis"]["naglowekA"]["numerKRS"]
        pipeline.process_api_krs_blob(
            f"gs://koryta-pl-crawled/hostname=api-krs.ms.gov.pl/api/krs/"
            f"OdpisAktualny/{krs}/date=2026-05-27",
            data,
            NO_POSTAL_CODES,
        )
    hardcoded = {
        krs: KRS(
            krs,
            {"PUBLIC_COMPANIES_KRS"}
            | ({REGON_PUBLIC_OWNERSHIP} if krs in regon_public else set()),
        )
        for krs in pipeline.companies
    }
    public = pipeline.compute_public_krss(hardcoded)
    pipeline.propagate_is_public(public, pipeline.build_parent_to_children())
    return {krs for krs, company in pipeline.companies.items() if company.is_public}


def test_regon_answers_for_an_sa_the_register_is_silent_about():
    public = public_after([owned("0000073772", SA)], regon_public={"0000073772"})

    assert public == {"0000073772"}


def test_an_owner_in_the_register_outranks_the_regon_code():
    # GERMANIA MINT STORE: REGON still files it under local government, while
    # the register shows it owned by people.
    public = public_after(
        [owned("0000687765", SPZOO, wspolnicy=[A_PERSON])],
        regon_public={"0000687765"},
    )

    assert public == set()


def test_being_in_the_catalogue_alone_is_not_public_ownership():
    public = public_after([owned("0000073772", SA)], regon_public=set())

    assert public == set()


def test_a_subsidiary_inherits_what_regon_said_of_its_parent():
    # GPW is an SA with several shareholders; EKOENERGIA SILESIA names it as
    # its owner, so it goes public with it rather than on its own evidence.
    public = public_after(
        [
            owned("0000247533", SA),
            owned("0000408185", SPZOO, wspolnicy=[GPW]),
        ],
        regon_public={"0000247533"},
    )

    assert public == {"0000247533", "0000408185"}
