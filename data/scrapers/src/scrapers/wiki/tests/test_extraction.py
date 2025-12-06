import dataclasses
import itertools
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from scrapers.stores import LocalFile
from scrapers.tests.mocks import setup_test_context, test_context
from scrapers.wiki.process_articles import (
    Company,
    People,
    WikiArticle,
    extract,
)
from util.lists import TEST_FILES

NORMALIZED_LINKS_EXPECTED = {
    "Józef Śliwa": ["Grodków", "Uniwersytet Przyrodniczy we Wrocławiu"],
    "Grzegorz Michał Pastuszko": [],
    "Marcin Chludziński": [],
    "Agata (przedsiębiorstwo)": [],
    "Agencja Mienia Wojskowego": [],
    "Biuro Maklerskie PKO Banku Polskiego": [],
    "Grupa kapitałowa PWN": [],
    "Kopalnia Węgla Kamiennego „Śląsk”": [],
    "Miejski Zakład Komunikacji w Koninie": [],
    "Miejskie Przedsiębiorstwo Komunikacyjne we Wrocławiu": ["Wrocław"],
    "Orange Polska": [],
    "PERN": [],
    "Pesa Mińsk Mazowiecki": [],
    "PGE Polska Grupa Energetyczna": [],
    "Pojazdy Szynowe Pesa Bydgoszcz": [],
    "Polbus-PKS": [],
    "Polfa Warszawa": [],
    "Polski Holding Obronny": [],
    "Port lotniczy Warszawa-Modlin": [],
    "Telewizja Polska": [],
    "Totalizator Sportowy": [],
    "Warel": [],
    "ZE PAK": [],
}

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
        owner_articles=["Konin"],
    ),
    "Miejskie Przedsiębiorstwo Komunikacyjne we Wrocławiu": Company(
        name="Miejskie Przedsiębiorstwo Komunikacyjne sp. z o.o. we Wrocławiu",
        krs="",
        content_score=1,
        owner_text="Miasto Wrocław",
    ),
    "Orange Polska": Company(
        name="Orange Polska S.A.",
        krs="0000010681",
        content_score=0,
        owner_articles=["Orange (przedsiębiorstwo)"],
    ),
    "PERN": Company(
        name="PERN S.A.",
        krs="0000069559",
        content_score=1,
        owner_articles=["Skarb państwa"],
    ),
    "Pesa Mińsk Mazowiecki": Company(
        name="Pesa Mińsk Mazowiecki",
        krs="0000067499",
        content_score=1,
        owner_articles=["Pojazdy Szynowe Pesa Bydgoszcz"],
    ),
    "PGE Polska Grupa Energetyczna": Company(
        name="PGE Polska Grupa Energetyczna Spółka Akcyjna",
        krs="0000059307",
        content_score=1,
        owner_articles=["Skarb Państwa"],
    ),
    "Pojazdy Szynowe Pesa Bydgoszcz": Company(
        name="Pojazdy Szynowe Pesa Bydgoszcz",
        krs="0000036552",
        content_score=1,
        owner_articles=["Polski Fundusz Rozwoju"],
    ),
    "Polbus-PKS": Company(
        name="Polbus-PKS",
        krs="0000008042",
        content_score=1,
        owner_articles=["Skarb Państwa"],
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
        owner_articles=["Skarb Państwa", "Agencja Rozwoju Przemysłu"],
    ),
    "Port lotniczy Warszawa-Modlin": Company(
        name="Port Lotniczy Warszawa-Modlin",
        krs="0000184990",
        content_score=1,
        owner_articles=[
            "Agencja Mienia Wojskowego",
            "Województwo mazowieckie",
            "Porty lotnicze w Polsce#Przedsiębiorstwo Państwowe Porty Lotnicze",
            "Nowy Dwór Mazowiecki",
        ],
    ),
    "Stadion Narodowy im. Kazimierza Górskiego w Warszawie": None,
    "Telewizja Polska": Company(
        name="Telewizja Polska S.A. w likwidacji",
        krs="0000100679",
        content_score=1,
        owner_articles=["Skarb Państwa"],
    ),
    "Totalizator Sportowy": Company(
        name="Totalizator Sportowy",
        krs="0000007411",
        content_score=1,
        owner_articles=["Skarb państwa"],
    ),
    "Warel": Company(
        name="Zakłady Elektroniczne WAREL S.A.",
        krs="0000100750",
        content_score=1,
        owner_text="Skarb Państwa",
    ),
    "ZE PAK": Company(
        name="ZE PAK SPÓŁKA AKCYJNA",
        krs="0000021374",
        content_score=0,
        owner_articles=["Zygmunt Solorz-Żak"],
    ),
}

@pytest.fixture
def ctx():
    base_path = Path(__file__).parent.parent.parent.parent.parent / "tests"
    mapping = {
        str(LocalFile(f"{file}.xml", "tests")): str(base_path / f"{file}.xml") for file in list_test_files()
    }
    return setup_test_context(test_context(), mapping)


def list_test_files():
    return itertools.chain(PEOPLE_EXPECTED.keys(), COMPANIES_EXPECTED.keys())



@pytest.mark.parametrize("filename", list_test_files())
def test_links(filename, ctx):
    with ctx.io.read_data(LocalFile(f"{filename}.xml", "tests")).read_file() as f:
        elem = ET.fromstring(f.read())
        article = WikiArticle.parse(elem)
        assert article is not None

        for link in NORMALIZED_LINKS_EXPECTED.get(filename, []):
            assert link in article.normalized_links

        for link in article.normalized_links:
            assert "[" not in link and "]" not in link and "|" not in link


@pytest.mark.parametrize("filename", list_test_files())
def test_entity_extraction(filename, ctx):
    with ctx.io.read_data(LocalFile(f"{filename}.xml", "tests")).read_file() as f:
        elem = ET.fromstring(f.read())
        article = WikiArticle.parse(elem)
        assert article is not None

        entity = extract(elem)
        expected = PEOPLE_EXPECTED.get(filename, COMPANIES_EXPECTED.get(filename))

        if expected is None:
            assert entity is None
            return

        assert len(article.infoboxes) > 0
        assert entity is not None, "Entity extracted successfully"
        assert isinstance(entity, (People, Company))

        if expected.content_score > 0:
            assert entity.content_score > 0, "content_score should be positive"

        # Setting to disregard exact score
        entity.content_score = 0
        expected.content_score = 0
        assert dataclasses.asdict(entity) == dataclasses.asdict(expected)


@pytest.mark.parametrize("filename", TEST_FILES)
def test_all_tested(filename, ctx):
    # Verify the file exists in the context
    try:
        ctx.io.read_data(LocalFile(f"{filename}.xml", "tests"))
    except FileNotFoundError:
        pytest.fail(f"Test file {filename}.xml not found in mock context")


    if filename in PEOPLE_EXPECTED:
        return
    if filename in COMPANIES_EXPECTED:
        return

    assert False  # Not found in any categories
