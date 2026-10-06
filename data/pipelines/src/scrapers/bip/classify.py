"""Document detection and link filtering for BIP pages.

Link extraction itself lives in `scrapers.common.links` (shared with the
article crawler); this module only holds BIP-specific policy: which URLs are
documents, which are junk, and which sections to crawl first.
"""

from __future__ import annotations

import re

from entities.util import format_query, parse_query

# URL shapes that serve a file rather than a page. Extensionless endpoints
# (attachments/download, getFile) are included because the response
# content-type is the authoritative check.
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

_FILENAME_RE = re.compile(r"/([^/?#]+?)(?:[?#].*)?$")

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


_AMP_ENTITY_RE = re.compile(r"&amp;", re.IGNORECASE)
_AMP_PREFIX_RE = re.compile(r"^(?:amp;)+", re.IGNORECASE)
# Presentation-only parameters: same page, different URL. `switch_*` are the
# accessibility toggles (letter/word spacing, dark mode, link underline), the
# rest are font size, print view, change-log view and image-map coordinates.
_NOISE_QUERY_PARAMS = frozenset(
    {"x", "y", "fontsize", "print", "pokaz_rejestr_zmian"}
)
_NOISE_QUERY_PREFIXES = ("switch_",)


def normalize_url(url: str) -> str:
    """Drop the fragment, collapse a trailing slash, and canonicalise the query.

    Some BIP platforms echo their own query string into every link, HTML-escaping
    it a little more each round (`?amp%3Bamp%3Bacc_pa=1`), which mints an endless
    supply of distinct URLs from one page. Unescaping `&amp;`, stripping `amp;`
    prefixes from parameter names, dropping presentation-only toggles and
    duplicate pairs, and sorting the rest makes those permutations converge.
    """
    clean = _AMP_ENTITY_RE.sub("&", url).split("#", maxsplit=1)[0].strip()
    if clean.endswith("/") and clean.count("/") > 3:
        clean = clean.rstrip("/")
    base, separator, query = clean.partition("?")
    if not separator:
        return clean
    pairs: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for key, value in parse_query(query):
        key = _AMP_PREFIX_RE.sub("", key)
        lowered = key.lower()
        if (
            not key
            or lowered in _NOISE_QUERY_PARAMS
            or lowered.startswith(_NOISE_QUERY_PREFIXES)
        ):
            continue
        pair = (key, value)
        if pair in seen:
            continue
        seen.add(pair)
        pairs.append(pair)
    if not pairs:
        return base
    pairs.sort()
    return f"{base}?{format_query(pairs)}"


def is_low_value_url(url: str) -> bool:
    return bool(_LOW_VALUE_RE.search(url))


def host_of(url: str) -> str:
    match = re.match(r"^https?://([^/]+)", url, re.IGNORECASE)
    if match is None:
        return ""
    return match.group(1).lower().removeprefix("www.").split(":")[0]


def path_of(url: str) -> str:
    return re.sub(r"^https?://[^/]+", "", url, flags=re.IGNORECASE)
