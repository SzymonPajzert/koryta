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
    "Paweł Gruza": None,
}

COMPANIES_EXPECTED = {
    "Agata (przedsiębiorstwo)": Company(
        name="",
        krs="",
        content_score=0,
    ),
    "Agencja Mienia Wojskowego": Company(
        name="",
        krs="",
        content_score=1,
    ),
    "Biuro Maklerskie PKO Banku Polskiego": Company(
        name="",
        krs="",
        content_score=1,
    ),
    "Grupa kapitałowa PWN": Company(
        name="",
        krs="",
        content_score=1,
    ),
    "Kopalnia Węgla Kamiennego „Śląsk”": Company(
        name="",
        krs="",
        content_score=1,
    ),
    "Miejski Zakład Komunikacji w Koninie": Company(
        name="",
        krs="",
        content_score=1,
    ),
    "Miejskie Przedsiębiorstwo Komunikacyjne we Wrocławiu": Company(
        name="",
        krs="",
        content_score=1,
    ),
    "Orange Polska": Company(
        name="",
        krs="",
        content_score=0,
    ),
    "PERN": Company(
        name="PERN S.A.",
        krs="0000069559",
        content_score=1,
    ),
    "Pesa Mińsk Mazowiecki": Company(
        name="",
        krs="",
        content_score=1,
    ),
    "PGE Polska Grupa Energetyczna": Company(
        name="",
        krs="",
        content_score=1,
    ),
    "Pojazdy Szynowe Pesa Bydgoszcz": Company(
        name="",
        krs="",
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

        company = extract(elem)
        if COMPANIES_EXPECTED[filename] is None:
            assert company is None
            return

        assert company is not None, "Company extracted successfully"
        assert isinstance(company, Company)
        # Setting to disregard exact score
        company.content_score = 1 if company.content_score > 0 else 0
        assert dataclasses.asdict(company) == dataclasses.asdict(
            COMPANIES_EXPECTED[filename]
        )


@pytest.mark.parametrize("filename", TEST_FILES)
def test_all_tested(filename):
    path = ctx.io.list_data(LocalFile(f"{filename}.xml", "tests"))[0]
    assert os.path.exists(path)

    if filename in PEOPLE_EXPECTED:
        return
    if filename in COMPANIES_EXPECTED:
        return

    assert False  # Not found in any categories
