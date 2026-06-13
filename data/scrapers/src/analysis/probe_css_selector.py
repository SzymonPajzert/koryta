"""Probe LLM-generated CSS selectors for article content extraction."""

import asyncio
import itertools
import json
import re
import tarfile
import textwrap
from pathlib import Path

import aiohttp
from bs4 import BeautifulSoup, Tag

QWEN_PORTS = [5004, 5005, 5006, 5007]
MODEL = "Qwen/Qwen3-14B"
DOWNLOADED_DIR = Path("/home/mp/Projects/koryta/data/scrapers/downloaded")

URLS = [
    "https://fakt.pl/polityka/lotka-w-niemcy-nietypowa-atrakcja-politykow-pis/b4x969k",
    "https://radom24.pl/polityka/przewozil-20-tysiecy-papierosow-bez-akcyzy-18076",
    "https://kartuzy.info/artykul/kartuzy-gdzie-sie-podzialy-n809565",
]

SKIP_TAGS = {"script", "style", "svg", "img", "link", "meta", "noscript", "iframe",
             "picture", "source", "input", "button", "form"}
SKIP_STRUCTURAL_TAGS = {"header", "nav", "footer"}
MAX_DEPTH = 10
MAX_CLASSES = 3
SKELETON_LIMIT = 6000

_port_cycle = itertools.cycle(QWEN_PORTS)


def next_endpoint() -> str:
    return f"http://localhost:{next(_port_cycle)}/v1/chat/completions"


def build_skeleton(tag, depth=0) -> str:
    if depth > MAX_DEPTH or not isinstance(tag, Tag):
        return ""
    if tag.name in SKIP_TAGS:
        return ""
    if depth <= 2 and tag.name in SKIP_STRUCTURAL_TAGS:
        return f"{'  '*depth}<{tag.name}> <!-- skipped -->\n"

    indent = "  " * depth
    classes = tag.get("class", [])
    cls = " ".join(classes[:MAX_CLASSES]) if classes else ""
    tid = tag.get("id", "")
    attrs = (f' class="{cls}"' if cls else "") + (f' id="{tid}"' if tid else "")

    children = [c for c in tag.children if isinstance(c, Tag) and c.name not in SKIP_TAGS]

    if not children:
        text = tag.get_text(" ", strip=True)[:60].replace("\n", " ")
        return f"{indent}<{tag.name}{attrs}>{text}</{tag.name}>\n" if text else ""

    # Collapse repeated siblings
    collapsed: list = []
    i = 0
    while i < len(children):
        c = children[i]
        sig = (c.name, tuple((c.get("class") or [])[:MAX_CLASSES]))
        j = i + 1
        while j < len(children) and (children[j].name, tuple((children[j].get("class") or [])[:MAX_CLASSES])) == sig:
            j += 1
        count = j - i
        collapsed.append(children[i])
        if count > 2:
            collapsed.append(f"<!-- ...{count-1} more <{c.name}> -->")
        elif count == 2:
            collapsed.append(children[i + 1])
        i = j

    inner = ""
    for c in collapsed:
        if isinstance(c, str):
            inner += indent + "  " + c + "\n"
        else:
            inner += build_skeleton(c, depth + 1)

    if not inner.strip():
        return ""
    return f"{indent}<{tag.name}{attrs}>\n{inner}{indent}</{tag.name}>\n"


def html_to_skeleton(html_bytes: bytes) -> str:
    soup = BeautifulSoup(html_bytes, "html.parser")
    body = soup.find("body") or soup
    skeleton = build_skeleton(body)
    if len(skeleton) > SKELETON_LIMIT:
        skeleton = skeleton[:SKELETON_LIMIT] + "\n<!-- skeleton truncated -->"
    return skeleton


def strip_thinking(text: str) -> str:
    """Remove <think>...</think> blocks from Qwen3 output."""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


async def ask_llm(session: aiohttp.ClientSession, skeleton: str, url: str) -> str:
    prompt = textwrap.dedent(f"""
        You are helping extract article content from a Polish news website.
        URL: {url}

        Below is a structural skeleton of the HTML page (text content replaced with short snippets, repeated elements collapsed).
        Your task: identify the single best CSS selector that targets the element containing the main article body text.

        Rules:
        - Return ONLY a JSON object, no markdown, no explanation
        - Format: {{"selector": "...", "reasoning": "..."}}
        - The selector must work with Python's soup.select_one()
        - Prefer a SHORT selector targeting the content element by its own class, e.g. "div.article-body" not "article > section > div.article-body"
        - Avoid selectors that would match navigation, ads, related articles, or comments

        HTML skeleton:
        {skeleton}
    """).strip()

    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
        "max_tokens": 256,
        "chat_template_kwargs": {"enable_thinking": False},
    }

    async with session.post(next_endpoint(), json=payload, timeout=aiohttp.ClientTimeout(total=60)) as resp:
        resp.raise_for_status()
        data = await resp.json()
        return strip_thinking(data["choices"][0]["message"]["content"])


def apply_selector(html_bytes: bytes, selector: str) -> str:
    soup = BeautifulSoup(html_bytes, "html.parser")
    el = soup.select_one(selector)
    if not el:
        return "(selector matched nothing)"
    for unwanted in el.find_all(["script", "style", "nav", "aside"]):
        unwanted.decompose()
    text = re.sub(r" {2,}", " ", el.get_text(" ", strip=True))
    return text[:1500]


def get_html_from_mirror(url: str) -> bytes:
    no_scheme = url.split("//", 1)[-1]
    host = no_scheme.split("/", 1)[0]
    path = no_scheme.split("/", 1)[1].rstrip("/") if "/" in no_scheme else ""
    tarballs = sorted(DOWNLOADED_DIR.glob(f"hostname={host}.*.tar.gz"))
    if not tarballs:
        raise FileNotFoundError(f"No tarball for {host}")
    prefix = f"{host}/{path}"
    with tarfile.open(tarballs[-1]) as tf:
        matches = [m for m in tf.getmembers() if m.name.startswith(prefix) and m.isfile()]
        if not matches:
            raise FileNotFoundError(f"URL path not found in tarball: {prefix}")
        return tf.extractfile(matches[-1]).read()


async def process_url(session: aiohttp.ClientSession, url: str) -> None:
    print(f"\n{'='*70}\nURL: {url}\n{'='*70}")

    html = get_html_from_mirror(url)
    print(f"HTML size: {len(html):,} bytes")

    skeleton = html_to_skeleton(html)
    print(f"Skeleton size: {len(skeleton):,} chars")

    raw = await ask_llm(session, skeleton, url)
    print(f"LLM response: {raw}")

    try:
        result = json.loads(raw)
        selector = result["selector"]
        print(f"Selector:  {selector}")
        print(f"Reasoning: {result.get('reasoning', '')}")
        print("\n--- EXTRACTED CONTENT ---")
        print(apply_selector(html, selector))
    except (json.JSONDecodeError, KeyError) as e:
        print(f"Failed to parse response: {e}")


async def main() -> None:
    async with aiohttp.ClientSession() as session:
        await asyncio.gather(*[process_url(session, url) for url in URLS])


if __name__ == "__main__":
    asyncio.run(main())
