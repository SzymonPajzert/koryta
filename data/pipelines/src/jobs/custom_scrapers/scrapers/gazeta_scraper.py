import json
import logging
import time
from typing import List

import requests as r
from bs4 import BeautifulSoup

from scrapers.url.file_url_client import FileUrlClient
from scrapers.url.url_client import UrlClient
from scrapers.url_scraper import UrlScraper

POLAND_URL = 'https://wiadomosci.gazeta.pl/polska/0,0.html#e=NavLink'
POLITICAL_URL = 'https://wiadomosci.gazeta.pl/polityka/0,0.html#e=NavLink'


class GazetaScraper(UrlScraper):

    def __init__(self, url_client: UrlClient, max_pages: int = 5):
        self.url_client: UrlClient = url_client
        self.max_pages: int = max_pages

    def get_articles_from_polska_page(self, page: int, url_base: str) -> List[str]:
        logging.info(f"[Gazeta] Getting articles from page {page}")

        url = f'{url_base}'
        params = {
            'str': page
        }
        response = r.get(url=url, params=params)
        soup = BeautifulSoup(response.text, 'html.parser')

        # <script type="application/ld+json">
        entries = soup.find_all('li', class_='entry')

        urls = [entry.find('a').attrs['href'] for entry in entries if entry.find('a')]
        logging.info(f"[Gazeta] Found {len(urls)} articles on page {page}")
        return urls

    def collect_urls(self):
        logging.info("[Gazeta] Starting URL collection")
        logging.info("[Gazeta] Collecting URLs from POLSKA page")
        self.collect_urls_from_base(POLAND_URL)
        logging.info("[Gazeta] Collecting URLs from POLITICAL page")
        self.collect_urls_from_base(POLITICAL_URL)
        logging.info("[Gazeta] Done")

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
    client = FileUrlClient('gazeta.txt')
    scraper = GazetaScraper(client, max_pages=2)
    scraper.collect_urls()
