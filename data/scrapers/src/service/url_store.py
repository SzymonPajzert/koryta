"""Registering a captured page with the crawl's url store.

This is what makes a browser capture a first-class crawl result rather than a
one-off: `ArticleDoneUrls` reads `url_store` for everything fetched, so a page
registered here is re-parsed and re-analysed by the nightly pipeline with the
local model, alongside everything the crawler fetched itself. The fast path is
then a preview of that, not a replacement for it.

Best effort throughout. The html is already in the bucket by the time anything
here runs, and a capture that failed to register is worth strictly less than
one that did — but it is not worth failing the extraction over.
"""

from __future__ import annotations

import logging

from external.url_store_client import UrlIn, UrlStoreClient
from service.config import Config

logger = logging.getLogger(__name__)

# How far to page through a domain's unfetched urls looking for the one just
# inserted. The api has no lookup-by-url, so this is a scan; a domain with more
# than this many urls waiting is one the crawler is already working through, and
# the row will be marked fetched by the nightly reconciliation instead.
_MAX_LOOKUP_PAGES = 4
_PAGE_SIZE = 500


def _find_url_id(client: UrlStoreClient, url: str, domain: str) -> int | None:
    for page in range(_MAX_LOOKUP_PAGES):
        rows = client.list_urls(
            status="new", domain=domain, limit=_PAGE_SIZE, offset=page * _PAGE_SIZE
        )
        for row in rows:
            if row.url.rstrip("/") == url.rstrip("/"):
                return row.id
        if len(rows) < _PAGE_SIZE:
            return None
    return None


def register_capture(config: Config, url: str, domain: str, storage_path: str) -> bool:
    """Records the capture as a fetched url. True when it landed."""
    if not config.url_store_enabled:
        return False

    try:
        with UrlStoreClient(
            base_url=config.url_store_url, api_key=config.url_store_api_key
        ) as client:
            client.create_urls([UrlIn(url=url, source="browser_capture")])
            url_id = _find_url_id(client, url, domain)
            if url_id is None:
                logger.warning("url_store has no row for %s after insert", url)
                return False
            client.update_url(url_id, status="fetched", storage_path=storage_path)
            return True
    except Exception:
        logger.exception("failed to register %s with url_store", url)
        return False
