"""
Validation pass for domain_selectors.jsonl.

For each domain/selector:
  1. Fetch sample URLs live from the web (async)
  2. Extract content + before/after sibling context
  3. Ask Qwen: ok / too_narrow / too_broad / wrong  (not_found is programmatic)
  4. Save to domain_selectors_validated.jsonl (resumable)
"""

import asyncio
import itertools
import json
import re
from pathlib import Path

import aiohttp
from bs4 import BeautifulSoup, Tag
from tqdm.asyncio import tqdm

QWEN_PORTS       = [5004, 5005, 5006, 5007]
MODEL            = "Qwen/Qwen3-14B"
INPUT_FILE       = Path("domain_selectors.jsonl")
OUTPUT_FILE      = Path("domain_selectors_validated.jsonl")
QWEN_CONCURRENCY = 32
WEB_CONCURRENCY  = 100
FETCH_TIMEOUT    = 10
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"}

_port_cycle = itertools.cycle(QWEN_PORTS)


# ── web fetch ─────────────────────────────────────────────────────────────────

async def fetch_html(session: aiohttp.ClientSession, web_sem: asyncio.Semaphore, url: str) -> bytes | None:
    if not url.startswith("http"):
        url = "https://" + url
    async with web_sem:
        try:
            async with session.get(url, headers=HEADERS,
                                   timeout=aiohttp.ClientTimeout(total=FETCH_TIMEOUT),
                                   allow_redirects=True) as resp:
                return await resp.read() if resp.status < 400 else None
        except Exception as e:
            print(f"  [fetch] {url}: {e}")
            return None


# ── content + context extraction ──────────────────────────────────────────────

NOISE_TAGS = ["script", "style", "nav", "aside", "img", "iframe", "figure"]


def _text(node) -> str:
    """Get clean text from a node without modifying the tree."""
    texts = []
    for s in node.strings:
        t = s.strip()
        if t and s.parent.name not in NOISE_TAGS:
            # skip if any ancestor is a noise tag
            skip = False
            for anc in s.parents:
                if anc.name in NOISE_TAGS:
                    skip = True
                    break
                if anc is node:
                    break
            if not skip:
                texts.append(t)
    return re.sub(r"\s+", " ", " ".join(texts)).strip()


def extract_context(html_bytes: bytes, selector: str) -> dict:
    """Returns {found, content, before, after}. Never mutates the tree."""
    try:
        soup = BeautifulSoup(html_bytes, "html.parser")
        el   = soup.select_one(selector)
    except Exception as e:
        print(f"  [error] select {selector!r}: {e}")
        return {"found": False, "content": "", "before": "", "after": ""}

    if not el:
        return {"found": False, "content": "", "before": "", "after": ""}

    content = _text(el)

    before_parts: list[str] = []
    for sib in el.previous_siblings:
        if isinstance(sib, Tag):
            t = _text(sib)
            if t:
                before_parts.insert(0, t)
    before = " ".join(before_parts)

    after_parts: list[str] = []
    for sib in el.next_siblings:
        if isinstance(sib, Tag):
            t = _text(sib)
            if t:
                after_parts.append(t)
    after = " ".join(after_parts)

    return {"found": True, "content": content, "before": before, "after": after}


# ── LLM ──────────────────────────────────────────────────────────────────────

def strip_thinking(text: str) -> str:
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


PROMPT = """\
You are checking whether a CSS selector captured the FULL and CORRECT article body from a Polish news page.
URL: {url}
Selector: {selector}

The selector captured this text (start, middle, end shown):
--- CAPTURED START (first 400 chars) ---
{content_start}
--- CAPTURED MIDDLE (chars 1000-1400) ---
{content_mid}
--- CAPTURED END (last 400 chars) ---
{content_end}

Text from sibling elements immediately BEFORE the selected element:
--- BEFORE ---
{before}

Text from sibling elements immediately AFTER the selected element:
--- AFTER ---
{after}

Step 1 — evaluate CAPTURED first:
- Completely unrelated to any article? (login form, directory, error, AdBlock, copyright) → "wrong"
- Contains heavy pollution? (multiple unrelated article headlines with dates mixed in, full comment threads, nav menus, ad blocks embedded in text) → "too_broad"

Step 2 — if CAPTURED looks like a real article, check BEFORE/AFTER:
- Does BEFORE or AFTER contain 20+ words of continuous article prose (lead paragraph, teaser, TLDR) absent from CAPTURED? → "too_narrow"
- Short heading, title, author, date, breadcrumb, or share button does NOT count.

Step 3 — otherwise → "ok"

If both too_broad and too_narrow apply, pick too_broad.

Return JSON only. Keep issue under 120 chars. Use backticks for snippets:
{{"verdict": "ok|too_narrow|too_broad|wrong", "issue": "too_narrow: `missing snippet` — why; too_broad: `noise snippet` — why; wrong: what it is; empty if ok"}}"""


async def ask_qwen(session: aiohttp.ClientSession, qwen_sem: asyncio.Semaphore,
                   url: str, selector: str, ctx: dict) -> dict:
    content = ctx["content"]
    before = ctx["before"] if len(ctx["before"].split()) >= 25 else "(nothing substantial)"
    after  = ctx["after"]  if len(ctx["after"].split())  >= 25 else "(nothing substantial)"
    mid_start = len(content) // 2 - 200
    mid_start = max(0, mid_start)
    prompt = PROMPT.format(
        url=url, selector=selector,
        before=before,
        content_start=content[:400],
        content_mid=content[mid_start:mid_start+400] if len(content) > 800 else "(content too short for middle sample)",
        content_end=content[-400:] if len(content) > 400 else "",
        after=after,
    )
    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
        "max_tokens": 150,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    port = next(_port_cycle)
    async with qwen_sem:
        try:
            async with session.post(f"http://localhost:{port}/v1/chat/completions",
                                    json=payload, timeout=aiohttp.ClientTimeout(total=90)) as resp:
                resp.raise_for_status()
                data = await resp.json()
                raw  = strip_thinking(data["choices"][0]["message"]["content"])
                raw  = re.sub(r"^[^{]*", "", raw)
                raw  = re.sub(r"}[^}]*$", "}", raw, flags=re.DOTALL)
                try:
                    return json.loads(raw)
                except json.JSONDecodeError:
                    # try extracting verdict manually if JSON is malformed
                    m = re.search(r'"verdict"\s*:\s*"(\w+)"', raw)
                    verdict = m.group(1) if m else None
                    issue_m = re.search(r'"issue"\s*:\s*"(.*?)(?<!\\)"', raw, re.DOTALL)
                    issue = issue_m.group(1) if issue_m else "parse error"
                    return {"verdict": verdict, "issue": issue}
        except Exception as e:
            return {"verdict": None, "issue": str(e)}


# ── per-domain ────────────────────────────────────────────────────────────────

async def validate_domain(record: dict, session: aiohttp.ClientSession,
                           web_sem: asyncio.Semaphore, qwen_sem: asyncio.Semaphore) -> dict:
    domain   = record["domain"]
    selector = record.get("selector")
    urls     = record.get("sample_urls", [])

    if not selector or not urls:
        return {**record, "validation": [], "valid": None}

    htmls = await asyncio.gather(*[fetch_html(session, web_sem, u) for u in urls])

    validation_results = []
    qwen_tasks, qwen_meta = [], []

    for url, html in zip(urls, htmls):
        if not html:
            validation_results.append({"url": url, "verdict": None, "issue": "fetch failed"})
            continue
        ctx = extract_context(html, selector)
        if not ctx["found"]:
            validation_results.append({"url": url, "verdict": "not_found", "issue": "selector matched nothing"})
        else:
            qwen_tasks.append(ask_qwen(session, qwen_sem, url, selector, ctx))
            qwen_meta.append(url)

    if qwen_tasks:
        verdicts = await asyncio.gather(*qwen_tasks)
        for url, v in zip(qwen_meta, verdicts):
            validation_results.append({"url": url, **v})

    # overall: ok only if all verdicts are "ok"
    verdicts_list = [v.get("verdict") for v in validation_results]
    valid = all(v == "ok" for v in verdicts_list) and bool(verdicts_list)

    # summary for progress display
    counts = {}
    for v in verdicts_list:
        counts[v] = counts.get(v, 0) + 1
    summary = " ".join(f"{v}:{n}" for v, n in counts.items())
    print(f"  {'✓' if valid else '✗'} {domain}: {selector!r}  [{summary}]")

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
    records = [json.loads(l) for l in INPUT_FILE.open() if l.strip()]
    done    = load_done(OUTPUT_FILE)
    todo    = [r for r in records if r["domain"] not in done]
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

            await tqdm.gather(*[handle(r) for r in todo],
                              total=len(todo), desc="validating", unit="domain")

    from collections import Counter
    counts = Counter()
    for line in OUTPUT_FILE.open():
        for v in json.loads(line).get("validation", []):
            counts[v.get("verdict")] += 1
    print(f"\nDone. Verdict counts: {dict(counts)}")


if __name__ == "__main__":
    rm = Path("domain_selectors_validated.jsonl")
    if rm.exists():
        rm.unlink()
    asyncio.run(main())
