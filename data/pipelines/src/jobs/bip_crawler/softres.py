"""BUK Softres's BIPs: files offered as form buttons, not links.

Softres's CMS (bip.strzyzow.pl, medyka.itl.pl, gminajaroslaw.pl, niebylec.com.pl
...: 7 units of the people mode and Strzyżów's, about 25 candidacies on 10-31)
lists a position's files as ``<form class="download" method="post">`` buttons,
the file's address only in a hidden ``attach_file_path`` (a plain GET of it
gives the file). The walk reads links alone, and saw none. The page names the
person in its "Nazwa pozycji" (and its "Osoby odpowiedzialne"), not over the
files, whose heading is "Załączniki" and whose title is the office's.

`files` hands each such button back as a link, the position's name for its
row.
"""

from __future__ import annotations

import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

from scrapers.common.links import LinkContext

_MARK = b"attach_file_path"


def _text(node: object) -> str:
    raw = node.get_text(" ", strip=True) if isinstance(node, Tag) else str(node or "")
    return " ".join(raw.split())


def _position(soup: BeautifulSoup) -> str:
    """The position's name: the "Nazwa pozycji" cell, else the first person
    responsible."""
    for label in soup.find_all("strong"):
        if _text(label).rstrip(":").strip().lower() == "nazwa pozycji":
            cell = label.find_parent("td")
            value = cell.find_next_sibling("td") if isinstance(cell, Tag) else None
            if isinstance(value, Tag) and _text(value):
                return _text(value)
    person = soup.find(class_="persons__position")
    return _text(person)


def files(content: bytes, url: str) -> list[LinkContext]:
    """The page's file buttons as links: [] for a page with none."""
    if _MARK not in content:
        return []
    soup = BeautifulSoup(content, "lxml")
    position = _position(soup)
    out: list[LinkContext] = []
    for form in soup.find_all("form"):
        if not isinstance(form, Tag):
            continue
        path = form.find("input", attrs={"name": "attach_file_path"})
        address = str(path.get("value") or "").strip() if isinstance(path, Tag) else ""
        if not re.match(r"(?i)https?://", urljoin(url, address)) or not address:
            continue
        label = _text(form.find("button")) or _text(form)
        out.append(
            LinkContext(
                urljoin(url, address),
                label,
                " | ".join(x for x in (position, label) if x),
            )
        )
    return out
