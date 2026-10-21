import json
import logging
import time
from typing import List

import requests as r
from bs4 import BeautifulSoup

from scrapers.url.file_url_client import FileUrlClient
from scrapers.url.url_client import UrlClient
from scrapers.url_scraper import UrlScraper

NEW_URL = 'https://www.fakt.pl/najnowsze'
EVENTS_URL = 'https://www.fakt.pl/wydarzenia'
POLITICAL_URL = 'https://www.fakt.pl/polityka'


class FaktScraper(UrlScraper):

    def __init__(self, url_client: UrlClient, max_pages: int = 5):
        self.url_client: UrlClient = url_client
        self.max_pages: int = max_pages

    def get_articles_from_page(self, page: int, url_base: str) -> List[str]:
        logging.info(f"[Fakt] Getting articles from page {page}")

        url = f'{url_base}'
        params = {}
        if page > 1:
            params['page'] = page
        response = r.get(url=url, params=params)
        soup = BeautifulSoup(response.text, 'html.parser')

        # <script type="application/ld+json">
        items = soup.find_all('div', class_='list-item', attrs={'data-section': None})


        urls = [entry.find('a').attrs['href'] for entry in items if entry.find('a')]
        logging.info(f"[Fakt] Found {len(urls)} articles on page {page}")
        return urls

    def collect_urls(self):
        logging.info("[Fakt] Starting URL collection")
        logging.info("[Fakt] Collecting URLs from POLITICAL page")
        self.collect_urls_from_base(POLITICAL_URL)
        logging.info("[Fakt] Collecting URLs from NEW page")
        self.collect_urls_from_base(NEW_URL)
        logging.info("[Fakt] Collecting URLs from EVENTS page")
        self.collect_urls_from_base(EVENTS_URL)
        logging.info("[Fakt] Done")

    def collect_urls_from_base(self, url_base: str):
        page = 1  # Starts from page 1
        for _ in range(self.max_pages):
            response_urls = self.get_articles_from_page(page=page, url_base=url_base)
            some_url_exists = self.url_client.any_url_exists(response_urls)
            self.url_client.add_urls(response_urls)
            if not response_urls or some_url_exists:
                break
            page += 1
            time.sleep(1)  # just in case


if __name__ == '__main__':
    client = FileUrlClient('fakt.txt')
    scraper = FaktScraper(client, max_pages=2)
    scraper.collect_urls()
