import logging
import time

from bs4 import BeautifulSoup
from curl_cffi import requests as r

from scrapers.common import create_url_store_client
from scrapers.url.url_client import UrlClient
from scrapers.url_scraper import UrlScraper


class NaszeMiastoScraper(UrlScraper):

    def __init__(self, url_client: UrlClient):
        self.url_client: UrlClient = url_client
        self.headers = {
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'accept-language': 'en-GB,en;q=0.8',
            'priority': 'u=0, i',
            'sec-ch-ua': '"Not:A-Brand";v="99", "Brave";v="145", "Chromium";v="145"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"macOS"',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'none',
            'sec-fetch-user': '?1',
            'sec-gpc': '1',
            'upgrade-insecure-requests': '1',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        }
        self.max_pages = 5

    def _get_all_cities(self):
        url = 'https://poznan.naszemiasto.pl/ajax/nsk/geo/cities'
        response = r.get(url, headers=self.headers, impersonate='chrome')
        soup = BeautifulSoup(response.text, 'html.parser')
        all_links = soup.find_all('a')
        groups = [link['data-name'].replace('-', '') for link in soup.find_all('li')]
        cities = [link['data-name'] for link in all_links]
        cities = [c for c in cities if c not in groups]
        return cities

    def _get_from_city_from_page(self, city: str, page: int) -> list[str]:
        logging.info(f"[NaszeMiasto] Getting articles from city {city} page {page}")
        url = f"https://{city}.naszemiasto.pl/wiadomosci/{page}"

        response = r.get(url, headers=self.headers, impersonate='chrome')
        soup = BeautifulSoup(response.text, 'html.parser')
        articles_section = soup.find('section', attrs={'data-ea': 'articles_left'})

        if not articles_section:
            logging.info(f"[NaszeMiasto] No articles section found for city {city} page {page}")
            return []

        all_urls = articles_section.find_all('a', attrs={'data-ec': "atomsListingArticleTileWithSeparatedLink"})
        all_urls = [article['href'] for article in all_urls if 'href' in article.attrs and article['href'].startswith('/')]
        all_urls = [f"https://{city}.naszemiasto.pl{url}" for url in all_urls]

        return list(set(all_urls))  # remove duplicates

    def collect_urls(self):
        logging.info("[NaszeMiasto] Starting URL collection")
        cities = self._get_all_cities()
        for city in cities:
            try:
                self._collect_urls_from_city(city)
            except Exception as e:
                logging.error(f"Error collecting urls from city {city}: {e}")

    def _collect_urls_from_city(self, city: str):
        logging.info(f"Collecting urls from city: {city}")
        page = 1  # Starts from page 1
        urls = []
        for _ in range(self.max_pages):
            response_urls = self._get_from_city_from_page(city, page)
            urls.extend(response_urls)
            some_url_exists = self.url_client.any_url_exists(response_urls)
            self.url_client.add_urls(response_urls)
            if not response_urls or some_url_exists:
                break
            page += 1
            time.sleep(1)  # just in case


def main():
    client = create_url_store_client('nasze_miasto')
    scraper = NaszeMiastoScraper(client)
    cities = scraper._collect_urls_from_city('bierutow')
    pass


if __name__ == '__main__':
    main()
