"""The free half of the KRS scrape: the bulletin, then an odpis for every query.

`ScrapeRejestrIO` lists what is worth asking about; this asks api-krs for each
query's free URLs and writes every answer to the crawl bucket - an empty object
where there was none. Nothing here is paid for.

    koryta_scrape_krs_free
"""

from time import sleep

from tqdm import tqdm

from conductor import setup_context
from jobs.krs_bulletin import scrape_updates_by_dates
from jobs.krs_common import REFRESH_PIPELINES, query_krs_api, upload_result
from scrapers.krs.scrape import ScrapeRejestrIO
from scrapers.stores import ProcessPolicy


def scrape_krs_free(sleep_time=0.2):
    """Phase 1: Scrape bulletin updates and free api-krs queries.

    This updates the bulletin data and api-krs OdpisAktualny snapshots.
    No cost — all queries go to the free api-krs.ms.gov.pl API.
    """
    scrape_updates_by_dates(sleep_time)
    ctx, _ = setup_context(policy=ProcessPolicy(REFRESH_PIPELINES))
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
                print(f"Recording failure for {url} as an empty file...")
                result = ""
            upload_result(ctx, url, result, verbose=False)
            sleep(sleep_time)

        if any_succeeded:
            successful_krs.add(query.krs)
        else:
            failures += 1

    print(
        f"Successfully scraped {len(successful_krs)} KRS numbers, {failures} failures"
    )


def main():
    scrape_krs_free()
