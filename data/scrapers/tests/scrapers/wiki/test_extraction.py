import pytest
import xml.etree.ElementTree as ET
import os

from util.config import tests
from scrapers.wiki.process_articles import (
    WikiArticle,
    TEST_FILES,
    extract,
    Company,
    People,
)

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
        krs_number="0000100679",
    ),
    "PERN": Company(
        name="PERN S.A.",
        krs_number="0000069559",
    ),
}


@pytest.mark.parametrize("filename", PEOPLE_EXPECTED.keys())
def test_people(filename):
    with open(tests.get_path(f"{filename}.xml"), "r") as f:
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
    with open(tests.get_path(f"{filename}.xml"), "r") as f:
        elem = ET.fromstring(f.read())
        article = WikiArticle.parse(elem)
        assert article is not None
        assert article.infobox is not None

        company = extract(elem)
        assert company is not None
        assert company == COMPANIES_EXPECTED[filename]


@pytest.mark.parametrize("filename", TEST_FILES)
def test_all_tested(filename):
    assert os.path.exists(tests.get_path(f"{filename}.xml"))

    if filename in PEOPLE_EXPECTED:
        return
    if filename in COMPANIES_EXPECTED:
        return

    assert False  # Not found in any categories
