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
from scrapers.krs.updates import KRSUpdates
from scrapers.stores import ProcessPolicy
from stores.storage import warsaw_tz

FIRST_DAY = date(2025, 6, 1)

#: EX_TEMPFAIL, as the other KRS jobs have it: a day was left unfetched, and
#: the next run asks for it again.
EXIT_TRY_LATER = 75


#: How long after a day ends its bulletin failing still says "try later". Six
#: days of 2025-11 have answered HTTP 500 on every run since; counted, they
#: made every run exit 75, and the exit code said nothing about the night.
GIVE_UP_AFTER = timedelta(days=14)


@dataclass
class BulletinRun:
    """Which days a run stored, and which it asked for and did not get."""

    fetched: list[str] = field(default_factory=list)
    #: Not got, and recent enough that a later run may get it.
    failed: list[str] = field(default_factory=list)
    #: Not got, long after the day ended: missing at the source. Still asked
    #: for on every run, and listed, but no reason to call the run unfinished.
    unavailable: list[str] = field(default_factory=list)

    def missed(self, day: str, today: date) -> None:
        stale = date.fromisoformat(day) < today - GIVE_UP_AFTER
        (self.unavailable if stale else self.failed).append(day)


def warsaw_today() -> date:
    return datetime.now(warsaw_tz).date()


def days_to_fetch(stored: set[str], today: date) -> list[str]:
    """The days from FIRST_DAY up to yesterday with no bulletin on file."""
    days = []
    current_date = FIRST_DAY
    while current_date < today:
        if (day := current_date.isoformat()) not in stored:
            days.append(day)
        current_date += timedelta(days=1)
    return days


def scrape_updates_by_dates(sleep_time=0.2) -> BulletinRun:
    ctx, _ = setup_context(policy=ProcessPolicy(set()))

    # What is on file, read off the listing. KRSUpdates' rows cannot say it: a
    # day nobody's entry changed on has none, so it was fetched again on every
    # run (2025-09-20 and 09-21, three times on 2026-10-02) - and building the
    # pipeline for it cost a 143 MB rebuild and 20 s turning its rows into
    # objects, before the run's own tree built it again anyway.
    stored = KRSUpdates().days_crawled(ctx)
    print(
        f"{len(stored)} bulletin days stored, the newest {max(stored, default='none')}"
    )

    run = BulletinRun()
    today = warsaw_today()
    for date_str in days_to_fetch(stored, today):
        url = f"https://api-krs.ms.gov.pl/api/Krs/Biuletyn/{date_str}"
        print(f"Requesting: {url}")
        try:
            response = requests.get(url, timeout=REQUEST_TIMEOUT)
            if response.status_code == 200:
                # Parse to ensure it's valid JSON
                response.json()
                if ctx.io.upload(url, response.text, "application/json") is False:
                    run.missed(date_str, today)
                else:
                    run.fetched.append(date_str)
                    print(f"Successfully scraped and uploaded for date: {date_str}")
            else:
                print(f"Failed to fetch {url}: HTTP {response.status_code}")
                run.missed(date_str, today)
        except Exception as e:
            print(f"An error occurred while uploading {url}: {e}")
            run.missed(date_str, today)
        sleep(sleep_time)

    return run


def main() -> int:
    return EXIT_TRY_LATER if scrape_updates_by_dates().failed else 0
