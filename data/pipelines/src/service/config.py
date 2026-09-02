"""Everything the extractor service reads from its environment.

Read once at import so a missing variable is a startup failure with a name in
it, rather than a 500 on the first capture someone sends.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import cache

#: The model the fast path runs. Named here rather than left to the deploy so
#: that the tag below, which says which model wrote a fact, cannot drift from
#: the model that actually wrote it.
DEFAULT_LLM_MODEL = "qwen/qwen3-30b-a3b-instruct-2507"

#: Stamped on every fact the fast path submits.
#:
#: Versioned separately from the batch pipeline's `--tag`, and re-versioned
#: whenever either half of "which model, judged how" changes — a reviewer
#: sorting `/ekstrakcje` reads the tag to know what produced the row.
#: `attempt_lookup` is the people match in `service/people.py`: a name match
#: against the site's person nodes, which is weaker evidence than the batch
#: path's judged mentions and is worth being able to tell apart.
#:
#: Keep in step with `CAPTURE_EXTRACTION_TAG` in frontend/shared/capture.ts.
DEFAULT_EXTRACTION_TAG = "capture_v2_qwen3.8-27b_attempt_lookup"


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer, got {raw!r}") from exc


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Config:
    #: Where to submit facts, e.g. https://koryta.pl
    koryta_url: str
    #: Firebase web api key, used to exchange a custom token for an id token.
    #: Public by design — it is in nuxt.config.ts too.
    firebase_api_key: str
    #: The uid this service signs in as. Needs the `datascience` claim, which it
    #: mints for itself in the custom token.
    extractor_uid: str
    firestore_database: str

    llm_model: str
    llm_base_url: str
    llm_api_key: str
    #: Concurrent LLM requests. The pool models concurrency as ports, which for
    #: a hosted endpoint are just lanes onto the same url.
    llm_lanes: int
    llm_timeout_seconds: int

    extraction_tag: str
    verify_facts: bool
    #: Look the article's people up among the site's people and send their ids
    #: as `koryta_ids`, so the endpoint can link facts to person pages. Off
    #: turns the fast path back into the unlinked `capture_v1` behaviour
    #: without a redeploy — the switch to reach for if the match turns out to
    #: link the wrong people.
    match_people: bool
    #: A `KorytaPeople` dump to build the name index from, instead of the
    #: newest one in the shared cache: either the jsonl itself or the
    #: `backup.tar.gz` it ships in. How the development loop runs without the
    #: bucket, and how to pin the index into the image if the daily-ish dump is
    #: too loose.
    people_index_path: str
    #: How long a built index is reused. A day by default: `KorytaPeople` runs
    #: about that often, so anything shorter re-reads the same object.
    people_index_ttl_seconds: int
    #: Skip fact extraction below this koryciarski score. Off by default: a
    #: person picked this page, which is a stronger signal than the score.
    min_score: int | None

    url_store_url: str = ""
    url_store_api_key: str = ""

    #: Only used by the local `direct` dispatch mode; on Cloud Run the caller is
    #: authenticated by IAM before the request ever reaches this process.
    allow_unauthenticated: bool = False

    crawled_bucket: str = "koryta-pl-crawled"
    #: Where the pipelines publish their outputs. Read-only from here: the
    #: bucket is shared with the owner's own runs.
    shared_cache_bucket: str = "koryta-pl-sharedcache"

    missing: tuple[str, ...] = field(default_factory=tuple)

    @property
    def url_store_enabled(self) -> bool:
        return bool(self.url_store_url and self.url_store_api_key)


@cache
def config() -> Config:
    required = {
        "KORYTA_API_URL": os.environ.get("KORYTA_API_URL", ""),
        "FIREBASE_WEB_API_KEY": os.environ.get("FIREBASE_WEB_API_KEY", ""),
        "LLM_API_KEY": os.environ.get("LLM_API_KEY")
        or os.environ.get("OPENROUTER_APIKEY")
        or os.environ.get("OPENAI_API_KEY")
        or "",
    }
    missing = tuple(name for name, value in required.items() if not value)

    raw_min_score = os.environ.get("MIN_KORYCIARSKI_SCORE", "").strip()

    return Config(
        koryta_url=required["KORYTA_API_URL"].rstrip("/"),
        firebase_api_key=required["FIREBASE_WEB_API_KEY"],
        extractor_uid=os.environ.get("EXTRACTOR_UID", "capture-extractor"),
        firestore_database=os.environ.get("FIRESTORE_DATABASE", "koryta-pl"),
        llm_model=os.environ.get("LLM_MODEL", DEFAULT_LLM_MODEL),
        llm_base_url=os.environ.get("LLM_BASE_URL", "https://openrouter.ai/api/v1"),
        llm_api_key=required["LLM_API_KEY"],
        llm_lanes=_int("LLM_LANES", 4),
        llm_timeout_seconds=_int("LLM_TIMEOUT_SECONDS", 300),
        extraction_tag=os.environ.get("EXTRACTION_TAG", DEFAULT_EXTRACTION_TAG),
        verify_facts=_bool("VERIFY_FACTS", True),
        match_people=_bool("MATCH_PEOPLE", True),
        people_index_path=os.environ.get("PEOPLE_INDEX_PATH", ""),
        people_index_ttl_seconds=_int("PEOPLE_INDEX_TTL_SECONDS", 24 * 3600),
        min_score=int(raw_min_score) if raw_min_score else None,
        url_store_url=os.environ.get("URL_STORE_URL", ""),
        url_store_api_key=os.environ.get("URL_STORE_API_KEY", ""),
        allow_unauthenticated=_bool("ALLOW_UNAUTHENTICATED", False),
        crawled_bucket=os.environ.get("CRAWLED_BUCKET", "koryta-pl-crawled"),
        shared_cache_bucket=os.environ.get(
            "SHARED_CACHE_BUCKET", "koryta-pl-sharedcache"
        ),
        missing=missing,
    )
