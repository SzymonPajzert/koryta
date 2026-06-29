"""
Score each parsed article for how "koryciarski" it is.

"Koryciarski" = article about politicians/officials exploiting public positions:
nepotism, political appointments, conflicts of interest, public money abuse.

Input: versioned/article_parsed/article_parsed.jsonl
Output: score_koryciarski.jsonl

Output rows keep the parsed article fields and add:
  - koryciarski_llm_score
  - koryciarski_llm_reason
  - llm_is_article
"""

from __future__ import annotations

import asyncio
import json
import re
import sys
from pathlib import Path
from typing import Any

import aiohttp
from tqdm import tqdm

QWEN_PORTS = list(range(6000, 6016))
MODEL = "Qwen/Qwen3-14B"
INPUT_FILE = Path("versioned/article_parsed/article_parsed.jsonl")
OUTPUT_FILE = Path("score_koryciarski.jsonl")
TEMP_OUTPUT_FILE = Path("score_koryciarski.jsonl.tmp")
CONCURRENCY = 32
TEXT_LIMIT = 100000
BATCH_SIZE = 512
REQUEST_RETRIES = 3
REQUEST_TIMEOUT_SECONDS = 60
WORKER_COUNT = len(QWEN_PORTS)

PROMPT = (
    'Oceń artykuł pod kątem tego, czy opisuje zjawisko "koryciarstwa" '
    "— czyli czerpania korzyści z publicznych stanowisk poprzez nepotyzm, "
    "obsadzanie stanowisk po znajomości, konflikty interesów, nadużycia "
    "publicznych pieniędzy przez polityków lub urzędników.\n\n"
    "Skala 0-5:\n"
    "0 = brak związku (sport, wypadki, kultura, pogoda, zdrowie, "
    "gospodarka bez polityków)\n"
    "1 = wspomina polityków/urzędników, ale bez kontekstu nadużyć\n"
    "2 = opisuje mianowania/awanse/decyzje polityczne bez wyraźnej krytyki\n"
    "3 = sugeruje nepotyzm, konflikty interesów lub obsadzanie stanowisk\n"
    "4 = bezpośrednio opisuje korupcję/nepotyzm/obsadzanie stanowisk po znajomości\n"
    "5 = główny temat to koryciarstwo, udokumentowane konkretne przypadki\n\n"
    "Jeśli tekst nie jest w ogóle artykułem, albo wygląda na to, że selector "
    "był błędny i widzisz raczej stronę kategorii, listing, menu, albo cały "
    "szablon strony, ustaw:\n"
    '  "koryciarski_llm_reason": "krótki powód"\n'
    '  "koryciarski_llm_score": null\n'
    '  "llm_is_article": false\n\n'
    "Jeśli to jest artykuł, ustaw:\n"
    '  "koryciarski_llm_reason": "krótki powód"\n'
    '  "koryciarski_llm_score": liczba 0-5\n'
    '  "llm_is_article": true\n\n'
    "Odpowiedz TYLKO jako JSON. Bez markdown, bez innych słów.\n\n"
    "Artykuł:\n"
    "{text}"
)


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
    if isinstance(parsed, dict):
        return parsed
    return None


def _looks_like_json_fields(text: str) -> bool:
    return all(
        marker in text
        for marker in (
            "koryciarski_llm_reason",
            "koryciarski_llm_score",
            "llm_is_article",
        )
    )


def _normalize_scoring_result(parsed: dict[str, Any]) -> tuple[bool, int | None, str]:
    raw_is_article = parsed.get("llm_is_article", parsed.get("is_article"))
    llm_is_article = _normalize_bool(raw_is_article)

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

    raw_reason = parsed.get("koryciarski_llm_reason", parsed.get("reason", ""))
    reason = str(raw_reason or "").strip()

    if llm_is_article is None:
        llm_is_article = score is not None and 0 <= score <= 5
    if not llm_is_article:
        score = None
    return llm_is_article, score, reason


def _load_latest_offsets(path: Path) -> list[tuple[str, int]]:
    latest: dict[str, int] = {}
    with path.open("rb") as handle:
        while True:
            offset = handle.tell()
            line = handle.readline()
            if not line:
                break
            try:
                obj = json.loads(line)
            except Exception:
                continue
            url = obj.get("url")
            if isinstance(url, str) and url:
                latest[url] = offset
    return sorted(latest.items(), key=lambda item: item[1])


def _load_existing_cache(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    cache: dict[str, dict[str, Any]] = {}
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            url = obj.get("url")
            article_content_hash = obj.get("article_content_hash")
            if not isinstance(url, str) or not url:
                continue
            if not isinstance(article_content_hash, str) or not article_content_hash:
                continue
            if obj.get("parse_status") == "error":
                continue
            cache[url] = {
                "article_content_hash": article_content_hash,
                "koryciarski_llm_score": obj.get("koryciarski_llm_score"),
                "koryciarski_llm_reason": obj.get("koryciarski_llm_reason"),
                "llm_is_article": obj.get("llm_is_article"),
            }
    return cache


def _merge_row_with_score(
    source_row: dict[str, Any],
    score: int | None,
    reason: str,
    llm_is_article: bool,
) -> dict[str, Any]:
    merged = dict(source_row)
    merged["koryciarski_llm_score"] = score
    merged["koryciarski_llm_reason"] = reason
    merged["llm_is_article"] = llm_is_article
    return merged


def _source_rows_by_latest_offset(path: Path) -> list[tuple[str, int]]:
    return _load_latest_offsets(path)


def _latest_ok_rows(
    path: Path,
    latest_offsets: list[tuple[str, int]],
) -> list[tuple[str, int, dict[str, Any]]]:
    ok_rows: list[tuple[str, int, dict[str, Any]]] = []
    with path.open("rb") as handle:
        for url, offset in latest_offsets:
            handle.seek(offset)
            raw_line = handle.readline()
            if not raw_line.strip():
                continue
            try:
                row = json.loads(raw_line)
            except Exception:
                continue
            if row.get("parse_status") == "ok":
                ok_rows.append((url, offset, row))
    return ok_rows


async def _check_backend_health(session: aiohttp.ClientSession) -> None:
    async def _check_port(port: int) -> tuple[int, bool, str]:
        url = f"http://localhost:{port}/v1/models"
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                if resp.status != 200:
                    return port, False, f"HTTP {resp.status}"
                return port, True, ""
        except Exception as exc:
            return port, False, str(exc)

    results = await asyncio.gather(*(_check_port(port) for port in QWEN_PORTS))
    bad = [f"{port}: {detail}" for port, ok, detail in results if not ok]
    if bad:
        for item in bad:
            print(f"[health] {item}", file=sys.stderr)
        raise RuntimeError("one or more Qwen servers are unhealthy")


async def _score_one_attempt(
    session: aiohttp.ClientSession,
    port: int,
    record: dict[str, Any],
) -> dict[str, Any]:
    text = str(record.get("article_content") or "")[:TEXT_LIMIT]
    prompt = PROMPT.format(text=text)
    url = f"http://localhost:{port}/v1/chat/completions"

    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 1600,
        "temperature": 0.1,
        "extra_body": {"chat_template_kwargs": {"enable_thinking": False}},
    }

    async with session.post(
        url,
        json=payload,
        timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT_SECONDS),
    ) as resp:
        resp.raise_for_status()
        data = await resp.json()
        content = data["choices"][0]["message"]["content"].strip()
        if not _looks_like_json_fields(content):
            return {
                **dict(record),
                "koryciarski_llm_score": None,
                "koryciarski_llm_reason": "invalid json fields",
                "llm_is_article": False,
                "parse_status": "error",
            }
        parsed = _extract_json_object(content)
        if not parsed:
            return {
                **dict(record),
                "koryciarski_llm_score": None,
                "koryciarski_llm_reason": "invalid json parse",
                "llm_is_article": False,
                "parse_status": "error",
            }
        llm_is_article, score, reason = _normalize_scoring_result(parsed)
        return _merge_row_with_score(record, score, reason, llm_is_article)


async def score_one(
    session: aiohttp.ClientSession,
    port: int,
    record: dict[str, Any],
) -> dict[str, Any] | None:
    last_exc: Exception | None = None
    for attempt in range(1, REQUEST_RETRIES + 1):
        try:
            return await _score_one_attempt(session, port, record)
        except Exception as exc:
            last_exc = exc
            exc_name = type(exc).__name__
            exc_detail = str(exc).strip() or "<no message>"
            print(
                (
                    f"  [error] {record.get('url', '')[:60]}: "
                    f"attempt {attempt}/{REQUEST_RETRIES}: "
                    f"{exc_name}: {exc_detail}"
                ),
                file=sys.stderr,
            )
            if attempt < REQUEST_RETRIES:
                await asyncio.sleep(1.0 * attempt)
    assert last_exc is not None
    return {
        **dict(record),
        "koryciarski_llm_score": None,
        "koryciarski_llm_reason": str(last_exc),
        "llm_is_article": False,
        "parse_status": "error",
    }


async def _score_batch(
    session: aiohttp.ClientSession,
    batch: list[dict[str, Any]],
    out_handle,
    progress: tqdm,
) -> tuple[int, int]:
    scored = 0
    failed = 0
    worker_batches = [
        batch[index::WORKER_COUNT] for index in range(WORKER_COUNT)
    ]

    async def _score_worker(
        port: int,
        records: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        for record in records:
            result = await score_one(session, port, record)
            assert result is not None
            results.append(result)
        return results

    tasks = [
        _score_worker(QWEN_PORTS[index], worker_batches[index])
        for index in range(WORKER_COUNT)
        if worker_batches[index]
    ]
    for coro in asyncio.as_completed(tasks):
        results = await coro
        for result in results:
            out_handle.write(json.dumps(result, ensure_ascii=False) + "\n")
            if result.get("parse_status") == "error":
                failed += 1
            else:
                scored += 1
            progress.update(1)
    out_handle.flush()
    return scored, failed


async def main() -> None:  # noqa: PLR0915
    if not INPUT_FILE.exists():
        raise FileNotFoundError(INPUT_FILE)

    latest_offsets = _source_rows_by_latest_offset(INPUT_FILE)
    existing_cache = _load_existing_cache(OUTPUT_FILE)
    ok_rows = _latest_ok_rows(INPUT_FILE, latest_offsets)

    print(f"Loaded {len(latest_offsets)} unique URLs from parsed articles")
    print(f"Latest ok rows: {len(ok_rows)}")
    if OUTPUT_FILE.exists():
        print(f"Resuming — {len(existing_cache)} cached URLs")

    if TEMP_OUTPUT_FILE.exists():
        TEMP_OUTPUT_FILE.unlink()
    TEMP_OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    connector = aiohttp.TCPConnector(limit=CONCURRENCY)

    reused = 0
    rescored = 0
    failed = 0
    total_written = 0

    with (
        TEMP_OUTPUT_FILE.open("w", encoding="utf-8") as out,
    ):
        async with aiohttp.ClientSession(connector=connector) as session:
            await _check_backend_health(session)
            batch: list[dict[str, Any]] = []
            progress = tqdm(total=len(ok_rows), unit="article", desc="Articles")

            for url, _offset, row in ok_rows:
                cached = existing_cache.get(url)
                if (
                    cached
                    and cached.get("article_content_hash")
                    == row.get("article_content_hash")
                ):
                    merged = _merge_row_with_score(
                        row,
                        cached.get("koryciarski_llm_score"),
                        str(cached.get("koryciarski_llm_reason") or ""),
                        bool(cached.get("llm_is_article", True)),
                    )
                    out.write(json.dumps(merged, ensure_ascii=False) + "\n")
                    out.flush()
                    reused += 1
                    total_written += 1
                    progress.update(1)
                    continue

                batch.append(row)
                if len(batch) >= BATCH_SIZE:
                    scored, batch_failed = await _score_batch(
                        session,
                        batch,
                        out,
                        progress,
                    )
                    rescored += scored
                    failed += batch_failed
                    total_written += scored
                    batch = []

            if batch:
                scored, batch_failed = await _score_batch(
                    session,
                    batch,
                    out,
                    progress,
                )
                rescored += scored
                failed += batch_failed
                total_written += scored

            progress.close()

    TEMP_OUTPUT_FILE.replace(OUTPUT_FILE)

    print(
        f"\nDone. wrote {total_written} rows "
        f"({reused} reused, {rescored} rescored, "
        f"{failed} failed)."
    )
    print(
        f"Seen ok rows: {len(ok_rows)}. "
        f"Cache hits: {reused}. "
        f"Needs scoring: {rescored}."
    )


if __name__ == "__main__":
    asyncio.run(main())
