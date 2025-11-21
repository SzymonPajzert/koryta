import pytest
import xml.etree.ElementTree as ET
import os

from scrapers.stores import LocalFile
from main import setup_context
from scrapers.wiki.process_articles import (
    WikiArticle,
    extract,
    Company,
    People,
)
from util.lists import TEST_FILES


PEOPLE_EXPECTED = {
    "Józef Śliwa": {
        "title": "Józef Andrzej Śliwa",  # We extract middle name from the page
        "infobox_type": "Biogram",
        "birth_date": "1954-11-17",
        "about_person": True,
    },
    "Grzegorz Michał Pastuszko": {
        "title": "Grzegorz Michał Pastuszko",
        "infobox_type": "Naukowiec",
        "birth_date": "1981-09-17",
        "about_person": True,
    },
}

COMPANIES_EXPECTED = {
    "Telewizja Polska": Company(
        name="Telewizja Polska S.A. w likwidacji",
        krs="0000100679",
    ),
    "PERN": Company(
        name="PERN S.A.",
        krs="0000069559",
    ),
    "Agata (przedsiębiorstwo)": None,
    "Agencja Mienia Wojskowego": None,
    "Biuro Maklerskie PKO Banku Polskiego": None,
    "Grupa kapitałowa PWN": None,
    "Kopalnia Węgla Kamiennego „Śląsk”": None,
    "Miejski Zakład Komunikacji w Koninie": None,
    "Miejskie Przedsiębiorstwo Komunikacyjne we Wrocławiu": None,
    "Orange Polska": None,
    "Pesa Mińsk Mazowiecki": None,
    "PGE Polska Grupa Energetyczna": None,
    "Pojazdy Szynowe Pesa Bydgoszcz": None,
    "Polbus-PKS": None,
    "Polfa Warszawa": None,
    "Polski Holding Obronny": None,
    "Port lotniczy Warszawa-Modlin": None,
    "Stadion Narodowy im. Kazimierza Górskiego w Warszawie": None,
    "Totalizator Sportowy": None,
    "Warel": None,
    "ZE PAK": None,
}

ctx, _ = setup_context(False)


@pytest.mark.parametrize("filename", PEOPLE_EXPECTED.keys())
def test_people(filename):
    with ctx.io.read_data(LocalFile(f"{filename}.xml", "tests")).read_file() as f:
        elem = ET.fromstring(f.read())
        article = WikiArticle.parse(elem)
        assert article is not None
        assert article.infobox is not None

        assert article.title == PEOPLE_EXPECTED[filename]["title"], "title"
        assert (
            article.infobox.inf_type == PEOPLE_EXPECTED[filename]["infobox_type"]
        ), "infobox_type"
        assert (
            article.infobox.birth_iso == PEOPLE_EXPECTED[filename]["birth_date"]
        ), "birth_date"
        assert (
            article.about_person() == PEOPLE_EXPECTED[filename]["about_person"]
        ), "about_person()"

        person = extract(elem)
        assert person is not None, "Person extracted successfully"
        assert isinstance(person, People)
        assert person.full_name == article.title


@pytest.mark.parametrize("filename", COMPANIES_EXPECTED.keys())
def test_companies(filename):
    with ctx.io.read_data(LocalFile(f"{filename}.xml", "tests")).read_file() as f:
        elem = ET.fromstring(f.read())
        article = WikiArticle.parse(elem)
        assert article is not None
        assert article.infobox is not None

        company = extract(elem)
        assert company is not None
        assert company == COMPANIES_EXPECTED[filename]


@pytest.mark.parametrize("filename", TEST_FILES)
def test_all_tested(filename):
    path = ctx.io.list_data(LocalFile(f"{filename}.xml", "tests"))[0]
    assert os.path.exists(path)

    if filename in PEOPLE_EXPECTED:
        return
    if filename in COMPANIES_EXPECTED:
        return

    assert False  # Not found in any categories
