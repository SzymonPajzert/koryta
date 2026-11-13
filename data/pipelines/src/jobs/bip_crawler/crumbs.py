"""Where a page stands, which only its breadcrumb says, on the platforms seen
saying it nowhere else.

A BIP that titles a page with the office's name, or with only the person or
the year it shows, may say in its breadcrumb alone that the page stands under
"Oświadczenia majątkowe". A file there labelled "Falkowska Anna.pdf (PDF,
255.86Kb)", in a row "Liczba pobrań", says nothing of being a declaration:
named, not declaration-like, and nothing came down (11-13: none of Żnin's 18
candidacies, none of Kamień Pomorski's 15, every BIPv2 unit no_declarations).
`trail` reads the breadcrumb of:

- ZETO-RZESZÓW's CMS, ``ul#trescLokator`` (`zeto`);
- 2ClickPortal, ``nav.breadcrumbs``: each item's first link, the rest of it a
  list of the item's neighbours (Brzostek's "Radni Rady Miejskiej" under
  "Oświadczenia majątkowe > za 2024 rok");
- SkyCMS, ``ul.pageBreadcumb`` (sic): Opole's "Radni Powiatu", every ?Page=N
  of it, under "Menu przedmiotowe > Oświadczenia majątkowe";
- Sputnik's BIPv2 (bip.net.pl), a ``ul`` that starts at "Strona główna", on
  pages all titled with the office's name (`sputnik`);
- Bootstrap's ``ol.breadcrumb``, Alfa TV's BIPs among others: Żnin's
  "Falkowska Anna - BIP Powiat Żniński" under "Oświadczenia majątkowe > Na
  początek kadencji 2024-2029 > Radni Rady Powiatu w Żninie".

`declarations` is what a page's files carry of it in their heading: the trail
up to its last crumb that says declarations, where the page stands, not whose
it is. The crumbs after it can name a person ("... > Falkowska Anna"), and a
heading names whoever it says: under "Oświadczenia majątkowe > Burmistrz Jan
Kowalski > Zastępca" the deputy's file, under her own name, would have been
the mayor's too. The page's title still names its person.
"""

from __future__ import annotations

import html
import re
from collections.abc import Iterable

from jobs.bip_crawler import zeto
from scrapers.bip.people import DECLARATION, fold
from scrapers.common.links import decode_html

_TAG = re.compile(r"<[^>]+>")
_ITEM = re.compile(r"<li\b[^>]*>(.*?)</li\s*>", re.S | re.I)
_TWO_CLICK = re.compile(
    r"""<nav\b[^>]*\bclass=["'][^"']*\bbreadcrumbs\b[^>]*>(.*?)</nav\s*>""", re.S
)
_TWO_CLICK_LINK = re.compile(
    r"""<a\b[^>]*\bclass=["'][^"']*\bbreadcrumbs__link\b[^>]*>(.*?)</a\s*>""", re.S
)
_SKY = re.compile(
    r"""<ul\b[^>]*\bclass=["']pageBreadcumb["'][^>]*>(.*?)</ul\s*>""", re.S
)
_SPUTNIK_MARK = b'<ul class="wrapper flex items-center flex-wrap">'
_SPUTNIK = re.compile(
    r"""<ul class="wrapper flex items-center flex-wrap">(<li\b[^>]*><a\b[^>]*"""
    r"""\btitle="Strona główna".*?)</ul>""",
    re.S,
)
#: A list whose class says breadcrumb: Bootstrap's ``ol.breadcrumb``, and the
#: ``ul.breadcrumbs`` of others.
_BOOTSTRAP = re.compile(
    r"""<(ol|ul)\b[^>]*\bclass=["'][^"']*\bbreadcrumbs?\b[^"']*["'][^>]*>(.*?)</\1\s*>""",
    re.S | re.I,
)
_MARKS = (b"breadcrumbs__link", b"pageBreadcumb", _SPUTNIK_MARK, b"breadcrumb")
_HOME = "strona glowna"


def _crumbs(items: Iterable[str]) -> str:
    texts = (" ".join(html.unescape(_TAG.sub(" ", x)).split()) for x in items)
    return " > ".join(x for x in texts if x and fold(x) != _HOME)


def _read(text: str, content: bytes) -> str:
    if b"breadcrumbs__link" in content and (nav := _TWO_CLICK.search(text)):
        return _crumbs(_TWO_CLICK_LINK.findall(nav.group(1)))
    if b"pageBreadcumb" in content and (sky := _SKY.search(text)):
        return _crumbs(_ITEM.findall(sky.group(1)))
    if _SPUTNIK_MARK in content and (sputnik := _SPUTNIK.search(text)):
        return _crumbs(_ITEM.findall(sputnik.group(1)))
    if bootstrap := _BOOTSTRAP.search(text):
        return _crumbs(_ITEM.findall(bootstrap.group(2)))
    return ""


def trail(content: bytes) -> str:
    """The page's breadcrumb, "Oświadczenia majątkowe > 2025 rok > Rada
    Powiatu", or ""."""
    if found := zeto.trail(content):
        return found
    if not any(mark in content for mark in _MARKS):
        return ""
    found = _read(content.decode("utf-8", "replace"), content)
    if "\ufffd" in found:  # windows-1250 or ISO-8859-2, as its <meta> says
        found = _read(decode_html(content), content)
    return found


def declarations(where: str) -> str:
    """``where`` up to its last crumb that says declarations; "" when none does."""
    crumbs = where.split(" > ") if where else []
    said = [i for i, crumb in enumerate(crumbs) if DECLARATION.search(fold(crumb))]
    return " > ".join(crumbs[: said[-1] + 1]) if said else ""
