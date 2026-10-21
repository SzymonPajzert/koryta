import os

from scrapers.url.url_client import UrlClient
from scrapers.url.url_store_client import UrlStoreClient
from scrapers.url.url_store_url_client import UrlStoreUrlClient


def create_url_store_client(source: str) -> UrlClient:
    return UrlStoreUrlClient(
        store_client=UrlStoreClient(
            base_url=os.environ["URL_STORE_BASE_URL"],
            api_key=os.environ["URL_STORE_API_KEY"],
        ),
        source=source
    )
