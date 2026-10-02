"""Fetch every day of the KRS bulletin not yet in the crawl bucket.

The bulletin names each KRS number whose entry changed that day; `KRSUpdates`
reads it, and through it the free scrape, the paid scrape and the register job
decide what is out of date. Free - api-krs asks for no key.

A day is fetched once it is over in Warsaw, the clock the crawl bucket's
`date=` already keeps. A host on UTC (Cloud Run, predator) is still on that day
until 02:00 in summer, so by its own clock a run at 00:30 would leave the day
that has just ended for the next night.

    koryta_scrape_krs_updates
"""

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from time import sleep

import requests

from conductor import setup_context
from jobs.krs_common import REQUEST_TIMEOUT
from scrapers.krs.columns import ISO_DATE_LENGTH
from scrapers.krs.updates import KRSUpdates
from scrapers.stores import ProcessPolicy
from stores.storage import warsaw_tz

FIRST_DAY = date(2025, 6, 1)

#: EX_TEMPFAIL, as the other KRS jobs have it: a day was left unfetched, and
#: the next run asks for it again.
EXIT_TRY_LATER = 75


@dataclass
class BulletinRun:
    """Which days a run stored, and which it asked for and did not get."""

    fetched: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)


def warsaw_today() -> date:
    return datetime.now(warsaw_tz).date()


def scrape_updates_by_dates(sleep_time=0.2) -> BulletinRun:
    ctx, _ = setup_context(policy=ProcessPolicy({"KRSUpdates"}))

    today = warsaw_today()

    pipeline = KRSUpdates()
    already_scraped_dates = set()
    for update in pipeline.read_or_process_list(ctx):
        # Truncated, because a run that reads the cached output rather than
        # rebuilding it gets "2025-06-02 00:00:00" here: pandas parses a column
        # named `date` into a Timestamp whatever dtype asks for. That matches
        # no date_str below, so every bulletin day since 2025-06-01 would be
        # fetched again, on every run.
        already_scraped_dates.add(str(update.date)[:ISO_DATE_LENGTH])

    print(
        f"{len(already_scraped_dates)} bulletin days stored, the newest "
        f"{max(already_scraped_dates, default='none')}"
    )

    run = BulletinRun()
    current_date = FIRST_DAY
    while current_date < today:
        date_str = current_date.strftime("%Y-%m-%d")
        if date_str in already_scraped_dates:
            current_date += timedelta(days=1)
            continue

        url = f"https://api-krs.ms.gov.pl/api/Krs/Biuletyn/{date_str}"
        print(f"Requesting: {url}")
        try:
            response = requests.get(url, timeout=REQUEST_TIMEOUT)
            if response.status_code == 200:
                # Parse to ensure it's valid JSON
                response.json()
                if ctx.io.upload(url, response.text, "application/json") is False:
                    run.failed.append(date_str)
                else:
                    run.fetched.append(date_str)
                    print(f"Successfully scraped and uploaded for date: {date_str}")
            else:
                print(f"Failed to fetch {url}: HTTP {response.status_code}")
                run.failed.append(date_str)
        except Exception as e:
            print(f"An error occurred while uploading {url}: {e}")
            run.failed.append(date_str)
        sleep(sleep_time)

        current_date += timedelta(days=1)

    return run


def main() -> int:
    return EXIT_TRY_LATER if scrape_updates_by_dates().failed else 0
