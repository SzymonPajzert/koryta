from __future__ import annotations

from typing import Any

import pytest
from fastapi import HTTPException

from service import app as service_app


class _Stub:
    """Only what the misconfiguration branch reads off a Config."""

    def __init__(self, missing: tuple[str, ...]) -> None:
        self.missing = missing


def test_a_misconfigured_service_says_so_on_the_page(
    monkeypatch: pytest.MonkeyPatch,
):
    """A capture must not sit at "stored" with no account of why.

    The endpoint that uploaded it records a *dispatch* failure, and this is not
    one: the task was accepted and handed over, so the page document is the only
    place the reason can appear.
    """
    writes: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(service_app, "config", lambda: _Stub(("LLM_API_KEY",)))
    monkeypatch.setattr(
        service_app,
        "_update_page",
        lambda page_id, fields: writes.append((page_id, fields)),
    )

    request = service_app.ExtractRequest(
        pageId="page-1",
        url="https://www.example.pl/a",
        storagePath="gs://koryta-pl-crawled/x.tar.gz",
        uploaderUid="reader-1",
    )

    with pytest.raises(HTTPException) as raised:
        service_app.extract(request)

    # 503 so Cloud Tasks retries; a later success overwrites the error, which is
    # the right way round.
    assert raised.value.status_code == 503
    assert "LLM_API_KEY" in raised.value.detail

    assert len(writes) == 1
    page_id, fields = writes[0]
    assert page_id == "page-1"
    assert fields["status"] == "error"
    assert "LLM_API_KEY" in fields["extraction.error"]
