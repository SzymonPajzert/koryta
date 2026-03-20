from functools import lru_cache
from hashlib import sha256
from pathlib import Path

import pandas as pd
import pytest
import requests

from scrapers.article import parse

URL_DF_PATH = Path(__file__).resolve().parent / "test_data" / "url_parsing.csv"
CACHE_DIR = Path(__file__).resolve().parent / "test_data" / "http_cache"
HEADERS = {"User-Agent": "KorytaCrawler/0.1 (+http://koryta.pl/crawler)"}
REFRESH_ENV = "REFRESH_HTTP_CACHE"


@lru_cache(maxsize=128)
def fetch_url(url: str) -> bytes:
    refresh = should_refresh(REFRESH_ENV)
    if not refresh:
        cached = read_cached_bytes(CACHE_DIR, url)
        if cached is not None:
            return cached

    response = requests.get(url, headers=HEADERS, timeout=10)
    response.raise_for_status()
    content = response.content
    write_cached_bytes(CACHE_DIR, url, content)
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
    pytest.skip("recreate these test files")
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


def get_hostname(url: str) -> str:
    # Minimal URL hostname parser without urllib.
    no_scheme = url.split("//", 1)[-1]
    host_port = no_scheme.split("/", 1)[0]
    host_port = host_port.split("@", 1)[-1]
    host = host_port.split(":", 1)[0]
    return host or "unknown"


def env_has_flag(env_var: str) -> bool:
    try:
        data = Path("/proc/self/environ").read_bytes()
    except FileNotFoundError:
        return False
    return f"{env_var}=1".encode() in data


def cache_path(base_dir: Path, url: str) -> Path:
    hostname = get_hostname(url)
    url_hash = sha256(url.encode("utf-8")).hexdigest()
    return base_dir / hostname / f"{url_hash}.bin"


def cache_meta_path(base_dir: Path, url: str) -> Path:
    hostname = get_hostname(url)
    url_hash = sha256(url.encode("utf-8")).hexdigest()
    return base_dir / hostname / f"{url_hash}.url"


def read_cached_bytes(base_dir: Path, url: str) -> bytes | None:
    path = cache_path(base_dir, url)
    if path.exists():
        return path.read_bytes()
    return None


def write_cached_bytes(base_dir: Path, url: str, content: bytes) -> None:
    path = cache_path(base_dir, url)
    meta_path = cache_meta_path(base_dir, url)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    if not meta_path.exists():
        meta_path.write_text(url + "\n")


def should_refresh(env_var: str) -> bool:
    return env_has_flag(env_var)
