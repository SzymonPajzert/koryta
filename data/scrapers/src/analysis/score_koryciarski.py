"""
Score each extracted article for how "koryciarski" it is.

"Koryciarski" = article about politicians/officials exploiting public positions:
nepotism, political appointments, conflicts of interest, public money abuse.

Output: score_koryciarski.jsonl — one line per article:
  {domain, url, score (0-5), reason}
"""

import asyncio
import itertools
import json
import re
import sys
from pathlib import Path

import aiohttp
from tqdm.asyncio import tqdm

QWEN_PORTS    = list(range(5000, 5032))   # 32 instances
MODEL         = "Qwen/Qwen3-14B"
INPUT_FILE    = Path("extract_articles.jsonl")
OUTPUT_FILE   = Path("score_koryciarski.jsonl")
CONCURRENCY   = 64    # concurrent LLM calls across 32 servers (2 per server)
TEXT_LIMIT    = 2500  # chars fed to LLM

_port_cycle = itertools.cycle(QWEN_PORTS)

PROMPT = """Oceń artykuł pod kątem tego, czy opisuje zjawisko "koryciarstwa" — czyli czerpania korzysci z publicznych stanowisk poprzez nepotyzm, obsadzanie stanowisk po znajomosci, konflikty interesow, naduzycia publicznych pieniedzy przez politykow lub urzednikow.

Skala 0-5:
0 = brak zwiazku (sport, wypadki, kultura, pogoda, zdrowie, gospodarka bez politykow)
1 = wspomina politykow/urzednikow, ale bez kontekstu naduzyc
2 = opisuje mianowania/awanse/decyzje polityczne bez wyraznej krytyki
3 = sugeruje nepotyzm, konflikty interesow lub obsadzanie stanowisk
4 = bezposrednio opisuje korupcje/nepotyzm/obsadzanie stanowisk po znajomosci
5 = glowny temat to koryciarstwo, udokumentowane konkretne przypadki

Odpowiedz TYLKO jako JSON z polami "score" (liczba 0-5) i "reason" (max 1 zdanie po polsku). Bez markdown, bez innych slow, tylko JSON.

Artykul:
{text}"""


async def score_one(
    session: aiohttp.ClientSession,
    sem: asyncio.Semaphore,
    record: dict,
) -> dict | None:
    text = record["text"][:TEXT_LIMIT]
    prompt = PROMPT.format(text=text)
    port = next(_port_cycle)
    url = f"http://localhost:{port}/v1/chat/completions"

    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 120,
        "temperature": 0.1,
        "extra_body": {"chat_template_kwargs": {"enable_thinking": False}},
    }

    async with sem:
        try:
            async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                data = await resp.json()
                content = data["choices"][0]["message"]["content"].strip()
                # Strip <think>...</think> if present
                content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
                # Extract JSON
                m = re.search(r'\{[^}]+\}', content, re.DOTALL)
                if not m:
                    return None
                parsed = json.loads(m.group())
                return {
                    "domain": record["domain"],
                    "url":    record["url"],
                    "score":  int(parsed.get("score", -1)),
                    "reason": parsed.get("reason", ""),
                }
        except Exception as e:
            print(f"  [error] {record['url'][:60]}: {e}", file=sys.stderr)
            return None


async def main() -> None:
    records = []
    for line in INPUT_FILE.open():
        try:
            records.append(json.loads(line))
        except Exception:
            pass
    print(f"Loaded {len(records)} articles")

    # Resume: skip already-scored URLs
    done_urls: set[str] = set()
    if OUTPUT_FILE.exists():
        for line in OUTPUT_FILE.open():
            try:
                done_urls.add(json.loads(line)["url"])
            except Exception:
                pass
        print(f"Resuming — {len(done_urls)} already scored")

    todo = [r for r in records if r["url"] not in done_urls]
    print(f"Scoring {len(todo)} articles on {len(QWEN_PORTS)} vLLM instances...")

    sem = asyncio.Semaphore(CONCURRENCY)
    connector = aiohttp.TCPConnector(limit=CONCURRENCY + 32)

    with OUTPUT_FILE.open("a") as out:
        async with aiohttp.ClientSession(connector=connector) as session:
            tasks = [score_one(session, sem, r) for r in todo]
            async for result in tqdm(
                asyncio.as_completed(tasks), total=len(tasks), unit="article"
            ):
                r = await result
                if r is not None:
                    out.write(json.dumps(r, ensure_ascii=False) + "\n")

    # Print distribution
    scores = []
    for line in OUTPUT_FILE.open():
        try:
            scores.append(json.loads(line)["score"])
        except Exception:
            pass
    print(f"\nDone. {len(scores)} scored.")
    for s in range(6):
        n = scores.count(s)
        print(f"  score {s}: {n:5d}  ({100*n/len(scores):.1f}%)")


if __name__ == "__main__":
    asyncio.run(main())
