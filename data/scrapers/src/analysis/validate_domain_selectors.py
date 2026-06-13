"""
Validation pass for domain_selectors.jsonl.

For each domain/selector:
  1. Re-extract the sample HTML from the tarball
  2. Apply the selector → get article text
  3. Ask Qwen: "Was this extracted correctly? Is this the article body?"
  4. Save validation results to domain_selectors_validated.jsonl
"""

import asyncio
import itertools
import json
import re
import tarfile
import textwrap
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import aiohttp
from bs4 import BeautifulSoup, Tag

# ── config ────────────────────────────────────────────────────────────────────
QWEN_PORTS      = [5004, 5005, 5006, 5007]
MODEL           = "Qwen/Qwen3-14B"
DOWNLOADED_DIR  = Path("/home/mp/Projects/koryta/data/scrapers/downloaded")
INPUT_FILE      = Path("domain_selectors.jsonl")
OUTPUT_FILE     = Path("domain_selectors_validated.jsonl")
CONCURRENCY     = 24
MAX_CONTENT_LEN = 1500   # chars fed to Qwen for validation

_port_cycle = itertools.cycle(QWEN_PORTS)


# ── tarball helpers (shared with generator) ───────────────────────────────────

def find_tarballs() -> dict[str, Path]:
    result = {}
    for p in DOWNLOADED_DIR.glob("hostname=*.tar.gz"):
        if p.stat().st_size < 1000:
            continue
        domain = p.name.split(".from=")[0].replace("hostname=", "")
        if domain not in result or p.name > result[domain].name:
            result[domain] = p
    return result


def extract_one(tarball_path: Path, url: str) -> bytes | None:
    """Extract a single HTML by URL (strips scheme, appends /date=* match)."""
    no_scheme  = url.split("//", 1)[-1]
    host       = no_scheme.split("/", 1)[0]
    path       = no_scheme.split("/", 1)[1].rstrip("/") if "/" in no_scheme else ""
    prefix     = f"{host}/{path}"
    try:
        with tarfile.open(tarball_path, "r:gz") as tf:
            for member in tf:
                if member.name.startswith(prefix) and member.isfile():
                    f = tf.extractfile(member)
                    return f.read() if f else None
    except Exception:
        pass
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
    text = re.sub(r" {2,}", " ", el.get_text(" ", strip=True))
    return text[:MAX_CONTENT_LEN]


# ── LLM ──────────────────────────────────────────────────────────────────────

def strip_thinking(text: str) -> str:
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


VALIDATION_PROMPT = textwrap.dedent("""\
    You are validating article content extraction from a Polish news website.
    URL: {url}
    CSS selector used: {selector}

    Below is the text extracted using that selector. Judge whether it is:
    - The actual article body (main news/article text, not nav/ads/comments/related)
    - Reasonably complete (not cut to a sentence or two when it should be longer)
    - Free from major navigation/ad contamination

    Extracted text:
    {content}

    Return ONLY valid JSON, no markdown:
    {{"ok": true/false, "issue": "short description of problem or empty string if ok"}}""")


async def ask_qwen_validate(
    session: aiohttp.ClientSession,
    sem: asyncio.Semaphore,
    url: str,
    selector: str,
    content: str,
) -> dict:
    prompt  = VALIDATION_PROMPT.format(url=url, selector=selector, content=content)
    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
        "max_tokens": 100,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    port = next(_port_cycle)
    async with sem:
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


# ── per-domain validation ─────────────────────────────────────────────────────

async def validate_domain(
    record: dict,
    tarballs: dict[str, Path],
    session: aiohttp.ClientSession,
    sem: asyncio.Semaphore,
    executor: ThreadPoolExecutor,
) -> dict:
    domain   = record["domain"]
    selector = record.get("selector")
    urls     = record.get("sample_urls", [])

    if not selector or not urls:
        return {**record, "validation": []}

    tarball = tarballs.get(domain)
    if not tarball:
        return {**record, "validation": []}

    loop = asyncio.get_event_loop()

    # pick up to 2 sample URLs to validate (save Qwen calls)
    validation_results = []
    for url in urls[:2]:
        html = await loop.run_in_executor(executor, extract_one, tarball, url)
        if not html:
            continue
        content = apply_selector(html, selector)
        if not content:
            verdict = {"ok": False, "issue": "selector matched nothing"}
        else:
            verdict = await ask_qwen_validate(session, sem, url, selector, content)

        validation_results.append({
            "url":     url,
            "content": content[:300],   # store snippet for inspection
            **verdict,
        })

    ok_count  = sum(1 for v in validation_results if v.get("ok") is True)
    all_ok    = ok_count == len(validation_results) and len(validation_results) > 0
    result    = {**record, "validation": validation_results, "valid": all_ok}

    status = "✓" if all_ok else "✗"
    issue  = "; ".join(v.get("issue","") for v in validation_results if not v.get("ok"))
    print(f"  {status} {domain}: {selector!r}  {issue}")
    return result


# ── main ──────────────────────────────────────────────────────────────────────

def load_done(path: Path) -> set[str]:
    if not path.exists():
        return set()
    done = set()
    with path.open() as f:
        for line in f:
            try:
                done.add(json.loads(line)["domain"])
            except Exception:
                pass
    return done


async def main() -> None:
    if not INPUT_FILE.exists():
        print(f"{INPUT_FILE} not found — run generate_domain_selectors.py first")
        return

    records  = []
    with INPUT_FILE.open() as f:
        for line in f:
            try:
                records.append(json.loads(line))
            except Exception:
                pass

    tarballs = find_tarballs()
    done     = load_done(OUTPUT_FILE)
    todo     = [r for r in records if r["domain"] not in done]

    print(f"Records: {len(records)}  Done: {len(done)}  Todo: {len(todo)}")

    sem = asyncio.Semaphore(CONCURRENCY)

    with ThreadPoolExecutor(max_workers=8) as executor:
        async with aiohttp.ClientSession() as session:
            with OUTPUT_FILE.open("a") as out:

                async def handle(record):
                    result = await validate_domain(record, tarballs, session, sem, executor)
                    out.write(json.dumps(result, ensure_ascii=False) + "\n")
                    out.flush()

                await asyncio.gather(*[handle(r) for r in todo])

    # print summary
    ok = fail = none = 0
    with OUTPUT_FILE.open() as f:
        for line in f:
            v = json.loads(line).get("valid")
            if v is True:   ok   += 1
            elif v is False: fail += 1
            else:            none += 1
    print(f"\nValidation complete: {ok} ok / {fail} failed / {none} no-data")


if __name__ == "__main__":
    asyncio.run(main())
