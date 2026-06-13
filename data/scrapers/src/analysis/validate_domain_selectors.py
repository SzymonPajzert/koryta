"""
Validation pass for domain_selectors.jsonl.

For each domain/selector:
  1. Fetch sample URLs live from the web (async)
  2. Apply the selector → get article text
  3. Ask Qwen: "Was this extracted correctly?"
  4. Save to domain_selectors_validated.jsonl (resumable)
"""

import asyncio
import itertools
import json
import re
import textwrap
from pathlib import Path

import aiohttp
from bs4 import BeautifulSoup
from tqdm.asyncio import tqdm

QWEN_PORTS      = [5004, 5005, 5006, 5007]
MODEL           = "Qwen/Qwen3-14B"
INPUT_FILE      = Path("domain_selectors.jsonl")
OUTPUT_FILE     = Path("domain_selectors_validated.jsonl")
QWEN_CONCURRENCY = 32
WEB_CONCURRENCY  = 100   # parallel live fetches — many domains, low risk of blocks
FETCH_TIMEOUT    = 10
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"}

_port_cycle = itertools.cycle(QWEN_PORTS)


# ── web fetch ─────────────────────────────────────────────────────────────────

async def fetch_html(session: aiohttp.ClientSession, web_sem: asyncio.Semaphore, url: str) -> bytes | None:
    if not url.startswith("http"):
        url = "https://" + url
    async with web_sem:
        try:
            async with session.get(
                url, headers=HEADERS,
                timeout=aiohttp.ClientTimeout(total=FETCH_TIMEOUT),
                allow_redirects=True,
            ) as resp:
                if resp.status >= 400:
                    return None
                return await resp.read()
        except Exception as e:
            print(f"  [fetch] {url}: {e}")
            return None


# ── content extraction ────────────────────────────────────────────────────────

def apply_selector(html_bytes: bytes, selector: str) -> str:
    try:
        soup = BeautifulSoup(html_bytes, "html.parser")
        el   = soup.select_one(selector)
    except Exception as e:
        print(f"  [error] apply_selector {selector!r}: {e}")
        return ""
    if not el:
        return ""
    for tag in el.find_all(["script", "style", "nav", "aside"]):
        tag.decompose()
    return re.sub(r" {2,}", " ", el.get_text(" ", strip=True))


# ── LLM ──────────────────────────────────────────────────────────────────────

def strip_thinking(text: str) -> str:
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


VALIDATION_PROMPT = textwrap.dedent("""\
    You are validating article content extraction from a Polish news website.
    URL: {url}
    CSS selector used: {selector}

    Below is the text extracted using that selector. Judge whether it is:
    - The actual article body (main news/article text, not nav/ads/comments/related)
    - Reasonably complete (not cut off mid-sentence when it should be longer)
    - Free from major navigation/ad contamination

    Extracted text:
    {content}

    Return ONLY valid JSON, no markdown:
    {{"ok": true/false, "issue": "short description of problem or empty string if ok"}}""")


async def ask_qwen(
    session: aiohttp.ClientSession,
    qwen_sem: asyncio.Semaphore,
    url: str,
    selector: str,
    content: str,
) -> dict:
    prompt  = VALIDATION_PROMPT.format(url=url, selector=selector, content=content[:20000])
    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
        "max_tokens": 100,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    port = next(_port_cycle)
    async with qwen_sem:
        try:
            async with session.post(
                f"http://localhost:{port}/v1/chat/completions",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=60),
            ) as resp:
                resp.raise_for_status()
                data = await resp.json()
                raw  = strip_thinking(data["choices"][0]["message"]["content"])
                raw  = re.sub(r"^```[a-z]*\n?", "", raw.strip())
                raw  = re.sub(r"\n?```$", "", raw.strip())
                return json.loads(raw)
        except Exception as e:
            return {"ok": None, "issue": str(e)}


# ── per-domain ────────────────────────────────────────────────────────────────

async def validate_domain(
    record: dict,
    session: aiohttp.ClientSession,
    web_sem: asyncio.Semaphore,
    qwen_sem: asyncio.Semaphore,
) -> dict:
    domain   = record["domain"]
    selector = record.get("selector")
    urls     = record.get("sample_urls", [])

    if not selector or not urls:
        return {**record, "validation": [], "valid": None}

    # fetch all sample URLs in parallel
    htmls = await asyncio.gather(*[fetch_html(session, web_sem, u) for u in urls])

    validation_results = []
    qwen_tasks = []
    qwen_urls  = []

    for url, html in zip(urls, htmls):
        if not html:
            validation_results.append({"url": url, "ok": None, "issue": "fetch failed"})
            continue
        content = apply_selector(html, selector)
        if not content:
            validation_results.append({"url": url, "ok": False, "issue": "selector matched nothing", "content": ""})
        else:
            qwen_tasks.append(ask_qwen(session, qwen_sem, url, selector, content))
            qwen_urls.append((url, content))

    if qwen_tasks:
        verdicts = await asyncio.gather(*qwen_tasks)
        for (url, content), verdict in zip(qwen_urls, verdicts):
            validation_results.append({"url": url, "content": content[:300], **verdict})

    ok_count = sum(1 for v in validation_results if v.get("ok") is True)
    valid    = ok_count == len(validation_results) and len(validation_results) > 0

    status = "✓" if valid else "✗"
    issue  = "; ".join(v.get("issue", "") for v in validation_results if not v.get("ok"))
    print(f"  {status} {domain}: {selector!r}  {issue}")

    return {**record, "validation": validation_results, "valid": valid}


# ── main ──────────────────────────────────────────────────────────────────────

def load_done(path: Path) -> set[str]:
    if not path.exists():
        return set()
    done = set()
    for line in path.open():
        try:
            done.add(json.loads(line)["domain"])
        except Exception:
            pass
    return done


async def main() -> None:
    if not INPUT_FILE.exists():
        print(f"{INPUT_FILE} not found — run generate_domain_selectors.py first")
        return

    records = []
    for line in INPUT_FILE.open():
        try:
            records.append(json.loads(line))
        except Exception:
            pass

    done = load_done(OUTPUT_FILE)
    todo = [r for r in records if r["domain"] not in done]
    print(f"Records: {len(records)}  Done: {len(done)}  Todo: {len(todo)}")

    web_sem  = asyncio.Semaphore(WEB_CONCURRENCY)
    qwen_sem = asyncio.Semaphore(QWEN_CONCURRENCY)

    connector = aiohttp.TCPConnector(limit=WEB_CONCURRENCY + QWEN_CONCURRENCY)
    async with aiohttp.ClientSession(connector=connector) as session:
        with OUTPUT_FILE.open("a") as out:
            async def handle(record):
                try:
                    result = await validate_domain(record, session, web_sem, qwen_sem)
                    out.write(json.dumps(result, ensure_ascii=False) + "\n")
                    out.flush()
                except Exception as e:
                    print(f"  [error] {record['domain']}: {e}")

            await tqdm.gather(
                *[handle(r) for r in todo],
                total=len(todo), desc="validating", unit="domain",
            )

    ok = fail = none = 0
    for line in OUTPUT_FILE.open():
        v = json.loads(line).get("valid")
        if v is True:    ok   += 1
        elif v is False: fail += 1
        else:            none += 1
    print(f"\nDone: {ok} ok / {fail} failed / {none} no-data")


if __name__ == "__main__":
    asyncio.run(main())
