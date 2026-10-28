"""Pobieranie detali pojedynczej umowy."""
from __future__ import annotations

import logging
from typing import Optional

import requests

from jobs.rejestr_umow.scraper.client import ApiClient
from jobs.rejestr_umow.scraper.models import AgreementDetails

log = logging.getLogger(__name__)


def fetch_details(client: ApiClient, id_umowy: str) -> Optional[AgreementDetails]:
    """Pobiera detale umowy. Zwraca None, jeśli umowa nie istnieje (404)."""
    try:
        raw = client.get_details(id_umowy)
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else None
        if status == 404:
            log.warning("Umowa %s nie istnieje (404) — pomijam", id_umowy)
            return None
        raise
    log.info("Umowa %s: pobrano detale", id_umowy)
    return AgreementDetails.from_dict(raw)
