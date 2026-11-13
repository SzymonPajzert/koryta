"""Reading um-bip, Gdynia's own BIP app, through the JSON API its pages are
drawn from.

bip.um.gdynia.pl is a React app, "um-bip": every address answers the same
shell, ``<div id="um-bip">`` and ``/js/config.js``, and the browser draws the
page from the API that config names (``API_URL``, https://api.um.gdynia.pl):

- ``contents/category_by_id/<id>``: a category's name and its parent's id;
- ``contents/subcategories/<id>?bip=1``: its subcategories, by name and address;
- ``contents/posts/category/<id>?limit&offset&basic=1``: its posts, by title
  and address;
- ``contents/posts/<id>``: a post, its text, its attachments and, for a
  declarations post, its rows: a declarant each, ``declarations_name``,
  ``declarations_position`` and up to ten files, ``protocol``, ``protocol2``
  ... ``protocol10``.

Addresses are read as the app's router reads them: ``<slug>,<id>`` a category,
``<category slug>,<category id>/<post slug>,<post id>`` a post; the main page
shows the main categories, category 1's subcategories, and its menu each one's
own.

The shell shows the walk nothing, and a render no more: the years are buttons,
a post's table ``div`` cells ten rows a page behind "Następny" buttons, a
file's own cell without its declarant. The walk read one page with no links
and left Gdynia's 34 candidacies no_declarations (11-13). Drawn here, a
category is a page of links to its subcategories, under its name, and to its
posts; a post a page titled with the categories above it, its declarations a
table, a row a declarant: name, position, files (its text, a preamble of blank
forms and notices, left out). Every row names its declarant, so a file there
that names no seeker is somebody else's, never a declaration that names nobody
(`names_every_declarant`): the general posts list 300 officials and heads of
city companies a year, some by their surname alone ("Domańska-Ożga"), which
`candidates` would take for nobody's. The pages and the API's calls are asked
as any other, robots.txt, the host's rate and its User-Agent (`identity`).
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
from urllib.parse import parse_qs, quote, unquote, urljoin, urlsplit

from scrapers.common.fetch import HttpResult

#: The walk's request (robots.txt, the host's rate, the fetch): a response, or
#: why there was none (``people.ROBOTS``, ``people.UNREACHABLE``).
Get = Callable[[str], "HttpResult | str"]
#: What the walk's request answers when robots.txt keeps the crawler out.
ROBOTS = "robots"

#: The shell's mount point, and the script that names the API.
_SHELL = re.compile(rb"""<div id=["']um-bip["']""")
_CONFIG = re.compile(rb"""<script[^>]*\bsrc=["']([^"']*config\.js)["']""")
#: ``get API_URL() { return "https://..." }``, or ``API_URL: "https://..."``.
_API_URL = re.compile(
    r"""\bAPI_URL["']?\s*(?:\(\)\s*\{\s*return\s*|[:=]\s*)["'](https?://[^"']+)["']"""
)
#: Posts asked at once: the app asks for 10 a page, its menu for 1,000.
LIMIT = 100
#: Probes of a host whose config.js failed in a way that may pass (a timeout,
#: a 5xx) before the run takes it for no um-bip host.
PROBES = 3
#: The class of a declarations table drawn here (`names_every_declarant`).
_NAMED = "koryta-umbip-declarants"
#: A declarations row's files, as the app lists them.
_FILES = ("protocol", *(f"protocol{n}" for n in range(2, 11)))
_TAG = re.compile(r"<[^>]*>")


def is_shell(content: bytes) -> bool:
    """Whether a page is the shell um-bip draws itself into."""
    head = content[:200_000]
    return bool(_SHELL.search(head)) and bool(_CONFIG.search(head))


def names_every_declarant(content: bytes) -> bool:
    """Whether a page is a declarations post drawn here, whose every file
    stands in a row naming its declarant: a file there that names no seeker
    is somebody else's, never an unnamed declaration."""
    return _NAMED.encode() in content


@dataclass(frozen=True)
class Route:
    """What an address shows in the app: the main page ("m"), a category
    ("c") or a post ("p")."""

    kind: str
    id: str
    page: int = 1


def route(url: str) -> Route | None:
    """``url`` as the app's router reads it; None for an address the app does
    not draw from the API (its scripts, an old slug alone, the search)."""
    parts = urlsplit(url)
    path = unquote(parts.path).strip("/")
    page = parse_qs(parts.query).get("page", ["1"])[0]
    number = int(page) if page.isdigit() and int(page) > 0 else 1
    if not path:
        return Route("m", "1")  # the main categories, category 1's subcategories
    ids = []
    for segment in path.split("/"):
        slug, comma, ident = segment.rpartition(",")
        if not comma or not slug or not ident.isdigit():
            return None
        ids.append(ident)
    if len(ids) == 1:
        return Route("c", ids[0], number)
    return Route("p", ids[1]) if len(ids) == 2 else None


def _origin(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}".lower()


def _is_html(page: HttpResult) -> bool:
    head = page.content[:1000].lower()
    return "html" in page.content_type.lower() or b"<html" in head


def _api_url(config: bytes) -> str:
    """The API's address config.js names, ending in "/"; "" when none."""
    found = _API_URL.search(config[:100_000].decode("utf-8", "replace"))
    return found.group(1).rstrip("/") + "/" if found else ""


def _passing(answer: HttpResult | str) -> bool:
    """Whether a failed call may answer next time: the host down, slow or busy."""
    if isinstance(answer, str):
        return answer != ROBOTS
    return answer.status in (0, 408, 429) or answer.status >= 500


def _not_now(answer: HttpResult | str) -> bool:
    """Whether an answer asks to come back later (429, 503): the walk counts
    such a page unread rather than drawing what it has."""
    return isinstance(answer, HttpResult) and answer.status in (429, 503)


class _Failed(Exception):
    """An API call did not answer with JSON: ``answer`` is what came instead."""

    def __init__(self, answer: HttpResult | str) -> None:
        super().__init__(str(answer))
        self.answer = answer


def _text(value: Any) -> str:
    """A label as the app shows it: tags out ("<BR>"), entities read
    ("W&oacute;jcik"), spaces folded."""
    return " ".join(html.unescape(_TAG.sub(" ", str(value or ""))).split())


def _a(href: str, text: str) -> str:
    return f'<a href="{html.escape(href)}">{html.escape(text)}</a>'


def _page(url: str, title: str, body: str) -> HttpResult:
    page = (
        f"<html><head><title>{html.escape(title)}</title></head>"
        f"<body>{body}</body></html>"
    )
    return HttpResult(url, 200, "text/html; charset=utf-8", page.encode("utf-8"))


def _address(base: str, value: Any) -> str:
    """An absolute http(s) address, "" when ``value`` gives none."""
    raw = str(value or "").strip()
    absolute = urljoin(base, raw) if raw else ""
    return absolute if absolute.startswith(("http://", "https://")) else ""


def _dicts(value: Any) -> list[dict[str, Any]]:
    return [x for x in value if isinstance(x, dict)] if isinstance(value, list) else []


def _count(value: Any) -> int:
    text = str(value or "").strip()
    return int(text) if text.isdigit() else 0


@dataclass
class _Site:
    """One host running um-bip: its address, its API's, and its categories."""

    origin: str
    api: str
    #: Categories the run has met, by id: (name, parent's id).
    categories: dict[str, tuple[str, str]] = field(default_factory=dict)


class UmBip:
    """The um-bip BIPs a run meets, read through their API (see the module).

    A host counts as um-bip once a page of it was the app's shell (`is_shell`)
    and its config.js named the API (`probe`); from then on `page` draws its
    pages. Thread-safe: walks of different hosts share one."""

    def __init__(self, get: Get) -> None:
        self.get = get
        self._sites: dict[str, _Site | None] = {}
        self._undecided: Counter[str] = Counter()
        #: A host's config.js answered "not now": what `busy` hands the walk.
        self._busy: dict[str, HttpResult] = {}
        self._lock = threading.Lock()

    def _site(self, url: str) -> _Site | None:
        with self._lock:
            return self._sites.get(_origin(url))

    def knows(self, url: str) -> bool:
        """Whether ``url``'s host is a um-bip BIP this run has probed."""
        return self._site(url) is not None

    def probe(self, page: HttpResult) -> bool:
        """Whether ``page``, as fetched, is um-bip's shell and its config.js
        names the API. The answer holds for the host the rest of the run once
        it is sure; a config.js that failed in a way that may pass leaves it to
        the host's next pages, `PROBES` at most."""
        origin = _origin(page.url)
        with self._lock:
            if origin in self._sites:
                return self._sites[origin] is not None
        if not _is_html(page):
            return False  # a file says nothing about the pages
        site: _Site | None = None
        if is_shell(page.content):
            found = _CONFIG.search(page.content[:200_000])
            source = found.group(1).decode("utf-8", "replace") if found else ""
            config = self.get(urljoin(page.url, source))
            if isinstance(config, HttpResult) and config.ok:
                api = _api_url(config.content)
                site = _Site(origin, api) if api else None
            elif isinstance(config, HttpResult) and _not_now(config):
                with self._lock:  # no probe used up: the next page asks again
                    self._busy[origin] = config
                return False
            elif _passing(config):
                with self._lock:
                    self._undecided[origin] += 1
                    if self._undecided[origin] < PROBES:
                        return False
        with self._lock:
            return self._sites.setdefault(origin, site) is not None

    def busy(self, url: str) -> HttpResult | None:
        """The "not now" ``url``'s host gave at its last probe, once."""
        with self._lock:
            return self._busy.pop(_origin(url), None)

    def page(self, url: str) -> HttpResult | str | None:
        """The page at ``url`` as the app draws it: an HTML page, the error an
        API call answered, or why there was no answer (robots.txt, the host
        down); None when the app does not draw the address from the API, which
        the walk fetches as it is."""
        site = self._site(url)
        where = route(url)
        if site is None or where is None:
            return None
        try:
            if where.kind == "m":
                return self._main(site, url)
            if where.kind == "c":
                return self._category(site, where, url)
            return self._post(site, where, url)
        except _Failed as failed:
            return failed.answer

    # -- the API ---------------------------------------------------------------
    def _json(self, site: _Site, path: str) -> Any:
        answer = self.get(site.api + path)
        if isinstance(answer, str) or not answer.ok:
            raise _Failed(answer)
        try:
            return json.loads(answer.content)
        except ValueError:
            raise _Failed(
                HttpResult(
                    answer.url, answer.status, answer.content_type, b"", "not JSON"
                )
            ) from None

    def _name(self, site: _Site, ident: str) -> str:
        """A category's name: as a listing gave it, else as the API says."""
        with self._lock:
            known = site.categories.get(ident)
        if known is not None and known[0]:
            return known[0]
        try:
            data = self._json(site, f"contents/category_by_id/{quote(ident)}")
        except _Failed as failed:
            if _not_now(failed.answer):
                raise
            return ""  # a name the page can do without
        category = data.get("category") if isinstance(data, dict) else None
        if not isinstance(category, dict):
            return ""
        name = _text(category.get("name"))
        with self._lock:
            site.categories[ident] = (name, str(category.get("parent_id") or ""))
        return name

    def _trail(self, site: _Site, ident: str) -> list[str]:
        """The names of the categories above ``ident`` the run has met, the
        nearest first: a year's page says whose declarations it holds."""
        names: list[str] = []
        seen = {ident}
        with self._lock:
            parent = site.categories.get(ident, ("", ""))[1]
            while parent and parent not in seen and parent in site.categories:
                seen.add(parent)
                name, parent = site.categories[parent]
                if name:
                    names.append(name)
        return names

    def _subcategories(self, site: _Site, ident: str) -> list[tuple[str, str]]:
        """A category's subcategories, (address, name), each remembered with
        its name and parent for the titles below it (`_trail`)."""
        base = site.origin + "/"
        data = self._json(site, f"contents/subcategories/{quote(ident)}?bip=1")
        listing = data.get("subcategories") if isinstance(data, dict) else None
        found = listing.get("categories") if isinstance(listing, dict) else None
        out = []
        for category in _dicts(found):
            child, name = str(category.get("id") or ""), _text(category.get("name"))
            href = _address(base, category.get("redirect_url")) or _address(
                base, category.get("url")
            )
            if not href:
                continue
            if child.isdigit():
                with self._lock:
                    site.categories.setdefault(child, (name, ident))
            out.append((href, name or href))
        return out

    # -- pages -------------------------------------------------------------------
    def _main(self, site: _Site, url: str) -> HttpResult:
        """The main page as the app's menu shows it: the main categories, each
        with its subcategories, a call a main category. Gdynia files its
        declarations under "Inne", the last of 15: from the main categories
        alone the walk read 111 pages of the council's sections in its six
        minutes and never got there (11-13)."""
        items = []
        unfolding = True
        for href, name in self._subcategories(site, "1"):
            below: list[tuple[str, str]] = []
            where = route(href)
            if unfolding and where is not None and where.kind == "c":
                try:
                    below = self._subcategories(site, where.id)
                except _Failed:
                    unfolding = False  # the menu so far: the host is busy or down
            inner = "".join(f"<li>{_a(h, n)}</li>" for h, n in below)
            menu = f"<ul>{inner}</ul>" if inner else ""
            items.append(f"<li>{_a(href, name)}{menu}</li>")
        name = self._name(site, "1")
        heading = f"<h1>{html.escape(name)}</h1>" if name else ""
        return _page(url, name, f"{heading}<ul>{''.join(items)}</ul>")

    def _category(self, site: _Site, where: Route, url: str) -> HttpResult:
        """A category: its subcategories and its posts, under its name."""
        base = site.origin + "/"
        # The subcategories on the first page; the next ones list more posts.
        below = self._subcategories(site, where.id) if where.page == 1 else []
        items = [f"<li>{_a(href, name)}</li>" for href, name in below]
        offset = (where.page - 1) * LIMIT
        data = self._json(
            site,
            f"contents/posts/category/{quote(where.id)}"
            f"?limit={LIMIT}&offset={offset}&basic=1",
        )
        posts = data.get("posts") if isinstance(data, dict) else None
        listed = _dicts(posts.get("contents")) if isinstance(posts, dict) else []
        for post in listed:
            href = _address(base, post.get("url"))
            if href:
                items.append(f"<li>{_a(href, _text(post.get('title')) or href)}</li>")
        pages = posts.get("pages") if isinstance(posts, dict) else None
        total = _count(pages.get("itemCount")) if isinstance(pages, dict) else 0
        more = ""
        if listed and offset + len(listed) < total:
            following = f"{url.split('?', 1)[0]}?page={where.page + 1}"
            more = _a(following, f"Następna strona ({where.page + 1})")
        name = self._name(site, where.id)
        title = " - ".join(
            dict.fromkeys(x for x in [name, *self._trail(site, where.id)] if x)
        )
        heading = f"<h1>{html.escape(name)}</h1>" if name else ""
        return _page(url, title, f"{heading}<ul>{''.join(items)}</ul>{more}")

    def _post(self, site: _Site, where: Route, url: str) -> HttpResult:
        """A post: its declarations a row a declarant, else its text; its
        attachments; under its title and the categories above it."""
        data = self._json(site, f"contents/posts/{quote(where.id)}")
        found = _dicts(data.get("posts")) if isinstance(data, dict) else []
        if not found:
            return HttpResult(url, 404, "text/html", b"", "no such post in the API")
        post = found[0]
        base = site.origin + "/"
        title = _text(post.get("title"))
        # The categories above it, the BIP's own first: the way back, and its
        # trail in the title, nearest first.
        chain = _dicts(post.get("all_categories"))
        with self._lock:
            for i, category in enumerate(chain):
                ident = str(category.get("id") or "")
                parent = str(chain[i - 1].get("id") or "") if i else ""
                if ident.isdigit():
                    site.categories.setdefault(
                        ident, (_text(category.get("name")), parent)
                    )
        trail = [_text(c.get("name")) for c in reversed(chain)]
        back = []
        for category in chain:
            href = _address(base, category.get("url"))
            if href:
                back.append(_a(href, _text(category.get("name")) or href))
        table = _declarations(base, post)
        # A declarations post's text is its preamble, no declarant's: the blank
        # forms ("do pobrania tutaj"), the data-protection notices, and the
        # staff who blacked out the addresses, by name.
        text = "" if table else post.get("content_app") or post.get("content") or ""
        body = (
            f"<h1>{html.escape(title)}</h1><p>{' '.join(back)}</p>"
            f"{table}{_attachments(base, post)}<div>{text}</div>"
        )
        return _page(
            url, " - ".join(dict.fromkeys(x for x in [title, *trail] if x)), body
        )


def _declarations(base: str, post: dict[str, Any]) -> str:
    """A declarations post's rows as a table: name, position, files. Not who
    entered them (``responsible_person``, ``insert_author``): the app's
    "Metryczka" names staff, not the declarant."""
    extended = post.get("extended_data")
    rows = _dicts(extended.get("declarations")) if isinstance(extended, dict) else []
    out = []
    for row in rows:
        files = []
        for key in _FILES:
            item = row.get(key)
            if not isinstance(item, dict):
                continue
            href = _address(base, item.get("url"))
            if href:
                files.append(_a(href, _text(item.get("title")) or "Pobierz plik"))
        if files:
            out.append(
                f"<tr><td>{html.escape(_text(row.get('declarations_name')))}</td>"
                f"<td>{html.escape(_text(row.get('declarations_position')))}</td>"
                f"<td>{' '.join(files)}</td></tr>"
            )
    if not out:
        return ""
    return (
        f'<table class="{_NAMED}"><tr><th>Nazwisko i imię</th><th>Stanowisko</th>'
        f"<th>Do pobrania</th></tr>{''.join(out)}</table>"
    )


def _attachments(base: str, post: dict[str, Any]) -> str:
    """A post's attachments, those the app shows: with a title and an address
    (a table post's rows are lists, no files)."""
    files = []
    for item in _dicts(post.get("attachments")):
        title = _text(item.get("title"))
        href = _address(base, item.get("url") or item.get("name"))
        if title and href:
            files.append(f"<li>{_a(href, title)}</li>")
    return f"<h2>Załączniki</h2><ul>{''.join(files)}</ul>" if files else ""
