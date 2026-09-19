"""Document detection and link filtering for BIP pages.

Link extraction itself lives in `scrapers.common.links` (shared with the
article crawler); this module only holds BIP-specific policy: which URLs are
documents, which are junk, and which sections to crawl first.
"""

from __future__ import annotations

import re

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

# Pages that never lead to documents and would eat the host's page budget.
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

PRIORITY_DOC = 10
PRIORITY_SECTION = 20
PRIORITY_PAGE = 50
PRIORITY_JUNK = 90

_HTML_CONTENT_TYPES = ("text/html", "application/xhtml+xml")


def is_html(content_type: str) -> bool:
    media_type = content_type.split(";", 1)[0].strip().lower()
    return media_type in _HTML_CONTENT_TYPES


def is_document_url(url: str) -> bool:
    return any(pattern.search(url) for pattern in _DOC_PATTERNS)


def is_document_content_type(content_type: str) -> bool:
    media_type = content_type.split(";", 1)[0].strip().lower()
    return media_type.startswith(_DOC_CONTENT_TYPES)


def looks_like_document(url: str, content_type: str) -> bool:
    return is_document_content_type(content_type) or (
        is_document_url(url) and not is_html(content_type)
    )


def filename_from_url(url: str) -> str:
    match = _FILENAME_RE.search(url)
    name = match.group(1) if match else "document"
    return name or "document"


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


def priority_for(url: str) -> int:
    """Lower runs sooner: documents, then document-bearing sections, then pages."""
    if is_document_url(url):
        return PRIORITY_DOC
    if is_section_url(url):
        return PRIORITY_SECTION
    return PRIORITY_PAGE


def host_of(url: str) -> str:
    match = re.match(r"^https?://([^/]+)", url, re.IGNORECASE)
    if match is None:
        return ""
    return match.group(1).lower().removeprefix("www.").split(":")[0]


def path_of(url: str) -> str:
    return re.sub(r"^https?://[^/]+", "", url, flags=re.IGNORECASE)
