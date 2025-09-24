import requests
import time
from datetime import datetime, timedelta
from urllib.parse import urljoin, urlparse, ParseResult
from urllib.robotparser import RobotFileParser
from bs4 import BeautifulSoup
from zoneinfo import ZoneInfo
from google.cloud import storage
import sys, select
from uuid_extensions import uuid7str
import copy
from dataclasses import dataclass
import duckdb
from duckdb.typing import VARCHAR
from stores.duckdb import ducktable, dump_dbs


@ducktable(read=True, name="hostname_config")
@dataclass
class HostnameConfig:
    hostname: str
    allowed: bool
    quality: str

    def insert_into(self):
        pass


@ducktable(read=True, name="request_logs")
@dataclass
class RequestLog:
    id: str
    website_id: str
    domain: str
    url: str
    time: datetime
    response_code: int
    payload_size_bytes: int
    duration: str

    def insert_into(self):
        pass


@ducktable(read=True, name="website_index")
@dataclass
class WebsiteIndex:
    id: str
    url: str
    interesting: bool | None

    def insert_into(self):
        pass


warsaw_tz = ZoneInfo("Europe/Warsaw")
storage_client = storage.Client()

BUCKET = "koryta-pl-crawled"
HEADERS = {"User-Agent": "KorytaCrawler/0.1 (+http://koryta.pl/crawler)"}
CRAWL_DELAY_SECONDS = 20


def config_from_row(allowed, quality):
    if allowed:
        if quality == "good":
            return "good"
        return "approved"
    return "block"


hostname_config = {
    row[0]: config_from_row(row[1], row[2])
    for row in duckdb.sql("SELECT * FROM hostname_config").fetchall()
}
next_request_time = {}
robot_parsers = {}
url_to_update = set()
page_score = dict()


class NormalizedParse:
    def __init__(self, arg: ParseResult):
        self.scheme = arg.scheme
        self.netloc = arg.netloc
        self.path = arg.path
        self.hostname = arg.hostname
        if not self.hostname:
            self.hostname = arg.netloc
        self.hostname_normalized = self.hostname.lower()
        if self.hostname_normalized.startswith("www."):
            self.hostname_normalized = self.hostname_normalized[4:]
        self.domain = f"{self.scheme}://{self.hostname}"

    hostname_normalized: str
    domain: str


def parse_url(url):
    if url.endswith("/"):
        url = url[:-1]
    return NormalizedParse(urlparse(url))


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


def upload_to_gcs(
    source: NormalizedParse,
    data,
    content_type,
):
    try:
        now = datetime.now(warsaw_tz)
        if source.path == "":
            source.path = "index"
        destination_blob_name = (
            f"hostname={source.hostname}/"
            f"date={now.strftime('%Y')}-{now.strftime('%m')}-{now.strftime('%d')}/"
            f"{source.path}"
        )
        destination_blob_name = destination_blob_name.replace("//", "/")
        destination_blob_name = destination_blob_name.rstrip("/")

        bucket = storage_client.bucket(BUCKET)
        blob = bucket.blob(destination_blob_name)
        # Upload the string data
        blob.upload_from_string(data, content_type=f"{content_type}; charset=utf-8")

        full_path = f"gs://{BUCKET}/{destination_blob_name}"
        print(f"Successfully uploaded data to: {full_path}")

    except Exception as e:
        print(f"An error occurred: {e}")
        return None


def input_with_timeout(msg, timeout=10):
    print(msg)
    sys.stdout.flush()
    i, o, e = select.select([sys.stdin], [], [], timeout)

    if i:
        return sys.stdin.readline().strip()
    else:
        return None


def ready_to_crawl(parsed):
    domain = parsed.hostname_normalized
    result = True
    if domain in next_request_time:
        result = time.time() > next_request_time[domain]

    if result:
        next_request_time[domain] = time.time() + CRAWL_DELAY_SECONDS
    return result


def parse_hostname(url: str) -> str:
    return parse_url(url).hostname_normalized


def uuid7():
    return uuid7str()


duckdb.create_function("parse_hostname", parse_hostname, [VARCHAR], VARCHAR)  # type: ignore
duckdb.create_function("uuid7str", uuid7, [], VARCHAR)  # type: ignore


# --- Main Crawler Logic ---
def crawl_website(uid, current_url):
    parsed = parse_url(current_url)
    if not robot_txt_allowed(current_url, parsed):
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
            upload_to_gcs(parsed, response.text, "text/html")

            for parser in ["html.parser", "lxml", "html5lib"]:
                copy_parsed = copy.deepcopy(parsed)
                soup = BeautifulSoup(response.text, parser)
                copy_parsed.path += f".{parser}.txt"
                upload_to_gcs(copy_parsed, soup.get_text(), "text/plain")

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
                    pages_to_visit.add(absolute_link)

            pages_to_visit.difference_update(
                row[0] for row in duckdb.sql("SELECT url FROM website_index").fetchall()
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


def crawl():
    try:
        pages_to_visit_query = duckdb.sql(
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
            crawl_website(row[0], row[1])
            if datetime.now(warsaw_tz) - last_save > timedelta(minutes=2):
                dump_dbs()
    finally:
        dump_dbs()
