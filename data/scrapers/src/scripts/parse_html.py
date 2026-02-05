import argparse
import json
import logging
import os
import subprocess
import sys
from datetime import datetime

from bs4 import BeautifulSoup
from bs4 import Comment
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
            WHERE done = TRUE
              AND storage_path IS NOT NULL
                LIMIT %s; \
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


import json
import re
from datetime import datetime
from bs4 import BeautifulSoup, Comment


def extract_article_content(url: str, html_bytes: bytes) -> dict:
    # 1. Parse and Pre-clean
    # Using 'lxml' is faster and more robust if available, otherwise 'html.parser'
    soup = BeautifulSoup(html_bytes, "html.parser")

    # Remove obvious non-content noise before analysis
    for noise in soup(["script", "style", "nav", "footer", "header", "aside", "form", "iframe"]):
        noise.decompose()

    # --- 1. METADATA VALIDATION ---
    publication_date = None
    is_article_by_meta = False

    # Check JSON-LD for "NewsArticle" or "BlogPosting"
    # Homepages (like bad2.html) often list multiple types or just "WebSite"
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string)
            nodes = data.get("@graph", [data]) if isinstance(data, dict) else data
            for node in nodes:
                if isinstance(node, dict):
                    node_type = str(node.get("@type", ""))
                    if any(x in node_type for x in ["Article", "NewsArticle", "BlogPosting"]):
                        # Verify this isn't just a snippet in a list
                        date_str = node.get("datePublished")
                        if date_str:
                            publication_date = parse_date(date_str)
                            is_article_by_meta = True
                            break
        except:
            continue

    # --- 2. CONTENT SCORING (Standard Assumptions) ---
    # Find the "Main" container. role="main" is the modern accessibility standard.
    main_tag = soup.find("article") or soup.find("main") or soup.find(role="main") or soup.body

    # Heuristic: Article content has high text density and few links.
    # Homepages have many <a> tags relative to text length.
    content_text = ""
    if main_tag:
        # Get text while preserving paragraph breaks
        content_text = main_tag.get_text(separator="\n", strip=True)

        # Calculate Link Density: (Total Link Text Length) / (Total Text Length)
        links = main_tag.find_all("a")
        link_text_len = sum(len(a.get_text(strip=True)) for a in links)
        total_text_len = len(content_text)
        link_density = link_text_len / total_text_len if total_text_len > 0 else 1
    else:
        link_density = 1

    # --- 3. FINAL IS_ARTICLE DECISION ---
    # Thresholds based on file analysis:
    # - Good articles have link density < 20% (mostly body text).
    # - Homepages have link density > 50% (mostly menus/headlines).
    # - Articles should have a substantial word count (> 200 words).
    word_count = len(content_text.split())

    is_article = False
    if is_article_by_meta and link_density < 0.35 and word_count > 200:
        is_article = True
    elif link_density < 0.20 and word_count > 300:  # Strong content even without meta
        is_article = True

    # Title fallback
    og_title = soup.find("meta", property="og:title")
    title = og_title.get("content") if og_title else (soup.title.string if soup.title else "")

    return {
        "title": title.strip() if title else "",
        "content": content_text.strip(),
        "is_article": is_article,
        "publication_date": publication_date.isoformat() if publication_date else None,
        "metrics": {"word_count": word_count, "link_density": round(link_density, 2)}  # For debugging
    }

def main():
    parser = argparse.ArgumentParser(description="Parse downloaded HTML articles.")
    parser.add_argument(
        "--limit",
        type=int,
        default=10,
        help="Number of articles to process.",
    )
    parser.add_argument(
        "--view",
        action="store_true",
        help="Open each parsed HTML in Firefox for manual validation.",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s - %(levelname)s - [%(name)s] %(message)s"
    )

    pages = get_pages_to_parse(args.limit)

    if not pages:
        logger.info("No pages to parse.")
        return

    if args.view:
        logger.info(
            f"Found {len(pages)} pages to parse. Opening in Firefox for manual validation."
        )
        try:
            for page_id, url, storage_path in pages:
                if not storage_path or not os.path.exists(storage_path):
                    logger.warning(f"Storage path not found for URL {url}: {storage_path}")
                    continue

                if storage_path.startswith("gs://"):
                    logger.info(f"Skipping GCS path for now: {storage_path}")
                    continue

                try:
                    with open(storage_path, "rb") as html_file:
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
                    if not record["is_article"]:
                        continue

                    logger.info(f"Opening {url} in Firefox...")
                    # Replace webbrowser.open with this:
                    subprocess.Popen(
                        ["firefox", f"file://{os.path.abspath(storage_path)}"],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL
                    )
                    print("\n" + "=" * 80)
                    print("=" * 80 + "\n")
                    print(f"URL: {record['url']}")
                    print(f"Title: {record['title']}")
                    print(f"Is Article: {record['is_article']}")
                    print(f"Publication Date: {record['publication_date']}")
                    print("-" * 80)
                    print("Content:")
                    print(record["content"][:1000] + "..." if len(record["content"]) > 1000 else record[
                        "content"])  # Print first 1000 chars of content

                    input("Press Enter to continue, or Ctrl+C to quit...")

                except KeyboardInterrupt:
                    logger.info("Viewer interrupted by user. Exiting.")
                    break
                except Exception as e:
                    logger.error(f"Failed to parse or view {url} from {storage_path}: {e}")
        except KeyboardInterrupt:
            logger.info("Viewer interrupted by user. Exiting.")

    else:
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
