"""A person a ``<details>``: the name in its ``<summary>``, the files inside.

samorzad.gov.pl, gov.pl's portal for local offices (46 units with nothing
downloaded on 11-05, 502 candidacies), lists a council as an accordion: a
``<details>`` a councillor, "Banaszek Paweł" in its ``<summary>``, their files
under "Materiały" labelled "Oświadczenie o stanie majątkowym za 2024 rok
składane do 30 kwietnia 2025 r.". The file's row is the link alone and its
heading "Materiały", so nothing said whose it was; powiat wołomiński's two
term pages held 264 files and gave 0 found.

`persons` gives each link inside such a ``<details>`` its summary as its row.
"""

from __future__ import annotations

from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

#: A summary longer than this is a section's title, not a person's name.
_NAME_WORDS = 6


def _text(node: Tag) -> str:
    return " ".join(node.get_text(" ", strip=True).split())


def persons(content: bytes, url: str) -> dict[str, str]:
    """{address: "Banaszek Paweł | <the link's own words>"} for each link
    inside a ``<details>`` whose summary reads as a name; {} for a page with
    none. A nested ``<details>`` answers for its own links."""
    if b"<details" not in content:
        return {}
    soup = BeautifulSoup(content, "lxml")
    out: dict[str, str] = {}
    for details in soup.find_all("details"):
        if not isinstance(details, Tag):
            continue
        summary = details.find("summary")
        if not isinstance(summary, Tag):
            continue
        person = _text(summary)
        if not person or len(person.split()) > _NAME_WORDS:
            continue
        for anchor in details.find_all("a", href=True):
            if (
                not isinstance(anchor, Tag)
                or anchor.find_parent("details") is not details
            ):
                continue
            href = str(anchor.get("href") or "").strip()
            if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
                continue
            said = _text(anchor)
            out[urljoin(url, href).split("#")[0]] = " | ".join(
                x for x in (person, said) if x
            )
    return out
