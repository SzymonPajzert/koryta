from typing import Callable

from external.url_store_client import UrlStoreClient
from scrapers.stores import CrawlQueue, DoneUrl, BlockedDomain, CrawlQueueItem, NewUrl


class UrlStoreQueue(CrawlQueue):

    def __init__(self, url_client: UrlStoreClient):
        self.url_client = url_client

    def put(self, urls: list[NewUrl]) -> None:
        pass  # NOP

    def get(self, worker_id: str, max_retries: int = 3, timeout_seconds: float = 60) -> CrawlQueueItem | None:
        urls = self.url_client.claim_urls(limit=1)
        if not urls:
            return None
        url = urls[0]
        return CrawlQueueItem(
            uid=str(url.id),
            url=url.url,
            priority=0,
        )

    def mark_done(self, uid: str, storage_path: str | None, metadata: dict[str, object] | None = None) -> None:
        self.url_client.update_url(
            url_id=int(uid),
            status="fetched",
        )

    def mark_error(self, uid: str, error: str) -> None:
        self.url_client.update_url(
            url_id=int(uid),
            status="failed",
            context={"error": error}
        )

    def release(self, uid: str) -> None:
        self.url_client.update_url(
            url_id=int(uid),
            status='new',
        )

    def add_blocked_domains(self, rows: list[BlockedDomain]) -> None:
        pass  # NOP

    def get_blocked_domains(self) -> set[str]:
        return set([])

    def reprioritize(self, priority_fn: Callable[[str], int], batch_size: int = 5000) -> None:
        pass  # NOP

    def get_done_urls(self, limit: int | None = None) -> list[DoneUrl]:
        urls = self.url_client.list_urls(status="fetched", limit=limit)
        return [DoneUrl(url=url.url, uid=str(url.id), storage_path=url.storage_path) for url in urls]

    def reset(self) -> None:
        pass  # NOP
