import json
import logging
import time
from typing import List

import requests as r
from bs4 import BeautifulSoup

from scrapers.url_scraper import UrlScraper
from scrapers.url.file_url_client import FileUrlClient
from scrapers.url.url_client import UrlClient

POLAND_URL = 'https://wiadomosci.wp.pl/polska-6750773603044864k'
REGIONAL_URL = 'https://wiadomosci.wp.pl/regionalne-6750773603061248k'


class WpScraper(UrlScraper):

    def __init__(self, url_client: UrlClient, max_pages: int = 5):
        self.url_client: UrlClient = url_client
        self.max_pages: int = max_pages

    def get_articles_from_polska_page(self, page: int, url_base: str) -> List[str]:
        logging.info(f"[WP] Getting articles from page {page}")

        url = f'{url_base}/{page}'
        response = r.get(url=url)
        soup = BeautifulSoup(response.text, 'html.parser')

        # <script type="application/ld+json">
        script_tag = soup.find('script', attrs={'type': 'application/ld+json'})

        json_loads = json.loads(script_tag.string)
        articles_object = None
        for item in json_loads['@graph']:
            if item['@type'] == 'CollectionPage':
                articles_object = item
                break
        if not articles_object:
            logging.info(f"[WP] No articles found on page {page}")
            # TODO monitor it
            return []
        urls = [item['url'] for item in articles_object['mainEntity']['itemListElement']]

        logging.info(f"[WP] Found {len(urls)} articles on page {page}")
        return urls

    def collect_urls(self):
        logging.info("[WP] Starting URL collection")
        logging.info("[WP] Collecting URLs from POLSKA page")
        self.collect_urls_from_base(POLAND_URL)
        logging.info("[WP] Collecting URLs from REGIONAL page")
        self.collect_urls_from_base(REGIONAL_URL)

    def collect_urls_from_base(self, url_base: str):
        page = 1  # Starts from page 1
        for _ in range(self.max_pages):
            response_urls = self.get_articles_from_polska_page(page=page, url_base=url_base)
            some_url_exists = self.url_client.any_url_exists(response_urls)
            self.url_client.add_urls(response_urls)
            if not response_urls or some_url_exists:
                break
            page += 1
            time.sleep(1)  # just in case


if __name__ == '__main__':
    client = FileUrlClient('urls_wp.txt')
    scraper = WpScraper(client, max_pages=2)
    scraper.collect_urls()
