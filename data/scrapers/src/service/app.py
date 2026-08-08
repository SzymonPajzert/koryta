"""The extractor service: one captured page in, facts out.

Runs on Cloud Run, called by Cloud Tasks with an OIDC token that Cloud Run
itself checks before the request arrives — so there is no authentication code
here, only a switch that refuses to start unauthenticated unless someone asked
for it (`ALLOW_UNAUTHENTICATED`, which is how it runs on a laptop).

The work is synchronous inside the request. That is the point of using Tasks:
the queue owns the retry and the deadline, the response says what happened, and
nothing is left running after a response is written — which on Cloud Run would
be stopped mid-call anyway.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import firebase_admin
from fastapi import FastAPI, HTTPException
from firebase_admin import firestore
from google.cloud.firestore_v1 import SERVER_TIMESTAMP
from pydantic import BaseModel, Field

from entities.util import NormalizedParse
from scrapers.article import oneshot
from service.config import Config, config
from service.koryta_api import KorytaClient
from service.storage import read_captured_html
from service.url_store import register_capture
from stores.llm import OpenAICompatibleConfig, OpenAICompatibleMultiPortLLM

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

app = FastAPI(title="koryta capture extractor")


class ExtractRequest(BaseModel):
    page_id: str = Field(alias="pageId")
    url: str
    storage_path: str = Field(alias="storagePath")
    uploader_uid: str = Field(alias="uploaderUid")
    html_sha256: str | None = Field(default=None, alias="htmlSha256")
    article_node_id: str | None = Field(default=None, alias="articleNodeId")
    #: Text the capturing browser already had — a reader's selection. Beats any
    #: selector when present.
    content_override: str | None = Field(default=None, alias="contentOverride")

    model_config = {"populate_by_name": True}


class ExtractResponse(BaseModel):
    page_id: str
    status: str
    facts_submitted: int = 0
    facts_extracted: int = 0
    score: int | None = None
    error: str | None = None


def _llm(cfg: Config) -> OpenAICompatibleMultiPortLLM:
    return OpenAICompatibleMultiPortLLM(
        OpenAICompatibleConfig(
            model=cfg.llm_model,
            # With a base_url set, "ports" are only concurrency lanes onto the
            # one endpoint — see `_endpoint` in stores/llm.py.
            ports=tuple(range(cfg.llm_lanes)),
            per_port_concurrency=1,
            request_timeout_seconds=cfg.llm_timeout_seconds,
            base_url=cfg.llm_base_url,
            api_key=cfg.llm_api_key,
        )
    )


def _firestore():
    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    return firestore.client(database_id=config().firestore_database)


def _page_ref(page_id: str):
    return _firestore().collection("articlePages").document(page_id)


def _update_page(page_id: str, fields: dict[str, Any]) -> None:
    """Records progress on the capture document, and never raises.

    The page is the user's only view of the job, but it is not the job: losing a
    status write must not lose the facts that were already submitted.
    """
    try:
        _page_ref(page_id).update({**fields, "updatedAt": SERVER_TIMESTAMP})
    except Exception:
        logger.exception("could not update articlePages/%s", page_id)


@app.get("/health")
def health() -> dict[str, Any]:
    cfg = config()
    return {
        "status": "ok" if not cfg.missing else "misconfigured",
        "missing": list(cfg.missing),
        "model": cfg.llm_model,
        "tag": cfg.extraction_tag,
    }


@app.post("/extract", response_model=ExtractResponse)
def extract(request: ExtractRequest) -> ExtractResponse:
    cfg = config()
    if cfg.missing:
        detail = f"service is missing configuration: {', '.join(cfg.missing)}"
        # Written before the raise, or the job sits at "stored" saying nothing:
        # the capture endpoint records a *dispatch* failure, and this is not one
        # -- the task was accepted, and the only account of what happened next
        # is here. Cloud Tasks retries a 503, so this may be overwritten by a
        # later success, which is the right way round.
        _update_page(
            request.page_id,
            {
                "status": "error",
                "extraction.error": detail,
                "extraction.finishedAt": SERVER_TIMESTAMP,
            },
        )
        raise HTTPException(status_code=503, detail=detail)

    logger.info("extracting %s (%s)", request.url, request.page_id)
    _update_page(
        request.page_id,
        {
            "status": "extracting",
            "extraction.tag": cfg.extraction_tag,
            "extraction.model": cfg.llm_model,
            "extraction.startedAt": SERVER_TIMESTAMP,
            "extraction.error": None,
        },
    )

    try:
        return _run(cfg, request)
    except Exception as exc:  # noqa: BLE001 - reported, not swallowed
        logger.exception("extraction failed for %s", request.page_id)
        _update_page(
            request.page_id,
            {
                "status": "error",
                "extraction.error": str(exc)[:500],
                "extraction.finishedAt": SERVER_TIMESTAMP,
            },
        )
        # 500 so Cloud Tasks retries; the queue's own limit decides how often.
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _run(cfg: Config, request: ExtractRequest) -> ExtractResponse:
    html = read_captured_html(request.storage_path, request.url)
    domain = NormalizedParse.parse(request.url).hostname_normalized

    analyzed = asyncio.run(
        oneshot.analyze(
            _llm(cfg),
            url=request.url,
            domain=domain,
            html=html,
            model=cfg.llm_model,
            content_override=request.content_override,
            verify=cfg.verify_facts,
        )
    )
    logger.info("analysed %s", oneshot.to_json(analyzed))

    score = analyzed.score.score if analyzed.score else None
    if analyzed.error:
        _update_page(
            request.page_id,
            {
                "status": "error",
                "extraction.error": analyzed.error[:500],
                "extraction.koryciarskiScore": score,
                "extraction.finishedAt": SERVER_TIMESTAMP,
            },
        )
        return ExtractResponse(
            page_id=request.page_id,
            status="error",
            score=score,
            error=analyzed.error,
        )

    # Registering with url_store is what gets this page re-analysed by the
    # nightly run with the local model. Best effort — see url_store.py.
    register_capture(cfg, request.url, domain, request.storage_path)

    submitted = 0
    payload = oneshot.submission_payload(analyzed, cfg.extraction_tag)
    below_threshold = cfg.min_score is not None and (
        score is None or score < cfg.min_score
    )
    if payload["extracted_facts"] and not below_threshold:
        submitted = KorytaClient(cfg).submit_extraction(payload, request.uploader_uid)

    _update_page(
        request.page_id,
        {
            "status": "done",
            "extraction.factCount": submitted,
            "extraction.koryciarskiScore": score,
            "extraction.koryciarskiReason": (
                analyzed.score.reason if analyzed.score else ""
            ),
            "extraction.promptVersion": analyzed.facts_prompt_version,
            "extraction.finishedAt": SERVER_TIMESTAMP,
            "extraction.error": None,
        },
    )

    return ExtractResponse(
        page_id=request.page_id,
        status="done",
        facts_submitted=submitted,
        facts_extracted=len(analyzed.facts),
        score=score,
    )
