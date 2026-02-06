import argparse
import json
import logging
import os
import subprocess
import sys

from tqdm import tqdm

from parse import extract_article_content

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

                    extracted_data = extract_article_content(html_content_bytes)

                    record = {
                        "id": page_id,
                        "url": url,
                        "title": extracted_data["title"],
                        "is_article": extracted_data["is_article"],
                        "publication_date": extracted_data["publication_date"],
                        "content": extracted_data["article_content"],
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
                    print(record["content"])

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
