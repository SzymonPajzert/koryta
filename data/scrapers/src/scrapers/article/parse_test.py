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
                               "Kto", "Gdzie", "Pierwsze Zdanie", "Ostatnie Zdanie"}
    df["Pierwsze Zdanie"] = df["Pierwsze Zdanie"].replace("", None)
    df["Ostatnie Zdanie"] = df["Ostatnie Zdanie"].replace("", None)
    df["Tytuł Alternatywny"] = df["Tytuł Alternatywny"].replace("", None)
    df["Data Normalizowana"] = df["Data Normalizowana"].replace("Brak", None)
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
    alternative_title = row_article["Tytuł Alternatywny"]
    expected_date = row_article["Data Normalizowana"]
    expected_first_sentence = row_article["Pierwsze Zdanie"]
    expected_last_sentence = row_article["Ostatnie Zdanie"]

    website_bytes = fetch_url(url)
    parsed_data = parse.extract_article_content(website_bytes)

    assert parsed_data["is_article"], f"Failed for {url}: Should be an article"

    # Title
    if not pd.isna(alternative_title):
        assert normalize_quotes(parsed_data["title"]).strip() in (normalize_quotes(expected_title).strip(),
                                                                  normalize_quotes(alternative_title).strip())
    else:
        assert normalize_quotes(parsed_data["title"]).strip() == normalize_quotes(expected_title).strip()

    # Date
    if not pd.isna(expected_date):
        assert parsed_data["publication_date"] == expected_date, \
            f"Hint, the date in the article looks like '{row_article['Data']}'"
    else:
        assert parsed_data["publication_date"] is None

    # Content
    if not pd.isna(expected_first_sentence):
        # Assert sentence starts in first 10% of string
        assert expected_first_sentence in parsed_data["article_content"]
        index = parsed_data["article_content"].index(expected_first_sentence)
        assert index <= len(parsed_data["article_content"]) * 0.1

    if not pd.isna(expected_last_sentence):
        # Assert sentence ends in last 90% of string
        assert expected_last_sentence in parsed_data["article_content"]
        index = parsed_data["article_content"].index(expected_last_sentence)
        assert len(parsed_data["article_content"]) * 0.9 < index + len(expected_last_sentence)


def test_no_article(row_no_article):
    url = row_no_article["Link"]

    website_bytes = fetch_url(url)
    parsed_data = parse.extract_article_content(website_bytes)

    assert not parsed_data["is_article"], f"Failed for {url}: Should NOT be an article"
