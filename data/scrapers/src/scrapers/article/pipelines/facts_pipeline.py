import asyncio
import json
import re
from pathlib import Path
from typing import Any

import pandas as pd
from tqdm import tqdm

from entities.article import ArticleFacts
from entities.facts import (
    ArticleFact,
    EmploymentFact,
    PartyMembershipFact,
    PersonalRelationFact,
    fact_to_dict,
)
from scrapers.article.pipelines.koryciarski_scores_pipeline import (
    ArticleKoryciarskiScores,
)
from scrapers.article.pipelines.pipeline_utils import llm_model
from scrapers.stores import Context, LLMRequest, Pipeline
from stores.config import VERSIONED_DIR

PROMPT_VERSION = 1
TEXT_LIMIT = 100000
MAX_TOKENS = 1000
TEMPERATURE = 0.1

_PARSED_FILE = Path(VERSIONED_DIR) / "article_parsed" / "article_parsed.jsonl"
_SCORES_FILE = (
    Path(VERSIONED_DIR)
    / "article_koryciarski_scores"
    / "article_koryciarski_scores.jsonl"
)
_FINAL_OUTPUT_FILE = Path(VERSIONED_DIR) / "article_facts" / "article_facts.jsonl"
_TEMP_OUTPUT_FILE = Path(VERSIONED_DIR) / "article_facts" / "article_facts.jsonl.tmp"

_PROMPT = (
    "Wyciągnij tylko fakty bezpośrednio poparte główną treścią artykułu. "
    "Interesują nas wyłącznie trzy typy faktów:\n"
    "1. employment — ktoś pracuje, pełni funkcję albo zajmuje stanowisko "
    "w instytucji, urzędzie, firmie, organizacji lub spółce\n"
    "2. party_membership — ktoś należy do partii politycznej albo jest "
    "jednoznacznie opisany jako polityk tej partii\n"
    "3. personal_relation — ktoś jest spokrewniony z kimś albo pozostaje "
    "z kimś w jednoznacznie opisanej bliskiej relacji osobistej\n\n"
    "Jeśli w tekście nie ma takich faktów, zwróć pustą listę.\n\n"
    "Zwróć maksymalnie 8 faktów.\n"
    "Ignoruj komentarze czytelników, podpisy zdjęć, stopki, wezwania do głosowania, "
    "listy kandydatów, listy uczestników, listy radnych, listy sygnatariuszy, "
    "zaproszenia na wydarzenia i proste relacje z obecności na spotkaniu.\n"
    "Nie traktuj kandydowania w wyborach, poparcia wyborczego, głosowania na kogoś, "
    "udziału w spotkaniu, wystąpienia publicznego ani przynależności do komitetu "
    "wyborczego jako employment.\n"
    "Nie traktuj komitetu wyborczego jako partii politycznej.\n"
    "Nie traktuj poparcia, krytyki, wspólnego wystąpienia ani cytowania jednej osoby "
    "przez drugą jako personal_relation.\n\n"
    "Zwróć końcową odpowiedź jako krótki markdown, jedna linia na fakt.\n"
    "Format każdej linii:\n"
    "- employment | person=... | organization=... | role=... | justification=...\n"
    "- party_membership | person=... | party=... | justification=...\n"
    "- personal_relation | subject=... | object=... | relation=... | "
    "justification=...\n\n"
    "Jeśli nie ma faktów, zwróć pustą odpowiedź albo sam nagłówek `facts:`.\n"
    "Nie zgaduj. Nie dopisuj faktów spoza tekstu.\n\n"
    "Artykuł:\n{text}"
)


class ArticleExtractedFacts(Pipeline[ArticleFacts]):
    filename = "article_facts"

    koryciarski_scores: ArticleKoryciarskiScores

    @property
    def output_class(self):
        return ArticleFacts

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
        try:
            df = self.process(ctx)
            self._refreshed_execution = True
        except (InterruptedError, KeyboardInterrupt):
            print("Caught interrupt signal, will save partial facts")
            df = pd.DataFrame()
        except Exception:
            graceful = False
            raise
        finally:
            if graceful:
                print("Dumping...")
                ctx.io.dumper.dump_pandas()  # type: ignore[attr-defined]
                if _TEMP_OUTPUT_FILE.exists():
                    _finalize_temp_output()
                print("Done")

        ctx.refresh_policy.add_refreshed_pipeline(self.pipeline_name)
        self._cached_result = df
        return df

    def process(self, ctx: Context):
        if ctx.llm is None:
            raise ValueError("ArticleExtractedFacts requires Context.llm")
        if not _PARSED_FILE.exists():
            raise FileNotFoundError(_PARSED_FILE)
        if not _SCORES_FILE.exists():
            raise FileNotFoundError(_SCORES_FILE)

        existing = _existing_facts_cache_from_files(
            _FINAL_OUTPUT_FILE,
            _TEMP_OUTPUT_FILE,
        )
        _prepare_temp_output()
        model = llm_model(ctx)
        records = _extractable_records(_PARSED_FILE, _SCORES_FILE)
        asyncio.run(_extract_records(ctx, records, existing, model=model))
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


def _existing_facts_cache_from_files(*paths: Path) -> dict[str, dict[str, Any]]:
    cache: dict[str, dict[str, Any]] = {}
    for path in paths:
        if not path.exists():
            continue
        with path.open("r", encoding="utf-8") as handle:
            for line in tqdm(
                handle,
                desc=f"Reading facts cache {path.name}",
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


def _extractable_records(parsed_path: Path, scores_path: Path) -> list[dict[str, Any]]:
    article_urls = _article_urls_from_scores(scores_path)
    latest: dict[str, dict[str, Any]] = {}
    with parsed_path.open("r", encoding="utf-8") as handle:
        for line in tqdm(handle, desc="Reading parsed articles", unit="row"):
            raw = line.strip()
            if not raw:
                continue
            try:
                row = json.loads(raw)
            except Exception:
                continue
            url = row.get("url")
            if not isinstance(url, str) or url not in article_urls:
                continue
            if row.get("parse_status") != "ok":
                continue
            content_hash = row.get("article_content_hash")
            content = row.get("article_content")
            if (
                isinstance(content_hash, str)
                and isinstance(content, str)
                and content.strip()
            ):
                latest[url] = row
    return list(latest.values())


def _article_urls_from_scores(path: Path) -> set[str]:
    urls: set[str] = set()
    with path.open("r", encoding="utf-8") as handle:
        for line in tqdm(handle, desc="Reading scores", unit="row"):
            raw = line.strip()
            if not raw:
                continue
            try:
                row = json.loads(raw)
            except Exception:
                continue
            if row.get("llm_is_article") is not True:
                continue
            url = row.get("url")
            if isinstance(url, str):
                urls.add(url)
    return urls


async def _extract_records(
    ctx: Context,
    records: list[dict[str, Any]],
    existing: dict[str, dict[str, Any]],
    *,
    model: str,
) -> None:
    assert ctx.llm is not None
    await ctx.llm.check_health()
    pending: dict[int, dict[str, Any]] = {}
    uncached = _emit_cached_facts(ctx, records, existing, model)

    with tqdm(
        total=len(uncached),
        desc="Extracting article facts",
        unit="article",
        dynamic_ncols=True,
        mininterval=1.0,
        smoothing=0.05,
    ) as bar:
        async with ctx.llm.response_pool() as pool:
            for record in uncached:
                while pool.is_full():
                    request_id, response = await pool.get_response()
                    _emit_fact_response(
                        ctx,
                        pending.pop(request_id),
                        response,
                        model,
                    )
                    bar.update(1)

                request_id = await pool.put_request(_fact_request(record, model))
                pending[request_id] = record

            while pending:
                request_id, response = await pool.get_response()
                _emit_fact_response(
                    ctx,
                    pending.pop(request_id),
                    response,
                    model,
                )
                bar.update(1)


def _emit_cached_facts(
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
            _emit_facts(ctx, _facts_row_from_cache(cached))
            cached_count += 1
            continue
        uncached.append(record)
    if cached_count:
        print(f"Reused cached article facts: {cached_count}")
    return uncached


def _emit_fact_response(
    ctx: Context,
    record: dict[str, Any],
    response,
    model: str,
) -> None:
    if isinstance(response, Exception):
        _emit_facts(ctx, _error_row(record, model, str(response)))
    else:
        _emit_facts(ctx, _facts_row(record, response.content, model, response))


def _fact_request(record: dict[str, Any], model: str) -> LLMRequest:
    return LLMRequest(
        prompt=_PROMPT.format(
            text=str(record.get("article_content") or "")[:TEXT_LIMIT]
        ),
        max_tokens=MAX_TOKENS,
        temperature=TEMPERATURE,
        model=model,
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


def _facts_row_from_cache(cached: dict[str, Any]) -> dict[str, Any]:
    return {
        "url": cached.get("url"),
        "article_content_hash": cached.get("article_content_hash"),
        "extracted_facts": cached.get("extracted_facts") or [],
        "fact_extraction_status": cached.get("fact_extraction_status") or "ok",
        "fact_extraction_error": cached.get("fact_extraction_error"),
        "model": cached.get("model") or "",
        "prompt_version": cached.get("prompt_version"),
        "prompt_tokens": int(cached.get("prompt_tokens") or 0),
        "completion_tokens": int(cached.get("completion_tokens") or 0),
        "total_tokens": int(cached.get("total_tokens") or 0),
    }


def _facts_row(
    record: dict[str, Any],
    response_text: str,
    model: str,
    response,
) -> dict[str, Any]:
    try:
        facts = _normalize_markdown_response(
            str(record.get("url") or ""),
            response_text,
        )
        return {
            "url": record["url"],
            "article_content_hash": record["article_content_hash"],
            "extracted_facts": facts,
            "fact_extraction_status": "ok",
            "fact_extraction_error": None,
            "model": model,
            "prompt_version": PROMPT_VERSION,
            "prompt_tokens": response.prompt_tokens,
            "completion_tokens": response.completion_tokens,
            "total_tokens": response.total_tokens,
        }
    except Exception as exc:
        return _error_row(record, model, str(exc), response=response)


def _error_row(
    record: dict[str, Any],
    model: str,
    error: str,
    response=None,
) -> dict[str, Any]:
    return {
        "url": record.get("url"),
        "article_content_hash": record.get("article_content_hash"),
        "extracted_facts": [],
        "fact_extraction_status": "error",
        "fact_extraction_error": error,
        "model": model,
        "prompt_version": PROMPT_VERSION,
        "prompt_tokens": int(getattr(response, "prompt_tokens", 0) or 0),
        "completion_tokens": int(getattr(response, "completion_tokens", 0) or 0),
        "total_tokens": int(getattr(response, "total_tokens", 0) or 0),
    }


def _emit_facts(ctx: Context, row: dict[str, Any]) -> None:
    ctx.io.dumper.insert_into(  # type: ignore[attr-defined]
        ArticleFacts(
            url=str(row.get("url") or ""),
            article_content_hash=str(row.get("article_content_hash") or ""),
            extracted_facts=list(row.get("extracted_facts") or []),
            fact_extraction_status=str(row.get("fact_extraction_status") or "ok"),
            fact_extraction_error=(
                None
                if row.get("fact_extraction_error") is None
                else str(row.get("fact_extraction_error"))
            ),
            model=str(row.get("model") or ""),
            prompt_version=int(row.get("prompt_version") or PROMPT_VERSION),
            prompt_tokens=int(row.get("prompt_tokens") or 0),
            completion_tokens=int(row.get("completion_tokens") or 0),
            total_tokens=int(row.get("total_tokens") or 0),
        ),
        [],
    )


def _strip_formatting(text: str) -> str:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    text = re.sub(r"^```[a-z]*\n?", "", text.strip())
    text = re.sub(r"\n?```$", "", text.strip())
    return text.strip()


def _split_fact_line(line: str) -> dict[str, str] | None:
    line = line.strip()
    if not line or line.lower() == "facts:":
        return None
    if line.startswith(("- ", "* ")):
        line = line[2:].strip()
    parts = [part.strip() for part in line.split("|")]
    if not parts:
        return None
    fact_type = parts[0].strip().lower()
    if fact_type not in {"employment", "party_membership", "personal_relation"}:
        return None
    parsed: dict[str, str] = {"fact_type": fact_type}
    for part in parts[1:]:
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        parsed[key.strip().lower()] = value.strip().strip('"').strip("'")
    return parsed


def _extract_markdown_facts(text: str) -> list[dict[str, str]]:
    text = _strip_formatting(text)
    facts: list[dict[str, str]] = []
    for raw_line in text.splitlines():
        parsed = _split_fact_line(raw_line)
        if parsed is not None:
            facts.append(parsed)
    return facts


def _coerce_fact(url: str, raw_fact: dict[str, Any]) -> ArticleFact | None:
    fact_type = raw_fact.get("fact_type")
    justification = str(raw_fact.get("justification") or "").strip()
    if fact_type == "employment":
        person = str(raw_fact.get("person") or "").strip()
        organization = str(raw_fact.get("organization") or "").strip()
        role = raw_fact.get("role")
        role_text = str(role).strip() if role is not None else None
        if not person or not organization:
            return None
        lowered = f"{organization} {role_text or ''}".lower()
        if "kww" in lowered or "komitet wyborczy" in lowered:
            return None
        if any(
            banned in lowered
            for banned in ("kandydat", "kandydatka", "wybor", "wyborc")
        ):
            return None
        return EmploymentFact(
            url=url,
            justification=justification,
            person=person,
            organization=organization,
            role=role_text or None,
        )
    if fact_type == "party_membership":
        person = str(raw_fact.get("person") or "").strip()
        party = str(raw_fact.get("party") or "").strip()
        if not person or not party:
            return None
        lowered_party = party.lower()
        if "kww" in lowered_party or "komitet wyborczy" in lowered_party:
            return None
        return PartyMembershipFact(
            url=url,
            justification=justification,
            person=person,
            party=party,
        )
    if fact_type == "personal_relation":
        subject = str(raw_fact.get("subject") or "").strip()
        object_ = str(raw_fact.get("object") or "").strip()
        relation = raw_fact.get("relation")
        relation_text = str(relation).strip() if relation is not None else None
        if not subject or not object_:
            return None
        lowered_relation = (relation_text or "").lower()
        if lowered_relation and any(
            banned in lowered_relation
            for banned in (
                "popar",
                "głos",
                "kryty",
                "cytu",
                "wspólne wystąpienie",
                "wystąpienie",
                "spotkanie",
            )
        ):
            return None
        return PersonalRelationFact(
            url=url,
            justification=justification,
            subject=subject,
            object=object_,
            relation=relation_text or None,
        )
    return None


def _normalize_markdown_response(url: str, text: str) -> list[dict[str, Any]]:
    facts: list[dict[str, Any]] = []
    for raw_fact in _extract_markdown_facts(text):
        fact = _coerce_fact(url, raw_fact)
        if fact is not None:
            facts.append(fact_to_dict(fact))
    return facts


def _print_llm_usage(ctx: Context) -> None:
    llm = ctx.llm
    if llm is None:
        return
    print(
        "LLM usage: "
        f"{int(getattr(llm, 'request_count', 0) or 0)} requests, "
        f"{int(getattr(llm, 'prompt_tokens', 0) or 0)} prompt tokens, "
        f"{int(getattr(llm, 'completion_tokens', 0) or 0)} completion tokens, "
        f"{int(getattr(llm, 'total_tokens', 0) or 0)} total tokens"
    )
