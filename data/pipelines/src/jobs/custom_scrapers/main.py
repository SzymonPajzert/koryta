import datetime
import logging
import os
import sys
from typing import List

from scrapers.common import create_url_store_client
from scrapers.fakt_scraper import FaktScraper
from scrapers.gazeta_scraper import GazetaScraper
from scrapers.nasze_miasto_scaper import NaszeMiastoScraper
from scrapers.onet_scraper import OnetScraper
from scrapers.tvn24_scraper import TVN24Scraper
from scrapers.url_scraper import UrlScraper
from scrapers.wp_scraper import WpScraper

LOCAL_ENV = 'LOCAL'
ENV = os.environ.get("ENV", LOCAL_ENV)
LOG_DIR = 'log/'


def setup_logging(log_file_prefix='', console_level=logging.INFO):
    handlers = []

    if ENV != LOCAL_ENV:
        if not os.path.exists(LOG_DIR):
            os.makedirs(LOG_DIR)
        log_file = f"{LOG_DIR}/{log_file_prefix}{str(datetime.datetime.now()).replace(' ', '-')}-debug.log"
        file_handler = logging.FileHandler(log_file)
        file_handler.setLevel(logging.DEBUG)
        handlers.append(file_handler)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(console_level)
    handlers.append(console_handler)

    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s | %(name)s | [%(levelname)s] - %(message)s",
        handlers=handlers
    )
    logging.getLogger("httpcore").setLevel(logging.INFO)
    logging.getLogger("urllib3").setLevel(logging.INFO)
    logging.debug("Logging set up")


def main():
    try:
        source = 'custom_scraper'
        setup_logging(log_file_prefix=source, console_level=logging.DEBUG)

        url_store_client = create_url_store_client(source)

        scrapers: List[UrlScraper] = [
            FaktScraper(url_store_client),
            TVN24Scraper(url_store_client),
            GazetaScraper(url_store_client),
            WpScraper(url_store_client),
            OnetScraper(url_store_client),
            NaszeMiastoScraper(url_store_client),
        ]

        for scraper in scrapers:
            scraper.collect_urls()
    except Exception as e:
        print(f"Error in main: {e}")


print('body')
if __name__ == '__main__':
    print("Starting scraper...")
    main()
