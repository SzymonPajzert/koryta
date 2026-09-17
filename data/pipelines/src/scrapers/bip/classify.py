"""Document detection and link extraction for BIP pages."""

from __future__ import annotations

import re
from dataclasses import dataclass

from bs4 import BeautifulSoup, Tag

# URL shapes that serve a file rather than a page. Measured across the sample in
# BIP_SCRAPING_80_20.md; extensionless endpoints (attachments/download, getFile)
# are included because the response content-type is the authoritative check.
_DOC_PATTERNS = [
    re.compile(r"/attachments?/\d+/download", re.IGNORECASE),
    re.compile(r"/attachments/download/\d+", re.IGNORECASE),
    re.compile(r"/download/attachment/\d+/", re.IGNORECASE),
    re.compile(r"/api/files/\d+", re.IGNORECASE),
    re.compile(r"/fobjects/download/", re.IGNORECASE),
    re.compile(r"/resource/\d+/", re.IGNORECASE),
    re.compile(r"/res/serwisy/pliki/", re.IGNORECASE),
    re.compile(r"/system/obj/", re.IGNORECASE),
    re.compile(r"/fls/bip_pliki/", re.IGNORECASE),
    re.compile(r"[?&](?:id|zid|iddok|idplik)=.*", re.IGNORECASE),
    re.compile(r"/(?:plik|file|download|pobierz)(?:[.,?/]|$)", re.IGNORECASE),
    re.compile(r"\.(?:pdf|docx?|xlsx?|csv|zip|rtf|odt|ods)(?:$|\?)", re.IGNORECASE),
]

_DOC_CONTENT_TYPES = (
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument",
    "application/vnd.ms-excel",
    "application/vnd.oasis.opendocument",
    "application/zip",
    "application/x-zip",
    "application/rtf",
)

_SKIP_SCHEMES = ("#", "mailto:", "tel:", "javascript:", "data:")

# Pages that never lead to documents and would eat the per-host page budget.
_LOW_VALUE_RE = re.compile(
    r"/(?:banners?|view|tags?|search|szukaj|print|drukuj|rss|feed|login"
    r"|logowanie|polityka-prywatnosci|deklaracja-dostepnosci|mapa-strony"
    r"|sitemap)(?:/|$|\?)",
    re.IGNORECASE,
)

# Sections that hold the documents iteration 1 is after; crawled first.
_SECTION_KEYWORDS = (
    "oswiadczen",
    "przetarg",
    "umow",
    "zamowien",
    "budzet",
    "majatek",
    "mienie",
    "nieruchomosc",
    "zarzadzen",
    "uchwal",
    "ogloszen",
    "dokument",
    "spolk",
    "jednostk",
    "wykaz",
    "rejestr",
    "podatk",
    "finans",
)

_FILENAME_RE = re.compile(r"/([^/?#]+?)(?:[?#].*)?$")


def normalize_url(url: str) -> str:
    """Drop the fragment and collapse a trailing slash (except for the root)."""
    clean = url.split("#", maxsplit=1)[0].strip()
    if clean.endswith("/") and clean.count("/") > 3:
        clean = clean.rstrip("/")
    return clean


def is_low_value_url(url: str) -> bool:
    return bool(_LOW_VALUE_RE.search(url))


def is_section_url(url: str) -> bool:
    lowered = url.lower()
    return any(keyword in lowered for keyword in _SECTION_KEYWORDS)


@dataclass(frozen=True)
class Link:
    url: str
    text: str


def is_document_url(url: str) -> bool:
    return any(pattern.search(url) for pattern in _DOC_PATTERNS)


def is_document_content_type(content_type: str) -> bool:
    media_type = content_type.split(";", maxsplit=1)[0].strip().lower()
    return media_type.startswith(_DOC_CONTENT_TYPES)


def filename_from_url(url: str) -> str:
    match = _FILENAME_RE.search(url)
    if match is None:
        return "document"
    name = match.group(1)
    return name or "document"


def _clean(href: str) -> str:
    return href.strip().split("#")[0].strip()


def extract_links(html: str, base_url: str) -> list[Link]:
    """Absolute links from anchor tags, query strings preserved.

    Unlike the article crawler's variant this must NOT drop the query string:
    document URLs here are routinely `plik.php?zid=121727` or `getFile?id=...`.
    """
    soup = BeautifulSoup(html, "lxml")
    base_tag = soup.find("base", href=True)
    if isinstance(base_tag, Tag):
        base_href = base_tag.get("href")
        if isinstance(base_href, str) and base_href.strip():
            base_url = base_href.strip()

    seen: dict[str, str] = {}
    for anchor in soup.find_all("a", href=True):
        if not isinstance(anchor, Tag):
            continue
        raw = anchor.get("href")
        if not isinstance(raw, str):
            continue
        href = _clean(raw)
        if not href or href.startswith(_SKIP_SCHEMES):
            continue
        try:
            from urllib.parse import urljoin  # noqa: PLC0415

            absolute = urljoin(base_url, href)
        except ValueError:
            continue
        if not absolute.startswith(("http://", "https://")):
            continue
        text = anchor.get_text(" ", strip=True)[:120]
        if absolute not in seen or (text and not seen[absolute]):
            seen[absolute] = text
    return [Link(url=url, text=text) for url, text in seen.items()]
