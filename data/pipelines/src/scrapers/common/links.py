"""Link extraction shared by both crawlers.

The article crawler drops query strings (news URLs are path-identified); the
BIP crawler must keep them (`plik.php?zid=121727` is a document). One function,
one flag.
"""

from __future__ import annotations

from dataclasses import dataclass
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


@dataclass(frozen=True)
class LinkContext:
    """A link, its label, and what stands around it on the page.

    A BIP lists a person's documents in one of three ways: the label names them
    ("Oświadczenie majątkowe - Jan Kowalski - 2023"), the table row or list item
    does ("Jan Kowalski | radny | pobierz"), or the heading above a list of
    labels that do not ("Jan Kowalski" over "za 2022", "za 2023"). ``row`` is the
    nearest enclosing table row, list item or paragraph, ``heading`` the nearest
    heading or bold text before the link, each cut to a few hundred characters.
    """

    url: str
    anchor: str
    row: str = ""
    heading: str = ""


_BLOCKS = ("tr", "li", "p", "dd", "dt")
_HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "caption", "th"]


def extract_link_contexts(html: str, base_url: str) -> tuple[str, list[LinkContext]]:
    """The page's title (``<title>``, first headings) and every link with its context.

    Queries are kept, as the BIP crawler needs them; links are not normalised
    beyond being made absolute, so a caller normalises them as it stores them.
    """
    soup = BeautifulSoup(html, "lxml")
    base_tag = soup.find("base", href=True)
    if isinstance(base_tag, Tag):
        base_href = base_tag.get("href")
        if isinstance(base_href, str) and base_href.strip():
            base_url = urljoin(base_url, base_href.strip())
    title_parts = [soup.title.get_text(" ", strip=True)] if soup.title else []
    title_parts += [
        h.get_text(" ", strip=True) for h in soup.find_all(["h1", "h2"], limit=3)
    ]
    title = " | ".join(" ".join(p.split()) for p in title_parts if p)[:300]
    links: list[LinkContext] = []
    seen: set[str] = set()
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
            absolute = urljoin(base_url, href).split("#")[0]
        except ValueError:
            continue
        if not absolute.startswith(("http://", "https://")) or absolute in seen:
            continue
        seen.add(absolute)
        text = " ".join(anchor.get_text(" ", strip=True).split())
        if not text:
            text = str(anchor.get("title") or "").strip()
        block = anchor.find_parent(_BLOCKS)
        row = ""
        if isinstance(block, Tag):
            row = " ".join(block.get_text(" ", strip=True).split())[:300]
        previous = anchor.find_previous(_HEADINGS)
        heading = ""
        if isinstance(previous, Tag):
            heading = " ".join(previous.get_text(" ", strip=True).split())[:200]
        links.append(LinkContext(absolute, text, row, heading))
    return title, links
