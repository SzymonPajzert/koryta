import pandas as pd
import requests

from . import parse

URL_DF_PATH = "/home/mp/Projects/koryta/data/scrapers/first_10.csv"
HEADERS = {"User-Agent": "KorytaCrawler/0.1 (+http://koryta.pl/crawler)"}


def fetch_url(url: str) -> bytes:
    response = requests.get(url, headers=HEADERS, timeout=10)
    return response.content


def pytest_generate_tests(metafunc):
    """Dynamically generates test cases from the CSV file."""
    df = pd.read_csv(URL_DF_PATH)
    df["Data Normalizowana"] = pd.to_datetime(df["Data Normalizowana"]).dt.date

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
    expected_date = row_article["Data Normalizowana"]

    website_bytes = fetch_url(url)
    parsed_data = parse.extract_article_content(website_bytes)

    assert parsed_data["is_article"], f"Failed for {url}: Should be an article"
    assert parsed_data["title"] == expected_title
    assert parsed_data["publication_date"] == expected_date, f"Hint, the date in article looks like '{row_article['Data']}'"


def test_no_article(row_no_article):
    url = row_no_article["Link"]

    website_bytes = fetch_url(url)
    parsed_data = parse.extract_article_content(website_bytes)

    assert not parsed_data["is_article"], f"Failed for {url}: Should NOT be an article"
