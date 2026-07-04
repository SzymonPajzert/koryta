from scrapers.krs.list import parse_activity_from_api_krs

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
