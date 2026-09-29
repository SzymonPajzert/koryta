"""Fetch every day of the KRS bulletin not yet in the crawl bucket.

The bulletin names each KRS number whose entry changed that day; `KRSUpdates`
reads it, and through it the free scrape, the paid scrape and the register job
decide what is out of date. Free - api-krs asks for no key.

    koryta_scrape_krs_updates
"""

from datetime import datetime, timedelta
from time import sleep

import requests

from conductor import setup_context
from scrapers.krs.columns import ISO_DATE_LENGTH
from scrapers.krs.updates import KRSUpdates
from scrapers.stores import ProcessPolicy


def scrape_updates_by_dates(sleep_time=0.2):
    ctx, _ = setup_context(policy=ProcessPolicy({"KRSUpdates"}))

    start_date = datetime.strptime("2025-06-01", "%Y-%m-%d").date()
    today = datetime.now().date()

    pipeline = KRSUpdates()
    already_scraped_dates = set()
    for update in pipeline.read_or_process_list(ctx):
        # Truncated, because a run that reads the cached output rather than
        # rebuilding it gets "2025-06-02 00:00:00" here: pandas parses a column
        # named `date` into a Timestamp whatever dtype asks for. That matches
        # no date_str below, so every bulletin day since 2025-06-01 would be
        # fetched again, on every run.
        already_scraped_dates.add(str(update.date)[:ISO_DATE_LENGTH])

    print("already_scraped_dates: ", already_scraped_dates)

    current_date = start_date
    while current_date < today:
        date_str = current_date.strftime("%Y-%m-%d")
        if date_str in already_scraped_dates:
            current_date += timedelta(days=1)
            continue

        url = f"https://api-krs.ms.gov.pl/api/Krs/Biuletyn/{date_str}"
        print(f"Requesting: {url}")
        try:
            response = requests.get(url)
            if response.status_code == 200:
                # Parse to ensure it's valid JSON
                response.json()
                ctx.io.upload(url, response.text, "application/json")
                print(f"Successfully scraped and uploaded for date: {date_str}")
            else:
                print(f"Failed to fetch {url}: HTTP {response.status_code}")
        except Exception as e:
            print(f"An error occurred while uploading {url}: {e}")
        sleep(sleep_time)

        current_date += timedelta(days=1)


def main():
    scrape_updates_by_dates()
