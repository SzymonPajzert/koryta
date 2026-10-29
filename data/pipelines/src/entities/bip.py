"""Data classes for harvested BIP documents."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import ClassVar


@dataclass
class BipPersonOfInterest:
    """One won local candidacy to look up on the unit's BIP.

    A row is PKW's candidacy - the name as PKW printed it, the unit, the office
    and the year - with the koryta pages and rejestr.io entries that carry it.
    Two register entries of one person stay two (a rejestr.io entry is one
    person, never merged), and both point at the same candidacy here, so the
    crawler looks for the declaration once. ``key`` is stable across rebuilds:
    it hashes the candidacy, not the people.

    ``teryt`` is PKW's six digits for the unit the seat belongs to: ``WWPPGG`` a
    gmina (a Warsaw dzielnica for „Rada dzielnicy”), ``WWPP00`` a powiat,
    ``WW0000`` a województwo; ``unit_level`` says which. ``namesakes`` counts the
    other winners of that name in the unit and year: above zero, the name alone
    does not say whose declaration a link is.

    Nearly every KRS person has a register birth date, so for most rows the
    declaration's date is evidence that PKW's candidate and the register's person
    are one human, not a new fact; it is a new fact for a page that shows none
    (``page_has_birth_date``). No birth date from the register or the site is
    carried here, on purpose: the declaration is read to check them. ``priority``
    orders the crawl: 0 a published page with no birth date, 1 a draft page with
    none, 2 a page with one, 3 a person not on the site yet.
    """

    key: str
    full_name: str
    first_name: str
    last_name: str
    teryt: str
    unit_level: str
    office: str
    election_year: int
    priority: int
    middle_name: str | None = None
    #: "Strzelin (gmina miejsko-wiejska)", for people reading the record.
    unit_name: str = ""
    pkw_age: int | None = None
    pkw_birth_year: int | None = None
    namesakes: int = 0
    on_site: bool = False
    published: bool = False
    page_has_birth_date: bool = False
    koryta_ids: list[str] = field(default_factory=list)
    rejestrio_ids: list[str] = field(default_factory=list)


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
