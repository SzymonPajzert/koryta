"""ZETO Lublin's e-zeto BIPs: a list's further pages behind buttons.

ZETO Lublin's CMS (every *.bip.e-zeto.eu BIP, and bip.powiatboleslawiecki.pl;
``<meta name="author" content="ZETO Lublin, ...">``) lists a section's
documents ten to a page and offers the other pages as buttons its script
sends, ``<input type="submit" value="2" name="type%3D4%26name%3Dbt1%26func%3D
dispNaviBar%26...%26param%255B0%255D%3D1">``: a GET of ``index.php?`` and the
button's name is that page, "(2 z 12)", its param[0] counting from 0. The walk
reads links alone and saw none: Żółkiewka's chairman's declarations stand on
pages 2, 5 and 10 of the 2018-2023 term's 12 and on 3 and 4 of the next one's
5, none on a first page; powiat świdnicki's 2024 council fills 10 (11-13).

`pager` hands each button back as a link labelled with the title of the page
it continues, so that it ranks as that page does. One address a page, whatever
button it came from, is `scrapers.bip.classify.normalize_url`'s.

A list of document records (powiat świdnicki's, Żółkiewka's) names each in a
heading and links it as "przejdź do dokumentu", its name only in the link's
title: powiat świdnicki's councillors' declarations ranked last of a page's
167 links, and a walk of 119 pages opened none (11-13). `documents` gives a
seeker's document its name.
"""

from __future__ import annotations

import html
import re
from dataclasses import replace
from urllib.parse import parse_qsl, unquote, urljoin

from scrapers.bip.people import Seeker, declarants
from scrapers.common.links import LinkContext

_MARK = b"dispNaviBar"
#: A tag whose quoted values may hold a ">": the next pages' button is value=">".
_INPUT = re.compile(r"""<input\b(?:[^>"']|"[^"]*"|'[^']*')*>""", re.I)
_ANCHOR = re.compile(r"""<a\b(?:[^>"']|"[^"]*"|'[^']*')*>""", re.I)
_ATTRIBUTE = re.compile(r"""([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))""")
#: A list's document: its heading or its file, and its details link.
_ITEM = re.compile(r"<section\b.*?</section>", re.S | re.I)
_DETAILS = "szczegóły dokumentu:"


def _attributes(tag: str) -> dict[str, str]:
    return {
        m.group(1).lower(): html.unescape(
            next(g for g in m.groups()[1:] if g is not None)
        )
        for m in _ATTRIBUTE.finditer(tag)
    }


def _number(name: str) -> int:
    """The page a button's name opens, counted from 1 (its param[0] counts from
    0, and the first page's "<<" says -1); 0 for none."""
    pairs = dict(parse_qsl(unquote(name), keep_blank_values=True))
    first = pairs.get("param[0]", "")
    return int(first) + 1 if first.isdigit() else 0


def pager(content: bytes, url: str, title: str = "") -> list[LinkContext]:
    """The page's pager buttons as links to the pages they open, each labelled
    with ``title`` and the page's number: [] for a page with none. Not the
    first page's: that is the list's own address, which led here."""
    if _MARK not in content:
        return []
    out: list[LinkContext] = []
    seen: set[str] = set()
    for tag in _INPUT.finditer(content.decode("utf-8", "replace")):
        button = _attributes(tag.group())
        name = button.get("name", "").strip()
        if button.get("type", "").lower() != "submit" or "dispNaviBar" not in name:
            continue
        number = _number(name)
        target = urljoin(url, "index.php?" + name)
        if number < 2 or target in seen:
            continue
        seen.add(target)
        out.append(LinkContext(target, " ".join(f"{title} strona {number}".split())))
    return out


def documents(content: bytes, url: str, seekers: list[Seeker]) -> dict[str, str]:
    """The details links of a list's documents that say they are a seeker's
    declaration, by address, under the document's name. Not one whose file the
    list links itself: a councillor's own page (powiat bolesławiecki's) shows
    the file, and its details page holds no other."""
    if _DETAILS.encode() not in content:  # its pages are UTF-8
        return {}
    out: dict[str, str] = {}
    for item in _ITEM.finditer(content.decode("utf-8", "replace")):
        anchors = [_attributes(a.group()) for a in _ANCHOR.finditer(item.group())]
        if any("bip-link" in a.get("class", "").split() for a in anchors):
            continue
        for anchor in anchors:
            said = anchor.get("title", "")
            if "showmore" not in anchor.get("class", "").split() or not said.startswith(
                _DETAILS
            ):
                continue
            link = LinkContext(
                urljoin(url, anchor.get("href", "").strip()).split("#")[0],
                said.removeprefix(_DETAILS).strip(),
            )
            if declarants(link, seekers):
                out[link.url] = link.anchor
    return out


def links(
    content: bytes,
    url: str,
    title: str,
    found: list[LinkContext],
    seekers: list[Seeker],
) -> tuple[list[LinkContext], list[LinkContext]]:
    """``found``, a page's links, with a seeker's documents under their names
    (`documents`) and the list's further pages after them (`pager`); and those
    pages alone."""
    names = documents(content, url, seekers)
    pages = pager(content, url, title)
    named = [replace(x, anchor=names[x.url]) if x.url in names else x for x in found]
    return named + pages, pages
