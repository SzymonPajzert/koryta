"""HTTP client for the url_store API (generated from openapi.json)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterable, Literal

import requests

UrlStatus = Literal["new", "in_progress", "fetched", "failed"]


@dataclass
class UrlIn:
    url: str
    source: str | None = None
    context: dict[str, Any] | None = None

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"url": self.url}
        if self.source is not None:
            payload["source"] = self.source
        if self.context is not None:
            payload["context"] = self.context
        return payload


@dataclass
class UrlOut:
    id: int
    url: str
    domain: str
    source: str | None
    status: UrlStatus
    context: dict[str, Any] | None
    error: str | None
    storage_path: str | None
    discovered_at: datetime
    last_checked_at: datetime | None

    @classmethod
    def from_payload(cls, data: dict[str, Any]) -> "UrlOut":
        return cls(
            id=data["id"],
            url=data["url"],
            domain=data["domain"],
            source=data.get("source"),
            status=data["status"],
            context=data.get("context"),
            error=data.get("error"),
            storage_path=data.get("storage_path"),
            discovered_at=_parse_dt(data["discovered_at"]),
            last_checked_at=_parse_dt(data["last_checked_at"]) if data.get("last_checked_at") else None,
        )


@dataclass
class BatchInsertResponse:
    received: int
    inserted: int
    skipped: int


class UrlStoreError(Exception):
    def __init__(self, status_code: int, body: Any) -> None:
        super().__init__(f"url_store API error {status_code}: {body!r}")
        self.status_code = status_code
        self.body = body


class UrlStoreClient:
    def __init__(
            self,
            base_url: str,
            api_key: str | None = None,
            timeout: float = 30.0,
            session: requests.Session | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self.session = session or requests.Session()

    @classmethod
    def from_env(cls) -> UrlStoreClient:
        return cls(
            base_url=os.environ["URL_STORE_URL"],
            api_key=os.environ["URL_STORE_API_KEY"]
        )

    def close(self) -> None:
        self.session.close()

    def __enter__(self) -> "UrlStoreClient":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def health(self) -> dict[str, str]:
        return self._request("GET", "/health", auth=False)

    def list_urls(
            self,
            status: UrlStatus | None = None,
            domain: str | None = None,
            limit: int = 100,
            offset: int = 0,
    ) -> list[UrlOut]:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if status is not None:
            params["status"] = status
        if domain is not None:
            params["domain"] = domain
        data = self._request("GET", "/urls", params=params)
        return [UrlOut.from_payload(item) for item in data]

    def create_urls(self, urls: Iterable[UrlIn | dict[str, Any]]) -> BatchInsertResponse:
        payload_urls = [u.to_payload() if isinstance(u, UrlIn) else u for u in urls]
        data = self._request("POST", "/urls", json={"urls": payload_urls})
        return BatchInsertResponse(
            received=data["received"],
            inserted=data["inserted"],
            skipped=data["skipped"],
        )

    def claim_urls(self, limit: int = 10) -> list[UrlOut]:
        data = self._request("POST", "/urls/claim", params={"limit": limit})
        return [UrlOut.from_payload(item) for item in data]

    def urls_exist(self, urls: Iterable[str]) -> bool:
        data = self._request("POST", "/urls/exists", json={"urls": list(urls)})
        return data["exists"]

    def update_url(
            self,
            url_id: int,
            status: UrlStatus,
            error: str | None = None,
            context: dict[str, Any] | None = None,
            storage_path: str | None = None,
    ) -> UrlOut:
        body: dict[str, Any] = {"status": status}
        if error is not None:
            body["error"] = error
        if context is not None:
            body["context"] = context
        if storage_path is not None:
            body["storage_path"] = storage_path
        data = self._request("PATCH", f"/urls/{url_id}", json=body)
        return UrlOut.from_payload(data)

    def _request(
            self,
            method: str,
            path: str,
            *,
            params: dict[str, Any] | None = None,
            json: Any | None = None,
            auth: bool = True,
    ) -> Any:
        headers: dict[str, str] = {}
        if auth and self.api_key:
            headers["X-API-Key"] = self.api_key
        response = self.session.request(
            method=method,
            url=f"{self.base_url}{path}",
            params=params,
            json=json,
            headers=headers,
            timeout=self.timeout,
        )
        if not response.ok:
            try:
                body: Any = response.json()
            except ValueError:
                body = response.text
            raise UrlStoreError(response.status_code, body)
        if response.status_code == 204 or not response.content:
            return None
        return response.json()


def _parse_dt(value: str) -> datetime:
    # FastAPI emits ISO-8601; handle trailing "Z".
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    return datetime.fromisoformat(value)
