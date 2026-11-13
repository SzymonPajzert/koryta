"""Sputnik's BIPv2 (bip.net.pl and the offices' own hosts): a category lists ten
of its articles.

A category, ``/kategorie/<id>-<slug>?lang=PL``, shows its first ten articles
and pages through the rest with buttons a script draws: no link leads past the
tenth. Its payload says how many there are, ``"totalItems":63``, and the page
takes ``size`` (10, 25, 50 or 100) and ``page`` (from 0): Mogilno's councillors'
declarations for 2024, /kategorie/335-radni-rady-miejskiej, list 63 people's
articles, the walk saw the first ten (11-13: Nawrot's on the fifth page).
`whole_list` gives the addresses that list them all, 100 a page.
"""

from __future__ import annotations

import math
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

_CATEGORY = re.compile(r"^/kategorie/\d+-[^/]+/?$")
_TOTAL = re.compile(rb'totalItems\\?"\s*:\s*(\d+)')
#: The size a category shows unless asked for another: the first its pager
#: offers, ``"size":[10,25,50,100]``.
_SIZES = re.compile(rb'"size\\?"\s*:\s*\[\s*(\d+)')
SIZE = 100
#: Pages of `SIZE` articles read at most: a declarations category is a year's
#: or an office's, a few dozen people.
MAX_PAGES = 5


def whole_list(content: bytes, url: str) -> list[str]:
    """The addresses that list every article of the BIPv2 category at ``url``,
    `SIZE` a page, when it shows fewer than its payload counts; [] otherwise,
    and for one that already asks for a size or a page."""
    parts = urlsplit(url)
    if not _CATEGORY.match(parts.path) or b"totalItems" not in content:
        return []
    query = parse_qsl(parts.query, keep_blank_values=True)
    if any(key in ("size", "page") for key, _ in query):
        return []
    total = max((int(x) for x in _TOTAL.findall(content)), default=0)
    shown = _SIZES.search(content)
    if total <= (int(shown.group(1)) if shown else 10):
        return []
    pages = min(MAX_PAGES, math.ceil(total / SIZE))
    return [
        urlunsplit(
            parts._replace(
                query=urlencode(
                    [*query, ("size", str(SIZE))] + ([("page", str(n))] if n else [])
                )
            )
        )
        for n in range(pages)
    ]
