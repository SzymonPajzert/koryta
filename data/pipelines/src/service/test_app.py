from __future__ import annotations

from typing import Any

import pytest
from fastapi import HTTPException

from service import app as service_app
from service.config import Config
from service.people import PeopleMatch


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


def _run_config(match_people: bool = True) -> Config:
    """A real Config, so a new field cannot slip past this test unset."""
    return Config(
        koryta_url="https://koryta.test",
        firebase_api_key="key",
        extractor_uid="capture-extractor",
        firestore_database="koryta-pl",
        llm_model="test-model",
        llm_base_url="",
        llm_api_key="key",
        llm_lanes=1,
        llm_timeout_seconds=1,
        extraction_tag="capture_test",
        verify_facts=False,
        match_people=match_people,
        people_index_path="",
        people_index_ttl_seconds=1,
        min_score=None,
    )


_HTML = b"""
<html><body><article>
<p>Jan Kowalski zostal prezesem Miejskiego Przedsiebiorstwa Wodociagow, o czym
   pisalismy juz wczesniej w naszym serwisie przy okazji opisywania kolejnych
   zmian kadrowych w spolkach zaleznych od ratusza w ostatnich latach.</p>
</article></body></html>
"""


def _wire_run(
    monkeypatch: pytest.MonkeyPatch,
    *,
    matched,
    cfg: Config,
) -> dict[str, Any]:
    """Stub everything `_run` reaches for, and record what it produced."""
    seen: dict[str, Any] = {}

    monkeypatch.setattr(service_app, "read_captured_html", lambda *a, **k: _HTML)
    monkeypatch.setattr(service_app, "_firestore", object)
    monkeypatch.setattr(service_app, "_update_page", lambda page_id, fields: None)
    monkeypatch.setattr(service_app, "register_capture", lambda *a, **k: None)
    monkeypatch.setattr(service_app, "_llm", lambda cfg: object())

    def _match(cfg: Config, text: str):
        seen["text"] = text
        return matched

    monkeypatch.setattr(service_app, "match_people", _match)

    async def _fake_analyze(llm, **kwargs):
        seen["analyze"] = kwargs
        return service_app.oneshot.AnalyzedArticle(
            parsed=kwargs["parsed"],
            score=service_app.oneshot.ArticleScore(4, "", True, "test-model"),
            facts=[
                {
                    "url": kwargs["url"],
                    "fact_type": "employment",
                    "person": "Jan Kowalski",
                    "organization": "MPW",
                    "justification": "x",
                    "verified": True,
                }
            ],
        )

    monkeypatch.setattr(service_app.oneshot, "analyze", _fake_analyze)

    class _Client:
        def __init__(self, cfg: Any) -> None:
            pass

        def submit_extraction(self, payload: dict[str, Any], uid: str) -> int:
            seen["payload"] = payload
            return len(payload["extracted_facts"])

    monkeypatch.setattr(service_app, "KorytaClient", _Client)

    request = service_app.ExtractRequest(
        pageId="page-1",
        url="https://www.example.pl/a",
        storagePath="gs://koryta-pl-crawled/x.tar.gz",
        uploaderUid="reader-1",
    )
    seen["response"] = service_app._run(cfg, request)
    return seen


def test_matched_people_reach_the_prompt_and_the_endpoint(
    monkeypatch: pytest.MonkeyPatch,
):
    """The two halves of the lookup land in different places.

    The names go into the facts prompt as the detected-people hint; the ids go
    to /api/ingest/extraction as `koryta_ids`, which is what lets it stamp
    `personNodeId` and tie the fact to a person page.
    """
    seen = _wire_run(
        monkeypatch,
        matched=PeopleMatch(names=("Jan Kowalski",), ids=("p1",)),
        cfg=_run_config(),
    )

    # Looked up in the parsed article text, which is the text the model is
    # then shown — not the raw html.
    assert "Jan Kowalski" in seen["text"]
    assert "<article>" not in seen["text"]

    assert seen["analyze"]["people"] == ("Jan Kowalski",)
    # Parsed once, by the caller, and handed on rather than re-parsed.
    assert seen["analyze"]["parsed"].article_content == seen["text"]

    assert seen["payload"]["koryta_ids"] == ["p1"]
    assert seen["response"].facts_submitted == 1


def test_the_lookup_can_be_switched_off(monkeypatch: pytest.MonkeyPatch):
    """MATCH_PEOPLE=false is the way back to unlinked facts without a redeploy."""
    seen = _wire_run(
        monkeypatch,
        matched=PeopleMatch(names=("Jan Kowalski",), ids=("p1",)),
        cfg=_run_config(match_people=False),
    )

    assert seen["analyze"]["people"] == ()
    assert "koryta_ids" not in seen["payload"]
