"""bip.warszawa.pl's declarations search, a Liferay portlet asked by GET.

Warsaw files 22,125 declarations behind one page, /oswiadczenia-majatkowe: the
city's council, 18 district councils, the districts' boards, the city's staff
and units, 25 a page, newest first. The pages past the first are drawn by a
script, the filters are a form's selects, and each entry opens a page that
names its filer in "Imię" and "Nazwisko" fields over files labelled "Pobierz".
A walk from the BIP read 345 pages and reached no district councillor's
(11-13: 142 candidacies of 8 districts, each left unconfirmed on another
filer's files).

The search answers a plain GET: the page's address with the portlet's
``_<portlet>_keyword`` set to a surname lists that surname's entries, within
the filters the address carries (``_district=46385`` Mokotów, any kind of filer;
``_categoryIds=76220`` the city's councillors). `search_links` gives one such
link a seeker, on a search page whose address narrows it, as the unit's row in
unit_starts.csv does: unnarrowed, "Sosnowski" brings Włochy's Radosław
Sosnowski to Mokotów's. The keyword is the surname as the list spells it
(`Seeker.surname`): the search wants whole words ("mendelewsk" finds nothing),
each word it is given ("CIECHOMSKA-XYZQW" nothing, "CIECHOMSKA" three), and
finds a double surname whole whether an entry writes it with a hyphen or a
space ("Joanna Tracz Łaptaszyńska" by "TRACZ-ŁAPTASZYŃSKA", 11-13).
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from urllib.parse import parse_qsl, urlencode

from scrapers.bip.people import Seeker
from scrapers.common.links import LinkContext

_KEYWORD = re.compile(rb'name="_(web_content_search_portlet_INSTANCE_\w+?)_keyword"')
#: The filters that narrow the search: a district, a kind of filer.
_NARROWING = ("district", "categoryIds")


def search_links(
    content: bytes, url: str, seekers: Iterable[Seeker]
) -> list[LinkContext]:
    """For each seeker, ``url``'s own search with their surname as its keyword,
    first page; none when the page has no such search box or its address
    narrows nothing."""
    found = _KEYWORD.search(content)
    if not found:
        return []
    portlet = found.group(1).decode()
    ns = f"_{portlet}_"
    base, _, query = url.partition("?")
    pairs = parse_qsl(query, keep_blank_values=True)
    if not any(k == ns + f and v for k, v in pairs for f in _NARROWING):
        return []
    kept = [(k, v) for k, v in pairs if k not in (ns + "keyword", ns + "cur")]
    if not any(k == "p_p_id" for k, _ in kept):
        kept.insert(0, ("p_p_id", portlet))
    links: dict[str, LinkContext] = {}
    for s in seekers:
        if not s.surname:
            continue
        target = f"{base}?{urlencode([*kept, (ns + 'keyword', s.surname)])}"
        label = f"{s.first} {s.last} oświadczenia majątkowe"
        links.setdefault(target, LinkContext(target, label))
    return list(links.values())
