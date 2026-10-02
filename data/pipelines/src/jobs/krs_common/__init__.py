"""What the KRS jobs share: the api-krs client, the crawl layout, the refresh set.

Moved from `scraper.py`, unchanged, when the KRS scrape became jobs.
"""

import json

import requests

from scrapers.stores import Context


# TODO move this to stores - this is a generic utility, not KRS-specific.
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

    if verbose and "odpis" in result:
        # Said, never kept, so nothing here may fail the request. An address
        # can hold no town at all - "COFFEE POLSKA" S.A., 0000394808, has
        # `{"kraj": "POLSKA"}` alone - and reading one anyway raised KeyError
        # out of every free scrape that reached it, even with verbose off.
        dzial1 = (result["odpis"].get("dane") or {}).get("dzial1") or {}
        dane = dzial1.get("danePodmiotu") or {}
        adres = (dzial1.get("siedzibaIAdres") or {}).get("adres") or {}
        print(f"{dane.get('nazwa', dane)} - {adres.get('miejscowosc', '?')}")
    return json.dumps(result)


def upload_result(ctx: Context, url, result, verbose=True):
    # We're discarding query params, so it's a hotfix for this
    url = url.replace("?aktualnosc=", "/aktualnosc_")
    url = url.replace("&format=json", "")
    ctx.io.upload(url, result, "application/json", verbose=verbose, include_query=True)


# TODO This should be calculated by which job updates which pipeline and which pipelines
# are read by which jobs, not hardcoded here. It requires further utility, so it's
# left as a future development.

#: The pipelines every KRS scrape rebuilds before it reads its queue, whatever
#: is on disk: each one's inputs change with every crawl.
REFRESH_PIPELINES = {
    "ScrapeRejestrIO",
    "KRSAlreadyScraped",
    "KRSCensoredPeople",
    "KRSNeedsRefresh",
    "CompaniesKRS",
    "KRSUpdates",
    # The fold of the register job's log. Nothing it depends on changes when
    # the log grows, so without this a scrape queues from an old ledger.
    "KRSRegisterEntries",
    "RejestrIOCoverage",
    "PersonFeedCoverage",
}
