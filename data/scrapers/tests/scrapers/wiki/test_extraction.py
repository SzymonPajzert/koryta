import dataclasses
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
    "Marcin Chludziński": None,
}

COMPANIES_EXPECTED = {
    "Agata (przedsiębiorstwo)": Company(
        name="Agata PEŁNA NAZWA",
        krs="0000037615",
        content_score=0,
    ),
    # TODO support parsing pages like this one
    "Agencja Mienia Wojskowego": None,
    "Biuro Maklerskie PKO Banku Polskiego": Company(
        name="Biuro Maklerskie PKO Banku Polskiego",
        krs="",
        content_score=1,
    ),
    # TODO support parsing pages like this one
    "Grupa kapitałowa PWN": None,
    "Kopalnia Węgla Kamiennego „Śląsk”": Company(
        name="Kopalnia Węgla Kamiennego „Śląsk”",
        krs="",
        content_score=1,
    ),
    "Miejski Zakład Komunikacji w Koninie": Company(
        name="Miejski Zakład Komunikacji w Koninie",
        krs="",
        content_score=1,
    ),
    "Miejskie Przedsiębiorstwo Komunikacyjne we Wrocławiu": Company(
        name="Miejskie Przedsiębiorstwo Komunikacyjne we Wrocławiu",
        krs="",
        content_score=1,
    ),
    "Orange Polska": Company(
        name="Orange Polska",
        krs="0000010681",
        content_score=0,
    ),
    "PERN": Company(
        name="PERN",
        krs="0000069559",
        content_score=1,
    ),
    "Pesa Mińsk Mazowiecki": Company(
        name="Pesa Mińsk Mazowiecki",
        krs="0000067499",
        content_score=1,
    ),
    "PGE Polska Grupa Energetyczna": Company(
        name="PGE Polska Grupa Energetyczna",
        krs="0000059307",
        content_score=1,
    ),
    "Pojazdy Szynowe Pesa Bydgoszcz": Company(
        name="Pojazdy Szynowe Pesa Bydgoszcz",
        krs="0000036552",
        content_score=1,
    ),
    "Polbus-PKS": Company(
        name="Polbus-PKS",
        krs="0000008042",
        content_score=1,
    ),
    "Polfa Warszawa": Company(
        name="Polfa Warszawa",
        krs="0000147193",
        content_score=1,
    ),
    "Polski Holding Obronny": Company(
        name="Polski Holding Obronny",
        krs="0000027151",
        content_score=1,
    ),
    "Port lotniczy Warszawa-Modlin": Company(
        name="Port lotniczy Warszawa-Modlin",
        krs="0000184990",
        content_score=1,
    ),
    "Stadion Narodowy im. Kazimierza Górskiego w Warszawie": None,
    "Telewizja Polska": Company(
        name="Telewizja Polska",
        krs="0000100679",
        content_score=1,
    ),
    "Totalizator Sportowy": Company(
        name="Totalizator Sportowy",
        krs="0000007411",
        content_score=1,
    ),
    "Warel": Company(
        name="Warel",
        krs="0000100750",
        content_score=1,
    ),
    "ZE PAK": Company(
        name="ZE PAK",
        krs="0000021374",
        content_score=0,
    ),
}

ctx, _ = setup_context(False)


@pytest.mark.parametrize("filename", PEOPLE_EXPECTED.keys())
def test_people(filename):
    with ctx.io.read_data(LocalFile(f"{filename}.xml", "tests")).read_file() as f:
        elem = ET.fromstring(f.read())
        article = WikiArticle.parse(elem)
        assert article is not None
        assert article.infobox is not None

        if PEOPLE_EXPECTED[filename] is None:
            return

        assert article.title == PEOPLE_EXPECTED[filename]["title"], "title"
        assert (
            article.infobox.inf_type == PEOPLE_EXPECTED[filename]["infobox_type"]
        ), "infobox_type"
        assert (
            article.infobox.birth_iso == PEOPLE_EXPECTED[filename]["birth_date"]
        ), "birth_date"
        assert (
            article.about_person == PEOPLE_EXPECTED[filename]["about_person"]
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

        print(article.infobox.fields)

        company = extract(elem)
        expected = COMPANIES_EXPECTED[filename]

        if expected is None:
            assert company is None
            return

        assert company is not None, "Company extracted successfully"
        assert isinstance(company, Company)

        if expected.content_score > 0:
            assert company.content_score > 0, "content_score should be positive"

        # Setting to disregard exact score
        company.content_score = 0
        expected.content_score = 0
        assert dataclasses.asdict(company) == dataclasses.asdict(expected)


@pytest.mark.parametrize("filename", TEST_FILES)
def test_all_tested(filename):
    path = ctx.io.list_data(LocalFile(f"{filename}.xml", "tests"))[0]
    assert os.path.exists(path)

    if filename in PEOPLE_EXPECTED:
        return
    if filename in COMPANIES_EXPECTED:
        return

    assert False  # Not found in any categories
