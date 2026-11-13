"""Link extraction shared by both crawlers.

The article crawler drops query strings (news URLs are path-identified); the
BIP crawler must keep them (`plik.php?zid=121727` is a document). One function,
one flag.
"""

from __future__ import annotations

import codecs
import functools
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
        clean = f"{parsed.scheme}://{parsed.hostname_normalized}{parsed.path}".rstrip(
            "/"
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
    ``path`` is the menu sections above it, outermost first ("Rada Gminy >
    Oświadczenia majątkowe radnych > IX Kadencja 2024-2029" over "Natalia
    Piksa"): a menu has no headings, its nesting says where a link leads.
    ``frame`` says it stands in the site's frame around the page's own
    content, the same on every page: a menu, the site's header or footer, a
    sidebar (`_frame_elements`).
    """

    url: str
    anchor: str
    row: str = ""
    heading: str = ""
    path: str = ""
    frame: bool = False


_BLOCKS = ("tr", "li", "p", "dd", "dt")
_HEADINGS = frozenset(
    {"h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "caption", "th"}
)


#: Menu sections a link's path carries, the innermost.
_PATH_DEPTH = 4

#: Roles of the site's frame: its menus, its header and its footer. Not "menu",
#: which a file's own drop-down of formats may have.
_FRAME_ROLES = frozenset({"navigation", "banner", "contentinfo"})
#: Where a header, footer or aside is a part's own, not the site's: an
#: article's header holds its title, a section's footer its files.
_SECTIONS = ("main", "article", "section")
#: The words a frame's id or class is made of, besides where it stands:
#: Lwówek Śląski's "MenuLeft", biuletyn.net's "menu-lewe-1-poziom", ibip.pl's
#: "right_menu", "topbar", "stopka", Łódź's "aside" and "aside-nav" (a
#: ``<div>`` in its ``<main>``, beside the content). A word more and it is no
#: frame's name: Kraków's declarations stand in a "nav-container", Lubicz's in
#: a "footer-bg", Toruń's under each file's "header", and a "dropdown-menu"
#: may be a file's own. "nav" names a frame only beside a frame's word:
#: Bootstrap's "nav" alone may be a content's tabs.
_FRAME_NAMES = frozenset(
    "menu navbar navigation nawigacja sidebar topbar footer stopka aside".split()
)
_FRAME_SIDES = frozenset(
    """left right top bottom main side mobile primary secondary lewe lewa lewy
    prawe prawa prawy gora gorne gorna gorny dol dolne dolna dolny glowne glowna
    glowny boczne boczna boczny pion poziom przedmiotowe przedmiotowy podmiotowe
    podmiotowy nav""".split()
)
_NAME_WORD = re.compile(r"[A-Z]?[a-z]+|[A-Z]+(?![a-z])|[0-9]+")


@functools.lru_cache(maxsize=8192)
def _frame_name(value: str) -> bool:
    """Whether an id or a class names the site's frame (`_FRAME_NAMES`): BIPs
    call their menus "Menu przedmiotowe" and "Menu podmiotowe"."""
    words = [w.lower() for w in _NAME_WORD.findall(value) if not w.isdigit()]
    return any(w in _FRAME_NAMES for w in words) and all(
        w in _FRAME_NAMES or w in _FRAME_SIDES for w in words
    )


#: An id or class that names the page's own content: "content",
#: "main-content", "tresc", "strona-tresc", "skip-tresc".
_CONTENT_NAMES = frozenset("content tresc zawartosc".split())
_CONTENT_SIDES = frozenset("main page site strona skip glowna glowne".split())


@functools.lru_cache(maxsize=8192)
def _content_name(value: str) -> bool:
    words = [w.lower() for w in _NAME_WORD.findall(value) if not w.isdigit()]
    return any(w in _CONTENT_NAMES for w in words) and all(
        w in _CONTENT_NAMES or w in _CONTENT_SIDES for w in words
    )


def _names(node: Tag) -> list[str]:
    """``node``'s id and classes."""
    value = node.get("class")
    classes = value.split() if isinstance(value, str) else list(value or [])
    return [str(node.get("id") or ""), *(str(c) for c in classes)]


def _is_content(node: Tag) -> bool:
    """Whether ``node`` is the page's main part, an article or what is called
    the content."""
    return (
        node.name in ("main", "article")
        or str(node.get("role") or "").strip().lower() == "main"
        or any(_content_name(name) for name in _names(node) if name)
    )


def _holding_content(soup: BeautifulSoup) -> set[int]:
    """The elements (by id) that hold the page's content (`_is_content`): a
    frame never does, whatever it is called. lxml reads some pages' header as
    never closed, and the content as standing in it: Krzyżanowice's
    ``<div id="content">`` in its ``<header>``'s ``<nav>`` (11-13)."""
    holding: set[int] = set()
    for node in soup.find_all(_is_content):
        for parent in node.parents:
            if id(parent) in holding:
                break
            holding.add(id(parent))
    return holding


def _frame_elements(soup: BeautifulSoup) -> set[int]:
    """The elements (by id) of the site's frame around a page's content.

    A ``<nav>`` or the role of one, wherever it stands: biuletyn.net's left
    menu is a ``<nav>`` in an ``<aside>`` in ``<main>``. A ``<header>``,
    ``<footer>`` or ``<aside>`` outside the page's main part, articles and
    sections, or the role of the site's header or footer. And an element whose
    id or class names a frame (`_frame_name`): the old BIPs'
    ``<div id="MenuLeft">``. None of them when it holds the page's content
    (`_holding_content`). A file there is the site's, the same on every page
    (11-13: Mysłowice's menu lent "Odprowadzenie wód opadowych z posesji" to
    eleven councillors, Gliwice's footer "Wniosek o wydanie prawa jazdy" to
    fifteen).
    """
    holding = _holding_content(soup)
    found: set[int] = set()
    for node in soup.find_all(True):
        if not isinstance(node, Tag) or id(node) in holding:
            continue
        role = str(node.get("role") or "").strip().lower()
        if node.name == "nav" or role in _FRAME_ROLES:
            found.add(id(node))
        elif node.name in ("header", "footer", "aside"):
            if (
                node.find_parent(_SECTIONS) is None
                and node.find_parent(role="main") is None
            ):
                found.add(id(node))
        elif any(_frame_name(name) for name in _names(node) if name):
            found.add(id(node))
    return found


def _frame_of(node: Tag, frames: set[int]) -> int:
    """The outermost frame element ``node`` stands in, by id; 0 if none."""
    outermost = 0
    for parent in node.parents:
        if id(parent) in frames:
            outermost = id(parent)
    return outermost


def _path(anchor: Tag, labels: dict[int, tuple[int, str]]) -> str:
    """The list items above ``anchor``, each by its own first link, outermost
    first (`LinkContext.path`); ``labels`` keeps each item's, by its id."""
    found: list[str] = []
    for parent in anchor.parents:
        if parent.name != "li":
            continue
        if id(parent) not in labels:
            first = parent.find("a")
            labels[id(parent)] = (
                (id(first), _text(first)[:100]) if isinstance(first, Tag) else (0, "")
            )
        first_id, label = labels[id(parent)]
        if first_id != id(anchor) and label:
            found.append(label)
            if len(found) == _PATH_DEPTH:
                break
    return " > ".join(reversed(found))


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


def _cp1250_bytes(error: UnicodeError) -> tuple[str, int]:
    """A byte UTF-8 cannot read, read as windows-1250 (`decode_html`)."""
    assert isinstance(error, UnicodeDecodeError)
    bad = error.object[error.start : error.end]
    return bytes(bad).decode("cp1250", "replace"), error.end


codecs.register_error("koryta-cp1250", _cp1250_bytes)

_META_CHARSET = re.compile(rb"<meta[^>]+charset=[\"']?([\w.:-]+)", re.I)


def _meta_charset(content: bytes) -> str:
    """The charset the page's own ``<meta>`` declares, "" when none does."""
    found = _META_CHARSET.search(content[:4096])
    return found.group(1).decode("ascii", "replace") if found else ""


def _bold_span(node: Tag) -> bool:
    """A span styled bold, a heading as much as a <strong>: powiat chełmiński
    names each councillor so over their "pobierz oświadczenie" (11-05)."""
    if node.name != "span":
        return False
    style = str(node.get("style") or "").replace(" ", "").lower()
    return "font-weight:bold" in style or "font-weight:700" in style


def decode_html(content: bytes | str, content_type: str = "") -> str:
    """A page's text, in the charset its header or ``<meta>`` declares.

    Older BIPs still serve windows-1250 or ISO-8859-2; read as UTF-8 their
    "Oświadczenia majątkowe" loses its Polish letters and nothing matches.
    """
    if isinstance(content, str):
        return content
    declared = re.search(r"charset=[\"']?([\w.:-]+)", content_type or "", re.I)
    known = [declared.group(1)] if declared else []
    # A page that says UTF-8 and is, but for its template's few strings in
    # windows-1250 (gmina Sanok, 11-05: 25 bytes of "Przejdź do treści" among
    # 218 Polish letters in UTF-8): UnicodeDammit gave the whole page up for
    # mac_latin2, and its "Oświadczenia majątkowe" read "OŇõwiadczenia". Read
    # as written: UTF-8, any byte that is not as windows-1250.
    said = (declared.group(1) if declared else "") or _meta_charset(content)
    if said.lower().replace("-", "").replace("_", "") == "utf8":
        text = content.decode("utf-8", "koryta-cp1250")
        strays = content.decode("utf-8", "replace").count("\ufffd")
        letters = sum(1 for c in text if ord(c) > 127) - strays
        # A page in windows-1250 throughout has hardly a letter that reads
        # as UTF-8.
        if letters >= 2 * strays:
            return text
    dammit = UnicodeDammit(content, known, is_html=True)
    return dammit.unicode_markup or content.decode("utf-8", "replace")


def _anchors(soup: BeautifulSoup, base_url: str) -> list[tuple[Tag, str]]:
    """Each link of the page with its absolute address, in document order."""
    found = []
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
        if absolute.startswith(("http://", "https://")):
            found.append((anchor, absolute))
    return found


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
            if node.name in _HEADINGS or _bold_span(node):
                last = node
            elif node.name == "a" and last is not None:
                headings[id(node)] = last
    frames = _frame_elements(soup)
    anchors = [(a, url, _frame_of(a, frames)) for a, url in _anchors(soup, base_url)]
    # A link the frame has is the frame's, wherever else the page has it:
    # Mysłowice's template draws its menu twice, in the header's <nav> and
    # down the content's side.
    in_frame = {absolute for _, absolute, frame in anchors if frame}
    links: list[LinkContext] = []
    seen: set[str] = set()
    rows: _Rows = {}
    labels: dict[int, tuple[int, str]] = {}
    for anchor, absolute, frame in anchors:
        if absolute in seen:
            continue
        seen.add(absolute)
        framed = absolute in in_frame
        text = _text(anchor) or str(anchor.get("title") or "").strip()
        block = anchor.find_parent(_BLOCKS)
        row = _row_text(anchor, block, rows)[:300] if isinstance(block, Tag) else ""
        previous = headings.get(id(anchor))
        # A link of the frame stands under the frame's own headings: a footer
        # is not under the last heading of the content above it (Gliwice's
        # "Oświadczenia majątkowe", 11-13).
        if framed and previous is not None and _frame_of(previous, frames) != frame:
            previous = None
        heading = _text(previous)[:200] if previous is not None else ""
        path = _path(anchor, labels)
        links.append(LinkContext(absolute, text, row, heading, path, framed))
    return title, links
