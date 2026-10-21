from abc import ABC


class UrlScraper(ABC):
    def collect_urls(self):
        raise NotImplementedError("collect_urls method must be implemented in subclasses")