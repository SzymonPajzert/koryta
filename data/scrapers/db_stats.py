import psycopg2
import os
from datetime import datetime, timedelta
from collections import Counter
import logging
import sys

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s', stream=sys.stdout)
logger = logging.getLogger(__name__)

# PostgreSQL Connection Details (should match crawler.py)
DB_HOST = os.getenv("POSTGRES_HOST", "localhost")
DB_NAME = os.getenv("POSTGRES_DB", "crawler_db")
DB_USER = os.getenv("POSTGRES_USER", "crawler_user")
DB_PASSWORD = os.getenv("POSTGRES_PASSWORD", "crawler_password")

def get_pg_connection():
    return psycopg2.connect(host=DB_HOST, database=DB_NAME, user=DB_USER, password=DB_PASSWORD)

def print_db_stats():
    logger.info("Connecting to PostgreSQL database...")
    try:
        with get_pg_connection() as pg_conn:
            with pg_conn.cursor() as cur:
                logger.info("Successfully connected to the database.")

                # 1. Number of URLs
                cur.execute("SELECT COUNT(*) FROM website_index;")
                total_urls = cur.fetchone()[0]
                logger.info(f"Total URLs: {total_urls}")

                # 2. Finished URLs
                cur.execute("SELECT COUNT(*) FROM website_index WHERE done = TRUE;")
                finished_urls = cur.fetchone()[0]
                logger.info(f"Finished URLs: {finished_urls}")

                # 3. Hanging/Pending URLs
                cur.execute("SELECT COUNT(*) FROM website_index WHERE done = FALSE;")
                pending_urls = cur.fetchone()[0]
                logger.info(f"Pending URLs: {pending_urls}")

                # 4. URLs with errors
                cur.execute("SELECT COUNT(*) FROM website_index WHERE array_length(errors, 1) > 0;")
                urls_with_errors = cur.fetchone()[0]
                logger.info(f"URLs with errors: {urls_with_errors}")

                # 5. Total number of errors
                cur.execute("SELECT SUM(array_length(errors, 1)) FROM website_index WHERE array_length(errors, 1) > 0;")
                total_errors = cur.fetchone()[0] or 0 # SUM might return None if no errors
                logger.info(f"Total error occurrences: {total_errors}")

                # 6. Most popular errors
                cur.execute("SELECT unnest(errors) AS error_msg FROM website_index WHERE array_length(errors, 1) > 0;")
                all_error_messages = [row[0] for row in cur.fetchall()]
                if all_error_messages:
                    error_counts = Counter(all_error_messages)
                    logger.info("Most popular errors:")
                    for error_msg, count in error_counts.most_common(5):
                        logger.info(f"  - {error_msg}: {count} times")
                else:
                    logger.info("No error messages recorded.")

                # 7. Queries per second (average URLs processed per second)
                cur.execute("SELECT MIN(date_added), MAX(date_finished) FROM website_index WHERE done = TRUE;")
                min_date_added, max_date_finished = cur.fetchone()

                if finished_urls > 0 and min_date_added and max_date_finished:
                    time_span = max_date_finished - min_date_added
                    if time_span.total_seconds() > 0:
                        urls_per_second = finished_urls / time_span.total_seconds()
                        logger.info(f"Average URLs processed per second: {urls_per_second:.2f}")
                    else:
                        logger.info("Time span for finished URLs is too short to calculate average rate.")
                else:
                    logger.info("Not enough finished URLs to calculate average processing rate.")

                # 8. Average processing time per finished URL
                cur.execute("SELECT AVG(EXTRACT(EPOCH FROM (date_finished - date_added))) FROM website_index WHERE done = TRUE AND date_finished IS NOT NULL;")
                avg_processing_time_seconds = cur.fetchone()[0]
                if avg_processing_time_seconds is not None:
                    logger.info(f"Average processing time per finished URL: {avg_processing_time_seconds:.2f} seconds")
                else:
                    logger.info("No finished URLs with valid date_added/date_finished to calculate average processing time.")


    except psycopg2.OperationalError as e:
        logger.error(f"Failed to connect to the database: {e}")
        logger.error("Please ensure PostgreSQL is running and connection details (host, port, user, password, dbname) are correct.")
    except Exception as e:
        logger.error(f"An unexpected error occurred: {e}")

if __name__ == "__main__":
    print_db_stats()