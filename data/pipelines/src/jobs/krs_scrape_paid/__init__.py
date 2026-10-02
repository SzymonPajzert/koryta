"""The paid half of the KRS scrape: rejestr.io, for the queries worth money.

Recomputes `ScrapeRejestrIO` after the free half has written, prints what the
bill is made of and what it comes to, and waits for Enter before buying.

    koryta_scrape_krs_paid

A company's connections are left out where its people already come from a
current odpis pełny (`ScrapeRejestrIO.companies_told_by_the_odpis`), so the
bill is smallest after `koryta_krs_odpis` and a rebuild of the seats:

    koryta_krs_odpis
    koryta PeopleKRSCombined --refresh KrsOdpisSeats --refresh KrsOdpisEntries
    koryta_scrape_krs_paid
"""

from time import sleep

from conductor import setup_context
from jobs.krs_common import REFRESH_PIPELINES, upload_result
from scrapers.krs.scrape import ScrapeRejestrIO, cost_breakdown, public_krs_ids
from scrapers.stores import ProcessPolicy, RejestrIO


def scrape_krs_paid(sleep_time=0.2):
    """Phase 2: Query rejestr.io for KRS entries with confirmed changes.

    Uses the KRSCensoredPeople pre-filter to skip KRS entries
    where the censored people list didn't change. Only pays for
    rejestr.io queries where there's an actual difference.
    """
    # The queries come off a pipeline, but the paid calls are made here, so
    # this phase asks for the client itself rather than declaring it.
    ctx, _ = setup_context([RejestrIO], policy=ProcessPolicy(REFRESH_PIPELINES))
    pipeline = ScrapeRejestrIO()
    queries = list(pipeline.read_or_process_list(ctx))

    # What the bill is made of, not just what it comes to. Every query carries
    # the reason it exists, and the reasons are not worth the same money: a
    # refresh re-buys a company we already hold, a person feed is one name, and
    # a newly discovered public company is the thing the site is for.
    # The register's own public verdicts count too: a company found that way
    # is not in `CompaniesKRS` until its odpis has been crawled.
    public = public_krs_ids(pipeline.companies.read_or_process(ctx)) | {
        krs.id for krs in pipeline.owned_per_the_register(ctx)
    }
    print(cost_breakdown(queries, public))

    cost = sum(q.cost() for q in queries)
    print(f"Will cost: {cost} PLN")
    input("Press enter to continue...")

    for query in queries:
        for url in query.urls():
            if "rejestr.io" not in url:
                continue

            result = RejestrIO.from_context(ctx).get_rejestr_io(url)
            if result is None:
                print(f"Skipping {url}")
                continue

            upload_result(ctx, url, result)
            sleep(sleep_time)


def main():
    scrape_krs_paid()
