import asyncio
import difflib
import json
import re
import unicodedata
from collections import defaultdict
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
    dict_to_fact,
)
from scrapers.article.pipelines.koryciarski_scores_pipeline import (
    ArticleKoryciarskiScores,
)
from scrapers.article.pipelines.pipeline_utils import llm_model
from scrapers.stores import Context, LLMRequest, Pipeline
from stores.config import VERSIONED_DIR

PROMPT_VERSION = 7
TEXT_LIMIT = 100000
MAX_TOKENS = 20000
TEMPERATURE = 0.1
JUSTIFICATION_FUZZY_THRESHOLD = 0.85

_PARSED_FILE = Path(VERSIONED_DIR) / "article_parsed" / "article_parsed.jsonl"
_SCORES_FILE = (
    Path(VERSIONED_DIR)
    / "article_koryciarski_scores"
    / "article_koryciarski_scores.jsonl"
)
_FINAL_OUTPUT_FILE = Path(VERSIONED_DIR) / "article_facts" / "article_facts.jsonl"
_TEMP_OUTPUT_FILE = Path(VERSIONED_DIR) / "article_facts" / "article_facts.jsonl.tmp"
_THINK_BLOCK_RE = re.compile(r"<think>(.*?)</think>", flags=re.DOTALL)
_RUN_RESPONSE_THINK_CHARS = 0
_RUN_RESPONSE_THINK_BLOCKS = 0

_PROMPT = (
    "Jesteś profesjonalnym, obiektywnym dziennikarzem analizującym tekst źródłowy. "
    "Wyciągnij tylko fakty bezpośrednio poparte główną treścią artykułu. "
    "Interesują nas wyłącznie trzy typy faktów:\n"
    "1. employment — ktoś pracuje, pełni funkcję albo zajmuje stanowisko "
    "w instytucji, urzędzie, firmie, organizacji lub spółce\n"
    "2. party_membership — ktoś należy do partii politycznej albo jest "
    "jednoznacznie opisany jako polityk tej partii\n"
    "3. personal_relation — ktoś jest spokrewniony z kimś albo pozostaje "
    "z kimś w jednoznacznie opisanej bliskiej relacji osobistej\n\n"
    "Jeśli w tekście nie ma takich faktów, zwróć pustą listę.\n\n"
    "Ignoruj komentarze czytelników, podpisy zdjęć, stopki, wezwania do głosowania, "
    "listy kandydatów, listy uczestników, listy radnych, listy sygnatariuszy, "
    "zaproszenia na wydarzenia i proste relacje z obecności na spotkaniu.\n"
    "Jeśli tekst jest listą teaserów, stroną tagu albo zbiorem wielu krótkich "
    "zajawek, zwróć pustą odpowiedź.\n"
    "Każdy fakt musi dotyczyć realnej, nazwanej osoby. Nie zwracaj faktów dla "
    "osób opisanych tylko jako: urzędnik, dyrektor, prezes, podejrzany, "
    "biznesmen, osoba, ... albo brak danych.\n"
    "Nie traktuj kandydowania w wyborach, poparcia wyborczego, głosowania na kogoś, "
    "udziału w spotkaniu, wystąpienia publicznego ani przynależności do komitetu "
    "wyborczego jako employment.\n"
    "Nie traktuj bycia podejrzanym, oskarżonym, zatrzymanym, autorem, rozmówcą "
    "ani osobą cytowaną jako employment.\n"
    "Nie traktuj komitetu wyborczego jako partii politycznej.\n"
    "Nie zwracaj party_membership, jeśli tekst mówi tylko, że partii nie podano, "
    "osoba jest bezpartyjna, kandydowała z listy albo jest z nią luźno związana.\n"
    "Nie traktuj poparcia, krytyki, wspólnego wystąpienia ani cytowania jednej osoby "
    "przez drugą jako personal_relation.\n"
    "Personal_relation zwracaj tylko dla rodziny, małżeństwa, partnerstwa albo "
    "wyraźnie opisanej bliskiej relacji osobistej. Nie zwracaj relacji "
    "zawodowych, przestępczych, korupcyjnych ani współpracy.\n"
    "Nie zwracaj placeholderów ani faktów negatywnych typu person=..., "
    "party=nie podano, organization=nieokreślona.\n\n"
    "Pole justification jest dowodem z tekstu. Musi być albo dokładnym cytatem "
    "skopiowanym z artykułu, albo pustą wartością. Cytat musi być krótkim "
    "fragmentem, najlepiej jednym zdaniem albo częścią zdania, maksymalnie około "
    "180 znaków. Nie parafrazuj justification. Nie pisz: tekst mówi, artykuł "
    "podaje, jawnie podano, ..., ani własnych wyjaśnień. Jeśli nie możesz podać "
    "krótkiego dokładnego cytatu z artykułu, ustaw justification=.\n\n"
    "Zanim zwrócisz fakty, musisz krótko pomyśleć jawnie w sekcji "
    "<think>...</think>. Sekcja <think> ma mieć 3-8 krótkich punktów: "
    "kandydaci na fakty, dowody w tekście, odrzucone kandydaty i powód "
    "odrzucenia. Nie umieszczaj w <think> finalnych linii faktów. "
    "Po </think> napisz osobną linię `facts:` i dopiero pod nią zwróć końcową "
    "odpowiedź jako krótki markdown, jedna linia na fakt.\n"
    "Format każdej linii. Najpierw zawsze podaj justification, potem typ faktu, "
    "potem pola faktu:\n"
    "- justification=... | employment | person=... | organization=... | role=...\n"
    "- justification=... | party_membership | person=... | party=...\n"
    "- justification=... | personal_relation | subject=... | object=... | "
    "relation=...\n\n"
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
        _reset_run_think_stats()
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
        min_score = getattr(ctx, "article_facts_min_koryciarski_score", None)
        asyncio.run(
            _extract_records(
                ctx,
                records,
                existing,
                model=model,
                min_score=min_score,
            )
        )
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
    article_scores = _article_scores_by_url(scores_path)
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
            if not isinstance(url, str) or url not in article_scores:
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
                # Keep only the fields fact extraction needs — dropping
                # outbound_urls (63% of the row) and other columns keeps memory
                # bounded on the 20GB parsed file.
                latest[url] = {
                    "url": url,
                    "article_content_hash": content_hash,
                    "article_content": content,
                    "koryciarski_llm_score": article_scores[url],
                }
    return list(latest.values())


def _article_scores_by_url(path: Path) -> dict[str, int]:
    scores: dict[str, int] = {}
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
            score = _score_from_row(row)
            if isinstance(url, str) and score is not None:
                scores[url] = score
    return scores


def _score_from_row(row: dict[str, Any]) -> int | None:
    raw_score = row.get("koryciarski_llm_score")
    if isinstance(raw_score, bool):
        return None
    if isinstance(raw_score, int):
        return raw_score
    if isinstance(raw_score, float):
        return int(raw_score)
    if isinstance(raw_score, str) and raw_score.strip():
        try:
            return int(raw_score)
        except Exception:
            return None
    return None


async def _extract_records(
    ctx: Context,
    records: list[dict[str, Any]],
    existing: dict[str, dict[str, Any]],
    *,
    model: str,
    min_score: int | None,
) -> None:
    assert ctx.llm is not None
    await ctx.llm.check_health()
    pending: dict[int, dict[str, Any]] = {}
    uncached = _filter_uncached_fact_records(
        _emit_cached_facts(ctx, records, existing, model),
        min_score,
    )

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

                request_id = await pool.put_request(_fact_request(record, model, ctx))
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


def _filter_uncached_fact_records(
    records: list[dict[str, Any]],
    min_score: int | None,
) -> list[dict[str, Any]]:
    if min_score is None:
        return records
    filtered = [
        record
        for record in records
        if _record_meets_min_score(record, min_score)
    ]
    skipped = len(records) - len(filtered)
    if skipped:
        print(
            "Skipped uncached article facts below koryciarski score "
            f"{min_score}: {skipped}"
        )
    return filtered


def _record_meets_min_score(record: dict[str, Any], min_score: int) -> bool:
    score = _score_from_row(record)
    return score is not None and score >= min_score


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
        error = str(response) or f"{type(response).__name__}: {response!r}"
        _emit_facts(ctx, _error_row(record, model, error))
    else:
        _emit_facts(ctx, _facts_row(record, response.content, model, response))


def _fact_request(record: dict[str, Any], model: str, ctx=None) -> LLMRequest:
    text_limit = (
        getattr(ctx, "article_facts_text_limit", None) or TEXT_LIMIT
    )
    max_tokens = (
        getattr(ctx, "article_facts_max_tokens", None) or MAX_TOKENS
    )
    return LLMRequest(
        prompt=_PROMPT.format(
            text=str(record.get("article_content") or "")[:text_limit]
        ),
        max_tokens=max_tokens,
        temperature=TEMPERATURE,
        model=model,
        enable_thinking=True,
    )


def _cache_valid(
    cached: dict[str, Any] | None,
    record: dict[str, Any],
    model: str,
) -> bool:
    return (
        cached is not None
        and cached.get("fact_extraction_status") != "error"
        and cached.get("article_content_hash") == record.get("article_content_hash")
        and cached.get("prompt_version") == PROMPT_VERSION
        and cached.get("model") == model
        and "response_think_chars" in cached
        and "response_think_blocks" in cached
        and "response_think_text" in cached
        and all(
            "justification_in_text" in fact
            for fact in cached.get("extracted_facts") or []
            if isinstance(fact, dict)
        )
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
        "response_think_chars": int(cached.get("response_think_chars") or 0),
        "response_think_blocks": int(cached.get("response_think_blocks") or 0),
        "response_think_text": str(cached.get("response_think_text") or ""),
    }


def _facts_row(
    record: dict[str, Any],
    response_text: str,
    model: str,
    response,
) -> dict[str, Any]:
    think_text = _think_text(response_text)
    think_chars, think_blocks = _think_stats_from_text(think_text)
    _add_run_think_stats(think_chars, think_blocks)
    try:
        facts = _normalize_markdown_response(
            str(record.get("url") or ""),
            response_text,
            str(record.get("article_content") or ""),
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
            "response_think_chars": think_chars,
            "response_think_blocks": think_blocks,
            "response_think_text": think_text,
        }
    except Exception as exc:
        return _error_row(
            record,
            model,
            str(exc),
            response=response,
            think_chars=think_chars,
            think_blocks=think_blocks,
            think_text=think_text,
        )


def _error_row(
    record: dict[str, Any],
    model: str,
    error: str,
    response=None,
    think_chars: int = 0,
    think_blocks: int = 0,
    think_text: str = "",
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
        "response_think_chars": think_chars,
        "response_think_blocks": think_blocks,
        "response_think_text": think_text,
    }


def _deserialize_facts(raw: list[Any]) -> list[ArticleFact]:
    """Convert dicts read from JSONL back to ArticleFact instances."""
    facts = []
    for item in raw:
        if isinstance(item, ArticleFact):
            facts.append(item)
        elif isinstance(item, dict):
            try:
                facts.append(dict_to_fact(item))
            except Exception:
                pass
    return facts


def _emit_facts(ctx: Context, row: dict[str, Any]) -> None:
    ctx.io.dumper.insert_into(  # type: ignore[attr-defined]
        ArticleFacts(
            url=str(row.get("url") or ""),
            article_content_hash=str(row.get("article_content_hash") or ""),
            extracted_facts=_deserialize_facts(row.get("extracted_facts") or []),
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
            response_think_chars=int(row.get("response_think_chars") or 0),
            response_think_blocks=int(row.get("response_think_blocks") or 0),
            response_think_text=str(row.get("response_think_text") or ""),
        ),
        [],
    )


def _strip_formatting(text: str) -> str:
    text = _THINK_BLOCK_RE.sub("", text).strip()
    text = re.sub(r"^```[a-z]*\n?", "", text.strip())
    text = re.sub(r"\n?```$", "", text.strip())
    return text.strip()


def _think_text(text: str) -> str:
    return "\n\n".join(block.strip() for block in _THINK_BLOCK_RE.findall(text))


def _think_stats_from_text(text: str) -> tuple[int, int]:
    if not text:
        return 0, 0
    return len(text), len([block for block in text.split("\n\n") if block.strip()])


def _add_run_think_stats(chars: int, blocks: int) -> None:
    global _RUN_RESPONSE_THINK_CHARS, _RUN_RESPONSE_THINK_BLOCKS
    _RUN_RESPONSE_THINK_CHARS += chars
    _RUN_RESPONSE_THINK_BLOCKS += blocks


def _reset_run_think_stats() -> None:
    global _RUN_RESPONSE_THINK_CHARS, _RUN_RESPONSE_THINK_BLOCKS
    _RUN_RESPONSE_THINK_CHARS = 0
    _RUN_RESPONSE_THINK_BLOCKS = 0


def _split_fact_line(line: str) -> dict[str, str] | None:
    line = line.strip()
    if not line or line.lower() == "facts:":
        return None
    if line.startswith(("- ", "* ")):
        line = line[2:].strip()
    parts = [part.strip() for part in line.split("|")]
    if not parts:
        return None
    fact_types = {"employment", "party_membership", "personal_relation"}
    fact_type = ""
    fact_type_index = -1
    for index, part in enumerate(parts):
        candidate = part.strip().lower()
        if candidate in fact_types:
            fact_type = candidate
            fact_type_index = index
            break
    if not fact_type:
        return None
    parsed: dict[str, str] = {"fact_type": fact_type}
    for index, part in enumerate(parts):
        if index == fact_type_index:
            continue
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


def _coerce_fact(
    url: str,
    raw_fact: dict[str, Any],
    article_text: str,
) -> ArticleFact | None:
    fact_type = raw_fact.get("fact_type")
    justification = str(raw_fact.get("justification") or "").strip()
    justification_in_text = _find_justification_in_text(
        justification,
        article_text,
    )
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
            justification_in_text=justification_in_text,

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
            justification_in_text=justification_in_text,

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
            justification_in_text=justification_in_text,

            subject=subject,
            object=object_,
            relation=relation_text or None,
        )
    return None


def _find_justification_in_text(
    justification: str, article_text: str
) -> str | None:
    # The result must be a VERBATIM substring of article_text so it can be
    # found with ctrl+F / highlighted in the source HTML. Every branch below
    # returns actual article text (never the LLM's paraphrase).
    justification = justification.strip()
    if not justification:
        return None
    if justification in article_text:
        return justification

    stripped = _strip_edge_ellipsis(justification)
    candidate = stripped if (stripped and stripped != justification) else justification

    if candidate != justification and candidate in article_text:
        return candidate

    pattern = _justification_wildcard_pattern(candidate)
    if pattern is not None:
        m = re.search(pattern, article_text, re.DOTALL)
        if m is not None:
            return m.group(0)

    # Fuzzy fallback: the LLM may have dropped/altered a word (e.g. ate "też").
    # Return the real article span that matches, not the LLM text.
    return _fuzzy_verbatim_span(candidate, article_text)


def _justification_wildcard_pattern(justification: str) -> str | None:
    placeholders = ("[...]", "[…]", "…")
    if not any(placeholder in justification for placeholder in placeholders):
        return None

    parts = re.split(r"(?:\[\.\.\.\]|\[…\]|…)", justification)
    escaped = [re.escape(part.strip()) for part in parts if part.strip()]
    if not escaped:
        return None
    return r".{0,1000}?".join(escaped)


def _strip_edge_ellipsis(justification: str) -> str:
    without_prefix = re.sub(r"^(?:\.\.\.|…)\s*", "", justification)
    return re.sub(r"\s*(?:\.\.\.|…)$", "", without_prefix).strip()


_WORD_RE = re.compile(r"\w+", re.UNICODE)

# How many tokens the article span may shift/grow at each edge relative to the
# needle length, to absorb words the LLM dropped or added.
_JUSTIFICATION_SLACK = 3


def _article_word_offsets(article_text: str) -> list[tuple[str, int, int]]:
    """Tokenize into (normalized_token, start_char, end_char) so a matched token
    window can be mapped back to a verbatim slice of article_text."""
    words: list[tuple[str, int, int]] = []
    for match in _WORD_RE.finditer(article_text):
        norm = _normalize_justification_text(match.group(0))
        if norm:
            words.append((norm, match.start(), match.end()))
    return words


def _fuzzy_verbatim_span(justification: str, article_text: str) -> str | None:
    """Find the verbatim article substring that best matches the justification.

    Anchors on distinctive needle tokens, then flexes the span's start and end
    by a few tokens to absorb words the LLM dropped/added, and returns the actual
    article slice (guaranteed to be a substring) if the fuzzy ratio clears the
    threshold. Returns None otherwise.
    """
    needle_tokens = _normalize_justification_text(justification).split()
    if len(needle_tokens) < 3:
        return None
    words = _article_word_offsets(article_text)
    if len(words) < 3:
        return None

    needle = " ".join(needle_tokens)
    n = len(needle_tokens)
    positions_by_token: dict[str, list[int]] = defaultdict(list)
    for index, (token, _s, _e) in enumerate(words):
        positions_by_token[token].append(index)

    anchor_offsets = [
        (offset, token)
        for offset, token in enumerate(needle_tokens)
        if len(token) >= 4 and token in positions_by_token
    ]
    if not anchor_offsets:
        anchor_offsets = [
            (offset, token)
            for offset, token in enumerate(needle_tokens)
            if token in positions_by_token
        ]
    if not anchor_offsets:
        return None

    base_starts: set[int] = set()
    for offset, token in anchor_offsets:
        for article_position in positions_by_token[token]:
            start = article_position - offset
            if 0 <= start < len(words):
                base_starts.add(start)

    best_ratio = 0.0
    best_span: str | None = None
    slack = _JUSTIFICATION_SLACK
    for base in base_starts:
        for start in range(max(0, base - slack), min(len(words), base + slack + 1)):
            end_lo = max(start, start + n - 1 - slack)
            end_hi = min(len(words), start + n + slack)
            for end in range(end_lo, end_hi):
                span = article_text[words[start][1] : words[end][2]]
                ratio = difflib.SequenceMatcher(
                    None, needle, _normalize_justification_text(span)
                ).ratio()
                if ratio >= JUSTIFICATION_FUZZY_THRESHOLD and ratio > best_ratio:
                    best_ratio = ratio
                    best_span = span
    return best_span


def _normalize_justification_text(text: str) -> str:
    text = "".join(
        char
        for char in unicodedata.normalize("NFKD", text)
        if not unicodedata.combining(char)
    )
    text = text.lower()
    text = re.sub(r"[^\w]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _normalize_markdown_response(
    url: str,
    text: str,
    article_text: str,
) -> list[ArticleFact]:
    facts: list[ArticleFact] = []
    for raw_fact in _extract_markdown_facts(text):
        fact = _coerce_fact(url, raw_fact, article_text)
        if fact is not None:
            facts.append(fact)
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
    print(
        "LLM think usage: "
        f"{_RUN_RESPONSE_THINK_BLOCKS} blocks, "
        f"{_RUN_RESPONSE_THINK_CHARS} chars"
    )
