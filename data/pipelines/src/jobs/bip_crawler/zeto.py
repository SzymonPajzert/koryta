"""ZETO-RZESZÓW's BIPs: where a page stands, which only its breadcrumb says.

ZETO-RZESZÓW's CMS (bip.tarnobrzeski.pl, bip.dukla.pl, www.bip.zelazkow.pl
...: 6 units, 73 candidacies on 10-31) titles many pages with the office's
name alone. Its breadcrumb, ``ul#trescLokator``, says "Oświadczenia majątkowe >
2025 rok > Rada Powiatu", and a file on such a page ("plik w formacie pdf" in
a row "Gruszka Wojciech") said nothing of being a declaration: named, it was
not declaration-like, and nothing came down. `trail` reads the breadcrumb, for
the page's files to carry in their heading.
"""

from __future__ import annotations

import html
import re

from scrapers.bip.people import fold

_TRAIL = re.compile(r'<ul[^>]*\bid="trescLokator"[^>]*>(.*?)</ul>', re.S)
_ITEM = re.compile(r"<li\b[^>]*>(.*?)</li>", re.S)
_TAG = re.compile(r"<[^>]+>")
_HOME = "strona glowna"


def trail(content: bytes) -> str:
    """The page's breadcrumb, "Oświadczenia majątkowe > 2025 rok > Rada
    Powiatu", or ""."""
    if b"trescLokator" not in content:
        return ""
    found = _TRAIL.search(content.decode("utf-8", "replace"))
    if found is None:
        return ""
    items = [
        " ".join(html.unescape(_TAG.sub(" ", x)).split())
        for x in _ITEM.findall(found.group(1))
    ]
    return " > ".join(x for x in items if x and fold(x) != _HOME)
