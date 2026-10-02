"""Link extraction shared by both crawlers.

The article crawler drops query strings (news URLs are path-identified); the
BIP crawler must keep them (`plik.php?zid=121727` is a document). One function,
one flag.
"""

from __future__ import annotations

from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

from entities.util import NormalizedParse

_SKIP_PREFIXES = ("#", "mailto:", "tel:", "javascript:", "data:")


def extract_link_pairs(
    html: str, base_url: str, *, keep_query: bool = False
) -> list[tuple[str, str]]:
    """Absolute, normalised `(url, anchor text)` pairs, in document order.

    The anchor text is what a human clicks; the BIP crawler stores it on the
    discovered URL so category prediction can use the link label later without
    re-fetching the parent page.
    """
    soup = BeautifulSoup(html, "lxml")
    base_tag = soup.find("base", href=True)
    if isinstance(base_tag, Tag):
        base_href = base_tag.get("href")
        if isinstance(base_href, str) and base_href.strip():
            base_url = base_href.strip()

    seen: dict[str, str] = {}
    for anchor in soup.find_all("a", href=True):
        if not isinstance(anchor, Tag):
            continue
        raw = anchor.get("href")
        if not isinstance(raw, str):
            continue
        href = raw.strip()
        if not href or href.startswith(_SKIP_PREFIXES):
            continue
        try:
            absolute = urljoin(base_url, href)
        except ValueError:
            continue
        if not keep_query:
            absolute = absolute.split("?")[0]
        absolute = absolute.split("#")[0]
        if not absolute.startswith(("http://", "https://")):
            continue
        text = " ".join(anchor.get_text(" ", strip=True).split())
        if keep_query:
            seen.setdefault(absolute.rstrip("/") or absolute, text)
            continue
        parsed = NormalizedParse.parse(absolute)
        clean = (
            f"{parsed.scheme}://{parsed.hostname_normalized}{parsed.path}".rstrip("/")
        )
        seen.setdefault(clean, text)
    return list(seen.items())


def extract_links(html: str, base_url: str, *, keep_query: bool = False) -> list[str]:
    """Absolute, normalised links from anchor tags, in document order."""
    pairs = extract_link_pairs(html, base_url, keep_query=keep_query)
    return [url for url, _text in pairs]
