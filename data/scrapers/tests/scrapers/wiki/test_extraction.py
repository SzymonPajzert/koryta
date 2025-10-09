import pytest
import xml.etree.ElementTree as ET

from util.config import tests
from scrapers.wiki.process_articles import WikiArticle, TEST_FILES

EXPECTED = {
    "Józef Śliwa": {
        "title": "Józef Andrzej Śliwa",  # We extract middle name from the page
        "infobox_type": "Biogram",
        "birth_date": "1954-11-17",
    }
}


@pytest.mark.parametrize("filename", TEST_FILES)
def test_test_files(filename):
    with open(tests.get_path(f"{filename}.xml"), "r") as f:
        article = WikiArticle.parse(ET.fromstring(f.read()))
        assert article is not None
        assert article.polityk_infobox is not None

        if filename not in EXPECTED:
            pytest.skip()

        assert article.title == EXPECTED[filename]["title"]
        assert article.polityk_infobox.inf_type == EXPECTED[filename]["infobox_type"]
        assert article.polityk_infobox.birth_iso == EXPECTED[filename]["birth_date"]
