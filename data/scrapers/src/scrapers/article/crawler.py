import requests
import time
from datetime import datetime
from zoneinfo import ZoneInfo
from dataclasses import dataclass, asdict
import json

from urllib.parse import urljoin
from urllib.robotparser import RobotFileParser
from bs4 import BeautifulSoup
from google.cloud import storage

from util.url import NormalizedParse
from stores.storage import upload_to_gcs
from stores.redis import get_redis_client, LOG_KEY, URL_SET_KEY, DOMAIN_TIMES_KEY


@dataclass
class RequestLog:
    url: str
    time: datetime
    response_code: int
    payload_size_bytes: int
    duration: str


@dataclass
class WebsiteIndex:
    id: str
    url: str
    interesting: bool | None


warsaw_tz = ZoneInfo("Europe/Warsaw")
storage_client = storage.Client()
HEADERS = {"User-Agent": "KorytaCrawler/0.1 (+http://koryta.pl/crawler)"}
CRAWL_DELAY_SECONDS = 20
robot_parsers = {}

r = get_redis_client()


def robot_txt_allowed(url, parsed_url):
    """
    Checks if we are allowed to fetch a URL according to the site's robots.txt.
    Caches the parsed robots.txt file for efficiency.
    """
    robots_url = f"{parsed_url.domain}/robots.txt"
    if parsed_url.domain not in robot_parsers:
        parser = RobotFileParser()
        parser.set_url(robots_url)
        try:
            parser.read()
            robot_parsers[parsed_url.domain] = parser
        except Exception as e:
            print(f"Could not read robots.txt for {parsed_url.domain}: {e}")
            # If we can't read robots.txt, it's safer to assume we can't fetch.
            return False

    return robot_parsers[parsed_url.domain].can_fetch(HEADERS["User-Agent"], url)


def add_crawl_record(url, response_code, payload_size_bytes, duration):
    """Updates the timestamp for a successfully crawled URL in the sites file."""
    log_record = RequestLog(
        url,
        datetime.now(warsaw_tz),
        response_code,
        payload_size_bytes,
        duration,
    )
    json_log = json.dumps(asdict(log_record))
    # Log to Redis List using RPUSH
    r.rpush(LOG_KEY, json_log)


async def get_next_url():
    all_urls = r.smembers(URL_SET_KEY)
    if not all_urls:
        return None

    current_time = time.time()
    assert isinstance(all_urls, set)
    for url in all_urls:
        domain = NormalizedParse.parse(url).domain
        # ZSCORE retrieves the last visited time (score) for the domain
        last_visit_time_str = await r.zscore(DOMAIN_TIMES_KEY, domain)

        # If domain has never been visited (last_visit_time is None) OR
        # If the cool-down period has elapsed
        if (last_visit_time_str is None) or (
            current_time - float(last_visit_time_str) > CRAWL_DELAY_SECONDS
        ):

            # Found a valid URL
            # Prevent other processes, from getting this domain
            r.zadd(DOMAIN_TIMES_KEY, {domain: current_time})
            # Remove the URL from the set and return
            r.srem(URL_SET_KEY, url)
            return url

    return None


def find_links(soup):
    for link in soup.find_all("a", href=True):
        absolute_link = urljoin(current_url, link["href"])  # type: ignore
        absolute_link = absolute_link.split("#")[0]  # Remove fragment
        stop = False
        for prefix in ["javascript", "mailto", "tel"]:
            if absolute_link.startswith(prefix):
                stop = True
        if stop:
            continue
        absolute_link = absolute_link.rstrip("/")
        if not robot_txt_allowed(absolute_link, NormalizedParse.parse(absolute_link)):
            continue
        yield


def crawl_website(url: NormalizedParse):
    try:
        print(f"Crawling: {url}")
        started = datetime.now(warsaw_tz)
        response = requests.get(url.url, headers=HEADERS, timeout=10)

        # Check if the request was successful (status code 200)
        if response.status_code == 200:
            pages_to_visit = set()
            upload_to_gcs(url.extend("scraped.html"), response.text, "text/html")

            for parser in ["html.parser", "lxml", "html5lib"]:
                soup = BeautifulSoup(response.text, parser)
                upload_to_gcs(
                    url.extend(f"{parser}.txt"), soup.get_text(), "text/plain"
                )

                pages_to_visit.update(find_links(soup))

            if len(pages_to_visit) > 0:
                for url in pages_to_visit:
                    r.sadd(URL_SET_KEY, url.url)

        else:
            print(f"  -> Failed to retrieve page: Status code {response.status_code}")

        add_crawl_record(
            url,
            response.status_code,
            len(response.content),
            str(datetime.now(warsaw_tz) - started),
        )

    except requests.RequestException as e:
        print(f"  -> An error occurred: {e}")


async def crawl():
    while True:
        url = await get_next_url()
        if not url:
            time.sleep(CRAWL_DELAY_SECONDS)
            continue
        crawl_website(url)
