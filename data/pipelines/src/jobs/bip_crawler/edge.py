"""TYPO3's EdgeFinancialDisclosure app: a list of everyone who files, searched
by surname through its GET form.

Łódź (bip.uml.lodz.pl/samorzad/oswiadczenia-majatkowe/
wyszukiwarka-oswiadczen-majatkowych/) files every declaration since 2020 of
its councillors, mayors, directors and company boards in one app: a list of
~2,600 people, 20 a page in alphabetical order ("Walasek Mateusz" on about the
130th), each a link to their page, ``?tx_edgefinancialdisclosure_person
[action]=show&...[person]=1907&cHash=...``, which holds a table of their files
("2026 | 29.04.2026 | Radny(a) | walasek_mateusz_2026.pdf"). The walk read the
list's first pages and the people on them, 1,000 pages and none of 75
candidacies (11-13).

The list's form asks for a surname by GET (``[personDemand][lastName]``, a
case-blind substring that minds diacritics: "ŻURAW" finds Żuraw Elżbieta,
"zuraw" nobody), its hidden fields signed by the app. `search_links` gives
the walk that search for each seeker as a link labelled with the surname; the
answer lists them, as the full list would, and the walk opens their page.
"""

from __future__ import annotations

import html
import re
from urllib.parse import urlencode, urljoin, urlsplit

from scrapers.bip.people import Seeker
from scrapers.common.links import LinkContext

#: The form's surname field, after the app's prefix.
LAST_NAME = "[personDemand][lastName]"
#: The app's prefix: on a page, its form; in an address, one of its answers.
_APP = "tx_edgefinancialdisclosure_person"
_FORM = re.compile(rb"<form\b([^>]*)>(.*?)</form>", re.S | re.I)
_INPUT = re.compile(rb"<input\b([^>]*)>", re.I)
_SELECT = re.compile(rb"<select\b([^>]*)>(.*?)</select>", re.S | re.I)
_OPTION = re.compile(rb"<option\b([^>]*)>", re.I)


def _attr(tag: bytes, name: str) -> str | None:
    found = re.search(rb"\b" + name.encode() + rb"""\s*=\s*(["'])(.*?)\1""", tag, re.S)
    return html.unescape(found.group(2).decode("utf-8", "replace")) if found else None


def _longest(surname: str) -> str:
    """A double surname's longest part, as the list spells it: the search
    takes a substring, and finds "Moskwa-Wodnicka" by "WODNICKA" however the
    list joins the parts."""
    parts = [p for p in re.split(r"[-\s]+", surname) if p]
    return max(parts, key=len) if parts else ""


def search_links(content: bytes, url: str, seekers: list[Seeker]) -> list[LinkContext]:
    """The app's search for each seeker's surname, as a link labelled with
    it; [] for a page without the app's GET form, and for the app's own
    answers: their forms sign the request they answer
    (``[__referrer][arguments]``), so each would ask every search anew."""
    if _APP.encode() not in content or _APP in urlsplit(url).query:
        return []
    for form in _FORM.finditer(content):
        attrs, body = form.group(1), form.group(2)
        if (_attr(attrs, "method") or "get").lower() != "get":
            continue
        # What a browser sends: the hidden fields, the surname, each select.
        fields: list[tuple[str, str]] = []
        last_name = ""
        for tag in _INPUT.finditer(body):
            name = _attr(tag.group(1), "name") or ""
            kind = (_attr(tag.group(1), "type") or "text").lower()
            if name == _APP + LAST_NAME:
                last_name = name
            elif name and kind == "hidden":
                fields.append((name, _attr(tag.group(1), "value") or ""))
        if not last_name:
            continue
        # Every position and every year: each select's first option, "0".
        for select in _SELECT.finditer(body):
            name = _attr(select.group(1), "name") or ""
            first = _OPTION.search(select.group(2))
            if name and first:
                fields.append((name, _attr(first.group(1), "value") or ""))
        # A GET form's fields take the place of its action's query.
        action = (_attr(attrs, "action") or "").split("#")[0]
        base = urljoin(url, action).split("?")[0]
        links = []
        for surname in dict.fromkeys(_longest(s.surname) for s in seekers):
            if surname:
                query = urlencode([*fields, (last_name, surname)])
                # The surname alone: the answer lists people, and a label of
                # a first name too would lend it to a seeker (`named_by_label`).
                links.append(LinkContext(f"{base}?{query}", surname))
        return links
    return []
