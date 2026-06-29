"""
Extract structured article facts from scored articles.

Input: score_koryciarski.jsonl
Output: article_facts.jsonl

The output keeps the input row fields and adds:
  - extracted_facts
  - fact_extraction_status
  - fact_extraction_error
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path
from typing import Any

import aiohttp
from tqdm import tqdm

from entities.facts import (
    ArticleFact,
    EmploymentFact,
    PartyMembershipFact,
    PersonalRelationFact,
    fact_to_dict,
)

QWEN_PORTS = list(range(6000, 6014))
MODEL = "Qwen/Qwen3-14B"
INPUT_FILE = Path("score_koryciarski.jsonl")
OUTPUT_FILE = Path("article_facts.jsonl")
TEMP_OUTPUT_FILE = Path("article_facts.jsonl.tmp")
PER_PORT_CONCURRENCY = 128
CONCURRENCY = len(QWEN_PORTS) * PER_PORT_CONCURRENCY
TEXT_LIMIT = 100000
BATCH_SIZE = CONCURRENCY
REQUEST_RETRIES = 1
REQUEST_TIMEOUT_SECONDS = 600
WORKER_COUNT = len(QWEN_PORTS)
MAX_RESPONSE_TOKENS = 1000
FACT_LINE_PREFIX = "- "

PROMPT = (
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
    "Jeśli tekst jest głównie zaproszeniem, listą nazwisk albo kalendarzem wydarzeń, "
    "zwróć pustą listę.\n"
    "Nie traktuj kandydowania w wyborach, poparcia wyborczego, głosowania na kogoś, "
    "udziału w spotkaniu, wystąpienia publicznego ani przynależności do komitetu "
    "wyborczego jako employment.\n"
    "Nie traktuj komitetu wyborczego jako partii politycznej.\n"
    "Nie traktuj poparcia, krytyki, wspólnego wystąpienia ani cytowania jednej osoby "
    "przez drugą jako personal_relation.\n"
    "Dla personal_relation zwracaj tylko relacje rodzinne albo wyraźnie opisane "
    "bliskie relacje osobiste, np. mąż, żona, syn, córka, brat, siostra, kuzyn, "
    "partner, przyjaciel.\n\n"
    "Zwróć końcową odpowiedź jako krótki markdown, jedna linia na fakt.\n"
    "Nie używaj kodowych bloków JSON.\n"
    "Format każdej linii:\n"
    "- employment | person=... | organization=... | role=... | justification=...\n"
    "- party_membership | person=... | party=... | justification=...\n"
    "- personal_relation | subject=... | object=... | relation=... | "
    "justification=...\n\n"
    "Justification ma być krótkim cytatem z tekstu, który da się sprawdzić, "
    "albo pusty.\n"
    "Jeśli nie ma faktów, zwróć pustą odpowiedź albo sam nagłówek `facts:` bez linii.\n"
    "Nie zgaduj. Nie dopisuj faktów spoza tekstu. Nie dodawaj komentarzy ani "
    "innego tekstu poza liniami z faktami.\n\n"
    "Artykuł:\n"
    "{text}"
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--model",
        default=MODEL,
        help="OpenAI-compatible model name served by the local vLLM workers.",
    )
    parser.add_argument(
        "--ports",
        default=f"{QWEN_PORTS[0]}-{QWEN_PORTS[-1]}",
        help="Worker ports as a comma list or inclusive range, e.g. 6000-6007.",
    )
    parser.add_argument(
        "--output-file",
        type=Path,
        default=OUTPUT_FILE,
        help="JSONL output path. Existing successful rows are used as cache.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process at most N extractable rows after filtering and cache checks.",
    )
    return parser.parse_args()


def _parse_ports(raw_ports: str) -> list[int]:
    raw_ports = raw_ports.strip()
    if not raw_ports:
        raise ValueError("--ports cannot be empty")
    if "-" in raw_ports and "," not in raw_ports:
        start_text, end_text = raw_ports.split("-", 1)
        start = int(start_text)
        end = int(end_text)
        if end < start:
            raise ValueError("--ports range end must be >= start")
        return list(range(start, end + 1))
    return [int(port.strip()) for port in raw_ports.split(",") if port.strip()]


def _strip_formatting(text: str) -> str:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    text = re.sub(r"^```[a-z]*\n?", "", text.strip())
    text = re.sub(r"\n?```$", "", text.strip())
    return text.strip()


def _extract_json_object(text: str) -> dict[str, Any] | None:
    text = _strip_formatting(text)
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


def _split_fact_line(line: str) -> dict[str, str] | None:
    line = line.strip()
    if not line:
        return None
    if line.lower() == "facts:":
        return None
    if line.startswith(("- ", "* ")):
        line = line[2:].strip()
    if not line:
        return None
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
            if obj.get("fact_extraction_status") == "error":
                continue
            url = obj.get("url")
            article_content_hash = obj.get("article_content_hash")
            if not isinstance(url, str) or not url:
                continue
            if not isinstance(article_content_hash, str) or not article_content_hash:
                continue
            cache[url] = {
                "article_content_hash": article_content_hash,
                "extracted_facts": obj.get("extracted_facts", []),
                "fact_extraction_status": obj.get("fact_extraction_status"),
                "fact_extraction_error": obj.get("fact_extraction_error"),
            }
    return cache


def _latest_extractable_rows(
    path: Path,
    latest_offsets: list[tuple[str, int]],
) -> list[tuple[str, dict[str, Any]]]:
    rows: list[tuple[str, dict[str, Any]]] = []
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
            if row.get("parse_status") != "ok":
                continue
            if row.get("llm_is_article") is not True:
                continue
            rows.append((url, row))
    return rows


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


def _normalize_fact_response(url: str, parsed: dict[str, Any]) -> list[dict[str, Any]]:
    raw_facts = parsed.get("facts")
    if not isinstance(raw_facts, list):
        raise ValueError("missing facts list")
    facts: list[dict[str, Any]] = []
    for raw_fact in raw_facts:
        if not isinstance(raw_fact, dict):
            continue
        fact = _coerce_fact(url, raw_fact)
        if fact is None:
            continue
        facts.append(fact_to_dict(fact))
    return facts


def _normalize_markdown_response(url: str, text: str) -> list[dict[str, Any]]:
    facts: list[dict[str, Any]] = []
    for raw_fact in _extract_markdown_facts(text):
        fact = _coerce_fact(url, raw_fact)
        if fact is None:
            continue
        facts.append(fact_to_dict(fact))
    return facts


def _merge_row_with_facts(
    source_row: dict[str, Any],
    extracted_facts: list[dict[str, Any]],
    status: str,
    error: str | None,
) -> dict[str, Any]:
    merged = dict(source_row)
    merged["extracted_facts"] = extracted_facts
    merged["fact_extraction_status"] = status
    merged["fact_extraction_error"] = error
    return merged


async def _extract_one_attempt(
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
        "max_tokens": MAX_RESPONSE_TOKENS,
        "temperature": 0.1,
    }
    async with session.post(
        url,
        json=payload,
        timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT_SECONDS),
    ) as resp:
        resp.raise_for_status()
        data = await resp.json()
        content = data["choices"][0]["message"]["content"].strip()
        parsed = _extract_json_object(content)
        if parsed:
            facts = _normalize_fact_response(str(record.get("url") or ""), parsed)
        else:
            facts = _normalize_markdown_response(str(record.get("url") or ""), content)
        return _merge_row_with_facts(record, facts, "ok", None)


async def _extract_one(
    session: aiohttp.ClientSession,
    port: int,
    record: dict[str, Any],
) -> dict[str, Any]:
    last_exc: Exception | None = None
    for attempt in range(1, REQUEST_RETRIES + 1):
        try:
            return await _extract_one_attempt(session, port, record)
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
    return _merge_row_with_facts(record, [], "error", str(last_exc))


async def _extract_batch(
    session: aiohttp.ClientSession,
    batch: list[dict[str, Any]],
    out_handle,
    progress: tqdm,
) -> tuple[int, int]:
    extracted = 0
    failed = 0

    tasks = [
        asyncio.create_task(
            _extract_one(session, QWEN_PORTS[index % WORKER_COUNT], record)
        )
        for index, record in enumerate(batch)
    ]

    for task in asyncio.as_completed(tasks):
        result = await task
        out_handle.write(json.dumps(result, ensure_ascii=False) + "\n")
        if result.get("fact_extraction_status") == "error":
            failed += 1
        else:
            extracted += 1
        progress.update(1)

    out_handle.flush()
    return extracted, failed


async def main() -> None:  # noqa: PLR0915
    global BATCH_SIZE, CONCURRENCY, MODEL, OUTPUT_FILE, TEMP_OUTPUT_FILE
    global WORKER_COUNT, QWEN_PORTS

    args = _parse_args()
    MODEL = args.model
    QWEN_PORTS = _parse_ports(args.ports)
    WORKER_COUNT = len(QWEN_PORTS)
    CONCURRENCY = WORKER_COUNT * PER_PORT_CONCURRENCY
    BATCH_SIZE = CONCURRENCY
    OUTPUT_FILE = args.output_file
    TEMP_OUTPUT_FILE = OUTPUT_FILE.with_name(f"{OUTPUT_FILE.name}.tmp")

    if not INPUT_FILE.exists():
        raise FileNotFoundError(INPUT_FILE)

    latest_offsets = _load_latest_offsets(INPUT_FILE)
    existing_cache = _load_existing_cache(OUTPUT_FILE)
    extractable_rows = _latest_extractable_rows(INPUT_FILE, latest_offsets)
    if args.limit is not None:
        extractable_rows = extractable_rows[: args.limit]

    print(f"Loaded {len(latest_offsets)} unique URLs from scored articles")
    print(f"Latest extractable rows: {len(extractable_rows)}")
    if OUTPUT_FILE.exists():
        print(f"Resuming — {len(existing_cache)} cached URLs")

    if TEMP_OUTPUT_FILE.exists():
        TEMP_OUTPUT_FILE.unlink()
    TEMP_OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    connector = aiohttp.TCPConnector(limit=CONCURRENCY)
    reused = 0
    extracted = 0
    failed = 0
    total_written = 0

    with TEMP_OUTPUT_FILE.open("w", encoding="utf-8") as out:
        async with aiohttp.ClientSession(connector=connector) as session:
            await _check_backend_health(session)
            batch: list[dict[str, Any]] = []
            progress = tqdm(
                total=len(extractable_rows),
                unit="article",
                desc="Facts",
            )

            for url, row in extractable_rows:
                cached = existing_cache.get(url)
                if (
                    cached
                    and cached.get("article_content_hash")
                    == row.get("article_content_hash")
                ):
                    merged = _merge_row_with_facts(
                        row,
                        list(cached.get("extracted_facts") or []),
                        str(cached.get("fact_extraction_status") or "ok"),
                        (
                            str(cached.get("fact_extraction_error"))
                            if cached.get("fact_extraction_error") is not None
                            else None
                        ),
                    )
                    out.write(json.dumps(merged, ensure_ascii=False) + "\n")
                    out.flush()
                    reused += 1
                    total_written += 1
                    progress.update(1)
                    continue

                batch.append(row)
                if len(batch) >= BATCH_SIZE:
                    done, batch_failed = await _extract_batch(
                        session,
                        batch,
                        out,
                        progress,
                    )
                    extracted += done
                    failed += batch_failed
                    total_written += done + batch_failed
                    batch = []

            if batch:
                done, batch_failed = await _extract_batch(
                    session,
                    batch,
                    out,
                    progress,
                )
                extracted += done
                failed += batch_failed
                total_written += done + batch_failed

            progress.close()

    TEMP_OUTPUT_FILE.replace(OUTPUT_FILE)

    print(
        f"\nDone. wrote {total_written} rows "
        f"({reused} reused, {extracted} extracted, {failed} failed)."
    )


if __name__ == "__main__":
    asyncio.run(main())
