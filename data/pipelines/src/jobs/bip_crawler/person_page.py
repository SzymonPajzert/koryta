"""A person's own page that names them in a field, not its title.

Poznań's councillors (bip.poznan.pl/bip/radni/<slug>,<id>/) each have a page
titled "Radny/Radna Miasta Poznania" for everyone, the name only under
"Imię, nazwisko", and the files under "Oświadczenia majątkowe" labelled
"Pobierz dokument (PDF)" in rows "Oświadczenie majątkowe za 2024 r.": nothing
around a file said whose it was, and 61 candidacies came to no_declarations
(11-05). The list that links the pages says the name alone, so no link lends it
(`_Frontier.lenders` wants a declaration's).

Tychy's (bip.umtychy.pl/oswiadczenia-majatkowe/<id>) are titled for the
whole BIP and split the name in a table, "Imię | Maciej", "Nazwisko | Blada",
over "oświadczenie majątkowe za rok 2025 [ Pobierz | Pokaż ]" (11-05).

`name` reads that one field, or that pair, for the page's title to carry it.
"""

from __future__ import annotations

import re

from bs4 import BeautifulSoup, Tag

_MARK = re.compile(rb"Imi(?:\xc4\x99|&#281;|e)", re.I)
_LABEL = re.compile(r"^\s*imi[eę]\s*(?:,|i)\s*nazwisko\s*:?\s*$", re.I)
_FIRST = re.compile(r"^\s*imi[eę]\s*:?\s*$", re.I)
_LAST = re.compile(r"^\s*nazwisko\s*:?\s*$", re.I)
_LABELS = ("h2", "h3", "h4", "h5", "h6", "dt", "th", "strong", "b", "label")


def _text(node: Tag) -> str:
    return " ".join(node.get_text(" ", strip=True).split())


def name(content: bytes) -> str:
    """The name under the page's one "Imię, nazwisko" field, or "" for a page
    with none or with several (a list of people)."""
    if not _MARK.search(content):
        return ""
    soup = BeautifulSoup(content, "lxml")
    tags = [x for x in soup.find_all(_LABELS) if isinstance(x, Tag)]
    labels = [x for x in tags if _LABEL.match(_text(x))]
    if len(labels) == 1:
        said = _value(labels[0])
    elif labels:
        return ""
    else:
        firsts = [x for x in tags if _FIRST.match(_text(x))]
        lasts = [x for x in tags if _LAST.match(_text(x))]
        if len(firsts) != 1 or len(lasts) != 1:
            return ""
        said = f"{_value(firsts[0])} {_value(lasts[0])}".strip()
    # A name, not a paragraph: two to five words.
    return said if 2 <= len(said.split()) <= 5 and len(said) <= 80 else ""


def _value(label: Tag) -> str:
    """The text of the element after a field's label: "" when that is another
    label."""
    value = label.find_next_sibling()
    if not isinstance(value, Tag) or value.name in _LABELS:
        return ""
    return _text(value)
