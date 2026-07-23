import asyncio
import json
import re
from pathlib import Path
from typing import Any

import pandas as pd
from tqdm import tqdm

from entities.article import KoryciarskiScore
from scrapers.article.pipelines.parsed_pipeline import ArticleParsed
from scrapers.article.pipelines.pipeline_utils import llm_model
from scrapers.stores import Context, LLMRequest, Pipeline
from stores.config import VERSIONED_DIR

PROMPT_VERSION = 1
TEXT_LIMIT = 100000
MAX_TOKENS = 512
TEMPERATURE = 0.1

_PARSED_FILE = Path(VERSIONED_DIR) / "article_parsed" / "article_parsed.jsonl"
_FINAL_OUTPUT_FILE = (
    Path(VERSIONED_DIR)
    / "article_koryciarski_scores"
    / "article_koryciarski_scores.jsonl"
)
_TEMP_OUTPUT_FILE = (
    Path(VERSIONED_DIR)
    / "article_koryciarski_scores"
    / "article_koryciarski_scores.jsonl.tmp"
)

_PROMPT = (
    'Oceń artykuł pod kątem tego, czy opisuje zjawisko "koryciarstwa" '
    "— czyli czerpania korzyści z publicznych stanowisk poprzez nepotyzm, "
    "obsadzanie stanowisk po znajomości, konflikty interesów, nadużycia "
    "publicznych pieniędzy przez polityków lub urzędników.\n\n"
    "Skala 0-5:\n"
    "0 = brak związku\n"
    "1 = wspomina polityków/urzędników, ale bez kontekstu nadużyć\n"
    "2 = opisuje mianowania/awanse/decyzje polityczne bez wyraźnej krytyki\n"
    "3 = sugeruje nepotyzm, konflikty interesów lub obsadzanie stanowisk\n"
    "4 = bezpośrednio opisuje korupcję/nepotyzm/obsadzanie stanowisk po znajomości\n"
    "5 = główny temat to koryciarstwo, udokumentowane konkretne przypadki\n\n"
    "Jeśli tekst nie jest artykułem albo wygląda jak listing/menu/szablon strony, "
    "ustaw score null i llm_is_article false.\n\n"
    "Odpowiedz TYLKO jako JSON z polami: "
    "koryciarski_llm_reason, koryciarski_llm_score, llm_is_article.\n\n"
    "Artykuł:\n{text}"
)


class ArticleKoryciarskiScores(Pipeline[KoryciarskiScore]):
    filename = "article_koryciarski_scores"

    article_parsed: ArticleParsed

    @property
    def output_class(self):
        return KoryciarskiScore

    def read_or_process(self, ctx: Context) -> pd.DataFrame:
        if self._cached_result is not None:
            return self._cached_result

        if not ctx.refresh_policy.tree_printed:
            ctx.refresh_policy.build_and_print_tree(self, ctx)

        should_refresh = self.should_refresh_with_logic(ctx)
        if not should_refresh:
            self._cached_result = pd.DataFrame()
            return self._cached_result

        self.preprocess_sources(ctx, ctx.refresh_policy)
        graceful = True
        completed = False
        try:
            df = self.process(ctx)
            self._refreshed_execution = True
            completed = True
        except InterruptedError:
            print("Caught interrupt signal, will save partial scores")
            df = pd.DataFrame()
        except Exception:
            graceful = False
            raise
        finally:
            if graceful:
                print("Dumping...")
                ctx.io.dumper.dump_pandas()  # type: ignore[attr-defined]
                if completed or _TEMP_OUTPUT_FILE.exists():
                    _finalize_temp_output()
                else:
                    print(f"Partial score output left at {_TEMP_OUTPUT_FILE}")
                print("Done")

        ctx.refresh_policy.add_refreshed_pipeline(self.pipeline_name)
        self._cached_result = df
        return df

    def process(self, ctx: Context):
        if ctx.llm is None:
            raise ValueError("ArticleKoryciarskiScores requires Context.llm")
        if not _PARSED_FILE.exists():
            raise FileNotFoundError(_PARSED_FILE)

        existing = _existing_score_cache_from_files(
            _FINAL_OUTPUT_FILE,
            _TEMP_OUTPUT_FILE,
        )
        _prepare_temp_output()
        model = llm_model(ctx)
        records = _latest_ok_parsed_records(_PARSED_FILE)
        asyncio.run(_score_records(ctx, records, existing, model=model))
        _print_llm_usage(ctx)
        return pd.DataFrame()


def _prepare_temp_output() -> None:
    _TEMP_OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    if _TEMP_OUTPUT_FILE.exists():
        _TEMP_OUTPUT_FILE.unlink()
    _TEMP_OUTPUT_FILE.write_text("", encoding="utf-8")


def _finalize_temp_output() -> None:
    if _TEMP_OUTPUT_FILE.exists():
        _FINAL_OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
        _TEMP_OUTPUT_FILE.replace(_FINAL_OUTPUT_FILE)
    elif not _FINAL_OUTPUT_FILE.exists():
        _FINAL_OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
        _FINAL_OUTPUT_FILE.write_text("", encoding="utf-8")


def _existing_score_cache_from_files(*paths: Path) -> dict[str, dict[str, Any]]:
    cache: dict[str, dict[str, Any]] = {}
    for path in paths:
        if not path.exists():
            continue
        with path.open("r", encoding="utf-8") as handle:
            for line in tqdm(
                handle,
                desc=f"Reading score cache {path.name}",
                unit="row",
            ):
                raw = line.strip()
                if not raw:
                    continue
                try:
                    row = json.loads(raw)
                except Exception:
                    continue
                url = row.get("url")
                content_hash = row.get("article_content_hash")
                if isinstance(url, str) and isinstance(content_hash, str):
                    cache[url] = row
    return cache


def _latest_ok_parsed_records(path: Path) -> list[dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    with path.open("r", encoding="utf-8") as handle:
        for line in tqdm(handle, desc="Reading parsed articles", unit="row"):
            raw = line.strip()
            if not raw:
                continue
            try:
                row = json.loads(raw)
            except Exception:
                continue
            if row.get("parse_status") != "ok":
                continue
            url = row.get("url")
            content_hash = row.get("article_content_hash")
            content = row.get("article_content")
            if (
                isinstance(url, str)
                and isinstance(content_hash, str)
                and isinstance(content, str)
                and content.strip()
            ):
                # Keep only the fields scoring needs — dropping outbound_urls
                # (63% of the row) and other columns keeps memory bounded.
                latest[url] = {
                    "url": url,
                    "article_content_hash": content_hash,
                    "article_content": content,
                }
    return list(latest.values())


async def _score_records(
    ctx: Context,
    records: list[dict[str, Any]],
    existing: dict[str, dict[str, Any]],
    *,
    model: str,
) -> list[dict[str, Any]]:
    assert ctx.llm is not None
    await ctx.llm.check_health()
    pending: dict[int, dict[str, Any]] = {}
    uncached = _emit_cached_scores(ctx, records, existing, model)

    with tqdm(
        total=len(uncached),
        desc="Scoring koryciarstwo",
        unit="article",
        dynamic_ncols=True,
        mininterval=1.0,
        smoothing=0.05,
    ) as bar:
        async with ctx.llm.response_pool() as pool:
            for record in uncached:
                while pool.is_full():
                    request_id, response = await pool.get_response()
                    _emit_score_response(
                        ctx,
                        pending.pop(request_id),
                        response,
                        model,
                    )
                    bar.update(1)

                request_id = await pool.put_request(_score_request(record, model))
                pending[request_id] = record

            while pending:
                request_id, response = await pool.get_response()
                _emit_score_response(
                    ctx,
                    pending.pop(request_id),
                    response,
                    model,
                )
                bar.update(1)

    return []


def _emit_cached_scores(
    ctx: Context,
    records: list[dict[str, Any]],
    existing: dict[str, dict[str, Any]],
    model: str,
) -> list[dict[str, Any]]:
    uncached: list[dict[str, Any]] = []
    cached_count = 0
    for record in records:
        cached = existing.get(str(record["url"]))
        if _cache_valid(cached, record, model):
            assert cached is not None
            _emit_score(ctx, _score_row_from_cache(cached))
            cached_count += 1
            continue
        uncached.append(record)
    if cached_count:
        print(f"Reused cached koryciarstwo scores: {cached_count}")
    return uncached


def _emit_score_response(
    ctx: Context,
    record: dict[str, Any],
    response,
    model: str,
) -> None:
    if isinstance(response, Exception):
        _emit_score(ctx, _error_row(record, model, str(response)))
    else:
        _emit_score(ctx, _score_row(record, response.content, model, response))


def _score_request(record: dict[str, Any], model: str) -> LLMRequest:
    return LLMRequest(
        prompt=_PROMPT.format(
            text=str(record.get("article_content") or "")[:TEXT_LIMIT]
        ),
        max_tokens=MAX_TOKENS,
        temperature=TEMPERATURE,
        model=model,
    )


def _emit_score(ctx: Context, row: dict[str, Any]) -> None:
    raw_score = row.get("koryciarski_llm_score")
    score = int(raw_score) if isinstance(raw_score, (int, float)) else None
    ctx.io.dumper.insert_into(  # type: ignore[attr-defined]
        KoryciarskiScore(
            url=str(row.get("url") or ""),
            article_content_hash=str(row.get("article_content_hash") or ""),
            koryciarski_llm_score=score,
            koryciarski_llm_reason=str(row.get("koryciarski_llm_reason") or ""),
            llm_is_article=bool(row.get("llm_is_article")),
            model=str(row.get("model") or ""),
            prompt_version=int(row.get("prompt_version") or PROMPT_VERSION),
            prompt_tokens=int(row.get("prompt_tokens") or 0),
            completion_tokens=int(row.get("completion_tokens") or 0),
            total_tokens=int(row.get("total_tokens") or 0),
            error=(None if row.get("error") is None else str(row.get("error"))),
        ),
        [],
    )


def _cache_valid(
    cached: dict[str, Any] | None,
    record: dict[str, Any],
    model: str,
) -> bool:
    return (
        cached is not None
        and cached.get("article_content_hash") == record.get("article_content_hash")
        and cached.get("prompt_version") == PROMPT_VERSION
        and cached.get("model") == model
    )


def _score_row_from_cache(cached: dict[str, Any]) -> dict[str, Any]:
    return {
        "url": cached.get("url"),
        "article_content_hash": cached.get("article_content_hash"),
        "koryciarski_llm_score": cached.get("koryciarski_llm_score"),
        "koryciarski_llm_reason": cached.get("koryciarski_llm_reason") or "",
        "llm_is_article": bool(cached.get("llm_is_article")),
        "model": cached.get("model") or "",
        "prompt_version": cached.get("prompt_version"),
        "prompt_tokens": int(cached.get("prompt_tokens") or 0),
        "completion_tokens": int(cached.get("completion_tokens") or 0),
        "total_tokens": int(cached.get("total_tokens") or 0),
        "error": cached.get("error"),
    }


def _score_row(
    record: dict[str, Any],
    response_text: str,
    model: str,
    response,
) -> dict[str, Any]:
    parsed = _extract_json_object(response_text)
    if not parsed:
        return _error_row(record, model, "invalid json parse", response=response)
    llm_is_article, score, reason = _normalize_scoring_result(parsed)
    return {
        "url": record["url"],
        "article_content_hash": record["article_content_hash"],
        "koryciarski_llm_score": score,
        "koryciarski_llm_reason": reason,
        "llm_is_article": llm_is_article,
        "model": model,
        "prompt_version": PROMPT_VERSION,
        "prompt_tokens": response.prompt_tokens,
        "completion_tokens": response.completion_tokens,
        "total_tokens": response.total_tokens,
        "error": None,
    }


def _error_row(
    record: dict[str, Any],
    model: str,
    error: str,
    response=None,
) -> dict[str, Any]:
    return {
        "url": record.get("url"),
        "article_content_hash": record.get("article_content_hash"),
        "koryciarski_llm_score": None,
        "koryciarski_llm_reason": error,
        "llm_is_article": False,
        "model": model,
        "prompt_version": PROMPT_VERSION,
        "prompt_tokens": int(getattr(response, "prompt_tokens", 0) or 0),
        "completion_tokens": int(getattr(response, "completion_tokens", 0) or 0),
        "total_tokens": int(getattr(response, "total_tokens", 0) or 0),
        "error": error,
    }


def _normalize_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        value = value.strip().lower()
        if value in {"true", "1", "yes", "tak"}:
            return True
        if value in {"false", "0", "no", "nie"}:
            return False
    if value is None:
        return None
    return bool(value)


def _extract_json_object(text: str) -> dict[str, Any] | None:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    text = re.sub(r"^```[a-z]*\n?", "", text.strip())
    text = re.sub(r"\n?```$", "", text.strip())
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        parsed = json.loads(match.group())
    except Exception:
        return None
    return parsed if isinstance(parsed, dict) else None


def _normalize_scoring_result(parsed: dict[str, Any]) -> tuple[bool, int | None, str]:
    llm_is_article = _normalize_bool(
        parsed.get("llm_is_article", parsed.get("is_article"))
    )
    raw_score = parsed.get("koryciarski_llm_score", parsed.get("score"))
    score: int | None
    if isinstance(raw_score, bool):
        score = None
    elif isinstance(raw_score, int):
        score = raw_score
    elif isinstance(raw_score, float):
        score = int(raw_score)
    elif isinstance(raw_score, str) and raw_score.strip():
        try:
            score = int(raw_score)
        except Exception:
            score = None
    else:
        score = None

    reason = str(
        parsed.get("koryciarski_llm_reason", parsed.get("reason", "")) or ""
    ).strip()
    if not reason:
        reason = "model did not return reasoning"
    if llm_is_article is None:
        llm_is_article = score is not None and 0 <= score <= 5
    if not llm_is_article:
        score = None
    if score is not None:
        score = max(0, min(5, score))
    return llm_is_article, score, reason


def _print_llm_usage(ctx: Context) -> None:
    llm = ctx.llm
    if llm is None:
        return
    requests = int(getattr(llm, "request_count", 0) or 0)
    prompt_tokens = int(getattr(llm, "prompt_tokens", 0) or 0)
    completion_tokens = int(getattr(llm, "completion_tokens", 0) or 0)
    total_tokens = int(getattr(llm, "total_tokens", 0) or 0)
    print(
        "LLM usage: "
        f"{requests} requests, "
        f"{prompt_tokens} prompt tokens, "
        f"{completion_tokens} completion tokens, "
        f"{total_tokens} total tokens"
    )
