"""Klient HTTP do API rejestrumow.gov.pl.

Opakowuje `requests.Session`, dodaje domyślne nagłówki, throttling oraz retry
z wykładniczym backoffem na 429/5xx i błędy sieci.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Optional

import requests

import config

log = logging.getLogger(__name__)


class ApiError(RuntimeError):
    """Błąd komunikacji z API, którego nie udało się obejść ponawianiem."""


class ApiClient:
    def __init__(
        self,
        base_url: str = config.BASE_URL,
        *,
        throttle: float = config.THROTTLE_SECONDS,
        max_retries: int = config.MAX_RETRIES,
        backoff_base: float = config.BACKOFF_BASE,
        timeout: float = config.REQUEST_TIMEOUT,
        user_agent: str = config.USER_AGENT,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.throttle = throttle
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self.timeout = timeout
        self._session = requests.Session()
        self._session.headers.update(
            {
                "User-Agent": user_agent,
                "Accept": "application/json",
            }
        )

    # -- API publiczne --------------------------------------------------------

    def post_search(
        self,
        offset: int,
        limit: int,
        filters: Optional[dict[str, Any]] = None,
        sort_key: Optional[str] = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"offset": offset, "limit": limit}
        if sort_key:
            params["sortKey"] = sort_key
        return self._request(
            "POST",
            config.SEARCH_PATH,
            params=params,
            json=filters or {},
        )

    def get_details(self, id_umowy: str) -> dict[str, Any]:
        return self._request("GET", f"{config.DETAILS_PATH}/{id_umowy}")

    def close(self) -> None:
        self._session.close()

    def __enter__(self) -> "ApiClient":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    # -- Warstwa niższa -------------------------------------------------------

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        json: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        last_error: Optional[Exception] = None

        for attempt in range(1, self.max_retries + 1):
            if self.throttle:
                time.sleep(self.throttle)
            try:
                resp = self._session.request(
                    method, url, params=params, json=json, timeout=self.timeout
                )
            except requests.RequestException as exc:
                last_error = exc
                log.warning(
                    "Błąd sieci (%s %s), próba %d/%d: %s",
                    method, path, attempt, self.max_retries, exc,
                )
                self._sleep_backoff(attempt)
                continue

            if resp.status_code == 429 or resp.status_code >= 500:
                last_error = ApiError(
                    f"HTTP {resp.status_code} dla {method} {path}"
                )
                log.warning(
                    "HTTP %d (%s %s), próba %d/%d",
                    resp.status_code, method, path, attempt, self.max_retries,
                )
                self._sleep_backoff(attempt, resp)
                continue

            resp.raise_for_status()
            return resp.json()

        raise ApiError(
            f"Nie udało się wykonać {method} {path} po {self.max_retries} próbach"
        ) from last_error

    def _sleep_backoff(
        self, attempt: int, resp: Optional[requests.Response] = None
    ) -> None:
        """Wykładniczy backoff; respektuje nagłówek Retry-After, jeśli jest."""
        delay = self.backoff_base * (2 ** (attempt - 1))
        if resp is not None:
            retry_after = resp.headers.get("Retry-After")
            if retry_after and retry_after.isdigit():
                delay = max(delay, float(retry_after))
        time.sleep(delay)
