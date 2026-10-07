"""Data classes for harvested BIP documents."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import ClassVar


@dataclass
class BipUrlClassified:
    """Category predicted for one document URL before reading its content.

    Predicted from the URL path (own and parent) plus the stored anchor text;
    ``score`` is the model's winning margin and ``runner_up`` the second class.
    """

    __output_path__: ClassVar[Path] = Path(
        "bip_urls_classified/bip_urls_classified.jsonl.tmp"
    )

    url: str
    host: str
    category: str
    score: float
    runner_up: str
    model_version: int


@dataclass
class BipDocumentParsed:
    """Text parsed from one harvested BIP document.

    Keyed by the blob's ``sha256``. ``method`` says how the text was obtained
    (``pdf_text``/``ocr``/``ocr_image``/``xml``/``rtf``/``none``), so OCR output
    can be told apart from a real text layer. ``status`` marks non-OK outcomes:
    ``empty_text``, ``unsupported`` (e.g. legacy OLE files), ``missing_blob``
    (listed in Postgres but absent from the bundles) or ``error``.
    """

    __output_path__: ClassVar[Path] = Path(
        "bip_documents_parsed/bip_documents_parsed.jsonl.tmp"
    )

    sha256: str
    url: str
    host: str
    filename: str
    content_type: str
    size: int
    bundle: str
    parser_version: int
    status: str
    method: str
    text: str
    text_hash: str
    text_chars: int
    pages: int = 0
    ocr_pages: int = 0
    ocr_confidence: float | None = None
    title: str | None = None
    error: str | None = None
    url_category: str = ""
