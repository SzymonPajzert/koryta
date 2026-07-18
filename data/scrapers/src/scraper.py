import argparse
import json
import sys
import time
from datetime import datetime, timedelta
from time import sleep

import requests
from tqdm import tqdm

from conductor import setup_context
from scrapers.kmgp.people import PeopleKMGP
from scrapers.krs.scrape import ScrapeRejestrIO
from scrapers.krs.updates import KRSUpdates
from scrapers.stores import Context, ProcessPolicy


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
    ctx, _ = setup_context(use_rejestr_io=False)

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


def query_krs_api(url, verbose=True) -> str | None:
    def print_filtered(*args, **kwargs):
        if verbose:
            print(*args, **kwargs)

    print_filtered(f"Requesting: {url}")
    response = None
    result = {}
    try:
        response = requests.get(url)
        if response.text == "":
            return None
        result = response.json()
    except requests.exceptions.JSONDecodeError:
        print_filtered(f"Failed to decode JSON from {url}, skipping")
        if response is not None:
            print(f"Response: '{response.text}'")
            raise ValueError("Failed to decode non-empty response")
        return None

    # either expect odpis or title == Not Found
    if not ("odpis" in result or result.get("title", "") == "Not Found"):
        raise ValueError(f"Unexpected response for {url}: {result}, skipping this KRS")

    if "odpis" in result:
        # Printing data about the company
        dzial1 = result["odpis"]["dane"]["dzial1"]
        dane = dzial1.get("danePodmiotu", {})
        if "siedzibaIAdres" in dzial1:
            miasto = dzial1["siedzibaIAdres"]["adres"]["miejscowosc"]
            print_filtered(f"{dane.get('nazwa', dane)} - {miasto}")
    return json.dumps(result)


def upload_result(ctx: Context, url, result, verbose=True):
    # We're discarding query params, so it's a hotfix for this
    url = url.replace("?aktualnosc=", "/aktualnosc_")
    url = url.replace("&format=json", "")
    ctx.io.upload(url, result, "application/json", verbose=verbose, include_query=True)


REFRESH_PIPELINES = {
    "ScrapeRejestrIO",
    "KRSAlreadyScraped",
    "KRSCensoredPeople",
    "KRSNeedsRefresh",
    "CompaniesKRS",
    "KRSUpdates",
}


def scrape_krs_free(sleep_time=0.2):
    """Phase 1: Scrape bulletin updates and free api-krs queries.

    This updates the bulletin data and api-krs OdpisAktualny snapshots.
    No cost — all queries go to the free api-krs.ms.gov.pl API.
    """
    scrape_updates_by_dates(sleep_time)
    ctx, _ = setup_context(
        use_rejestr_io=False,
        policy=ProcessPolicy(REFRESH_PIPELINES),
    )
    pipeline = ScrapeRejestrIO()
    queries = list(pipeline.read_or_process_list(ctx))

    successful_krs = set()
    failures = 0

    for query in tqdm(queries):
        if query.krs is None:
            continue

        any_succeeded = False
        for url in query.urls(only_free=True):
            assert "rejestr.io" not in url
            result = query_krs_api(url, verbose=False)
            if result is not None:
                any_succeeded = True
            else:
                print(
                    f"Recording failure for {url}"
                    f" as an empty file..."
                )
                result = ""
            upload_result(ctx, url, result, verbose=False)
            sleep(sleep_time)

        if any_succeeded:
            successful_krs.add(query.krs)
        else:
            failures += 1

    print(
        f"Successfully scraped {len(successful_krs)}"
        f" KRS numbers, {failures} failures"
    )


def scrape_krs_paid(sleep_time=0.2):
    """Phase 2: Query rejestr.io for KRS entries with confirmed changes.

    Uses the KRSCensoredPeople pre-filter to skip KRS entries
    where the censored people list didn't change. Only pays for
    rejestr.io queries where there's an actual difference.
    """
    ctx, _ = setup_context(
        use_rejestr_io=True,
        policy=ProcessPolicy(REFRESH_PIPELINES),
    )
    pipeline = ScrapeRejestrIO()
    queries = list(pipeline.read_or_process_list(ctx))

    cost = sum(q.cost() for q in queries)
    print(f"Will cost: {cost} PLN")
    input("Press enter to continue...")

    for query in queries:
        for url in query.urls():
            if "rejestr.io" not in url:
                continue

            result = ctx.rejestr_io.get_rejestr_io(url)
            if result is None:
                print(f"Skipping {url}")
                continue

            upload_result(ctx, url, result)
            sleep(sleep_time)


def scrape_krs(sleep_time=0.2):
    """Run both phases: free api-krs queries then paid rejestr.io."""
    scrape_krs_free(sleep_time)
    scrape_krs_paid(sleep_time)



def scrape_updates_by_dates(sleep_time=0.2):
    ctx, _ = setup_context(use_rejestr_io=False, policy=ProcessPolicy({"KRSUpdates"}))

    start_date = datetime.strptime("2025-06-01", "%Y-%m-%d").date()
    today = datetime.now().date()

    pipeline = KRSUpdates()
    already_scraped_dates = set()
    for update in pipeline.read_or_process_list(ctx):
        already_scraped_dates.add(update.date)

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
