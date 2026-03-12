from functools import lru_cache
import os
from hashlib import sha256
from pathlib import Path
from urllib.parse import urlparse

import pandas as pd
import requests

from . import parse

URL_DF_PATH = Path(__file__).resolve().parent / "test_data" / "url_parsing.csv"
CACHE_DIR = Path(__file__).resolve().parent / "test_data" / "http_cache"
HEADERS = {"User-Agent": "KorytaCrawler/0.1 (+http://koryta.pl/crawler)"}
REFRESH_ENV = "REFRESH_HTTP_CACHE"


def _cache_path(url: str) -> Path:
    parsed = urlparse(url)
    hostname = parsed.hostname or "unknown"
    url_hash = sha256(url.encode("utf-8")).hexdigest()
    return CACHE_DIR / hostname / f"{url_hash}.bin"


def _cache_meta_path(url: str) -> Path:
    parsed = urlparse(url)
    hostname = parsed.hostname or "unknown"
    url_hash = sha256(url.encode("utf-8")).hexdigest()
    return CACHE_DIR / hostname / f"{url_hash}.url"


def _ensure_cache_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def _read_cached_bytes(url: str) -> bytes | None:
    cache_path = _cache_path(url)
    if cache_path.exists():
        return cache_path.read_bytes()
    return None


def _write_cached_bytes(url: str, content: bytes) -> None:
    cache_path = _cache_path(url)
    meta_path = _cache_meta_path(url)
    _ensure_cache_dir(cache_path)
    cache_path.write_bytes(content)
    if not meta_path.exists():
        meta_path.write_text(url + "\n")


@lru_cache(maxsize=128)
def fetch_url(url: str) -> bytes:
    refresh = os.getenv(REFRESH_ENV) == "1"
    if not refresh:
        cached = _read_cached_bytes(url)
        if cached is not None:
            return cached
        raise FileNotFoundError(
            f"Missing cached response for {url}. "
            f"Set {REFRESH_ENV}=1 to fetch and populate cache."
        )

    response = requests.get(url, headers=HEADERS, timeout=10)
    response.raise_for_status()
    content = response.content
    _write_cached_bytes(url, content)
    return content


def normalize_quotes(text: str) -> str:
    """Normalizes various quotes to straight double and single quotes."""
    text = text.replace("”", '"').replace("„", '"').replace("“", '"').replace("″", '"')
    text = text.replace("’", "'").replace("‘", "'").replace("«", '"').replace("»", '"')
    text = text.replace("›", "'").replace("‹", "'")
    text = text.replace("''", '"')
    return text


def pytest_generate_tests(metafunc):
    """Dynamically generates test cases from the CSV file."""
    df = pd.read_csv(URL_DF_PATH)
    assert set(df.columns) == {
        "Link",
        "Artykuł",
        "Domena",
        "Tytuł",
        "Tytuł Alternatywny",
        "Data",
        "Data Normalizowana",
        "Kto",
        "Gdzie",
        "Pierwsze Zdanie",
        "Ostatnie Zdanie",
    }
    df["Pierwsze Zdanie"] = df["Pierwsze Zdanie"].replace("", None)
    df["Ostatnie Zdanie"] = df["Ostatnie Zdanie"].replace("", None)
    df["Tytuł Alternatywny"] = df["Tytuł Alternatywny"].replace("", None)
    df["Data Normalizowana"] = df["Data Normalizowana"].replace("Brak", None)
    df["Data Normalizowana"] = pd.to_datetime(df["Data Normalizowana"]).dt.date

    if "row_article" in metafunc.fixturenames:
        # Filter for rows that ARE articles
        articles = df[df["Artykuł"] == "Tak"]
        metafunc.parametrize("row_article", articles.to_dict("records"))

    if "row_no_article" in metafunc.fixturenames:
        # Filter for rows that ARE NOT articles
        no_articles = df[df["Artykuł"] == "Nie"]
        metafunc.parametrize("row_no_article", no_articles.to_dict("records"))


def test_article_title(row_article):
    url = row_article["Link"]
    expected_title = row_article["Tytuł"]
    alternative_title = row_article["Tytuł Alternatywny"]

    website_bytes = fetch_url(url)
    parsed_data = parse.extract_article_content(website_bytes)

    assert parsed_data["is_article"], f"Failed for {url}: Should be an article"

    # Title
    if not pd.isna(alternative_title):
        assert normalize_quotes(parsed_data["title"]).strip() in (
            normalize_quotes(expected_title).strip(),
            normalize_quotes(alternative_title).strip(),
        )
    else:
        assert (
            normalize_quotes(parsed_data["title"]).strip()
            == normalize_quotes(expected_title).strip()
        )


def test_article_date(row_article):
    url = row_article["Link"]
    expected_date = row_article["Data Normalizowana"]

    website_bytes = fetch_url(url)
    parsed_data = parse.extract_article_content(website_bytes)

    assert parsed_data["is_article"], f"Failed for {url}: Should be an article"

    # Date
    if not pd.isna(expected_date):
        assert parsed_data["publication_date"] == expected_date, (
            f"Hint, the date in the article looks like '{row_article['Data']}'"
        )
    else:
        assert parsed_data["publication_date"] is None


def test_article_content(row_article):
    url = row_article["Link"]
    expected_first_sentence = row_article["Pierwsze Zdanie"]
    expected_last_sentence = row_article["Ostatnie Zdanie"]

    website_bytes = fetch_url(url)
    parsed_data = parse.extract_article_content(website_bytes)

    assert parsed_data["is_article"], f"Failed for {url}: Should be an article"

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
        assert len(parsed_data["article_content"]) * 0.9 < index + len(
            expected_last_sentence
        )


def test_no_article(row_no_article):
    url = row_no_article["Link"]

    website_bytes = fetch_url(url)
    parsed_data = parse.extract_article_content(website_bytes)

    assert not parsed_data["is_article"], f"Failed for {url}: Should NOT be an article"
