from abc import ABC
from typing import List


class UrlClient(ABC):

    def add_url(self, url: str):
        raise NotImplementedError()

    def add_urls(self, urls: List[str]):
        raise NotImplementedError()

    def any_url_exists(self, urls: List[str]) -> bool:
        raise NotImplementedError()