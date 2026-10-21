from typing import List

from scrapers.url.url_client import UrlClient
from scrapers.url.url_store_client import UrlIn, UrlStoreClient


class UrlStoreUrlClient(UrlClient):

    def __init__(self, store_client: UrlStoreClient, source: str | None = None):
        self.store_client = store_client
        self.source = source

    def add_url(self, url: str):
        self.store_client.create_urls([UrlIn(url=url, source=self.source)])

    def add_urls(self, urls: List[str]):
        if urls:
            self.store_client.create_urls([UrlIn(url=u, source=self.source) for u in urls])

    def any_url_exists(self, urls: List[str]) -> bool:
        if urls:
            return self.store_client.urls_exist(urls)
        else:
            return False
