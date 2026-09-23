"""Parsing the gov.pl BIP registry XML into host rows.

Pure parsing on purpose: the download and ZIP unpacking live in
`stores.bip_registry`, because this layer may not import `zipfile`/`io`.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET

from entities.util import NormalizedParse
from scrapers.bip.models import HostRow, RegistryEntry

_URL_RE = re.compile(r"^https?://", re.IGNORECASE)


def _is_root_url(url: str) -> bool:
    """True for `https://host/` (or bare host) with no userinfo garbage."""
    try:
        parsed = NormalizedParse.parse(url)
    except Exception:
        return False
    return parsed.path in ("", "/") and "@" not in parsed.netloc


def _text(row: ET.Element, tag: str) -> str:
    element = row.find(tag)
    if element is None or element.text is None:
        return ""
    return element.text.strip()


def host_from_url(url: str) -> str:
    """Normalised hostname (lowercased, `www.` stripped) or "" if unparsable."""
    candidate = url if _URL_RE.match(url) else f"http://{url}"
    try:
        return NormalizedParse.parse(candidate).hostname_normalized
    except Exception:
        return ""


def parse_subjects_xml(xml_bytes: bytes) -> list[RegistryEntry]:
    """Every registry row that carries a URL.

    Shape (measured 2026-09):
    <resultset><row>
      <id/><name/><url/><place/><email/>
      <communeTercCode><code>1416022</code></communeTercCode>
    </row>...</resultset>
    """
    root = ET.fromstring(xml_bytes)
    entries: list[RegistryEntry] = []
    for row in root.iter("row"):
        url = _text(row, "url")
        if not url:
            continue
        teryt_element = row.find("communeTercCode/code")
        teryt = (
            teryt_element.text.strip()
            if teryt_element is not None and teryt_element.text
            else ""
        )
        entries.append(
            RegistryEntry(
                entry_id=_text(row, "id"),
                name=_text(row, "name"),
                url=url,
                host=host_from_url(url),
                teryt=teryt,
                place=_text(row, "place"),
                email=_text(row, "email"),
            )
        )
    return entries


def hosts_from_entries(entries: list[RegistryEntry]) -> list[HostRow]:
    """Deduplicate registry rows into one row per host, preserving order.

    Shared portals host many institutions under one hostname (the City of
    Poznań and a dozen of its units all live on `bip.poznan.pl`). The registry
    is institution-keyed, so the host's representative is the row with a
    root-path URL when one exists — that is the umbrella institution whose seed
    covers the whole portal — instead of whichever unit happens to come first.
    """
    hosts: dict[str, HostRow] = {}
    for entry in entries:
        if not entry.host:
            continue
        existing = hosts.get(entry.host)
        if existing is None:
            hosts[entry.host] = HostRow(
                host=entry.host,
                name=entry.name,
                source_url=entry.url,
                teryt=entry.teryt,
                entry_count=1,
            )
            continue
        promote = _is_root_url(entry.url) and not _is_root_url(existing.source_url)
        hosts[entry.host] = HostRow(
            host=existing.host,
            name=entry.name if promote else existing.name,
            source_url=entry.url if promote else existing.source_url,
            teryt=(entry.teryt or existing.teryt) if promote else existing.teryt,
            entry_count=existing.entry_count + 1,
        )
    return list(hosts.values())
