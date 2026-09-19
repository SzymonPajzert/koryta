"""Fetching the official BIP registry from gov.pl.

This is the crawler's entry point: one ZIP with every obligated entity and its
BIP address. It lives in the `stores` layer because unpacking the response needs
`zipfile`/`io`, which the `scrapers` layer may not import (import-linter
contract "Do not import external packages").
"""

import io
import zipfile

import requests

# `https://www.gov.pl/web/bip/spis` redirects here and serves a ZIP holding
# subjects.xml (13k+ rows). Measured 2026-09: 1.5 MB ZIP, 9.8 MB XML.
REGISTRY_URL = "https://www.gov.pl/web/bip/spis"
ARCHIVE_URL = "https://www.gov.pl/web/bip/archiwum"
SUBJECTS_XML_NAME = "subjects.xml"

USER_AGENT = "koryta.pl-pipeline/1.0 (+https://github.com/SzymonPajzert/koryta)"


def fetch_registry_zip(url: str = REGISTRY_URL, timeout: float = 120) -> bytes:
    """Download the registry ZIP. gov.pl needs TLS verification relaxed."""
    response = requests.get(
        url,
        headers={"User-Agent": USER_AGENT},
        timeout=timeout,
        verify=False,
    )
    response.raise_for_status()
    return response.content


def extract_subjects_xml(
    zip_bytes: bytes, name: str = SUBJECTS_XML_NAME
) -> bytes:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        return archive.read(name)


def download_subjects_xml(
    url: str = REGISTRY_URL, timeout: float = 120
) -> bytes:
    return extract_subjects_xml(fetch_registry_zip(url, timeout))
