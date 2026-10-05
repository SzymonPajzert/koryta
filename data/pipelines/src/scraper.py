import argparse
import sys
import time

import requests

from conductor import setup_context
from jobs.krs_bulletin import scrape_updates_by_dates
from jobs.krs_common import REFRESH_PIPELINES, query_krs_api, upload_result
from jobs.krs_scrape_free import scrape_krs_free
from jobs.krs_scrape_paid import scrape_krs_paid
from scrapers.kmgp.people import PeopleKMGP

#: The KRS scrape moved to `jobs`. These names stay importable from here for
#: one cycle - `krs_nip_resolve.py` on krs-odpis-board-members imports
#: `upload_result` from this module, and venvs installed before the move run
#: the console scripts through it until they are reinstalled.
__all__ = [
    "REFRESH_PIPELINES",
    "query_krs_api",
    "scrape_krs",
    "scrape_krs_free",
    "scrape_krs_paid",
    "scrape_updates_by_dates",
    "upload_result",
]


def get_urls_to_scrape(ctx):
    pipeline = PeopleKMGP()
    teryts = set()
    for payload in pipeline.list_people(ctx):
        if payload.teryt:
            teryts.add(payload.teryt)

    urls = ["https://kazdymusigdziespracowac.pl/wp-json/kmgp-map/v1/employment-stats"]
    for teryt in sorted(teryts):
        urls.append(
            f"https://kazdymusigdziespracowac.pl/wp-json/kmgp-map/v1/bir12?teryt={teryt}"
        )
    return urls


def main():
    parser = argparse.ArgumentParser(
        description="Scrape URLs and upload their HTML to Google Cloud Storage."
    )

    # Initialize the context, similar to krs/scrape.py pipeline execution but manually
    ctx, _ = setup_context()

    urls_to_scrape = get_urls_to_scrape(ctx)
    if not urls_to_scrape:
        print("No URLs specified. Please provide URLs via arguments")
        parser.print_help()
        sys.exit(1)

    print(f"Loaded {len(urls_to_scrape)} URLs to scrape.")

    for url in urls_to_scrape:
        print(f"Requesting: {url}")
        try:
            response = requests.get(url)
            response.raise_for_status()
            ctx.io.upload(url, response.text, "application/json", include_query=True)
            print(f"Successfully scraped and uploaded: {url}")

        except requests.RequestException as e:
            print(f"Failed to fetch {url}: {e}")
        except Exception as e:
            print(f"An error occurred while uploading {url}: {e}")

        # Optional delay to avoid hammering servers too fast
        time.sleep(0.3)


def scrape_krs(sleep_time=0.2):
    """Run both phases: free api-krs queries then paid rejestr.io."""
    scrape_krs_free(sleep_time)
    scrape_krs_paid(sleep_time)
