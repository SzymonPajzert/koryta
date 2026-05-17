import argparse
import json
import sys
import time
from time import sleep

import requests

from conductor import setup_context
from scrapers.kmgp.people import PeopleKMGP
from scrapers.krs.scrape import ScrapeRejestrIO


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
            # TODO we need to detect the format of the uploaded data
            ctx.io.upload(url, response.text, "application/json", include_query=True)
            print(f"Successfully scraped and uploaded: {url}")

        except requests.RequestException as e:
            print(f"Failed to fetch {url}: {e}")
        except Exception as e:
            print(f"An error occurred while uploading {url}: {e}")

        # Optional delay to avoid hammering servers too fast
        time.sleep(0.3)


def scrape_krs():
    ctx, _ = setup_context(use_rejestr_io=True)
    pipeline = ScrapeRejestrIO()
    urls = pipeline.read_or_process_list(ctx)
    print(f"Will cost: {sum(map(lambda x: x[1], urls))} PLN")
    input("Press enter to continue...")

    skip = 0
    for url, _, skip_on_fail in urls:
        if skip > 0:
            print(f"Skipping {url} (skipping {skip} more)")
            skip -= 1
            continue
        if "rejestr.io" in url:
            result = ctx.rejestr_io.get_rejestr_io(url)
        else:
            print(f"Requesting: {url}")
            try:
                response = requests.get(url)
                result = response.json()
            except requests.exceptions.JSONDecodeError:
                print(f"Failed to decode JSON from {url}, skipping")
                print(f"Response: {response.text}")
                skip = skip_on_fail
                continue
            if "odpis" not in result:
                print(f"Unexpected response for {url}: {result}, skipping")
                skip = skip_on_fail
                continue
            dzial1 = result["odpis"]["dane"]["dzial1"]
            dane = dzial1["danePodmiotu"]
            miasto = dzial1["siedzibaIAdres"]["adres"]["miejscowosc"]
            print(f"{dane.get('nazwa', dane)} - {miasto}")
            result = json.dumps(result)
        sleep(0.3)

        if result is None:
            print(f"Skipping {url}")
            continue

        # We're discarding query params, so it's a hotfix for this
        url = url.replace("?aktualnosc=", "/aktualnosc_")
        url = url.replace("?rejestr=P&format=json", "")
        ctx.io.upload(url, result, "application/json")
