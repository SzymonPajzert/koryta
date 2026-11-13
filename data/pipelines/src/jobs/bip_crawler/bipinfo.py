"""Reading bip.info.pl's Angular BIPs through the JSON API their pages are drawn from.

bip.info.pl's new app (4.3.1 on 11-13: lubliniec-starostwo.bip.info.pl,
glogow.bip.info.pl, and offices on their own names, bip.mierzecice.pl) answers
every address, /sitemap.xml too, with the same 58,813-byte shell: an
``<app-root>`` and ``./assets/config.js`` (``apiUrl: '/api', prefix: 'fo'``).
The browser draws the page from ``<origin>/api/fo/``:

- ``getVersion``: ``{data: {id: '4.3.1-RC8'}}``, by which a host is told;
- ``menu/right``, ``menu/left``: the office's menus as a tree of ``{id,
  attributes: {title, type, url, children}}``; a ``group`` has no page, a
  ``page`` or ``articleCategory`` lists articles, an ``article`` is one;
- ``search/getMetadata/,<segment>,...``: what an address is, and for a list
  the id its articles are asked by (``objectId``: the menu's own id on the
  sections the old platform made, another one on new sections);
- ``articles?page&count&path&category``: a list's articles, ``count`` a call;
- ``articles/<slug>``: an article and its attachments (``originalName``,
  ``downloadName``);
- ``files/<id>/download``: an attachment, as the app links it.

Rendered, Lubliniec's start page asked its host ~53 times (scripts and calls),
past `people.RENDER_TURNS`, and drew only the left menu; the office pages list
their people ten at a time behind buttons. A walk read 300 pages there and no
declaration page (11-13). Read here the start page is the two menus, a list a
page two calls, an article one.

A list whose name or sections say oświadczenia or majątkowe is drawn without
links to its articles: Lubliniec's 64 declaration lists hold 1,425 people, one
article each, and a walk would read them ahead of the next list. The walk opens
those that may be the seekers' instead (`BipInfo.documents`, `entries_to_open`),
each a page of its attachments under their names.
"""

from __future__ import annotations

import html
import json
import re
import threading
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote, unquote, urlsplit

from scrapers.bip.people import (
    ASSETS,
    DECLARATION,
    YEAR,
    Entry,
    Seeker,
    entries_to_open,
    fold,
    is_council,
    is_file_link,
)
from scrapers.common.fetch import HttpResult
from scrapers.common.links import LinkContext, extract_link_contexts

#: The walk's request (robots.txt, the host's rate, the fetch): a response, or
#: why there was none (``people.ROBOTS``, ``people.UNREACHABLE``).
Get = Callable[[str], "HttpResult | str"]
#: What `BipInfo.page` answers when robots.txt keeps the crawler out of the
#: API: people.ROBOTS.
ROBOTS = "robots"
API = "/api/fo/"
#: The menus a start page shows: Lubliniec and Mierzęcice keep "Oświadczenia
#: majątkowe" in the right one, Głogów in the left.
MENUS = ("right", "left")
#: Articles a list call asks for: the app asks for 10, the API gives 100.
COUNT = 100
#: Calls a declarations list is read in: 1,000 articles.
MAX_PAGES = 10
#: Probes of a host whose API failed in a way that may pass (a timeout, a 5xx)
#: before the run takes it for no host of the app's.
PROBES = 3
#: What the app's addresses keep as written in a link; the rest (ą, spaces) is
#: percent-encoded.
_SAFE = "/-._~!$'()*+,;=:@"
#: Addresses the app does not draw: its API, its scripts and files.
_NOT_PAGES = re.compile(
    r"^/(?:api|assets)/|\.(?:js|css|ico|txt|xml|json|png|jpe?g|gif|svg|woff2?)$", re.I
)
_LIST = "koryta-bipinfo-list"
_KEPT = re.compile(
    rb'<script type="application/json" id="' + _LIST.encode() + rb'">(.*?)</script>',
    re.S,
)


def is_shell(content: bytes) -> bool:
    """Whether a page is the shell the app draws itself into."""
    head = content[:200_000]
    return b"<app-root" in head and b"assets/config.js" in head and API.encode() in head


def _origin(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}".lower()


def _path(url: str) -> str:
    """An address's path as the app reads it: decoded, no final slash."""
    return unquote(urlsplit(url).path).rstrip("/")


def _commas(path: str) -> str:
    """A path as the API takes it after a call's name: /a/b as ",a,b"."""
    return ",".join(quote(segment, safe="-._~") for segment in path.split("/"))


def _text(value: Any) -> str:
    return " ".join(html.unescape(str(value or "")).split())


def _a(href: str, text: str) -> str:
    return f'<a href="{html.escape(href)}">{html.escape(text)}</a>'


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


@dataclass
class _Node:
    """A menu item: its title, type, path on the host ("" for none or another
    host's), and the titles of the sections above it, innermost first."""

    title: str
    kind: str
    path: str
    trail: tuple[str, ...]
    children: list[_Node] = field(default_factory=list)


def _newest_first(nodes: list[_Node]) -> list[_Node]:
    """Siblings that name a year or a term, the newest first in the places
    they had; the rest where they were. A walk reads the lists it meets
    first, and a person's articles are opened three at most
    (`entries_to_open`): in menu order, Lubliniec's 2014-2018 term first."""

    def newest(node: _Node) -> int:
        return max((int(y) for y in YEAR.findall(fold(node.title))), default=0)

    dated = [i for i, node in enumerate(nodes) if newest(node)]
    ordered = sorted((nodes[i] for i in dated), key=newest, reverse=True)
    out = list(nodes)
    for i, node in zip(dated, ordered, strict=True):
        out[i] = node
    return out


def _nodes(items: Any, origin: str, trail: tuple[str, ...], top: bool) -> list[_Node]:
    """A menu answer's items. A menu's own name ("MENU PRZEDMIOTOWE", "SPIS
    PODMIOTÓW") stays out of the trails: `names_somebody` takes two
    capitalised words for a person's name."""
    out: list[_Node] = []
    for item in items if isinstance(items, list) else []:
        attributes = _dict(_dict(item).get("attributes"))
        if not attributes:
            continue
        title = _text(attributes.get("title"))
        url = str(attributes.get("url") or "")
        if url.lower().startswith(origin + "/"):
            url = url[len(origin) :]
        path = unquote(url).rstrip("/") if url.startswith("/") else ""
        node = _Node(title, str(attributes.get("type") or ""), path, trail)
        below = trail if top and not path else (title, *trail)
        node.children = _nodes(attributes.get("children"), origin, below, False)
        out.append(node)
    return _newest_first(out)


def _index(nodes: list[_Node], into: dict[str, _Node]) -> None:
    for node in nodes:
        if node.path:
            into.setdefault(node.path, node)
            if node.kind == "article":
                # An article in the menu stands for its section, whose address
                # is its own less the article's slug: Głogów's "Oświadczenia
                # majątkowe Radnych" over the terms and the councillors.
                into.setdefault(node.path.rsplit("/", 1)[0], node)
        _index(node.children, into)


@dataclass
class _Site:
    """One host running the app: its menus once read, by path."""

    origin: str
    #: robots.txt keeps the crawler out of the API: every page is ROBOTS, as a
    #: browser drawing them would read the API all the same.
    blocked: bool = False
    nodes: list[_Node] | None = None
    index: dict[str, _Node] = field(default_factory=dict)

    def href(self, path: str) -> str:
        return self.origin + quote(path, safe=_SAFE)


@dataclass(frozen=True)
class Document:
    """An article a walk opened, as a page of its files."""

    url: str
    title: str
    links: tuple[LinkContext, ...]


def _is_html(page: HttpResult) -> bool:
    return "html" in page.content_type.lower() or b"<html" in page.content[:1000]


def _passing(answer: HttpResult | str) -> bool:
    """Whether a failed call may answer next time: the host down, slow or busy."""
    if isinstance(answer, str):
        return answer != ROBOTS
    return answer.status in (0, 408, 429) or answer.status >= 500


class _Failed(Exception):
    """An API call did not answer with JSON: ``answer`` is what came instead."""

    def __init__(self, answer: HttpResult | str) -> None:
        super().__init__(str(answer))
        self.answer = answer


def _page(site: _Site, url: str, title: str, body: str) -> HttpResult:
    page = (
        f'<html><head><base href="{html.escape(site.origin)}/">'
        f"<title>{html.escape(title)}</title></head><body>{body}</body></html>"
    )
    return HttpResult(url, 200, "text/html; charset=utf-8", page.encode("utf-8"))


def _nav(site: _Site, nodes: list[_Node]) -> str:
    """Menu items as nested lists, a section without a page as a label without
    an address, which the links below it carry (`LinkContext.path`)."""

    def tree(items: list[_Node]) -> str:
        out = []
        for node in items:
            label = (
                _a(site.href(node.path), node.title)
                if node.path
                else f"<a>{html.escape(node.title)}</a>"
            )
            below = tree(node.children) if node.children else ""
            out.append(f"<li>{label}{below}</li>")
        return f"<ul>{''.join(out)}</ul>"

    return f"<nav>{tree(nodes)}</nav>"


def _label(attachment: dict[str, Any]) -> str:
    """An attachment as the app names it, and its file's name beside when that
    says more: "Oświadczenie majątkowe (Radny Krzysztof Kobiałka.pdf)"."""
    name, file = (_text(attachment.get(k)) for k in ("originalName", "downloadName"))
    return f"{name} ({file})" if name and file and file != name else name or file


def _attributes(answer: dict[str, Any]) -> dict[str, Any]:
    """An article call's article: ``{data: {attributes: ...}}``."""
    return _dict(_dict(answer.get("data")).get("attributes"))


class BipInfo:
    """The hosts of bip.info.pl's Angular app a run meets, read through their
    API (see the module). A host counts as one once a page of it was the shell
    (`is_shell`) and getVersion answered (`probe`); from then on `page` draws
    its pages. Thread-safe: walks of different hosts share one."""

    def __init__(self, get: Get, allowed: Callable[[str], bool]) -> None:
        self.get = get
        #: robots.txt alone, for the addresses an API call stands in for.
        self.allowed = allowed
        self._sites: dict[str, _Site | None] = {}
        self._undecided: Counter[str] = Counter()
        self._busy: dict[str, HttpResult] = {}
        self._lock = threading.Lock()

    def _site(self, url: str) -> _Site | None:
        with self._lock:
            return self._sites.get(_origin(url))

    def knows(self, url: str) -> bool:
        """Whether ``url``'s host runs the app, as this run has probed."""
        return self._site(url) is not None

    def probe(self, page: HttpResult) -> bool:
        """Whether ``page``, as fetched, is the app's shell and its API answers.
        The answer holds for the host the rest of the run once it is sure; a
        failure that may pass leaves it to the host's next pages, `PROBES` at
        most, and a "not now" to the next page (`busy`)."""
        origin = _origin(page.url)
        with self._lock:
            if origin in self._sites:
                return self._sites[origin] is not None
        if not _is_html(page):
            return False  # a file says nothing about the pages
        site: _Site | None = None
        if is_shell(page.content):
            try:
                data = self._json(origin + API + "getVersion")
                if _dict(data.get("data")).get("id"):
                    site = _Site(origin)
            except _Failed as failed:
                answer = failed.answer
                if answer == ROBOTS:
                    site = _Site(origin, blocked=True)
                elif isinstance(answer, HttpResult) and answer.status in (429, 503):
                    with self._lock:
                        self._busy[origin] = answer
                    return False
                elif _passing(answer):
                    with self._lock:
                        self._undecided[origin] += 1
                        if self._undecided[origin] < PROBES:
                            return False
        with self._lock:
            return self._sites.setdefault(origin, site) is not None

    def busy(self, url: str) -> HttpResult | None:
        """The "not now" getVersion gave ``url``'s host at its last probe, once."""
        with self._lock:
            return self._busy.pop(_origin(url), None)

    def page(self, url: str) -> HttpResult | str | None:
        """The page at ``url`` as the app draws it: an HTML page, the error an
        API call answered, or why there was no answer; None for an address
        that is no page of the app's (a file, a script), fetched as it is."""
        site = self._site(url)
        path = _path(url)
        if site is None or _NOT_PAGES.search(path):
            return None
        if site.blocked:
            return ROBOTS
        try:
            if not path:
                menus = _nav(site, self._menus(site))
                return _page(
                    site, url, "Strona główna", f"<h1>Strona główna</h1>{menus}"
                )
            answer = self._json(
                site.origin + API + "search/getMetadata/" + _commas(path)
            )
            meta = _dict(answer.get("meta"))
            kind, ident = str(meta.get("type") or ""), str(meta.get("objectId") or "")
            if kind == "articleCategory" and ident:
                return self._list(site, url, path, ident, _text(meta.get("name")))
            if kind == "article":
                return self._article(site, url, path)
        except _Failed as failed:
            return failed.answer
        # A page of the app's own (contact, search): nothing a declaration is behind.
        return _page(site, url, _text(meta.get("name")), "")

    # -- the API -----------------------------------------------------------------
    def _json(self, url: str) -> dict[str, Any]:
        answer = self.get(url)
        if isinstance(answer, str) or not answer.ok:
            raise _Failed(answer)
        try:
            data = json.loads(answer.content)
        except ValueError:
            data = None
        if not isinstance(data, dict):
            raise _Failed(
                HttpResult(url, answer.status, answer.content_type, b"", "not JSON")
            )
        return data

    def _menus(self, site: _Site) -> list[_Node]:
        """The site's menus, read once a run: a menu the site has not is left
        out, one that may answer later leaves them all to the next page."""
        with self._lock:
            if site.nodes is not None:
                return site.nodes
        nodes: list[_Node] = []
        for name in MENUS:
            try:
                data = self._json(site.origin + API + "menu/" + name)
            except _Failed as failed:
                if _passing(failed.answer):
                    raise
                continue
            nodes += _nodes(data.get("data"), site.origin, (), True)
        index: dict[str, _Node] = {}
        _index(nodes, index)
        with self._lock:
            site.nodes, site.index = nodes, index
        return nodes

    def _trail(self, site: _Site, path: str) -> tuple[_Node | None, tuple[str, ...]]:
        """The menu item at ``path`` and the sections above it, innermost
        first; for a path the menus do not have, its breadcrumb's sections."""
        self._menus(site)
        node = site.index.get(path)
        if node is not None:
            return node, node.trail
        try:
            data = self._json(site.origin + API + "breadcrumbs/" + _commas(path))
        except _Failed:
            return None, ()
        crumbs = [_dict(_dict(c).get("attributes")) for c in data.get("data") or []]
        titles = [_text(c.get("title")) for c in crumbs[1:-1] if c.get("isLink")]
        return None, tuple(reversed([t for t in titles if t]))

    def _rows(
        self, site: _Site, path: str, ident: str, pages: int
    ) -> list[dict[str, str]]:
        """A list's articles, newest first as the API gives them, read in
        ``pages`` calls at most: slug, title, path, date."""
        rows: list[dict[str, str]] = []
        for number in range(1, pages + 1):
            query = (
                f"page={number}&count={COUNT}&path={quote(path, safe='/')}"
                f"&category={quote(ident)}"
            )
            try:
                data = self._json(f"{site.origin}{API}articles?{query}")
            except _Failed:
                if not rows:
                    raise
                break  # the pages read so far
            batch = [_dict(_dict(r).get("attributes")) for r in data.get("data") or []]
            for article in batch:
                slug, url = (
                    str(article.get("slug") or ""),
                    str(article.get("url") or ""),
                )
                if slug and url.startswith("/"):
                    rows.append(
                        {
                            "slug": slug,
                            "title": _text(article.get("title")),
                            "path": unquote(url).rstrip("/"),
                            "date": str(article.get("publishedFrom") or "")[:10],
                        }
                    )
            last = _dict(data.get("meta")).get("pages")
            if not batch or not isinstance(last, int) or number >= last:
                break
        return rows

    # -- pages -------------------------------------------------------------------
    def _list(
        self, site: _Site, url: str, path: str, ident: str, name: str
    ) -> HttpResult:
        """A list: the sections below it in the menu, and its articles. A
        declarations list names them without links and keeps them on the page
        for `documents`; another links the first hundred."""
        node, trail = self._trail(site, path)
        name = node.title if node is not None else name
        title = " - ".join(dict.fromkeys(x for x in (name, *trail) if x))
        words = fold(title)
        declarations = bool(DECLARATION.search(words) or ASSETS.search(words))
        rows = self._rows(site, path, ident, MAX_PAGES if declarations else 1)
        parts = [f"<h1>{html.escape(name)}</h1>"]
        if node is not None and node.children:
            parts.append(_nav(site, node.children))
        if declarations:
            listed = "".join(f"<li>{html.escape(r['title'])}</li>" for r in rows)
            kept = {"name": name, "trail": list(trail), "rows": rows}
            text = json.dumps(kept, ensure_ascii=False).replace("</", "<\\/")
            parts.append(
                f'<ul>{listed}</ul><script type="application/json" id="{_LIST}">'
                f"{text}</script>"
            )
        else:
            linked = "".join(
                f"<li>{_a(site.href(r['path']), r['title'])}</li>" for r in rows
            )
            parts.append(f"<ul>{linked}</ul>")
        return _page(site, url, title, "".join(parts))

    def _article(self, site: _Site, url: str, path: str) -> HttpResult:
        """An article: its attachments, its text, and the sections below it
        when the menu holds it (Głogów's "Oświadczenia majątkowe Radnych")."""
        slug = quote(path.rsplit("/", 1)[-1], safe="")
        article = _attributes(self._json(site.origin + API + "articles/" + slug))
        section, trail = self._trail(site, path.rsplit("/", 1)[0])
        category = _text(
            _dict(_dict(article.get("category")).get("attributes")).get("title")
        )
        above = (section.title, *trail) if section is not None else (category, *trail)
        heading = _text(article.get("title"))
        title = " - ".join(dict.fromkeys(x for x in (heading, *above) if x))
        files = "".join(
            f"<li>{_a(href, label)}</li>" for href, label in self._files(site, article)
        )
        own = site.index.get(path)
        below = _nav(site, own.children) if own is not None and own.children else ""
        return _page(
            site,
            url,
            title,
            f"<h1>{html.escape(heading)}</h1><h2>Załączniki</h2><ul>{files}</ul>"
            f"<div>{article.get('content') or ''}</div>{below}",
        )

    def _files(self, site: _Site, article: dict[str, Any]) -> list[tuple[str, str]]:
        """An article's attachments, each at the address the app links it at,
        then the files its text links on the host; robots.txt asked first."""
        files: dict[str, str] = {}
        for attachment in article.get("attachments") or []:
            ident = str(_dict(attachment).get("id") or "")
            if not re.fullmatch(r"[0-9A-Za-z-]+", ident):
                continue
            href = f"{site.origin}{API}files/{ident}/download"
            if self.allowed(href):
                files.setdefault(href, _label(_dict(attachment.get("attributes"))))
        _, linked = extract_link_contexts(
            str(article.get("content") or ""), site.origin + "/"
        )
        for link in linked:
            if (
                _origin(link.url) == site.origin
                and is_file_link(link.url)
                and self.allowed(link.url)
            ):
                files.setdefault(link.url, link.anchor)
        return list(files.items())

    # -- a declarations list's articles -------------------------------------------
    def documents(
        self,
        page: HttpResult,
        seekers: list[Seeker],
        prefer: re.Pattern[str] | None,
        first_names: frozenset[str],
        per_person: int,
        opened: Counter[tuple[str, str]],
    ) -> list[Document]:
        """The articles of the declarations list ``page`` is (as `page` drew
        it) that may be the seekers' (`entries_to_open`), each read as a page
        of its files: a file's label its attachment's names, its row the
        article's title, the list's and its date; ``opened`` counts the walk's."""
        site = self._site(page.url)
        found = _KEPT.search(page.content)
        if site is None or found is None:
            return []
        try:
            kept = json.loads(found.group(1).decode("utf-8"))
            name, trail = str(kept["name"]), tuple(str(t) for t in kept["trail"])
            rows = [
                {k: str(r[k]) for k in ("slug", "title", "path", "date")}
                for r in kept["rows"]
            ]
        except (ValueError, KeyError, TypeError):
            return []
        council = is_council(" ".join((name, *trail)), prefer)
        entries = [
            Entry(
                " - ".join(x for x in (r["title"], name) if x),
                r["date"],
                council,
                page.url,
            )
            for r in rows
        ]
        out: list[Document] = []
        for i in entries_to_open(entries, seekers, first_names, per_person, opened):
            row, subject = rows[i], entries[i].subject
            address = site.href(row["path"])
            if not self.allowed(address):
                continue
            try:
                data = self._json(
                    site.origin + API + "articles/" + quote(row["slug"], safe="")
                )
            except _Failed:
                continue
            article = _attributes(data)
            said = f"{subject} - opublikowano {row['date']}" if row["date"] else subject
            title = " - ".join(dict.fromkeys(x for x in (subject, *trail) if x))
            links = tuple(
                LinkContext(href, label, said)
                for href, label in self._files(site, article)
            )
            out.append(Document(address, title, links))
        return out
