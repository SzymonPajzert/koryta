"""Reading Madkom's BIPs through the JSON API their pages are drawn from.

Madkom's BIP platform serves bip.malopolska.pl, an AngularJS app with one
context per office (bip.malopolska.pl/umwm, /ugradziemice ...: 81 units of the
people mode on 10-30), and single-office hosts on its React app
(bip.gminaolawa.pl, bip.dolnyslask.pl, *.nv.pl ...). Every address answers the
same empty shell, and the browser draws the page from ``<origin>/api/``:

- ``contexts/<name>``: the office and the id of its menu (``default`` on a
  single-office host);
- ``menu/<id>``: the office's menu, unfolded down to section ``<id>``;
- ``menu/<id>/articles?limit&offset[&archived=true]``: a section's articles,
  whatever its type (a "D" section that holds subsections may list some too);
- ``articles/<id>``: an article, its text and its attachments.

Rendered, a page asks its host for the shell, ~10 of those calls and the
scripts, at one request a second, and the units of bip.malopolska.pl share
that one host: a day of walking. Read here a page costs one or two calls and
comes back as an HTML page the walk reads like any other: the menu's and the
section's links under their names, the article's text and its files. A page's
title carries the sections above it and the separator over them: on
bip.ugsiemiatkowo.nv.pl "Oświadczenia majątkowe" is only a separator above
"Rok 2025", whose article "Radni Gminy" holds files named by the councillor
alone.

Addresses are read as the app's router reads them (``process_path`` in its
bundle): ``[<context>,]<type>,<id>,<slug>.html`` with type ``m`` a section,
``o`` its archive, ``a`` an article, ``e`` a special page or a file; and the
old ``[<context>/]Article/[get/]id,<id>.html``.

Madkom lists the articles and files an office hides in robots.txt by their own
addresses, which no API call matches: ``umwm,a,<id>,artykul.html``,
``a,<id>.html``, ``a,<id>,<slug>.html``, ``Article/get/id,<id>.html`` (8,555 of
bip.malopolska.pl's 16,183 article rules on 10-30 named no office), and
``e,pobierz,get.html?id=<id>``. Every such address of an article or a file is
checked before an API call stands in for it, so the API reads nothing the
site's own pages would not let the crawler read.
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

from scrapers.bip.people import ASSETS, DECLARATION, fold
from scrapers.common.fetch import HttpResult

#: The walk's request (robots.txt, the host's rate, the fetch): a response, or
#: why there was none (``people.ROBOTS``, ``people.UNREACHABLE``).
Get = Callable[[str], "HttpResult | str"]
#: What `Madkom.page` answers for an article robots.txt hides: people.ROBOTS.
ROBOTS = "robots"

#: The app's resource types (``process_path``): an article, a section, an
#: article's version, a section's archive, a survey, a special page or file,
#: a preview.
_TYPES = frozenset("amvosep")
#: The old addresses' methods (``FullRouteTransformer``); any other is a section.
_OLD_METHODS = {"get": "a", "getOutdated": "o", "getVersion": "v", "index": "m"}
#: Articles asked for at once: the app asks for 10, the API gives 100.
LIMIT = 100
#: The AngularJS app's configuration, or the React app's hidden menu.
_SHELL = re.compile(rb"MadkomConfiguration|/e,kalkulator\.html")
#: A file in an article's text: the app links them as e,pobierz,get.html?id=N.
_TEXT_FILE = re.compile(
    r"""href=(["'])(?:https?://([^/"']+))?/?e,pobierz,get\.html\?id=(\d+)[^"']*\1"""
)
#: Probes of a host whose API failed in a way that may pass (a timeout, a 5xx)
#: before the run takes it for no Madkom host.
PROBES = 3


def is_shell(content: bytes) -> bool:
    """Whether a page is the shell one of Madkom's apps draws itself into."""
    return bool(_SHELL.search(content[:200_000]))


@dataclass(frozen=True)
class Route:
    """What an address shows in the app; ``kind`` "" for the office's start."""

    context: str
    kind: str = ""
    id: str = ""
    page: int = 1

    @property
    def prefix(self) -> str:
        """How the app's addresses for this context start."""
        return "" if self.context == "default" else self.context + ","


def route(url: str) -> Route | None:
    """``url`` as the app's router reads it; None for an address the app does
    not draw (its scripts and styles, the server's own pages)."""
    parts = urlsplit(url)
    path = unquote(parts.path).strip("/")
    page = parse_qs(parts.query).get("page", ["1"])[0]
    number = int(page) if page.isdigit() and int(page) > 0 else 1
    if not path:
        return Route("default", page=number)
    segments = path.split("/")
    if "Article" in segments:
        at = segments.index("Article")
        found = re.search(r"(?:^|/)id,(\d+)", path)
        if at > 1 or not found:
            return None
        method = segments[at + 1] if len(segments) > at + 2 else ""
        return Route(
            segments[0] if at == 1 else "default",
            _OLD_METHODS.get(method, "m"),
            found.group(1),
            number,
        )
    if len(segments) > 1:
        return None
    pieces = segments[0].split(",")
    if len(pieces) == 1:
        # On a shared host a bare name is an office's start; a dotted one a file.
        return None if "." in pieces[0] else Route(pieces[0], page=number)
    kind = ident = ""
    for piece in pieces:
        if len(piece) == 1 and not piece.isdigit():
            kind = piece
        elif piece.isdigit():
            ident = piece
    if kind not in _TYPES:
        return None
    context = "default" if pieces[0] in _TYPES else pieces[0]
    return Route(context, kind, ident, number)


def _slug(url: str) -> str:
    """The name in an app address: "ewa-lis" of ugx,a,101,ewa-lis.html."""
    last = unquote(urlsplit(url).path).rsplit("/", 1)[-1].split(",")[-1]
    name = last.removesuffix(".html")
    return "" if name.isdigit() or len(name) < 2 or name == last else name


def _origin(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}".lower()


@dataclass
class _Site:
    """One host running Madkom's app: where its API is, and its offices."""

    origin: str
    api: str
    contexts: dict[str, dict[str, Any]] = field(default_factory=dict)
    #: robots.txt keeps the crawler out of the API: every page is ROBOTS, as a
    #: browser drawing them would read the API all the same.
    blocked: bool = False
    #: By context, each menu node's separator: the "S" node before it among
    #: its siblings, as the app shows it above them.
    separators: dict[str, dict[str, str]] = field(default_factory=dict)


def _is_html(page: HttpResult) -> bool:
    head = page.content[:1000].lower()
    return "html" in page.content_type.lower() or b"<html" in head


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
    """A label as the app shows it: entities read, spaces folded."""
    return " ".join(html.unescape(str(value or "")).split())


def _a(href: str, text: str) -> str:
    return f'<a href="{html.escape(href)}">{html.escape(text)}</a>'


def _page(site: _Site, url: str, title: str, body: str) -> HttpResult:
    # The app's own base: an article's text links "ugx,a,5,x.html" from the root.
    page = (
        f'<html><head><base href="{html.escape(site.origin)}/">'
        f"<title>{html.escape(title)}</title></head><body>{body}</body></html>"
    )
    return HttpResult(url, 200, "text/html; charset=utf-8", page.encode("utf-8"))


def _title(name: str, path: list[dict[str, Any]], separators: list[str]) -> str:
    """``name``, the sections above it (the office's menu itself left out) and
    the separators over them: "Arkit Tadeusz - 2024 - 2029 - Radni Województwa
    - Oświadczenia majątkowe"."""
    above = [_text(p.get("name")) for p in path if p.get("parentId")]
    return " - ".join(dict.fromkeys(x for x in [_text(name), *above, *separators] if x))


def _branch(items: list[dict[str, Any]], ident: str) -> list[dict[str, Any]]:
    """The nodes from the menu's top down to ``ident``; [] when it is not there."""
    for item in items:
        if str(item.get("id")) == ident:
            return [item]
        below = _branch(item.get("children") or [], ident)
        if below:
            return [item, *below]
    return []


class Madkom:
    """The Madkom BIPs a run meets, read through their API (see the module).

    A host counts as Madkom's once a page of it was an app shell
    (`is_shell`) and its API answered (`probe`); from then on `page` draws its
    pages. Thread-safe: walks of different hosts share one."""

    def __init__(self, get: Get, allowed: Callable[[str], bool]) -> None:
        self.get = get
        #: robots.txt alone, for the addresses an API call stands in for.
        self.allowed = allowed
        self._sites: dict[str, _Site | None] = {}
        self._undecided: Counter[str] = Counter()
        #: A host's last probe answered "not now": what `busy` hands the walk.
        self._busy: dict[str, HttpResult] = {}
        self._lock = threading.Lock()

    def _site(self, url: str) -> _Site | None:
        with self._lock:
            return self._sites.get(_origin(url))

    def knows(self, url: str) -> bool:
        """Whether ``url``'s host is a Madkom BIP this run has probed."""
        return self._site(url) is not None

    def probe(self, page: HttpResult) -> bool:
        """Whether ``page``, as fetched, is one of Madkom's app shells and the
        API answers, for the page's office or else for the host's default one.
        The answer holds for the host the rest of the run, once it is sure: a
        page that is no shell, an API that answers, or one that answers
        neither. A failure that may pass leaves it to the host's next pages,
        `PROBES` at most."""
        origin = _origin(page.url)
        with self._lock:
            if origin in self._sites:
                return self._sites[origin] is not None
        if not _is_html(page):
            return False  # a file says nothing about the pages
        site: _Site | None = None
        if is_shell(page.content):
            where = route(page.url)
            if where is None:
                return False  # no office to ask the API for: a later page may say
            site = _Site(origin, origin + "/api/")
            answers: list[HttpResult | str] = []
            for name in dict.fromkeys([where.context, "default"]):
                try:
                    self._context(site, name)
                    break
                except _Failed as failed:
                    answers.append(failed.answer)
            else:
                if any(a == ROBOTS for a in answers):
                    site.blocked = True
                elif busy := next((a for a in answers if _not_now(a)), None):
                    with self._lock:  # no probe used up: the next page asks again
                        self._busy[origin] = busy  # type: ignore[assignment]
                    return False
                elif any(_passing(a) for a in answers):
                    with self._lock:
                        self._undecided[origin] += 1
                        if self._undecided[origin] < PROBES:
                            return False
                    site = None
                else:
                    site = None
        with self._lock:
            return self._sites.setdefault(origin, site) is not None

    def busy(self, url: str) -> HttpResult | None:
        """The "not now" the API gave ``url``'s host at its last probe, once."""
        with self._lock:
            return self._busy.pop(_origin(url), None)

    def page(self, url: str) -> HttpResult | str | None:
        """The page at ``url`` as the app draws it: an HTML page, the error an
        API call answered, or why there was no answer (robots.txt, the host
        down); None when the address is no page of the app's (a file, a
        script), which the walk fetches as it is."""
        site = self._site(url)
        where = route(url)
        if site is None or where is None:
            return None
        if site.blocked:
            return ROBOTS
        try:
            if not where.kind:
                return self._start(site, where, url)
            if where.kind in ("m", "o") and where.id:
                return self._section(site, where, url)
            if where.kind == "a" and where.id:
                if not self._article_allowed(site, where.prefix, where.id, _slug(url)):
                    return ROBOTS
                return self._article(site, where, url)
        except _Failed as failed:
            return failed.answer
        if where.kind == "e" and "pobierz" in url:
            return None  # a file: the walk downloads it
        # A survey, a form, an old version: nothing a declaration is behind.
        return _page(site, url, "", "")

    # -- the API ---------------------------------------------------------------
    def _json(self, url: str) -> Any:
        answer = self.get(url)
        if isinstance(answer, str) or not answer.ok:
            raise _Failed(answer)
        try:
            return json.loads(answer.content)
        except ValueError:
            raise _Failed(
                HttpResult(url, answer.status, answer.content_type, b"", "not JSON")
            ) from None

    def _context(self, site: _Site, name: str) -> dict[str, Any]:
        with self._lock:
            known = site.contexts.get(name)
        if known is not None:
            return known
        data = self._json(site.api + "contexts/" + quote(name))
        if not isinstance(data, dict) or not data.get("defaultMenuId"):
            raise _Failed(
                HttpResult(site.api, 404, "", b"", f"no office {name!r} in the API")
            )
        with self._lock:
            site.contexts[name] = data
        return data

    def _menu(self, site: _Site, context: str, ident: str) -> list[dict[str, Any]]:
        data = self._json(site.api + "menu/" + quote(ident))
        menu = (
            [x for x in data if isinstance(x, dict)] if isinstance(data, list) else []
        )
        self._remember(site, context, menu)
        return menu

    def _remember(self, site: _Site, context: str, menu: list[dict[str, Any]]) -> None:
        """Each node's separator, from a menu answer."""
        heads: dict[str, str] = {}

        def walk(nodes: list[dict[str, Any]]) -> None:
            over = ""
            for node in nodes:
                if node.get("type") == "S":
                    over = _text(node.get("name"))
                else:
                    heads[str(node.get("id"))] = over
                walk(node.get("children") or [])

        walk(menu)
        with self._lock:
            site.separators.setdefault(context, {}).update(heads)

    def _separators(self, site: _Site, context: str, ids: list[str]) -> list[str]:
        """The separators over the nodes ``ids`` that speak of declarations,
        the nearest first: a page's title says whose its files are, and a
        separator may name the mayor over every page below it."""
        with self._lock:
            heads = site.separators.get(context, {})
            found = [heads[i] for i in ids if heads.get(i)]
        return [
            h for h in found if DECLARATION.search(fold(h)) or ASSETS.search(fold(h))
        ]

    # -- robots.txt for what the API stands in for ------------------------------
    def _article_allowed(
        self, site: _Site, prefix: str, ident: str, slug: str = ""
    ) -> bool:
        """Whether robots.txt lets the crawler read article ``ident`` by every
        address the app has for it, with the office and without; robots.txt
        matches by prefix, so each is checked whole."""
        names = [f"a,{ident},artykul.html", f"a,{ident}.html"]
        if slug:
            names.append(f"a,{ident},{slug}.html")
        paths = [*names, f"Article/get/id,{ident}.html"]
        if prefix:
            context = prefix.rstrip(",")
            paths += [prefix + n for n in names]
            paths.append(f"{context}/Article/get/id,{ident}.html")
        return all(
            self.allowed(f"{site.origin}/{path}") for path in dict.fromkeys(paths)
        )

    def _file_allowed(self, site: _Site, ident: str) -> bool:
        return all(
            self.allowed(f"{site.origin}/{path}")
            for path in (f"e,pobierz,get.html?id={ident}", f"api/files/{ident}")
        )

    def _file(self, site: _Site, ident: str) -> str:
        """The address the walk downloads a file by, the app's own."""
        return f"{site.origin}/api/files/{ident}"

    def _start_url(self, site: _Site, where: Route) -> str:
        return site.origin + "/" + ("" if where.context == "default" else where.context)

    # -- pages -------------------------------------------------------------------
    def _start(self, site: _Site, where: Route, url: str) -> HttpResult:
        office = self._context(site, where.context)
        menu = self._menu(site, where.context, str(office["defaultMenuId"]))
        name = _text(office.get("unitFullName") or office.get("siteTitle"))
        body = f"<h1>{html.escape(name)}</h1>{self._nav(site, menu)}"
        return _page(site, url, name, body)

    def _section(self, site: _Site, where: Route, url: str) -> HttpResult:
        archive = where.kind == "o"
        # The archive's menu is the section's: its page already showed it.
        menu = [] if archive else self._menu(site, where.context, where.id)
        branch = _branch(menu, where.id)
        node = branch[-1] if branch else None
        name = _text(node.get("name")) if node else ""
        ids = [str(n.get("id")) for n in reversed(branch)]
        parts = [self._nav(site, menu)] if menu else []
        path: list[dict[str, Any]] = []
        if node is None or node.get("type") != "S":
            offset = (where.page - 1) * LIMIT
            query = f"limit={LIMIT}&offset={offset}" + (
                "&archived=true" if archive else ""
            )
            try:
                listing = self._json(
                    f"{site.api}menu/{quote(where.id)}/articles?{query}"
                )
            except _Failed as failed:
                if not menu or _not_now(failed.answer):
                    raise
                listing = {}  # the menu drawn still leads on
            if not isinstance(listing, dict):
                listing = {}
            path = [p for p in listing.get("menuPath") or [] if isinstance(p, dict)]
            name = name or (_text(path[0].get("name")) if path else "")
            ids = ids or [str(p.get("id")) for p in path]
            parts.append(self._articles(site, where, url, listing, archive, name))
        title = _title(
            name,
            path[1:]
            or [{"name": n.get("name"), "parentId": 1} for n in branch[-2::-1]],
            self._separators(site, where.context, ids),
        )
        heading = f"<h1>{html.escape(name + (' (archiwum)' if archive else ''))}</h1>"
        return _page(site, url, title, heading + "".join(parts))

    def _articles(
        self,
        site: _Site,
        where: Route,
        url: str,
        listing: dict[str, Any],
        archive: bool,
        name: str,
    ) -> str:
        rows = []
        listed = listing.get("articles") or []
        main = str(listing.get("mainArticleId") or "")
        if (
            main.isdigit()
            and main not in {str(a.get("id")) for a in listed}
            and self._article_allowed(site, where.prefix, main)
        ):
            # The app draws the section's main article above its list.
            href = f"{site.origin}/{where.prefix}a,{main},artykul.html"
            rows.append(f"<li>{_a(href, name or 'Artykuł')}</li>")
        for article in listed:
            ident, link = str(article.get("id") or ""), article.get("link")
            if not ident.isdigit() or not link:
                continue
            href = urljoin(site.origin + "/", str(link))
            if not self._article_allowed(site, where.prefix, ident, _slug(href)):
                continue
            fields = {
                f.get("alias"): f.get("value") for f in article.get("aliasFields") or []
            }
            columns = {
                f.get("fieldId"): f.get("value")
                for f in article.get("columnFields") or []
            }
            title = _text(fields.get("title") or columns.get("title"))
            lead = _text(fields.get("lead"))
            rows.append(f"<li>{_a(href, title or href)} {html.escape(lead)}</li>")
        total = listing.get("total")
        offset = listing.get("offset") or 0
        shown = len(listing.get("articles") or [])
        more = ""
        if isinstance(total, int) and shown and offset + shown < total:
            base = url.split("?", 1)[0]
            more = _a(
                f"{base}?page={where.page + 1}", f"Następna strona ({where.page + 1})"
            )
        older = listing.get("outdatedListLink")
        if listing.get("hasArchived") and older and not archive:
            more += _a(urljoin(site.origin + "/", str(older)), "Archiwum")
        return f"<ul>{''.join(rows)}</ul>{more}"

    def _article(self, site: _Site, where: Route, url: str) -> HttpResult:
        data = self._json(site.api + "articles/" + quote(where.id))
        if not isinstance(data, dict):
            data = {}
        title = _text(data.get("title"))
        path = [p for p in data.get("mainMenuPath") or [] if isinstance(p, dict)]
        nav = ""
        with self._lock:
            known = where.context in site.separators
        if not known and str(data.get("mainMenuId") or "").isdigit():
            # The first page of this office is an article (an old address as the
            # unit's start): the app draws the office's menu beside it.
            try:
                nav = self._nav(
                    site, self._menu(site, where.context, str(data["mainMenuId"]))
                )
            except _Failed:
                pass

        own = urlsplit(site.origin).netloc

        def file_link(found: re.Match[str]) -> str:
            host, ident = (found.group(2) or own).lower(), found.group(3)
            if host != own:
                return found.group(0)  # another host's file: fetched as linked
            if not self._file_allowed(site, ident):
                return 'href=""'
            return f'href="{self._file(site, ident)}"'

        text = _TEXT_FILE.sub(file_link, str(data.get("content") or ""))
        files = []
        for attachment in data.get("attachments") or []:
            ident = str(attachment.get("id") or "")
            if (
                not ident.isdigit()
                or attachment.get("deleted")
                or not attachment.get("downloadable", True)
                or not self._file_allowed(site, ident)
            ):
                continue
            name = _text(attachment.get("name"))
            extension = _text(attachment.get("extension"))
            if extension and not name.lower().endswith("." + extension.lower()):
                name = f"{name} ({extension})"
            files.append(f"<li>{_a(self._file(site, ident), name or ident)}</li>")
        # The attachments first: a link the text repeats keeps the first label,
        # and an attachment's name says whose file it is more often than the text.
        attachments = f"<h2>Załączniki</h2><ul>{''.join(files)}</ul>" if files else ""
        # The way back the app shows: the sections above, and the office's start.
        with self._lock:
            office = _text(site.contexts.get(where.context, {}).get("unitFullName"))
        back = [
            _a(urljoin(site.origin + "/", str(p["url"])), _text(p.get("name")))
            for p in path
            if p.get("parentId") and p.get("url")
        ] + [_a(self._start_url(site, where), office or "Strona główna")]
        ids = [str(p.get("id")) for p in path]
        return _page(
            site,
            url,
            _title(title, path, self._separators(site, where.context, ids)),
            f"<h1>{html.escape(title)}</h1>{attachments}<div>{text}</div>"
            f"<nav>{' '.join(back)}</nav>{nav}",
        )

    def _nav(self, site: _Site, items: list[dict[str, Any]]) -> str:
        """The office's menu as the app shows it beside every page: its
        sections, the branch down to the page's own unfolded."""

        def tree(nodes: list[dict[str, Any]]) -> str:
            out = []
            for node in nodes:
                name = _text(node.get("name"))
                href = node.get("redirectUrl") or node.get("link")
                if node.get("type") == "S" or not href:
                    item = f"<h2>{html.escape(name)}</h2>"
                else:
                    target = urljoin(site.origin + "/", str(href))
                    found = route(target)
                    if (
                        found is not None
                        and found.kind == "a"
                        and found.id
                        and not self._article_allowed(
                            site, found.prefix, found.id, _slug(target)
                        )
                    ):
                        continue
                    item = _a(target, name)
                children = node.get("children") or []
                out.append(f"<li>{item}{tree(children) if children else ''}</li>")
            return f"<ul>{''.join(out)}</ul>"

        return f"<nav>{tree(items)}</nav>"
