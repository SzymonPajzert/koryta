import argparse
import sys
import time

import requests

from conductor import setup_context
from scrapers.kmgp.people import PeopleKMGP


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
            ctx.io.upload(url, response.text, "application/json")
            print(f"Successfully scraped and uploaded: {url}")

        except requests.RequestException as e:
            print(f"Failed to fetch {url}: {e}")
        except Exception as e:
            print(f"An error occurred while uploading {url}: {e}")

        # Optional delay to avoid hammering servers too fast
        time.sleep(0.3)


if __name__ == "__main__":
    main()
