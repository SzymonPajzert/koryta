import pandas as pd
import requests

from . import parse

URL_DF_PATH = "src/scrapers/article/test_data/url_parsing.csv"
HEADERS = {"User-Agent": "KorytaCrawler/0.1 (+http://koryta.pl/crawler)"}


def fetch_url(url: str) -> bytes:
    response = requests.get(url, headers=HEADERS, timeout=10)
    return response.content

def normalize_quotes(text: str) -> str:
    """Normalizes various quotes to straight double and single quotes."""
    text = text.replace('”', '"').replace('„', '"').replace('“', '"').replace('″', '"')
    text = text.replace("’", "'").replace("‘", "'").replace('«', '"').replace('»', '"')
    text = text.replace('›', "'").replace('‹', "'")
    text = text.replace("''", '"')
    return text

def pytest_generate_tests(metafunc):
    """Dynamically generates test cases from the CSV file."""
    df = pd.read_csv(URL_DF_PATH)
    assert set(df.columns) == {"Link", "Artykuł", "Domena", "Tytuł", "Tytuł Alternatywny", "Data", "Data Normalizowana",
                               "Kto", "Gdzie"}
    df["Data Normalizowana"] = df["Data Normalizowana"].replace("Brak", None)
    df["Data Normalizowana"] = pd.to_datetime(df["Data Normalizowana"]).dt.date
    df["Tytuł Alternatywny"] = df["Tytuł Alternatywny"].replace("", None)

    if "row_article" in metafunc.fixturenames:
        # Filter for rows that ARE articles
        articles = df[df["Artykuł"] == "Tak"]
        metafunc.parametrize("row_article", articles.to_dict('records'))

    if "row_no_article" in metafunc.fixturenames:
        # Filter for rows that ARE NOT articles
        no_articles = df[df["Artykuł"] == "Nie"]
        metafunc.parametrize("row_no_article", no_articles.to_dict('records'))


def test_article(row_article):
    url = row_article["Link"]
    expected_title = row_article["Tytuł"]
    alternative_title = row_article["Tytuł Alternatywny"]
    expected_date = row_article["Data Normalizowana"]

    website_bytes = fetch_url(url)
    parsed_data = parse.extract_article_content(website_bytes)

    assert parsed_data["is_article"], f"Failed for {url}: Should be an article"

    if not pd.isna(alternative_title):
        assert normalize_quotes(parsed_data["title"]).strip() in (normalize_quotes(expected_title).strip(), normalize_quotes(alternative_title).strip())
    else:
        assert normalize_quotes(parsed_data["title"]).strip() == normalize_quotes(expected_title).strip()

    if not pd.isna(expected_date):
        assert parsed_data["publication_date"] == expected_date, \
            f"Hint, the date in the article looks like '{row_article['Data']}'"
    else:
        assert parsed_data["publication_date"] is None


def test_no_article(row_no_article):
    url = row_no_article["Link"]

    website_bytes = fetch_url(url)
    parsed_data = parse.extract_article_content(website_bytes)

    assert not parsed_data["is_article"], f"Failed for {url}: Should NOT be an article"
