"""Pobieranie wyników z endpointu wyszukiwania umów."""
from __future__ import annotations

import logging
from typing import Any, Iterator, Optional

import config
from scraper.client import ApiClient
from scraper.models import AgreementSearchResult, SearchPage

log = logging.getLogger(__name__)


def iter_search_results(
    client: ApiClient,
    *,
    page_size: int = config.PAGE_SIZE,
    filters: Optional[dict[str, Any]] = None,
    sort_key: Optional[str] = None,
    start_offset: int = 0,
    max_records: Optional[int] = None,
) -> Iterator[AgreementSearchResult]:
    """Iteruje po wszystkich pozycjach wyszukiwania, stronicując po `offset`.

    Warunek stopu: osiągnięto `total_elements`, zwrócono pustą stronę lub
    dobito do `max_records`.
    """
    offset = start_offset
    yielded = 0

    first = client.post_search(offset, page_size, filters, sort_key)
    page = SearchPage.from_dict(first)
    total = page.total_elements
    log.info("Wyszukiwanie: %d umów w rejestrze", total)

    while True:
        if not page.content:
            break

        for item in page.content:
            yield item
            yielded += 1
            if max_records is not None and yielded >= max_records:
                log.info("Osiągnięto limit --max-records=%d", max_records)
                return

        offset += page_size
        if offset >= total:
            break

        raw = client.post_search(offset, page_size, filters, sort_key)
        page = SearchPage.from_dict(raw)
        # Rejestr jest żywy — total może wzrosnąć w trakcie; aktualizujemy.
        total = max(total, page.total_elements)
