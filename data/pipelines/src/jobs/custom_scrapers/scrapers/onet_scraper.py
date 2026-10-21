import logging
import re
import time
from typing import List

from bs4 import BeautifulSoup
from curl_cffi import requests as r

from scrapers.url.url_client import UrlClient
from scrapers.url_scraper import UrlScraper


class OnetScraper(UrlScraper):

    def __init__(self, url_client: UrlClient, max_pages: int = 5):
        self.url_client: UrlClient = url_client
        self.max_pages: int = max_pages

    def __get_articles_from_kraj_page(self, page: int) -> List[str]:
        logging.info(f"[Onet] Getting articles from page {page}")
        url = 'https://wiadomosci.onet.pl/kraj'
        params = {}
        if page > 1:  # for strona=1 it returns 410
            params['strona'] = page
        response = r.get(url=url, params=params, impersonate='chrome')
        soup = BeautifulSoup(response.text, 'html.parser')

        list_div = soup.find('div', attrs={'data-section': re.compile('list-feed-[0-9]')})
        articles_divs = list_div.findChildren('div', recursive=False)
        urls = [self.__get_url_from_article_div(article_div) for article_div in articles_divs]

        head_article_a = soup.find('a', attrs={'class': 'ods-o-card__link'})
        if head_article_a['href']:
            urls = [head_article_a['href']] + urls

        logging.info(f"[Onet] Found {len(urls)} articles on page {page}")
        return urls

    def collect_urls(self):
        logging.info("[Onet] Starting URL collection")
        page = 1  # Starts from page 1
        urls = []
        for _ in range(self.max_pages):
            response_urls = self.__get_articles_from_kraj_page(page)
            urls.extend(response_urls)
            some_url_exists = self.url_client.any_url_exists(response_urls)
            self.url_client.add_urls(response_urls)
            if not response_urls or some_url_exists:
                break
            page += 1
            time.sleep(1)  # just in case

    @staticmethod
    def __get_url_from_article_div(article_div) -> str:
        a_tag = article_div.find('a', href=True)
        if a_tag:
            return a_tag['href']
        return ''
