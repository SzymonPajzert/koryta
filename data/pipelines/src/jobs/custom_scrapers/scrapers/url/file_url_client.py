import logging
from typing import List

from scrapers.url.url_client import UrlClient


class FileUrlClient(UrlClient):

    def __init__(self, file_path: str):
        self.url_path: str = file_path
        # Create if not exists
        with open(self.url_path, 'a'):
            pass

    def add_url(self, url: str):
        # load all urls, check if url already exists, if not add to file
        with open(self.url_path, 'r') as f:
            existing_urls = set(line.strip() for line in f)
            if url in existing_urls:
                logging.info(f"[FileUrlClient] URL already exists: {url}")
                return
        with open(self.url_path, 'a') as f:
            f.write(url + '\n')
            logging.info(f"[FileUrlClient] Added URL: {url}")

    def add_urls(self, urls: List[str]):
        for u in urls:
            self.add_url(u)

    def any_url_exists(self, urls: List[str]) -> bool:
        with open(self.url_path, 'r') as f:
            existing_urls = set(line.strip() for line in f)
            return any(url in existing_urls for url in urls)
