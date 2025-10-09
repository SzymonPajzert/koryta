import pytest
import xml.etree.ElementTree as ET
import os

from util.config import tests
from scrapers.wiki.process_articles import WikiArticle, TEST_FILES

PEOPLE_EXPECTED = {
    "Józef Śliwa": {
        "title": "Józef Andrzej Śliwa",  # We extract middle name from the page
        "infobox_type": "Biogram",
        "birth_date": "1954-11-17",
    }
}


@pytest.mark.parametrize("filename", PEOPLE_EXPECTED.keys())
def test_people(filename):
    with open(tests.get_path(f"{filename}.xml"), "r") as f:
        article = WikiArticle.parse(ET.fromstring(f.read()))
        assert article is not None
        assert article.polityk_infobox is not None

        assert article.title == PEOPLE_EXPECTED[filename]["title"]
        assert (
            article.polityk_infobox.inf_type
            == PEOPLE_EXPECTED[filename]["infobox_type"]
        )
        assert (
            article.polityk_infobox.birth_iso == PEOPLE_EXPECTED[filename]["birth_date"]
        )


@pytest.mark.parametrize("filename", TEST_FILES)
def test_all_tested(filename):
    assert os.path.exists(tests.get_path(f"{filename}.xml"))

    if filename in PEOPLE_EXPECTED:
        return

    assert False  # Not found in any categories
