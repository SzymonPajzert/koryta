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
    "Józef Śliwa": People(
        source=("https://pl.wikipedia.org/wiki/Józef Andrzej Śliwa"),
        full_name="Józef Andrzej Śliwa",
        party="Sojusz Lewicy Demokratycznej",
        birth_iso8601="1954-11-17",
        birth_year=1954,
        infoboxes=["Biogram"],
        content_score=1,
        links=[],
    ),
    "Grzegorz Michał Pastuszko": People(
        source=("https://pl.wikipedia.org/wiki/Grzegorz Michał Pastuszko"),
        full_name="Grzegorz Michał Pastuszko",
        party="",
        birth_iso8601="1981-09-17",
        birth_year=1981,
        infoboxes=["Naukowiec"],
        content_score=1,
        links=[],
    ),
    "Marcin Chludziński": People(
        source=("https://pl.wikipedia.org/wiki/Marcin Chludziński"),
        full_name="Marcin Chludziński",
        party="",
        birth_iso8601="1979-00-00",
        birth_year=1979,
        infoboxes=["Biogram"],
        content_score=1,
        links=[],
    ),
}

COMPANIES_EXPECTED = {
    "Agata (przedsiębiorstwo)": Company(
        name="Agata",
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
        name="Kopalnia Węgla Kamiennego Śląsk",
        krs="",
        content_score=1,
    ),
    "Miejski Zakład Komunikacji w Koninie": Company(
        name="Miejski Zakład Komunikacji w Koninie Sp. z o.o.",
        krs="",
        content_score=1,
    ),
    "Miejskie Przedsiębiorstwo Komunikacyjne we Wrocławiu": Company(
        name="Miejskie Przedsiębiorstwo Komunikacyjne sp. z o.o. we Wrocławiu",
        krs="",
        content_score=1,
    ),
    "Orange Polska": Company(
        name="Orange Polska S.A.",
        krs="0000010681",
        content_score=0,
    ),
    "PERN": Company(
        name="PERN S.A.",
        krs="0000069559",
        content_score=1,
    ),
    "Pesa Mińsk Mazowiecki": Company(
        name="Pesa Mińsk Mazowiecki",
        krs="0000067499",
        content_score=1,
    ),
    "PGE Polska Grupa Energetyczna": Company(
        name="PGE Polska Grupa Energetyczna Spółka Akcyjna",
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
        name="Port Lotniczy Warszawa-Modlin",
        krs="0000184990",
        content_score=1,
    ),
    "Stadion Narodowy im. Kazimierza Górskiego w Warszawie": None,
    "Telewizja Polska": Company(
        name="Telewizja Polska S.A. w likwidacji",
        krs="0000100679",
        content_score=1,
    ),
    "Totalizator Sportowy": Company(
        name="Totalizator Sportowy",
        krs="0000007411",
        content_score=1,
    ),
    "Warel": Company(
        name="Zakłady Elektroniczne WAREL S.A.",
        krs="0000100750",
        content_score=1,
    ),
    "ZE PAK": Company(
        name="ZE PAK SPÓŁKA AKCYJNA",
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
        assert len(article.infoboxes) > 0

        person = extract(elem)
        expected = PEOPLE_EXPECTED[filename]

        if expected is None:
            assert person is None
            return

        assert len(article.infoboxes) > 0
        assert person is not None, "Person extracted successfully"
        assert isinstance(person, People)

        if expected.content_score > 0:
            assert person.content_score > 0, "content_score should be positive"

        # Setting to disregard exact score
        person.content_score = 0
        expected.content_score = 0
        assert dataclasses.asdict(person) == dataclasses.asdict(expected)


@pytest.mark.parametrize("filename", COMPANIES_EXPECTED.keys())
def test_companies(filename):
    with ctx.io.read_data(LocalFile(f"{filename}.xml", "tests")).read_file() as f:
        elem = ET.fromstring(f.read())
        article = WikiArticle.parse(elem)
        assert article is not None

        company = extract(elem)
        expected = COMPANIES_EXPECTED[filename]

        if expected is None:
            assert company is None
            return

        assert len(article.infoboxes) > 0
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
