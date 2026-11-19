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

Round 1's fix (11-13) let words or a picture on any host outrank a host that
says BIP, and a theme's or a vendor's labels won: Czarnocin's theme labels its
session videos on esesja.tv "Łącze zewnętrzne do strony BiP" like its BIP,
Gorzów Śląski's footer credits "Strony www i Biuletyny Informacji Publicznej"
to digitalholding.pl, Dzikowiec's hidden "BIP" menu item links onet.pl. And it
walked one BIP where an office has two, an old and a new one, and its
declarations were on the other: Ustroń, Rogów, Oborniki, Brudzew (11-18). Now
a host that says BIP and names the unit's place comes first (`_tier`), another
host counts only by the link's own words or its picture's file name where it
names the place, and the office's other BIPs the page links are walked beside
it (`Bip.also`).
"""

from __future__ import annotations

import html
import re
from collections.abc import Iterable
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
#: Words that say BIP: the abbreviation, or its name in the singular in any
#: case ("Link do Biuletynu Informacji Publicznej"); not a vendor's plural,
#: "Strony www i Biuletyny Informacji Publicznej" (11-18).
SAYS_BIP = re.compile(r"(?:^| )bip(?: |$)|biuletyn(?:u|em|ie|a)? informacji publicznej")
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
#: its declarations are, was left out (11-13). Its host's first page is one:
#: Ustroń's website links its BIP only as "Deklaracja Dostępności" (11-18).
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
#: How a link says it leads to a BIP: its words, its title or aria-label, its
#: picture's file name, its picture's alt or title.
TEXT, LABEL, FILE, ALT = "text", "label", "file", "alt"
#: Words of a name or a host that name no place (`place_stems`): an office's,
#: a host's.
_NO_PLACE = frozenset(
    "www gmina gminy gminie gminna miasto miasta miejski miejska miejskiej urzad"
    " urzedu starostwo starostwa powiat powiatu powiatowe powiatowy wojewodztwo"
    " info home samorzad samorzady umig uzdrowiskowej przy".split()
)
#: Words many places' names share, and the beginnings of such words: Wielka
#: Wieś, Nowe Brzesko, Rabka-Zdrój, Wysokie Mazowieckie.
_SHARED_WORDS = frozenset(
    "nowe nowy nowa nowej nowym nowego stary stare stara starym maly mala male"
    " malym malej duzy duza duze dolna dolny dolne dolnej gorna gorny gorne"
    " gornej wies wsi".split()
)
_SHARED_STARTS = tuple(
    "wielk mazow podla slask kujaw pomor tatrz zdroj kolon osada krole lubusk"
    " lubelsk lodzk opolsk malopol dolnosl podkarpac swietokrz warmin mazursk"
    " zachodniopom".split()
)
#: Words a BIP's host may carry before the place it names and still be the
#: office's own (`_offices`): bip.ug.hajnowka..., archiwumbip.paslek.pl,
#: oldbip.czarnkowgmina.pl, mst-wabrzezno..., splukow.bip.e-zeto.eu.
_OFFICE_WORDS = tuple(
    "archiwum arch old bip biuletyn www umig ugm ug um gmina gminy"
    " gm miasto mst starostwo spow sp st powiat pow".split()
)
_GMINA_WORDS = frozenset("umig ugm ug um gmina gminy gm miasto mst".split())
_POWIAT_WORDS = frozenset("starostwo spow sp st powiat pow".split())
#: A link's words that name another body than the office: its utility, its
#: shared services, a school, a clinic (`_offices`).
_OTHER_BODY_WORDS = re.compile(
    r"\b(?:zaklad|centrum|zespol|osrodek|inspektorat|szkol|przedszkol|przychodni"
    r"|bibliotek|dom pomocy|zlob|cuw|cus|gops|mops|mopr|gok|zgk|zuk|zbk|spzoz)"
)
#: What a host label may start with before the place it names: uggozdowo,
#: gminadzikowiec, umtarnogrod, spkolobrzeg, powiatkoscian.
_PLACE_PREFIX = re.compile(
    r"^(?:gmina|gminy|powiat|starostwo|miasto|umig|ugm|ug|um|mst|sp)"
)


@dataclass
class _Bip:
    """A page's links to one BIP: a host, or a shared host's unit path."""

    host: str
    scope: str
    first: int
    #: Every link to it, by how sure it is (`_sure`).
    links: dict[str, int] = field(default_factory=dict)
    #: What its links say (`TEXT`...).
    signs: set[str] = field(default_factory=set)
    #: Its links' words.
    words: list[str] = field(default_factory=list)


def bip_host(host: str) -> bool:
    """Whether a host says BIP in one of its labels: bip.x.pl, 4bip, e-bip,
    bipgmina, biuletyn.net, e-biuletyn."""
    return any("bip" in label or "biuletyn" in label for label in host.split("."))


def _image_signs(anchor: Tag) -> set[str]:
    """How a link's picture says BIP: its file's name ("Logo_BIP_uproszczone
    .svg", "bip@2x.png"), its alt or title in words. Not a file name that only
    spells it out: Kamieniec Ząbkowicki's "Deklaracja-dostępności-Biuletynu-
    Informacji-Publicznej_.png" links dziennikustaw.gov.pl."""
    signs: set[str] = set()
    for image in anchor.find_all("img"):
        if not isinstance(image, Tag):
            continue
        words = fold(f"{image.get('alt') or ''} {image.get('title') or ''}")
        if SAYS_BIP.search(words):
            signs.add(ALT)
        for source in _SOURCES:
            path = urlsplit(str(image.get(source) or "")).path
            if "bip" in unquote(path.rsplit("/", 1)[-1]).lower():
                signs.add(FILE)
    return signs


def _signs(content: bytes, url: str, content_type: str) -> dict[str, set[str]]:
    """How the page's links say BIP, by address: in their words (`TEXT`), their
    title or aria-label (`LABEL`), their picture (`_image_signs`)."""
    soup = BeautifulSoup(decode_html(content, content_type), "lxml")
    base = soup.find("base", href=True)
    if isinstance(base, Tag) and str(base.get("href") or "").strip():
        url = urljoin(url, str(base.get("href")).strip())
    found: dict[str, set[str]] = {}
    for anchor in soup.find_all("a", href=True):
        if not isinstance(anchor, Tag):
            continue
        try:
            target = urljoin(url, str(anchor.get("href") or "").strip()).split("#")[0]
        except ValueError:
            continue
        signs = found.setdefault(target, set())
        if SAYS_BIP.search(fold(anchor.get_text(" ", strip=True))):
            signs.add(TEXT)
        label = fold(f"{anchor.get('title') or ''} {anchor.get('aria-label') or ''}")
        if SAYS_BIP.search(label):
            signs.add(LABEL)
        signs |= _image_signs(anchor)
    return found


def _page_like(url: str) -> bool:
    """An http address that is no file, picture nor feed."""
    return (
        url.startswith(("http://", "https://"))
        and not _FILE.search(url)
        and not is_file_link(url)
    )


def place_stems(home: str, names: Iterable[str]) -> set[str]:
    """The places a website's host (a shared host's unit path too) and its
    offices' names name, as the first letters of each word, five of a long
    one and four of a short one, which a case ending leaves alone ("czarn" of
    czarnocin.com.pl, "sierp" of Starostwo Powiatowe w Sierpcu, "sacz" of
    Nowym Sączu), for `names_place`."""
    words = [
        _PLACE_PREFIX.sub("", label) if len(label) > 8 else label
        for label in fold(home).split()
    ]
    words += [word for name in names for word in fold(name).split()]
    return {
        word[: 5 if len(word) >= 7 else 4]
        for word in words
        if len(word) >= 4
        and word not in _NO_PLACE
        and word not in _SHARED_WORDS
        and not word.startswith(_SHARED_STARTS)
    }


def names_place(scope: str, stems: set[str]) -> bool:
    """Whether a host, or a shared host's unit path, names one of the places
    (`place_stems`): of the registry's 972 local offices, the 60 whose BIP's
    host does not say BIP all name their place in it or in their
    samorzad.gov.pl path (11-18). onet.pl, esesja.tv, digitalholding.pl name
    none."""
    flat = re.sub(r"[^a-z0-9]", "", scope.lower())
    return any(stem in flat for stem in stems)


#: Labels a host's own name ends in: bip.csw.pl is csw.pl's, bip.elk.gmina.pl
#: elk.gmina.pl's (`same_site`).
_SUFFIX_LABELS = frozenset(
    "pl com net org info gov edu eu biz waw ug um umig bip gmina powiat"
    " starostwo miasto".split()
)


def _site(host: str) -> str:
    labels = host.split(".")
    first = len(labels) - 1
    while first > 0 and labels[first] in _SUFFIX_LABELS:
        first -= 1
    return ".".join(labels[first:])


def same_site(host: str, home: str) -> bool:
    """Whether two hosts share their own name: a website's BIP under its
    domain names its place whatever it is called (powiat świecki's
    bip.csw.pl, powiat warszawski zachodni's bip.pwz.pl, 11-18)."""
    return _site(host) == _site(home)


def _tier(bip: _Bip, home: str, stems: set[str]) -> int | None:
    """How sure a BIP is that it is the unit's, 0 the surest; None for none.

    0. a host that says BIP (`bip_host`), its link or picture too, and names
       the unit's place (`names_place`, `same_site`);
    1. another host's words, where it names the place: Somianka's "Przejdź do
       serwisu Biuletyn Informacji Publicznej" on samorzad.gov.pl; or on a
       portal of BIPs the unit's own pages;
    2. another host's picture by its file's name, where it names the place:
       Stopnica's bip-big-3-1.png to stopnica.pl/bip/, where its theme's alt
       is "Logo Bip" on every icon, the council's session videos too, as its
       aria-label "strony BiP" is on Czarnocin's (11-18);
    3. a host that says BIP, its link or picture too, naming another place or
       none: Trąbki Wielkie's ugtr.bip.gov.pl; powiat sierpecki's website links
       its gminas' BIPs by their logos, its own BIP sierpc.starostwo.gov.pl by
       a picture (11-18);
    4. a host that says BIP alone, where it names the place: Somianka's old
       BIP, under "Nieodpłatna pomoc prawna";
    5. another host's picture by its alt, where it names the place.

    The website's own pages count by their words alone, a link's title or
    aria-label too. Another host that names no place of the unit's counts only
    when it says BIP and its link does too: Budzyń's website links powiat
    chodzieski's bip4.wokiss.pl/chodziezp for its "Nieodpłatna pomoc prawna",
    and a walk there credited a namesake's declaration (11-13).
    """
    if bip.host == home:
        return 1 if bip.signs & {TEXT, LABEL} else None
    named = names_place(bip.scope, stems) or same_site(bip.host, home)
    if bip_host(bip.host):
        if bip.signs:
            return 0 if named else 3
        return 4 if named else None
    if not named:
        return None
    if TEXT in bip.signs:
        return 1
    if FILE in bip.signs:
        return 2
    return 5 if ALT in bip.signs else None


def level_of(unit: str) -> str:
    """A unit's level by its TERYT: "powiat" (its gmina's digits 00), "gmina"
    (a gmina's or a city's), "" (a voivodeship's)."""
    if len(unit) != 6 or unit.endswith("0000"):
        return ""
    return "powiat" if unit.endswith("00") else "gmina"


def _cut(text: str, words: tuple[str, ...]) -> list[str] | None:
    """``text`` as ``words`` one after another, or None when it is not."""
    found: list[str] = []
    while text:
        word = next((w for w in words if text.startswith(w)), None)
        if word is None:
            digits = re.match(r"\d+", text)
            if digits is None:
                return None
            word = digits.group(0)
        found.append(word)
        text = text[len(word) :]
    return found


def _label(host: str) -> str:
    """A host's first label of three letters or more that is none of
    `_OFFICE_WORDS`: "ugtr" of ugtr.ssdip.bip.gov.pl and of ugtr.bip.gov.pl."""
    return next(
        (x for x in host.split(".") if len(x) > 2 and x not in _OFFICE_WORDS), ""
    )


def _offices(
    bip: _Bip, stems: set[str], names: set[str], level: str, first: str
) -> bool:
    """Whether a BIP is the office's own, an old, a new or an archive one,
    which a walk reads beside the one the page links first (on ``first``):
    its host says BIP and names the unit's place with nothing before the
    place but the office's words (`_OFFICE_WORDS`) or its name's, or starts
    with the first's own label (Trąbki Wielkie's ugtr.bip.gov.pl beside
    ugtr.ssdip.bip.gov.pl); it carries no word of the other level's office
    (a gmina's website links the powiat's bip.st.hajnowka.wrotapodlasia.pl)
    and its links' words name no other body. Not Warlubie's
    przychodnia-warlubie.bip.net.pl, Skierniewice's
    bip.moprskierniewice.nv.pl, Mędrzechów's bip.malopolska.pl/gopsmedrzechow,
    Raszków's raszkow.biuletyn.net under "Zakład Gospodarki Komunalnej"."""
    if not bip_host(bip.host) or (
        bip.words and all(_OTHER_BODY_WORDS.search(w) for w in bip.words)
    ):
        return False
    host, _, path = bip.scope.partition("/")
    tokens = [t for t in re.split(r"[^a-z0-9]+", path or host) if t]
    other = {"gmina": _POWIAT_WORDS, "powiat": _GMINA_WORDS}.get(level, frozenset())
    if other & set(tokens):
        return False
    if not path and (label := _label(host)) and label == _label(first):
        return True
    allowed = tuple(sorted({*_OFFICE_WORDS, *names}, key=len, reverse=True))
    before: list[str] = []
    for token in tokens:
        stem = next((s for s in stems if s in token), None)
        if stem is None:
            before.append(token)
            continue
        cut = _cut("".join([*before, token[: token.index(stem)]]), allowed)
        return cut is not None and not other & set(cut)
    return False


#: Words, or the start of a host's label, that say a BIP is an archive.
_ARCHIVE = re.compile(r"archiw")
_ARCHIVE_LABEL = re.compile(r"^(?:archiw|arch|old)")


def _archive(bip: _Bip) -> bool:
    """Whether a BIP is an old one kept for its documents: every link's words
    say archive (Rybno's BIP pages link e-bip.pl as "Archiwum BIP", and its
    BIP is the website's /bip/, 11-18), or its host's label does
    (archiwumbip.krasocin.com.pl, oldbip.czarnkowgmina.pl)."""
    if bip.words and all(_ARCHIVE.search(w) for w in bip.words):
        return True
    return any(_ARCHIVE_LABEL.match(x) for x in re.split(r"[.\-]", bip.host))


def _sure(signs: set[str]) -> int:
    """How sure one link is: words, a picture, a host."""
    if signs & {TEXT, LABEL}:
        return 0
    return 1 if signs & {FILE, ALT} else 2


def _scope_root(url: str, shared_hosts: set[str]) -> str:
    """The first page of the BIP ``url`` is on: its host's, or its unit path's
    on a shared host."""
    parts = urlsplit(url)
    _, _, path = scope_of(url, shared_hosts).partition("/")
    depth = len([s for s in path.split("/") if s])
    segments = [s for s in parts.path.split("/") if s][:depth]
    return f"{parts.scheme}://{parts.netloc}/" + "/".join(segments)


@dataclass(frozen=True)
class Bip:
    """A BIP a page links: its links, the surest first, whether they are the
    website's own pages (a page of a plain website, not of a portal of BIPs
    such as samorzad.gov.pl), whether it is the office's own BIP, which a walk
    reads beside the first (`_offices`), and whether it is an archive, which
    is never the first (`_archive`)."""

    links: list[str]
    own: bool
    also: bool = False
    archive: bool = False


def bips(
    content: bytes,
    url: str,
    content_type: str,
    shared_hosts: set[str],
    names: Iterable[str] = (),
    unit: str = "",
) -> list[Bip]:
    """The BIPs a page links, the one it links as its own first; [] for none.

    A BIP is a host, or a shared host's unit path, that its links say is one
    (`_tier`), never another body's (`OTHER_BODY`). A link to its pages about
    itself (`_ABOUT_THE_BIP`) stands for its first page. ``names`` are the
    unit's offices' names, which with the page's host say the unit's place
    (`place_stems`); ``unit`` its TERYT, whose level tells the other level's
    office (`_offices`). First:

    - not the website's own pages: Radziłów's "Biuletyn Informacji Publicznej"
      is a page of its website that links its BIP. On a portal of BIPs a
      unit's own pages are its BIP: samorzad.gov.pl's;
    - the surest (`_tier`);
    - on another host: Grodzisko Dolne's banner "BIP" to its archive BIP, which
      holds its declarations, over its samorzad.gov.pl BIP;
    - on the page's own unit path, of a shared host's;
    - linked most: powiat częstochowski's website links
      www.powiat-czestochowski.4bip.pl 29 times, its care home's
      dpsblachownia.4bip.pl once;
    - linked first.
    """
    _, links = extract_link_contexts(content, url, content_type)
    said = _signs(content, url, content_type)
    home, here = host_of(url), scope_of(url, shared_hosts)
    page = normalize_url(url).rstrip("/")
    found: dict[str, _Bip] = {}
    for index, link in enumerate(links):
        host = host_of(link.url)
        if not host or host in NOT_A_UNITS_BIP or not _page_like(link.url):
            continue
        signs = said.get(link.url, set())
        start = link.url
        if _ABOUT_THE_BIP.search(fold(link.anchor)):
            start = _scope_root(link.url, shared_hosts)
            if normalize_url(start).rstrip("/") == page:
                continue
        if host == home and not signs & {TEXT, LABEL}:
            continue
        scope = scope_of(link.url, shared_hosts)
        bip = found.setdefault(scope, _Bip(host, scope, index))
        bip.signs |= signs
        bip.links[start] = min(_sure(signs), bip.links.get(start, 2))
        if words := fold(link.anchor):
            bip.words.append(words)
    plain = home not in shared_hosts
    names = list(names)
    stems = place_stems(here, names)
    tiers = {
        scope: tier
        for scope, bip in found.items()
        if not OTHER_BODY.search(bip.scope)
        and (tier := _tier(bip, home, stems)) is not None
    }
    ranked = sorted(
        (found[scope] for scope in tiers),
        key=lambda b: (
            plain and b.host == home,
            tiers[b.scope],
            b.host == home,
            b.scope != here,
            -len(b.links),
            b.first,
        ),
    )
    named = {w for name in names for w in fold(name).split() if len(w) >= 3}
    level = level_of(unit)
    first = next((b.host for b in ranked if b.host != home and not _archive(b)), "")
    return [
        Bip(
            _starts(b.links),
            plain and b.host == home,
            b.host != home and _offices(b, stems, named, level, first),
            _archive(b),
        )
        for b in ranked
    ]


def _starts(links: dict[str, int]) -> list[str]:
    """A BIP's links, the surest first; one page linked with its slash and
    without once (Głuchołazy's website links both)."""
    starts: dict[str, str] = {}
    for link in sorted(links, key=links.__getitem__):
        starts.setdefault(normalize_url(link).rstrip("/"), link)
    return list(starts.values())


def bip_links(
    content: bytes,
    url: str,
    content_type: str,
    shared_hosts: set[str],
    names: Iterable[str] = (),
) -> list[str]:
    """The links of the BIP a page links as its own (`bips`); [] for none."""
    found = bips(content, url, content_type, shared_hosts, names)
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
    said = _signs(content, url, content_type)
    shown = {target for target, signs in said.items() if signs}
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
