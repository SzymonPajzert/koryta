"""BIPs whose lists a Vue component draws: ``<v-document-list>`` and its JSON.

Zabrze's BIP (bip.miastozabrze.pl) lists a section's documents with a
``<v-document-list :config="{...,&quot;loadURL&quot;:...}">`` that its script
fills from ``loadURL`` (``/api/v1/document-list/<n>``): ``data`` rows of
``doc_id``, ``dscrpt`` (the subject: a councillor's name) and ``dscrpa`` (their
post, "Radny RM"). The page itself links nothing but its menu, so the walk read
705 pages there and never saw a councillor (10-31). Each document has a plain
page, ``/doc/<doc_id>``, titled with the person and linking their files
("Oświadczenie majątkowe za rok 2025", ``/attachment/<id>``).

`links` hands the walk a list's documents as links, the subject for the label
and the post beside it, under the list's title. On a document's page each file
is a card (``data-clsnam="ATTACHMENT"``) whose label, "Oświadczenie majątkowe
za rok 2025", is a ``<div>`` beside a link reading "Pobierz załącznik":
`attachments` gives the card's links its text as their row.
"""

from __future__ import annotations

import html
import json
import logging
import re
from collections.abc import Callable
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup, Tag

from scrapers.common.fetch import HttpResult
from scrapers.common.links import LinkContext

logger = logging.getLogger(__name__)

#: The walk's request (robots.txt, the host's rate, the fetch): an answer, or
#: why there was none.
Get = Callable[[str], "HttpResult | str"]

_MARK = b"<v-document-list"
_COMPONENT = re.compile(r'<v-document-list\b[^>]*?:config="([^"]*)"', re.S)


def lists(content: bytes, url: str) -> list[tuple[str, str]]:
    """The page's document lists: (where its rows come from, its title)."""
    if _MARK not in content:
        return []
    out: list[tuple[str, str]] = []
    for found in _COMPONENT.finditer(content.decode("utf-8", "replace")):
        try:
            config = json.loads(html.unescape(found.group(1)))
        except ValueError:
            continue
        source = config.get("loadURL") if isinstance(config, dict) else None
        if not isinstance(source, str) or not source:
            continue
        source = urljoin(url, source)
        # Only the page's own host: the walk's scope goes no further.
        if urlsplit(source).hostname != urlsplit(url).hostname:
            continue
        out.append((source, " ".join(str(config.get("title") or "").split())))
    return out


def _rows(answer: HttpResult | str) -> list[dict[str, object]]:
    if isinstance(answer, str) or not answer.ok:
        return []
    try:
        body = json.loads(answer.content)
    except ValueError:
        return []
    rows = body.get("data") if isinstance(body, dict) else None
    return [r for r in rows or [] if isinstance(r, dict)]


def links(content: bytes, url: str, get: Get) -> list[LinkContext]:
    """The documents of the page's lists as links: [] for a page with none."""
    out: list[LinkContext] = []
    for source, title in lists(content, url):
        rows = _rows(get(source))
        if not rows:
            logger.info("document list %s: no rows", source)
        for row in rows:
            ident = row.get("doc_id")
            if ident is None or row.get("visble") is False:
                continue
            subject = " ".join(str(row.get("dscrpt") or "").split())
            post = " ".join(str(row.get("dscrpa") or "").split())
            out.append(
                LinkContext(
                    urljoin(url, f"/doc/{ident}"),
                    subject,
                    " | ".join(x for x in (subject, post) if x),
                    title,
                )
            )
    return out


_CARD = b'data-clsnam="ATTACHMENT"'


def attachments(content: bytes, url: str) -> dict[str, str]:
    """{file address: its card's text} on a document's page; {} for a page
    with no attachment cards."""
    if _CARD not in content:
        return {}
    soup = BeautifulSoup(content, "lxml")
    out: dict[str, str] = {}
    for card in soup.select('[data-clsnam="ATTACHMENT"]'):
        if not isinstance(card, Tag):
            continue
        said = " ".join(card.get_text(" ", strip=True).split())[:300]
        for anchor in card.find_all("a", href=True):
            href = str(anchor.get("href") or "").strip()
            if href and not href.startswith(("#", "javascript:")):
                out[urljoin(url, href).split("#")[0]] = said
    return out
