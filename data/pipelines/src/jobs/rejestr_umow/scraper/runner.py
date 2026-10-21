"""Orkiestracja: wyszukiwanie → detale → zapis, z obsługą wznawiania."""
from __future__ import annotations

import itertools
import logging
from typing import Any, Optional

import config
from scraper.client import ApiClient, ApiError
from scraper.details import fetch_details
from scraper.search import iter_search_results
from scraper.storage.base import AgreementRepository

log = logging.getLogger(__name__)


def run_search(
    client: ApiClient,
    repo: AgreementRepository,
    *,
    page_size: int = config.PAGE_SIZE,
    filters: Optional[dict[str, Any]] = None,
    sort_key: Optional[str] = None,
    start_offset: int = 0,
    max_records: Optional[int] = None,
    stop_on_existing: bool = False,
    batch_size: int = config.SEARCH_BATCH_SIZE,
) -> int:
    """Etap A: pobierz i zapisz listę umów. Zwraca liczbę zapisanych pozycji.

    Pozycje zapisywane są wsadowo (`save_search_results`) paczkami po `batch_size`
    — dla backendu bazodanowego to jeden INSERT na paczkę zamiast N zapytań.

    `stop_on_existing` (tryb inkrementalny): przerywa pobieranie po natrafieniu
    na pierwszą umowę, która jest już w repozytorium. Zakłada sortowanie od
    najnowszych — wtedy pierwsza znana pozycja oznacza, że reszta też już jest,
    więc nie ma potrzeby pobierać kolejnych stron.
    """
    count = 0
    batch: list = []

    def flush() -> None:
        nonlocal count
        if not batch:
            return
        repo.save_search_results(batch)
        count += len(batch)
        batch.clear()
        log.info("Wyszukiwanie: zapisano %d pozycji", count)

    for result in iter_search_results(
        client,
        page_size=page_size,
        filters=filters,
        sort_key=sort_key,
        start_offset=start_offset,
        max_records=max_records,
    ):
        if stop_on_existing and repo.exists_search_result(result.id_umowy):
            flush()
            log.info(
                "Napotkano znaną umowę %s — przerywam wyszukiwanie "
                "(tryb inkrementalny, zapisano %d nowych)",
                result.id_umowy, count,
            )
            break
        batch.append(result)
        if len(batch) >= batch_size:
            flush()
    else:
        flush()  # zapisz resztę, gdy pętla zakończyła się bez przerwania

    log.info("Wyszukiwanie zakończone: %d pozycji", count)
    return count


def run_details(
    client: ApiClient,
    repo: AgreementRepository,
    *,
    batch_size: int = config.DETAILS_BATCH_SIZE,
    max_details: Optional[int] = None,
) -> int:
    """Etap B: dla umów bez detali pobierz i zapisz detale.

    Detale zapisywane są wsadowo (`save_details_many`) paczkami po `batch_size`
    — dla backendu bazodanowego to jedna transakcja na paczkę zamiast N.

    Wznawialny — pomija umowy, których detale już są w repozytorium.
    `max_details` (opcjonalny) ogranicza liczbę przetwarzanych umów w jednym
    przebiegu — kolejne umowy zostaną pobrane przy następnym uruchomieniu.
    Zwraca liczbę nowo pobranych detali.
    """
    pending_iter = repo.iter_pending_ids()
    if max_details is not None:
        pending_iter = itertools.islice(pending_iter, max_details)
    pending = list(pending_iter)
    total = len(pending)
    log.info("Detale: %d umów do pobrania", total)

    fetched = 0
    batch: list = []

    def flush() -> None:
        nonlocal fetched
        if not batch:
            return
        repo.save_details_many(batch)
        fetched += len(batch)
        batch.clear()

    for i, id_umowy in enumerate(pending, start=1):
        try:
            details = fetch_details(client, id_umowy)
        except ApiError as e:
            # Wyczerpano wszystkie próby — oznacz umowę jako trwale niepobieralną,
            # aby nie ponawiać jej detali przy kolejnych przebiegach.
            log.error("Błąd pobierania detali umowy %s: %s — oznaczam jako niedostępną", id_umowy, e)
            repo.mark_details_failed(id_umowy, str(e))
            continue
        if details is not None:
            batch.append(details)
            if len(batch) >= batch_size:
                flush()
        if i % 100 == 0 or i == total:
            log.info(
                "Detale: %d/%d (pobrano %d, w buforze %d)",
                i, total, fetched, len(batch),
            )
    flush()  # zapisz resztę paczki
    log.info("Detale zakończone: pobrano %d", fetched)
    return fetched


def run(
    client: ApiClient,
    repo: AgreementRepository,
    *,
    do_search: bool = True,
    do_details: bool = True,
    page_size: int = config.PAGE_SIZE,
    filters: Optional[dict[str, Any]] = None,
    sort_key: Optional[str] = None,
    start_offset: int = 0,
    max_records: Optional[int] = None,
    stop_on_existing: bool = False,
    max_details: Optional[int] = None,
) -> None:
    if do_search:
        run_search(
            client,
            repo,
            page_size=page_size,
            filters=filters,
            sort_key=sort_key,
            start_offset=start_offset,
            max_records=max_records,
            stop_on_existing=stop_on_existing,
        )
    if do_details:
        run_details(client, repo, max_details=max_details)
