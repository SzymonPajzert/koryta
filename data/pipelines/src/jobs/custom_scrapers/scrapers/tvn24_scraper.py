import logging
import os
import time
from typing import List

from curl_cffi import requests as r

from bs4 import BeautifulSoup

from scrapers.url.file_url_client import FileUrlClient
from scrapers.url.url_client import UrlClient
from scrapers.url_scraper import UrlScraper


class TVN24Scraper(UrlScraper):

    def __init__(self, url_client: UrlClient, max_pages: int = 5):
        self.url_client: UrlClient = url_client
        self.max_pages: int = max_pages
        proxy_url = os.environ['PROXY_URL']
        self.proxies = {
            'http': proxy_url,
            'https': proxy_url,
        }

    def get_articles(self, page: int) -> List[str]:
        logging.info(f"[TVN24] Getting articles from page {page}")

        url = f'https://tvn24.pl/najnowsze/s-{page}' if page > 1 else 'https://tvn24.pl/najnowsze'
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
        }

        response = r.get(url=url, headers=headers, proxies=self.proxies)
        soup = BeautifulSoup(response.text, 'html.parser')

        urls = [s.find('a').attrs['href'] for s in soup.find_all('slot') if s.find('a')]
        urls = [url for url in urls if url.startswith('https://tvn24.pl/')]

        logging.info(f"[TVN24] Found {len(urls)} articles on page {page}")
        return urls

    def collect_urls(self):
        logging.info("[TVN24] Starting URL collection")
        page = 1  # Starts from page 1
        for _ in range(self.max_pages):
            response_urls = self.get_articles(page=page)
            some_url_exists = self.url_client.any_url_exists(response_urls)
            self.url_client.add_urls(response_urls)
            if not response_urls or some_url_exists:
                break
            page += 1
            time.sleep(1)  # just in case
        logging.info("[TVN24] Done")


if __name__ == '__main__':
    client = FileUrlClient('tvn24.txt')
    scraper = TVN24Scraper(client, max_pages=2)
    scraper.collect_urls()
