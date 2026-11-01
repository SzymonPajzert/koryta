"""Reading Wrota Lubelszczyzny's BIPs: a document list through the JSON its
page is drawn from, a persons list by the person over each file.

Wrota Lubelszczyzny, Województwo Lubelskie's regional BIP, serves 117 offices
from one PHP CMS (``<office>.bip.lubelskie.pl``), every page carrying the whole
menu, up to 1,300 links. A council's declarations stand in one of two lists:

- a document list, ``table.datatable-config-wrapper``, whose rows a script
  draws from the ``ajaxSource`` of its ``data-config``, ``?id=N&action=list-ajax``
  (``aaData`` of ``id_dokumentu``, ``tresc``, ``data_utworzenia``); a
  document's files are on its own page alone,
  ``?id=N&action=details&document_id=M``. A row names the person (Chełm:
  "Longin Bożeński"), or the list does, a list a person (powiat zamojski:
  "Adamczuk Agnieszka Katarzyna", its rows "Dokument za 2025 rok"). The walk saw
  an empty table: 22 units, 226 candidacies, none found on 10-31.
- a persons list, ``#person-assets-accordion``: a card a person, their name in
  its header, each file linked by an icon in its body ("Pobierz"), so neither
  the file's row nor its heading said whose it was (Konopnica, Końskowola,
  the sejmik's).

`Wrota.documents` hands the walk a document list's documents that may be the
seekers' (`entries_to_open`), each as a page of its files' links; the row of a
file is the document's subject and the list's name, its page's title these
and the breadcrumb. `persons` gives a persons list's files their person as
their row.
"""

from __future__ import annotations

import html
import json
import logging
import re
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, urljoin, urlsplit

from bs4 import BeautifulSoup, Tag

from scrapers.bip.people import (
    ASSETS,
    DECLARATION,
    Entry,
    Seeker,
    entries_to_open,
    fold,
    is_council,
)
from scrapers.common.fetch import HttpResult
from scrapers.common.links import LinkContext

logger = logging.getLogger(__name__)

#: The walk's request (robots.txt, the host's rate, the fetch): an answer, or
#: why there was none.
Get = Callable[[str], "HttpResult | str"]
#: A list's rows asked at once; a longer list is asked page by page.
PAGE = 500
#: Pages of a list's rows read.
MAX_PAGES = 4

_CONFIG = re.compile(
    r"""<table[^>]*\bdatatable-config-wrapper\b[^>]*\bdata-config=(['"])(.*?)\1""",
    re.S,
)
_TRAIL = re.compile(r'<nav aria-label="breadcrumb">(.*?)</nav>', re.S)
_ITEM = re.compile(r"<a\b[^>]*>(.*?)</a>", re.S)
_TAG = re.compile(r"<[^>]+>")
_MAIN = re.compile(r'<main id="main-panel"[^>]*>(.*?)</main>', re.S)
#: A file of the CMS: upload/pliki/<name>.
_FILE = re.compile(r"(?:^|/)upload/pliki/", re.I)


def _plain(fragment: str) -> str:
    return " ".join(html.unescape(_TAG.sub(" ", fragment)).split())


@dataclass(frozen=True)
class DocumentList:
    """A document list as its page configures it."""

    #: The list's page.
    url: str
    #: Where its rows come from: ``?id=N&action=list-ajax``, absolute.
    source: str
    #: The list's own name (``menuName``).
    name: str
    #: The breadcrumb's items, innermost first: "Radni Rady Miasta Chełm -
    #: Oświadczenia majątkowe - Menu".
    trail: str

    @property
    def declarations(self) -> bool:
        """Whether the list, or a section it stands in, says oświadczenia
        majątkowe: every list of the CMS is one (resolutions, orders ...)."""
        words = fold(self.name + " " + self.trail)
        return bool(DECLARATION.search(words) or ASSETS.search(words))


def document_list(content: bytes, url: str) -> DocumentList | None:
    """The document list ``content`` configures, if it is a page of one."""
    if b"datatable-config-wrapper" not in content:
        return None
    text = content[:3_000_000].decode("utf-8", "replace")
    found = _CONFIG.search(text)
    if found is None:
        return None
    try:
        config = json.loads(html.unescape(found.group(2)))
        source = str(config["settings"]["ajaxSource"])
    except (ValueError, KeyError, TypeError):
        return None
    if "action=list-ajax" not in source:
        return None
    name = str(
        ((config.get("general") or {}).get("additional") or {}).get("menuName") or ""
    )
    trail = _TRAIL.search(text)
    items = [_plain(x) for x in _ITEM.findall(trail.group(1))] if trail else []
    items = [x for x in items if x]
    return DocumentList(url, urljoin(url, source), name, " - ".join(reversed(items)))


def _rows(get: Get, listing: DocumentList) -> list[dict[str, Any]] | None:
    """The list's rows; None when it did not answer with them (a hang, or the
    WAF's script challenge in place of the JSON)."""
    rows: list[dict[str, Any]] = []
    for page in range(MAX_PAGES):
        address = f"{listing.source}&iDisplayStart={page * PAGE}&iDisplayLength={PAGE}"
        answer = get(address)
        if isinstance(answer, str) or not answer.ok:
            return None
        try:
            data = json.loads(answer.content)
            batch = [r for r in data.get("aaData") or [] if isinstance(r, dict)]
            total = int(str(data.get("iTotalRecords") or 0))
        except (ValueError, TypeError, AttributeError):
            return None
        rows += batch
        if not batch or len(rows) >= total:
            break
    return rows


def _detail(listing: DocumentList, ident: str) -> str:
    query = parse_qs(urlsplit(listing.source).query)
    menu = (query.get("id") or [""])[0]
    return urljoin(listing.url, f"?id={menu}&action=details&document_id={ident}")


def _files(page: HttpResult) -> list[tuple[str, str]]:
    """A document page's files, (address, label), each once: the CMS links each
    plain and with ?download=1."""
    text = page.content.decode("utf-8", "replace")
    main = _MAIN.search(text)
    soup = BeautifulSoup(main.group(1) if main else "", "lxml")
    files: dict[str, str] = {}
    for anchor in soup.find_all("a", href=True):
        if not isinstance(anchor, Tag):
            continue
        href = str(anchor.get("href") or "").strip()
        if not _FILE.search(href) or "download=" in href:
            continue
        address = urljoin(page.url, href)
        label = " ".join(anchor.get_text(" ", strip=True).split())
        files.setdefault(address, label)
    return list(files.items())


@dataclass(frozen=True)
class Document:
    """One document of a list, as a page of the walk."""

    url: str
    title: str
    links: tuple[LinkContext, ...]


class Wrota:
    """Wrota Lubelszczyzny's document lists, read for a walk (see the module)."""

    def __init__(self, get: Get) -> None:
        self.get = get

    def documents(
        self,
        listing: DocumentList,
        seekers: list[Seeker],
        prefer: re.Pattern[str] | None,
        first_names: frozenset[str],
        per_person: int,
        opened: Counter[tuple[str, str]],
    ) -> list[Document]:
        """The list's documents that may be the seekers' (`entries_to_open`),
        their files read from their pages; ``opened`` counts the walk's."""
        rows = _rows(self.get, listing)
        if rows is None:
            rows = _rows(self.get, listing)  # the WAF's challenge comes and goes
        if rows is None:
            logger.info("%s: its list did not answer with its rows", listing.url)
            return []
        council = is_council(listing.name + " " + listing.trail, prefer)
        entries = [
            Entry(
                " - ".join(x for x in (str(r.get("tresc") or ""), listing.name) if x),
                str(r.get("data_utworzenia") or ""),
                council,
                listing.url,
            )
            for r in rows
        ]
        out: list[Document] = []
        for i in entries_to_open(entries, seekers, first_names, per_person, opened):
            url = _detail(listing, str(rows[i].get("id_dokumentu")))
            page = self.get(url)
            if isinstance(page, str) or not page.ok:
                continue
            subject = entries[i].subject
            links = tuple(LinkContext(a, label, subject) for a, label in _files(page))
            title = " - ".join(x for x in (subject, listing.trail) if x)
            out.append(Document(url, title, links))
        return out


def persons(content: bytes, url: str) -> dict[str, str]:
    """A persons list's files, each with its card's person and its own line:
    {address: "Basak Tomasz | 2024 oświadczenie majątkowe na dwa miesiące ..."}."""
    if b"person-assets-accordion" not in content:
        return {}
    soup = BeautifulSoup(content, "lxml")
    accordion = soup.find(id="person-assets-accordion")
    if not isinstance(accordion, Tag):
        return {}
    out: dict[str, str] = {}
    for card in accordion.find_all("div", class_="card"):
        if not isinstance(card, Tag):
            continue
        header = card.find(class_="card-header")
        person = header.get_text(" ", strip=True) if isinstance(header, Tag) else ""
        for anchor in card.find_all("a", href=True):
            href = str(anchor.get("href") or "")
            if not _FILE.search(href):
                continue
            line = anchor.find_parent("div", class_="row")
            said = line.get_text(" ", strip=True) if isinstance(line, Tag) else ""
            row = " | ".join(x for x in (person, " ".join(said.split())) if x)
            out[urljoin(url, href.strip()).split("#")[0]] = row
    return out
