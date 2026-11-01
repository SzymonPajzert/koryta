"""Link extraction shared by both crawlers.

The article crawler drops query strings (news URLs are path-identified); the
BIP crawler must keep them (`plik.php?zid=121727` is a document). One function,
one flag.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag, UnicodeDammit

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
_HEADINGS = frozenset(
    {"h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "caption", "th"}
)


def _text(node: object) -> str:
    raw = node.get_text(" ", strip=True) if isinstance(node, Tag) else str(node)
    return " ".join(raw.split())


def _links_in(node: object) -> bool:
    return isinstance(node, Tag) and (node.name == "a" or node.find("a") is not None)


#: A table row's text, worked out once a page: each piece of it with the links
#: (by id) it sits in.
_Rows = dict[int, list[tuple[str, frozenset[int]]]]


def _row_pieces(block: Tag, anchors: list[Tag]) -> list[tuple[str, frozenset[int]]]:
    ids = {id(a) for a in anchors}
    pieces = []
    for piece in block.find_all(string=True):
        inside = []
        for parent in piece.parents:
            if parent is block:
                break
            if id(parent) in ids:
                inside.append(id(parent))
        pieces.append((str(piece), frozenset(inside)))
    return pieces


def _row_text(anchor: Tag, block: Tag, rows: _Rows | None = None) -> str:
    """The part of ``block`` that belongs to ``anchor``.

    The whole block when the link is its only one. In a table row holding
    several (a year per cell), the row without the other links' labels. In a
    paragraph or list item holding several ("Jan Kowalski<br>Anna Nowak"), the
    run of text from the previous link or line break to the next one.
    """
    if block.name == "tr":
        # Worked out once a row, links told apart by identity: bs4 compares
        # tags by their whole content, and on a table-layout BIP's page
        # (ugblizyn.bip.doc.pl, 1,170 links, 10-31) asking each link about
        # every piece of its row had not finished after 4 minutes; it held the
        # people mode's runs of 10-31 past their deadlines.
        pieces = rows.get(id(block)) if rows is not None else None
        if pieces is None:
            anchors = block.find_all("a", href=True)
            if len(anchors) <= 1:
                return _text(block)
            pieces = _row_pieces(block, anchors)
            if rows is not None:
                rows[id(block)] = pieces
        own = {id(anchor)}
        kept = [text for text, inside in pieces if inside <= own]
        return " ".join(" ".join(kept).split())
    anchors = block.find_all("a", href=True)
    if len(anchors) <= 1:
        return _text(block)
    node: Tag = anchor
    while node.parent is not None and node.parent is not block:
        node = node.parent
    parts = [_text(node)]
    for sibling in node.previous_siblings:
        if (isinstance(sibling, Tag) and sibling.name == "br") or _links_in(sibling):
            break
        parts.insert(0, _text(sibling))
    for sibling in node.next_siblings:
        if (isinstance(sibling, Tag) and sibling.name == "br") or _links_in(sibling):
            break
        parts.append(_text(sibling))
    return " ".join(" ".join(parts).split())


def decode_html(content: bytes | str, content_type: str = "") -> str:
    """A page's text, in the charset its header or ``<meta>`` declares.

    Older BIPs still serve windows-1250 or ISO-8859-2; read as UTF-8 their
    "Oświadczenia majątkowe" loses its Polish letters and nothing matches.
    """
    if isinstance(content, str):
        return content
    declared = re.search(r"charset=[\"']?([\w.:-]+)", content_type or "", re.I)
    known = [declared.group(1)] if declared else []
    dammit = UnicodeDammit(content, known, is_html=True)
    return dammit.unicode_markup or content.decode("utf-8", "replace")


def extract_link_contexts(
    html: bytes | str, base_url: str, content_type: str = ""
) -> tuple[str, list[LinkContext]]:
    """The page's title (``<title>`` and its ``<h1>``) and every link with its context.

    ``html`` may be the raw bytes; they are decoded as ``decode_html`` says.
    Queries are kept, as the BIP crawler needs them; links are not normalised
    beyond being made absolute, so a caller normalises them as it stores them.
    """
    soup = BeautifulSoup(decode_html(html, content_type), "lxml")
    base_tag = soup.find("base", href=True)
    if isinstance(base_tag, Tag):
        base_href = base_tag.get("href")
        if isinstance(base_href, str) and base_href.strip():
            base_url = urljoin(base_url, base_href.strip())
    # Not the h2s: on a page listing several people, each under their own h2,
    # the first of them would read as the page's subject.
    title_parts = [soup.title.get_text(" ", strip=True)] if soup.title else []
    first_h1 = soup.find("h1")
    if isinstance(first_h1, Tag):
        title_parts.append(first_h1.get_text(" ", strip=True))
    title = " | ".join(" ".join(p.split()) for p in title_parts if p)[:300]
    # Each link's heading in one pass. Asked link by link (find_previous) it
    # read the page back to its start every time: Wrota Lubelszczyzny's BIPs
    # carry their whole menu on every page, 1,300 links in 1.3 MB, 6 s a page.
    headings: dict[int, Tag] = {}
    last: Tag | None = None
    for node in soup.descendants:
        if isinstance(node, Tag):
            if node.name in _HEADINGS:
                last = node
            elif node.name == "a" and last is not None:
                headings[id(node)] = last
    links: list[LinkContext] = []
    seen: set[str] = set()
    rows: _Rows = {}
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
        text = _text(anchor) or str(anchor.get("title") or "").strip()
        block = anchor.find_parent(_BLOCKS)
        row = _row_text(anchor, block, rows)[:300] if isinstance(block, Tag) else ""
        previous = headings.get(id(anchor))
        heading = _text(previous)[:200] if previous is not None else ""
        links.append(LinkContext(absolute, text, row, heading))
    return title, links
