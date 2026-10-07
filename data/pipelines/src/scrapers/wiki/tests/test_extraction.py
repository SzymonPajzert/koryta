import dataclasses
import itertools
import xml.etree.ElementTree as ET
from pathlib import Path

import mwparserfromhell
import pytest

from entities.company import WikiShareholder
from scrapers.stores import LocalFile
from scrapers.tests.mocks import get_test_context, nested_dict, setup_test_context
from scrapers.wiki.process_articles import (
    Company,
    Infobox,
    People,
    WikiArticle,
    extract,
)
from scrapers.wiki.shareholders import article_url
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
        source=("https://pl.wikipedia.org/wiki/Józef_Śliwa"),
        full_name="Józef Andrzej Śliwa",
        party="Sojusz Lewicy Demokratycznej",
        birth_iso8601="1954-11-17",
        birth_year=1954,
        infoboxes=["Biogram"],
        content_score=1,
        links=[],
    ),
    "Grzegorz Pastuszko": People(
        source=("https://pl.wikipedia.org/wiki/Grzegorz_Pastuszko"),
        full_name="Grzegorz Michał Pastuszko",
        party="",
        birth_iso8601="1981-09-17",
        birth_year=1981,
        infoboxes=["Naukowiec"],
        content_score=1,
        links=[],
    ),
    "Marcin Chludziński": People(
        source=("https://pl.wikipedia.org/wiki/Marcin_Chludziński"),
        full_name="Marcin Chludziński",
        party="",
        birth_iso8601="1979-00-00",
        birth_year=1979,
        infoboxes=["Biogram"],
        content_score=1,
        links=[],
    ),
}


def wiki_company(title, name, krs, content_score, *shareholders):
    """What `extract` makes of a company article, before `scrape_wiki` has
    read the rest of the dump to say who its owners are.

    `categories` is left out: an article carries a dozen, most of them about
    the town it is in, and `test_company_categories` checks the ones that
    matter.
    """
    return Company(
        name=name,
        krs=krs,
        content_score=content_score,
        title=title,
        source=article_url(title),
        shareholders=list(shareholders),
    )


COMPANIES_EXPECTED = {
    "Agata (przedsiębiorstwo)": wiki_company(
        "Agata (przedsiębiorstwo)", "Agata", "0000037615", 0
    ),
    # TODO support parsing pages like this one
    "Agencja Mienia Wojskowego": None,
    "Biuro Maklerskie PKO Banku Polskiego": wiki_company(
        "Biuro Maklerskie PKO Banku Polskiego",
        "Biuro Maklerskie PKO Banku Polskiego",
        "",
        1,
    ),
    # TODO support parsing pages like this one
    "Grupa kapitałowa PWN": None,
    "Kopalnia Węgla Kamiennego „Śląsk”": wiki_company(
        "Kopalnia Węgla Kamiennego „Śląsk”", "Kopalnia Węgla Kamiennego Śląsk", "", 1
    ),
    "Miejski Zakład Komunikacji w Koninie": wiki_company(
        "Miejski Zakład Komunikacji w Koninie",
        "Miejski Zakład Komunikacji w Koninie Sp. z o.o.",
        "",
        1,
        # "Miasto [[Konin]]": the words around a link are part of the name.
        WikiShareholder("Miasto Konin", "Konin"),
    ),
    "Miejskie Przedsiębiorstwo Komunikacyjne we Wrocławiu": wiki_company(
        "Miejskie Przedsiębiorstwo Komunikacyjne we Wrocławiu",
        "Miejskie Przedsiębiorstwo Komunikacyjne sp. z o.o. we Wrocławiu",
        "",
        1,
        WikiShareholder("Miasto Wrocław"),
    ),
    "Orange Polska": wiki_company(
        "Orange Polska",
        "Orange Polska S.A.",
        "0000010681",
        0,
        WikiShareholder("Orange S.A.", "Orange (przedsiębiorstwo)"),
    ),
    "PERN": wiki_company(
        "PERN",
        "PERN S.A.",
        "0000069559",
        1,
        WikiShareholder("Skarb Państwa", "Skarb państwa", 100.0),
    ),
    "Pesa Mińsk Mazowiecki": wiki_company(
        "Pesa Mińsk Mazowiecki",
        "Pesa Mińsk Mazowiecki",
        "0000067499",
        1,
        WikiShareholder("Pesa", "Pojazdy Szynowe Pesa Bydgoszcz", 85.31),
    ),
    "PGE Polska Grupa Energetyczna": wiki_company(
        "PGE Polska Grupa Energetyczna",
        "PGE Polska Grupa Energetyczna Spółka Akcyjna",
        "0000059307",
        1,
        # "60,86%": a decimal comma, not one between two owners.
        WikiShareholder("Skarb Państwa", "Skarb Państwa", 60.86),
        WikiShareholder("pozostali", None, 39.14),
    ),
    "Pojazdy Szynowe Pesa Bydgoszcz": wiki_company(
        "Pojazdy Szynowe Pesa Bydgoszcz",
        "Pojazdy Szynowe Pesa Bydgoszcz",
        "0000036552",
        1,
        WikiShareholder("Polski Fundusz Rozwoju", "Polski Fundusz Rozwoju", 99.8),
    ),
    "Polbus-PKS": wiki_company(
        "Polbus-PKS",
        "Polbus-PKS",
        "0000008042",
        1,
        # Stakes given as capital, "10,9 mln zł", are not per cent.
        WikiShareholder("Skarb Państwa", "Skarb Państwa"),
        WikiShareholder("Autogiełda Majski"),
        WikiShareholder("Styrna sp. z o.o."),
    ),
    "Polfa Warszawa": wiki_company("Polfa Warszawa", "Polfa Warszawa", "0000147193", 1),
    "Polski Holding Obronny": wiki_company(
        "Polski Holding Obronny",
        "Polski Holding Obronny",
        "0000027151",
        1,
        WikiShareholder("Skarb Państwa", "Skarb Państwa"),
        WikiShareholder("Agencja Rozwoju Przemysłu SA", "Agencja Rozwoju Przemysłu"),
    ),
    "Port lotniczy Warszawa-Modlin": wiki_company(
        "Port lotniczy Warszawa-Modlin",
        "Port Lotniczy Warszawa-Modlin",
        "0000184990",
        1,
        # "– 30,44 proc.": a stake after the name, in words.
        WikiShareholder(
            "Agencja Mienia Wojskowego", "Agencja Mienia Wojskowego", 30.44
        ),
        WikiShareholder(
            "Samorząd województwa mazowieckiego", "Województwo mazowieckie", 38.44
        ),
        WikiShareholder(
            "Przedsiębiorstwo Państwowe Porty Lotnicze",
            "Porty lotnicze w Polsce",
            26.87,
        ),
        WikiShareholder("Miasto Nowy Dwór Mazowiecki", "Nowy Dwór Mazowiecki", 4.26),
    ),
    "Stadion Narodowy im. Kazimierza Górskiego w Warszawie": None,
    "Telewizja Polska": wiki_company(
        "Telewizja Polska",
        "Telewizja Polska S.A. w likwidacji",
        "0000100679",
        1,
        WikiShareholder("Skarb Państwa", "Skarb Państwa", 100.0),
    ),
    "Totalizator Sportowy": wiki_company(
        "Totalizator Sportowy",
        "Totalizator Sportowy",
        "0000007411",
        1,
        WikiShareholder("Skarb państwa", "Skarb państwa"),
    ),
    "Warel": wiki_company(
        "Warel",
        "Zakłady Elektroniczne WAREL S.A.",
        "0000100750",
        1,
        WikiShareholder("Skarb Państwa"),
    ),
    "ZE PAK": wiki_company(
        "ZE PAK",
        "ZE PAK SPÓŁKA AKCYJNA",
        "0000021374",
        0,
        # "(pośrednio, 65,96%)": a comma inside parentheses ends nothing.
        WikiShareholder("Zygmunt Solorz-Żak (pośrednio)", "Zygmunt Solorz-Żak", 65.96),
        WikiShareholder("OFE PZU „Złota Jesień”", None, 9.12),
        WikiShareholder("Nationale – Nederlanden OFE", None, 8.86),
        WikiShareholder("Pozostali", None, 16.06),
    ),
}


@pytest.fixture
def ctx():
    base_path = Path(__file__).parent.parent.parent.parent.parent / "tests" / "wiki"
    mapping: nested_dict = {
        str(LocalFile(f"{file}.xml", "tests/wiki")): str(base_path / f"{file}.xml")
        for file in list_test_files()
    }
    return setup_test_context(get_test_context(), mapping)


def list_test_files():
    return itertools.chain(PEOPLE_EXPECTED.keys(), COMPANIES_EXPECTED.keys())


@pytest.mark.parametrize("filename", list_test_files())
def test_links(filename, ctx):
    with ctx.io.read_data(LocalFile(f"{filename}.xml", "tests/wiki")).read_file() as f:
        elem = ET.fromstring(f.read())
        article = WikiArticle.parse(elem)

        expected = PEOPLE_EXPECTED.get(filename, COMPANIES_EXPECTED.get(filename))
        if expected is None:
            return

        assert article is not None

        for link in NORMALIZED_LINKS_EXPECTED.get(filename, []):
            assert link in article.normalized_links

        for link in article.normalized_links:
            assert "[" not in link and "]" not in link and "|" not in link


@pytest.mark.parametrize("filename", list_test_files())
def test_entity_extraction(filename, ctx):
    with ctx.io.read_data(LocalFile(f"{filename}.xml", "tests/wiki")).read_file() as f:
        elem = ET.fromstring(f.read())
        article = WikiArticle.parse(elem)

        expected = PEOPLE_EXPECTED.get(filename, COMPANIES_EXPECTED.get(filename))
        if expected is None and article is None:
            return

        assert article is not None

        entity = extract(elem)
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
        actual, wanted = dataclasses.asdict(entity), dataclasses.asdict(expected)
        if isinstance(entity, Company):
            # See `wiki_company`: these are `test_company_categories`'.
            actual.pop("categories")
            wanted.pop("categories")
        assert actual == wanted


#: One category each article has to carry - the one that says what the company
#: does, which `entities.company_categories` reads.
COMPANY_CATEGORIES_EXPECTED = {
    "PGE Polska Grupa Energetyczna": "Przedsiębiorstwa energetyczne w Polsce",
    "Pesa Mińsk Mazowiecki": "Producenci taboru kolejowego w Polsce",
    "Polbus-PKS": "Przedsiębiorstwo Komunikacji Samochodowej",
    "Miejski Zakład Komunikacji w Koninie": (
        "Operatorzy publicznego transportu zbiorowego w województwie wielkopolskim"
    ),
}


@pytest.mark.parametrize("filename,category", COMPANY_CATEGORIES_EXPECTED.items())
def test_company_categories(filename, category, ctx):
    with ctx.io.read_data(LocalFile(f"{filename}.xml", "tests/wiki")).read_file() as f:
        entity = extract(ET.fromstring(f.read()))

    assert isinstance(entity, Company)
    assert category in entity.categories
    # Without the namespace, and each one once.
    assert not any(c.startswith("Kategoria:") for c in entity.categories)
    assert len(set(entity.categories)) == len(entity.categories)


@pytest.mark.parametrize("filename", TEST_FILES)
def test_all_tested(filename, ctx):
    # Verify the file exists in the context
    try:
        ctx.io.read_data(LocalFile(f"{filename}.xml", "tests/wiki"))
    except FileNotFoundError:
        pytest.fail(f"Test file {filename}.xml not found in mock context")

    if filename in PEOPLE_EXPECTED:
        return
    if filename in COMPANIES_EXPECTED:
        return

    assert False  # Not found in any categories


@pytest.mark.parametrize(
    "fields,expected",
    [
        ("|rejestr = KRS |numer rejestru = 0000271591 |państwo = PL-PM", "0000271591"),
        (
            "|rejestr = [[Krajowy Rejestr Sądowy|KRS]] |numer rejestru = 0000271591",
            "0000271591",
        ),
        # Orange's article, whose number read as KRS 0380129866.
        ("|rejestr = SIREN |numer rejestru = 380129866 |państwo = Francja", None),
        ("|rejestr = IČO |numer rejestru = 45274649 |państwo = CZE", None),
        # No register named: the country decides, and none at all is Polish.
        ("|numer rejestru = 0000057019 |państwo = POL", "0000057019"),
        ("|numer rejestru = 0000057019 |państwo = śląskie", "0000057019"),
        ("|numer rejestru = 0000057019", "0000057019"),
        ("|numer rejestru = 86891 |państwo = DE-BY", None),
        # A Polish register that is not KRS: its number is not a KRS number.
        ("|rejestr = REGON |numer rejestru = 017415570 |państwo = Polska", None),
        # A register field holding a number names no register: AGRO
        # Ubezpieczenia's has its NIP there.
        (
            "|rejestr = 113-24-01-245 |numer rejestru = 0000145607 |państwo = Polska",
            "0000145607",
        ),
        ("|rejestr = KRS |numer rejestru = ", ""),
    ],
)
def test_only_a_krs_number_is_taken_for_one(fields, expected):
    template = mwparserfromhell.parse(f"{{{{Przedsiębiorstwo infobox {fields}}}}}")
    infobox = Infobox(template.filter_templates()[0])

    assert infobox.krs_number == expected
