import copy
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup
from uuid_extensions import uuid7str

from entities.crawler import RequestLog, WebsiteIndex
from entities.util import NormalizedParse
from scrapers.stores import Context

warsaw_tz = ZoneInfo("Europe/Warsaw")

HEADERS = {"User-Agent": "KorytaCrawler/0.1 (+http://koryta.pl/crawler)"}
CRAWL_DELAY_SECONDS = 20


def config_from_row(allowed, quality):
    if allowed:
        if quality == "good":
            return "good"
        return "approved"
    return "block"


next_request_time = {}
url_to_update = set()
page_score = dict()


def add_crawl_record(uid, parsed, url, response_code, payload_size_bytes, duration):
    """Updates the timestamp for a successfully crawled URL in the sites file."""
    RequestLog(
        uuid7str(),
        uid,
        parsed.hostname_normalized,
        url,
        datetime.now(warsaw_tz),
        response_code,
        payload_size_bytes,
        duration,
    ).insert_into()


def ready_to_crawl(parsed):
    domain = parsed.hostname_normalized
    result = True
    if domain in next_request_time:
        result = time.time() > next_request_time[domain]

    if result:
        next_request_time[domain] = time.time() + CRAWL_DELAY_SECONDS
    return result


def parse_hostname(url: str) -> str:
    return NormalizedParse.parse(url).hostname_normalized


def uuid7():
    return uuid7str()


# --- Main Crawler Logic ---
def crawl_website(ctx: Context, uid, current_url):
    parsed = NormalizedParse.parse(current_url)
    if not ctx.web.robot_txt_allowed(ctx, current_url, parsed, HEADERS["User-Agent"]):
        print(f"Skipping (disallowed by robots.txt): {current_url}")
        return
    if not ready_to_crawl(parsed):
        return

    try:
        print(f"Crawling: {current_url}")
        started = datetime.now(warsaw_tz)
        response = requests.get(current_url, headers=HEADERS, timeout=10)

        # Check if the request was successful (status code 200)
        if response.status_code == 200:
            pages_to_visit = set()
            ctx.io.upload(parsed, response.text, "text/html")

            for parser in ["html.parser", "lxml", "html5lib"]:
                copy_parsed = copy.deepcopy(parsed)
                soup = BeautifulSoup(response.text, parser)
                copy_parsed.path += f".{parser}.txt"
                ctx.io.upload(copy_parsed, soup.get_text(), "text/plain")

                for link in soup.find_all("a", href=True):
                    absolute_link = ctx.utils.join_url(current_url, link["href"])  # type: ignore
                    absolute_link = absolute_link.split("#")[0]  # Remove fragment
                    stop = False
                    for prefix in ["javascript", "mailto", "tel"]:
                        if absolute_link.startswith(prefix):
                            stop = True
                    if stop:
                        continue
                    absolute_link = absolute_link.rstrip("/")
                    pages_to_visit.add(absolute_link)

            pages_to_visit.difference_update(
                row[0] for row in ctx.con.sql("SELECT url FROM website_index").fetchall()
            )
            if len(pages_to_visit) > 0:
                for url in pages_to_visit:
                    WebsiteIndex(uuid7str(), current_url, None).insert_into()

        else:
            print(f"  -> Failed to retrieve page: Status code {response.status_code}")

        add_crawl_record(
            uid,
            parsed,
            current_url,
            response.status_code,
            len(response.content),
            str(datetime.now(warsaw_tz) - started),
        )

    except requests.RequestException as e:
        print(f"  -> An error occurred: {e}")


def crawl(ctx: Context):
    # Initialize hostname_config using ctx.con
    hostname_config = {
        row[0]: config_from_row(row[1], row[2])
        for row in ctx.con.sql("SELECT * FROM hostname_config").fetchall()
    }

    try:
        pages_to_visit_query = ctx.con.sql(
            """
            SELECT id, url, interesting
            FROM website_index JOIN hostname_config
                ON hostname_config.hostname == parse_hostname(website_index.url)
            WHERE
                id NOT IN (SELECT website_id FROM request_logs)
                AND url NOT IN (SELECT url FROM request_logs)
                AND quality == 'good'
            ORDER BY (case when interesting then 1 when interesting is null then 2 else 3 end) asc
            """
        )

        pages_to_visit_list = pages_to_visit_query.fetchall()

        print(len(pages_to_visit_list))
        last_save = datetime.now(warsaw_tz)
        for row in pages_to_visit_list:
            crawl_website(ctx, row[0], row[1])
            if datetime.now(warsaw_tz) - last_save > timedelta(minutes=2):
                # dump_dbs() # Removed as it's not available
                pass
    finally:
        # dump_dbs() # Removed
        pass
