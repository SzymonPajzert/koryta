import argparse
import json
import logging
import os
import re
import sys
from datetime import datetime

import psycopg2
from bs4 import BeautifulSoup
from tqdm import tqdm

# Add src to python path
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from scrapers.article.crawler import get_pg_connection

logger = logging.getLogger(__name__)


def get_pages_to_parse(limit: int):
    """
    Fetches pages from the database that are ready to be parsed.
    """
    query = """
        SELECT id, url, storage_path
        FROM website_index
        WHERE done = TRUE AND storage_path IS NOT NULL
        LIMIT %s;
    """
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, (limit,))
            return cur.fetchall()


def parse_date(date_string: str) -> datetime | None:
    """
    Parses a date string from various formats.
    """
    if not date_string:
        return None
    try:
        # Handle ISO format and other common formats
        return datetime.fromisoformat(date_string.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        # Add more formats here if needed
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%d.%m.%Y %H:%M"):
            try:
                return datetime.strptime(date_string, fmt)
            except (ValueError, TypeError):
                continue
    return None


def extract_article_content(url: str, html_bytes: bytes) -> dict:
    """
    Parses HTML to extract title, main content, publication date, and determine if it's an article.
    """
    soup = BeautifulSoup(html_bytes, "html.parser")

    title = soup.title.string if soup.title else ""

    # Is_article scoring
    is_article_score = 0
    og_type = soup.find("meta", property="og:type")
    if og_type and og_type.get("content", "").lower() == "article":
        is_article_score += 2

    if soup.article:
        is_article_score += 1

    for keyword in ["article", "news", "wiadomosci", "informacje"]:
        if keyword in url:
            is_article_score += 1
            break

    # Date extraction
    publication_date = None
    date_selectors = [
        ("meta", {"property": "article:published_time"}),
        ("meta", {"name": "pubdate"}),
        ("meta", {"name": "date"}),
        ("meta", {"property": "og:article:published_time"}),
        ("meta", {"name": "cXenseParse:recs:publishtime"}),
        ("meta", {"name": "parsely-pub-date"}),
        ("time", {"datetime": True}),
    ]
    for tag, attrs in date_selectors:
        element = soup.find(tag, attrs)
        if element:
            date_str = element.get("content") or element.get("datetime")
            if date_str:
                publication_date = parse_date(date_str)
                if publication_date:
                    break

    # JSON-LD
    if not publication_date:
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                json_ld_text = script.string
                if json_ld_text:
                    json_ld = json.loads(json_ld_text)
                    if isinstance(json_ld, dict) and "datePublished" in json_ld:
                        publication_date = parse_date(json_ld["datePublished"])
                        if publication_date:
                            break
            except (json.JSONDecodeError, TypeError):
                continue

    # URL matching
    if not publication_date:
        match = re.search(r"/(\d{4})/(\d{2})/(\d{2})/", url)
        if match:
            try:
                publication_date = datetime(
                    int(match.group(1)), int(match.group(2)), int(match.group(3))
                )
            except ValueError:
                pass

    main_content_tag = None
    if soup.article:
        main_content_tag = soup.article
    elif soup.main:
        main_content_tag = soup.main
    else:
        # A simple heuristic to find a content div
        possible_ids = ["content", "main-content", "article", "article-body"]
        for pid in possible_ids:
            main_content_tag = soup.find("div", id=pid)
            if main_content_tag:
                break
        if not main_content_tag:
            possible_classes = [
                "content",
                "main-content",
                "article",
                "article-body",
                "post-content",
            ]
            for pclass in possible_classes:
                main_content_tag = soup.find("div", class_=pclass)
                if main_content_tag:
                    break

    if not main_content_tag:
        main_content_tag = soup.body

    content_text = ""
    if main_content_tag:
        # Remove script and style tags
        for script_or_style in main_content_tag(["script", "style"]):
            script_or_style.decompose()
        content_text = main_content_tag.get_text(separator="\n", strip=True)

    if 200 < len(content_text) < 20000:
        is_article_score += 1

    return {
        "title": title,
        "content": content_text,
        "is_article": is_article_score >= 2,
        "publication_date": publication_date.isoformat() if publication_date else None,
    }


def main():
    parser = argparse.ArgumentParser(description="Parse downloaded HTML articles.")
    parser.add_argument(
        "--limit",
        type=int,
        default=10,
        help="Number of articles to process.",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s - %(levelname)s - [%(name)s] %(message)s"
    )

    pages = get_pages_to_parse(args.limit)

    if not pages:
        logger.info("No pages to parse.")
        return

    output_filename = "parsed_articles.jsonl"

    logger.info(
        f"Found {len(pages)} pages to parse. Output will be saved to {output_filename}"
    )

    with open(output_filename, "w", encoding="utf-8") as f:
        for page_id, url, storage_path in tqdm(pages, desc="Parsing articles"):
            if not storage_path or not os.path.exists(storage_path):
                logger.warning(f"Storage path not found for URL {url}: {storage_path}")
                continue

            # handle GCS paths later
            if storage_path.startswith("gs://"):
                logger.info(f"Skipping GCS path for now: {storage_path}")
                continue

            try:
                with open(storage_path, "r") as html_file:
                    html_content_bytes = html_file.read()

                extracted_data = extract_article_content(url, html_content_bytes)

                record = {
                    "id": page_id,
                    "url": url,
                    "title": extracted_data["title"],
                    "is_article": extracted_data["is_article"],
                    "publication_date": extracted_data["publication_date"],
                    "content": extracted_data["content"],
                }

                f.write(json.dumps(record) + "\n")

            except Exception as e:
                logger.error(f"Failed to parse {url} from {storage_path}: {e}")

    logger.info(f"Finished parsing. Results saved to {output_filename}")


if __name__ == "__main__":
    main()
