"""The BIP an office's website links to.

Where neither list has a unit's BIP, its walk starts from the office's website
in the dane.gov.pl catalogue and the BIP that page links (`PeopleSearch._roots`).
Until 11-13 a link counted when its own words said "BIP" or "Biuletyn
Informacji Publicznej", or when one label of its host was "bip"; 33 of the 107
units of round 1 that walked their website had a link that missed (~140
candidacies), and others no link at all on their first page:

- a logo for its label, which a link's words never carry: Brzeziny's
  ``<a href="https://www.powiat-brzeziny.4bip.pl/..."><img
  src=".../Logo_BIP_uproszczone.svg" alt=""></a>``, Stary Dzierzgoń's
  ``bip.png`` to ug.starydzierzgon.samorzady.pl, Iłowa's ``bip.svg`` to
  ilowa.info.pl;
- a host that says BIP inside a label: 4bip, ibip, e-bip, rbip, bipgmina,
  biuletyn.net (Szczawno-Zdrój's um.szczawnozdroj.ibip.wroc.pl: 0 of 8 found,
  7 from it);
- a splash page whose BIP is one page down (www.ostrowmaz.pl's
  /dla-mieszkanca, 0 found of 16): `inner_links`;
- a page that only sends the browser on, ``<meta http-equiv="refresh">``
  (Kłodawa's to its samorzad.gov.pl site, whose BIP link found 3 of 3):
  `refresh`.

A website links its subordinate bodies' BIPs too, a care home's, a culture
centre's, a road authority's, and their staff file declarations: a walk there
credits a namesake's. `bips` puts the BIP a page links as its own first and
never offers another body's.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass, field
from urllib.parse import unquote, urljoin, urlsplit

from bs4 import BeautifulSoup, Tag

from scrapers.bip.classify import host_of, is_low_value_url, normalize_url
from scrapers.bip.people import DECLARATION, fold, is_file_link
from scrapers.bip.units import scope_of
from scrapers.common.links import decode_html, extract_link_contexts

#: Hosts no unit's BIP lives on, though a unit's website may link to them.
NOT_A_UNITS_BIP = frozenset(
    {"bip.gov.pl", "gov.pl", "epuap.gov.pl", "obywatel.gov.pl", "biznes.gov.pl"}
)
#: Words that say BIP: the abbreviation, or its name in any case ("Link do
#: Biuletynu Informacji Publicznej").
SAYS_BIP = re.compile(r"(?:^| )bip(?: |$)|biuletyn\w* informacji publicznej")
#: Another body's host: a care home (dps), a welfare centre (gops, mops), a
#: culture or sports centre (gok, mosir, moksir), shared services (cuw, cus,
#: zeas), a road authority (zdp, pzd), a labour office (pup), a school, a
#: library, a utility. None of these is in a unit's name (TERC), and of the
#: gov.pl registry's 1,133 offices one stands on such a host: Niegowa's
#: niegowa.naszgok.pl, on a culture centres' platform (11-13).
OTHER_BODY = re.compile(
    r"dps|ops|gok|sir|cuw|cus|zeas|zdp|zdw|pzd|mzd|pup|pcpr|pinb|bibliot|gbp|mbp"
    r"|szkol|sp\d|zs\d|zsp|liceum|edu|oswiat|zlob|zgk|zgm|zwik|pgk|tbs|wodoc"
    r"|komunal|kultur|gck|sport|muze|straz|wtz|sds|ppp|spzoz|szpital|policj"
)
#: A BIP's pages about itself, no start: who edits it ("Redakcja BIP"), how to
#: use it, its accessibility statement. On samorzad.gov.pl Grodzisko Dolne's
#: "Redakcja BIP" was one of the three links taken, and its archive BIP, where
#: its declarations are, was left out (11-13).
_ABOUT_THE_BIP = re.compile(r"redakcj|instrukcj|deklaracj")
#: Where a lazy image keeps its file until a script shows it: Szczawno-Zdrój's
#: ``data-orig-src`` under an empty SVG.
_SOURCES = ("src", "data-src", "data-orig-src", "data-lazy-src")
#: The pages one level down read for a website's BIP at most.
INNER_PAGES = 5
#: A link to a file, a picture or a feed: no page a BIP starts from.
_FILE = re.compile(
    r"\.(pdf|docx?|odt|rtf|xlsx?|ods|jpe?g|png|gif|svg|webp|tiff?|zip|7z|rar|xml)"
    r"(?:$|[?#])",
    re.I,
)
#: Words, a picture, a host: how sure a link to a BIP is that it is one.
WORDS, PICTURE, HOST = 0, 1, 2


@dataclass
class _Bip:
    """A page's links to one BIP: a host, or a shared host's unit path."""

    host: str
    scope: str
    first: int
    #: Every link to it, and by the surest each one says BIP (`WORDS`...).
    links: dict[str, int] = field(default_factory=dict)

    def sure(self) -> int:
        return min(self.links.values())


def bip_host(host: str) -> bool:
    """Whether a host says BIP in one of its labels: bip.x.pl, 4bip, e-bip,
    bipgmina, biuletyn.net, e-biuletyn."""
    return any("bip" in label or "biuletyn" in label for label in host.split("."))


def _image_says(anchor: Tag) -> bool:
    """Whether a link is a picture that says BIP: an image's alt or title in
    words, or its file's name ("Logo_BIP_uproszczone.svg", "bip@2x.png"). Not
    a file name that only spells it out: Kamieniec Ząbkowicki's
    "Deklaracja-dostępności-Biuletynu-Informacji-Publicznej_.png" links
    dziennikustaw.gov.pl."""
    for image in anchor.find_all("img"):
        if not isinstance(image, Tag):
            continue
        words = fold(f"{image.get('alt') or ''} {image.get('title') or ''}")
        if SAYS_BIP.search(words):
            return True
        for source in _SOURCES:
            path = urlsplit(str(image.get(source) or "")).path
            if "bip" in unquote(path.rsplit("/", 1)[-1]).lower():
                return True
    return False


def _said(content: bytes, url: str, content_type: str) -> tuple[set[str], set[str]]:
    """The addresses of the page's links whose title or aria-label says BIP,
    and of those whose image does (`_image_says`)."""
    soup = BeautifulSoup(decode_html(content, content_type), "lxml")
    base = soup.find("base", href=True)
    if isinstance(base, Tag) and str(base.get("href") or "").strip():
        url = urljoin(url, str(base.get("href")).strip())
    worded: set[str] = set()
    pictured: set[str] = set()
    for anchor in soup.find_all("a", href=True):
        if not isinstance(anchor, Tag):
            continue
        try:
            target = urljoin(url, str(anchor.get("href") or "").strip()).split("#")[0]
        except ValueError:
            continue
        label = fold(f"{anchor.get('title') or ''} {anchor.get('aria-label') or ''}")
        if SAYS_BIP.search(label):
            worded.add(target)
        if _image_says(anchor):
            pictured.add(target)
    return worded, pictured


def _page_like(url: str) -> bool:
    """An http address that is no file, picture nor feed."""
    return (
        url.startswith(("http://", "https://"))
        and not _FILE.search(url)
        and not is_file_link(url)
    )


@dataclass(frozen=True)
class Bip:
    """A BIP a page links: its links, the surest first, and whether they are
    the website's own pages (a page of a plain website, not of a portal of BIPs
    such as samorzad.gov.pl)."""

    links: list[str]
    own: bool


def bips(
    content: bytes, url: str, content_type: str, shared_hosts: set[str]
) -> list[Bip]:
    """The BIPs a page links, the one it links as its own first; [] for none.

    A BIP (a host, or a shared host's unit path) is one when a link to it says
    BIP in words, or, on another host than the page, by its picture
    (`_image_says`) or its host's name (`bip_host`); never another body's
    (`OTHER_BODY`) nor its own page about itself (`_ABOUT_THE_BIP`). First:

    - not the website's own pages: Radziłów's "Biuletyn Informacji Publicznej"
      is a page of its website that links its BIP. On a portal of BIPs a
      unit's own pages are its BIP: samorzad.gov.pl's;
    - the surest: words over a picture over a host's name. Stopnica's words
      "strony BiP" over another link's "Logo Bip" picture, its council's
      video archive; Somianka's "Przejdź do serwisu Biuletyn Informacji
      Publicznej" on samorzad.gov.pl over its old BIP, under "Nieodpłatna
      pomoc prawna";
    - on another host: Grodzisko Dolne's banner "BIP" to its archive BIP, which
      holds its declarations, over its samorzad.gov.pl BIP;
    - on the page's own unit path, of a shared host's;
    - linked most: powiat częstochowski's website links
      www.powiat-czestochowski.4bip.pl 29 times, its care home's
      dpsblachownia.4bip.pl once;
    - linked first.

    On another host every link to it counts; on the page's own those that say
    BIP in words.
    """
    _, links = extract_link_contexts(content, url, content_type)
    worded, pictured = _said(content, url, content_type)
    home, here = host_of(url), scope_of(url, shared_hosts)
    found: dict[str, _Bip] = {}
    for index, link in enumerate(links):
        host = host_of(link.url)
        if (
            not host
            or host in NOT_A_UNITS_BIP
            or not _page_like(link.url)
            or _ABOUT_THE_BIP.search(fold(link.anchor))
        ):
            continue
        if SAYS_BIP.search(fold(link.anchor)) or link.url in worded:
            sure = WORDS
        elif host == home:
            continue
        else:
            sure = PICTURE if link.url in pictured else HOST
        scope = scope_of(link.url, shared_hosts)
        bip = found.setdefault(scope, _Bip(host, scope, index))
        bip.links[link.url] = min(sure, bip.links.get(link.url, sure))
    plain = home not in shared_hosts
    ranked = sorted(
        (
            b
            for b in found.values()
            if (b.sure() < HOST or bip_host(b.host)) and not OTHER_BODY.search(b.host)
        ),
        key=lambda b: (
            plain and b.host == home,
            b.sure(),
            b.host == home,
            b.scope != here,
            -len(b.links),
            b.first,
        ),
    )
    return [Bip(_starts(b.links), plain and b.host == home) for b in ranked]


def _starts(links: dict[str, int]) -> list[str]:
    """A BIP's links, the surest first; one page linked with its slash and
    without once (Głuchołazy's website links both)."""
    starts: dict[str, str] = {}
    for link in sorted(links, key=links.__getitem__):
        starts.setdefault(normalize_url(link).rstrip("/"), link)
    return list(starts.values())


def bip_links(
    content: bytes, url: str, content_type: str, shared_hosts: set[str]
) -> list[str]:
    """The links of the BIP a page links as its own (`bips`); [] for none."""
    found = bips(content, url, content_type, shared_hosts)
    return found[0].links if found else []


def keeps_declarations(content: bytes, url: str, content_type: str) -> bool:
    """Whether a page links declarations on its own host: a website that does
    keeps its BIP on it (Burzenin's /bip), one that does not only links it
    (Hrubieszów's /bip lists ughrubieszow.bip.lubelskie.pl and its schools')."""
    _, links = extract_link_contexts(content, url, content_type)
    home = host_of(url)
    return any(
        host_of(link.url) == home and DECLARATION.search(fold(link.anchor))
        for link in links
    )


def inner_links(
    content: bytes, url: str, content_type: str, shared_hosts: set[str]
) -> list[tuple[str, bool]]:
    """The pages a website's first page links on its own host (a shared host's:
    under its own unit path), to look one level down for its BIP when it links
    none: (address, whether the link says BIP), those that do first (Kamieniec
    Ząbkowicki's logo for its "/biuletyn-informacji-publicznych/" page), then as
    linked, `INNER_PAGES` at most."""
    _, links = extract_link_contexts(content, url, content_type)
    worded, pictured = _said(content, url, content_type)
    shown = worded | pictured
    here, page = scope_of(url, shared_hosts), normalize_url(url).rstrip("/")
    found: list[tuple[str, bool]] = []
    for link in links:
        if (
            scope_of(link.url, shared_hosts) != here
            or not _page_like(link.url)
            or is_low_value_url(link.url)
            or _ABOUT_THE_BIP.search(fold(link.anchor))
            or "/cdn-cgi/" in link.url
            or normalize_url(link.url).rstrip("/") == page
        ):
            continue
        words = f"{fold(link.anchor)} {fold(unquote(urlsplit(link.url).path))}"
        found.append(
            (link.url, link.url in shown or "bip" in words or "biuletyn" in words)
        )
    return sorted(found, key=lambda x: not x[1])[:INNER_PAGES]


_META = re.compile(r"<meta\b[^>]*>", re.I)
_ATTRIBUTE = re.compile(r"""([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))""")
_NOSCRIPT = re.compile(r"<noscript\b.*?</noscript\s*>", re.I | re.S)
_REFRESH_URL = re.compile(r"^\s*[\d.]*\s*[;,]?\s*(?:url\s*=\s*)?(.*)$", re.I | re.S)


def refresh(content: bytes, url: str) -> str:
    """Where a ``<meta http-equiv="refresh" content="0; url=...">`` sends the
    page, as an address; "" when it sends it nowhere else (powmiedzy.nazwa.pl
    sends it to itself). Kłodawa's and Somianka's websites are that tag alone,
    to their samorzad.gov.pl sites; Limanowa's sends it on after 10 seconds of
    "Nasz nowy adres to": eight units' walks read that page and stopped
    (11-13). Not one inside ``<noscript>``: that is for a browser without
    scripts."""
    head = _NOSCRIPT.sub("", content[:20_000].decode("utf-8", "replace"))
    for tag in _META.findall(head):
        attributes = {
            m.group(1).lower(): html.unescape(
                next((v for v in m.groups()[1:] if v is not None), "")
            )
            for m in _ATTRIBUTE.finditer(tag)
        }
        if attributes.get("http-equiv", "").strip().lower() != "refresh":
            continue
        said = _REFRESH_URL.match(attributes.get("content", ""))
        target = said.group(1).strip().strip("'\"").strip() if said else ""
        if not target:
            continue
        try:
            absolute = urljoin(url, target)
        except ValueError:
            continue
        if absolute.startswith(("http://", "https://")) and normalize_url(
            absolute
        ).rstrip("/") != normalize_url(url).rstrip("/"):
            return absolute
    return ""
