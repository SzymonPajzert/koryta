"""Parse harvested BIP documents into text and stream the result to JSONL.

Reads the document list from the crawl Postgres database (``bip_docs``),
locates each blob inside the tar.gz bundles the crawler wrote, and extracts
text, recording *how* it was obtained:

- born-digital PDF   -> PyMuPDF text layer               (``pdf_text``)
- scanned PDF        -> RapidOCR on the first pages      (``ocr``)
- scanned image      -> RapidOCR (jpeg/tiff/png)         (``ocr_image``)
- docx/xlsx/pptx/odf -> zip + XML text                   (``xml``)
- rtf                -> control-word stripping           (``rtf``)
- zip archive        -> members parsed recursively       (``zip+...``)
- Word 97 .doc       -> piece-table text                 (``doc_ole``)
- Excel .xls         -> xlrd cells                       (``xls``)
- PowerPoint .ppt    -> stream text runs                 (``ppt_ole``)

Every record is keyed by the blob's ``sha256`` and carries the extraction
``status`` (``ok``/``empty_text``/``unsupported``/``missing_blob``/``error``),
so downstream analysis can tell a real text layer from OCR noise and skip what
failed.

One host per run (``--refresh`` is required after the first run: the runner
only sees the output file, not the Postgres table):

    koryta --refresh BipDocumentsParsed BipDocumentsParsed \
        --bip-host-regex '^bip\\.poznan\\.pl$'

``--bip-ocr-pages`` controls how many leading pages scans are OCR'd (0 turns
OCR off). Empty results are retried when a later run allows more OCR pages, so
the whole corpus can first be swept text-layer-only and OCR'd afterwards; with
``--bip-ocr-only`` a run selects exactly that OCR backlog (documents that could
not be parsed normally) and leaves everything else untouched.

Re-runs are incremental: documents already parsed with the current
``PARSER_VERSION`` are carried over from the previous output, and records for
hosts outside the filter stay in the file.
"""

import argparse
import hashlib
import io
import json
import multiprocessing
import re
import statistics
import tarfile
import zipfile
from collections import defaultdict
from concurrent.futures import Future, ProcessPoolExecutor, as_completed
from dataclasses import dataclass, replace
from functools import cache
from pathlib import Path
from typing import Any, Iterator

import pandas as pd
from tqdm import tqdm

from analysis.bip_urls_classified import CATEGORIES, BipUrlsClassified
from entities.bip import BipDocumentParsed
from scrapers.article.pipelines.incremental import IncrementalJsonlPipeline
from scrapers.common.pg import PostgresClient
from scrapers.stores import Context

PARSER_VERSION = 1
OCR_PAGE_CAP = 2
OCR_SCALE = 1.3
FLUSH_EVERY = 200
MAX_BUNDLES_IN_FLIGHT = 2
DEFAULT_BUNDLES_DIR = "/mnt/disk/koryta/bip"

_TAG_RE = re.compile(r"<[^>]+>", re.DOTALL)
_RTF_RE = re.compile(r"\\[a-z]+-?\d* ?")
_PRINTABLE_RUN_RE = re.compile(rb"[\x20-\x7e\xa0-\xff\t\r\n\x0b\x0c]{40,}")
_UTF16_RUN_RE = re.compile(rb"(?:[\x20-\x7e\xa0-\xff]\x00){20,}")

MAX_ZIP_MEMBERS = 50
MAX_ZIP_MEMBER_BYTES = 20 * 1024 * 1024
MAX_ZIP_TOTAL_BYTES = 60 * 1024 * 1024
ZIP_DEPTH_LIMIT = 2

_engine: Any = None


def add_arguments(parser: argparse.ArgumentParser) -> None:
    """Register the BIP document-parsing flags on a parser."""
    parser.add_argument(
        "--bip-host-regex",
        default=None,
        help="Postgres regex on bip_docs.host; only these hosts are parsed, "
        "e.g. --bip-host-regex '^bip\\.poznan\\.pl$'. Required.",
    )
    parser.add_argument(
        "--bip-bundles",
        default=DEFAULT_BUNDLES_DIR,
        help="Root of the crawl output containing the tar.gz bundles.",
    )
    parser.add_argument(
        "--bip-workers",
        type=int,
        default=4,
        help="Parallel bundle parsers (OCR is CPU-heavy).",
    )
    parser.add_argument(
        "--bip-limit",
        type=int,
        default=None,
        help="Only consider the first N documents (debugging aid).",
    )
    parser.add_argument(
        "--bip-ocr-pages",
        type=int,
        default=OCR_PAGE_CAP,
        help="Leading pages rendered and OCR'd for scanned PDFs/images. "
        "0 disables OCR entirely: scans then come back as empty_text "
        "(useful for a fast text-layer-only pass over the whole corpus).",
    )
    parser.add_argument(
        "--bip-categories",
        default=None,
        help="Comma-separated categories to parse (przetargi, oswiadczenia, "
        "nabor, inne); default all. With --bip-ocr-only it OCRs only that "
        "part of the backlog, e.g. declarations and tenders first.",
    )
    parser.add_argument(
        "--bip-ocr-only",
        action="store_true",
        help="Only revisit documents that a previous run could not parse "
        "normally (status empty_text), i.e. the OCR backlog. Requires "
        "--bip-ocr-pages > 0.",
    )
    parser.add_argument(
        "--bip-force-parse",
        action="store_true",
        help="Re-parse documents even when a current-version parse exists.",
    )


@cache
def _args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    add_arguments(parser)
    return parser.parse_known_args()[0]


@dataclass(frozen=True)
class DocTask:
    sha256: str
    url: str
    host: str
    filename: str
    content_type: str
    size: int
    bundle: str


@dataclass
class Extraction:
    status: str
    method: str
    text: str
    pages: int = 0
    ocr_pages: int = 0
    ocr_confidence: float | None = None
    title: str | None = None
    error: str | None = None


# -- extraction --------------------------------------------------------------
def classify_document(data: bytes) -> str:
    """Content kind from magic bytes (not the HTTP content type)."""
    if data[:4] == b"%PDF":
        return "pdf"
    if data[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        return "ole"
    if data[:4] == b"PK\x03\x04":
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                names = set(archive.namelist())
        except Exception:
            return "zip"
        if any(name.startswith("word/") for name in names):
            return "docx"
        if any(name.startswith("xl/") for name in names):
            return "xlsx"
        if any(name.startswith("ppt/") for name in names):
            return "pptx"
        if "content.xml" in names:
            return "odf"
        return "zip"
    if data[:2] == b"\xff\xd8":
        return "jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] in (b"II*\x00", b"MM\x00*"):
        return "tiff"
    if data[:5] == b"{\\rtf":
        return "rtf"
    return "other"


def _ocr_engine() -> Any:
    global _engine
    if _engine is None:
        import cv2  # noqa: PLC0415
        from rapidocr_onnxruntime import RapidOCR  # noqa: PLC0415

        cv2.setNumThreads(1)
        _engine = RapidOCR(
            intra_op_num_threads=1,
            inter_op_num_threads=1,
            use_cls=False,
        )
    return _engine


def _ocr_image(image: Any) -> tuple[str, float | None]:
    lines, _ = _ocr_engine()(image)
    if not lines:
        return "", None
    text = " ".join(str(line[1]) for line in lines)
    confidence = round(statistics.mean(float(line[2]) for line in lines), 3)
    return text, confidence


def _extract_pdf(data: bytes, ocr_pages: int) -> Extraction:
    import pymupdf  # noqa: PLC0415

    document = pymupdf.open(stream=data, filetype="pdf")
    try:
        pages = len(document)
        metadata = document.metadata or {}
        title = metadata.get("title") or None
        page_texts = [document.load_page(index).get_text() for index in range(pages)]
    finally:
        document.close()
    chars = sum(len(text) for text in page_texts)
    if pages and chars / pages >= 100:
        text = "\n\f\n".join(page_texts)
        return Extraction("ok", "pdf_text", text, pages=pages, title=title)
    return _ocr_pdf(data, pages, title, ocr_pages)


def _ocr_pdf(data: bytes, pages: int, title: str | None, ocr_pages: int) -> Extraction:
    target = min(pages, max(0, ocr_pages))
    if target == 0:
        return Extraction(
            "empty_text", "none", "", pages=pages, title=title, error="ocr disabled"
        )
    import pypdfium2 as pdfium  # noqa: PLC0415
    parts: list[str] = []
    confidences: list[float] = []
    document = pdfium.PdfDocument(data)
    try:
        for index in range(target):
            image = document[index].render(scale=OCR_SCALE).to_pil()
            text, confidence = _ocr_image(image)
            if text:
                parts.append(text)
            if confidence is not None:
                confidences.append(confidence)
            if len(" ".join(parts)) >= 200:
                break
    finally:
        document.close()
    text = "\n\f\n".join(parts)
    status = "ok" if text.strip() else "empty_text"
    ocr_confidence = round(statistics.mean(confidences), 3) if confidences else 0.0
    return Extraction(
        status,
        "ocr",
        text,
        pages=pages,
        ocr_pages=target,
        ocr_confidence=ocr_confidence,
        title=title,
    )


def _extract_image(data: bytes, ocr_pages: int) -> Extraction:
    if ocr_pages <= 0:
        return Extraction("empty_text", "none", "", error="ocr disabled")
    from PIL import Image  # noqa: PLC0415

    image = Image.open(io.BytesIO(data)).convert("RGB")
    text, confidence = _ocr_image(image)
    status = "ok" if text.strip() else "empty_text"
    return Extraction(status, "ocr_image", text, ocr_pages=1, ocr_confidence=confidence)


def _printable_runs(data: bytes) -> str:
    """Readable text runs from a binary stream (last-resort for OLE formats)."""
    parts = [
        match.group().decode("cp1252", "replace")
        for match in _PRINTABLE_RUN_RE.finditer(data)
    ]
    parts += [
        match.group().decode("utf-16-le", "replace")
        for match in _UTF16_RUN_RE.finditer(data)
    ]
    kept: list[str] = []
    for part in parts:
        part = part.strip()
        if len(part) < 20:
            continue
        alnum = sum(char.isalnum() for char in part)
        if alnum / len(part) < 0.35:  # tables and formatting runs, not text
            continue
        kept.append(part)
    return "\n".join(kept)


def _clean_word_text(text: str) -> str:
    for bad, good in (("\x07", " "), ("\x0b", "\n"), ("\x0c", "\n"), ("\r", "\n")):
        text = text.replace(bad, good)
    return text


def _word97_piece_table(clx: bytes) -> bytes:
    """The PlcPcd from a Word 97 CLX (skipping the leading Prc entries)."""
    position = 0
    while position < len(clx):
        marker = clx[position]
        if marker == 0x01:
            size = int.from_bytes(clx[position + 1 : position + 3], "little")
            position += 3 + size
        elif marker == 0x02:
            size = int.from_bytes(clx[position + 1 : position + 5], "little")
            return clx[position + 5 : position + 5 + size]
        else:
            return b""
    return b""


def _word97_text(word: bytes, table: bytes) -> str:
    """Text via the Word 97 piece table, handling CP1252 and UTF-16 pieces."""
    if len(word) < 0x01AC or not table:
        return ""
    fc_clx = int.from_bytes(word[0x01A2:0x01A6], "little")
    lcb_clx = int.from_bytes(word[0x01A6:0x01AA], "little")
    plc = _word97_piece_table(table[fc_clx : fc_clx + lcb_clx])
    count = (len(plc) - 4) // 12
    if count <= 0:
        return ""
    positions = [
        int.from_bytes(plc[4 * index : 4 * index + 4], "little")
        for index in range(count + 1)
    ]
    pcds = plc[4 * (count + 1) :]
    chunks: list[str] = []
    for index in range(count):
        fc = int.from_bytes(pcds[8 * index + 2 : 8 * index + 6], "little")
        length = positions[index + 1] - positions[index]
        if length <= 0:
            continue
        if fc & 0x40000000:  # compressed: one CP1252 byte per character
            offset = (fc & 0x3FFFFFFF) // 2
            chunks.append(word[offset : offset + length].decode("cp1252", "replace"))
        else:
            offset = fc & 0x3FFFFFFF
            chunks.append(
                word[offset : offset + length * 2].decode("utf-16-le", "replace")
            )
    return "".join(chunks)


def _extract_word97(ole: Any) -> Extraction:
    with ole.openstream("WordDocument") as stream:
        word = stream.read()
    flags = int.from_bytes(word[0x0A:0x0C], "little") if len(word) > 0x0C else 0
    table_name = "1Table" if flags & 0x0200 else "0Table"
    try:
        with ole.openstream(table_name) as stream:
            table = stream.read()
    except Exception:
        table = b""
    text = _clean_word_text(_word97_text(word, table))
    if len(text.strip()) < 40:
        fallback = _clean_word_text(_printable_runs(word))
        if len(fallback.strip()) > len(text.strip()):
            text = fallback
    status = "ok" if len(text.strip()) >= 20 else "empty_text"
    return Extraction(status, "doc_ole", text)


def _extract_xls(data: bytes) -> Extraction:
    import xlrd  # noqa: PLC0415

    try:
        book = xlrd.open_workbook(file_contents=data)
    except Exception as exc:
        return Extraction("error", "none", "", error=f"xls: {exc}")
    rows: list[str] = []
    for sheet in book.sheets():
        for index in range(sheet.nrows):
            cells = [
                str(cell.value).strip()
                for cell in sheet.row(index)
                if str(cell.value).strip()
            ]
            if cells:
                rows.append(" | ".join(cells))
    text = "\n".join(rows)
    status = "ok" if text.strip() else "empty_text"
    return Extraction(status, "xls", text)


def _extract_stream_text(ole: Any, stream_name: str, method: str) -> Extraction:
    try:
        with ole.openstream(stream_name) as stream:
            text = _printable_runs(stream.read())
    except Exception as exc:
        return Extraction("error", "none", "", error=f"{method}: {exc}")
    status = "ok" if text.strip() else "empty_text"
    return Extraction(status, method, text)


def _extract_ole(data: bytes) -> Extraction:
    try:
        import olefile  # noqa: PLC0415
    except ImportError:
        # olefile is a normal dependency now, but keep a legacy .doc from
        # taking a worker down if the environment ever lacks it: mark it
        # unsupported instead of raising.
        return Extraction("unsupported", "none", "", error="ole: olefile not installed")

    try:
        ole = olefile.OleFileIO(io.BytesIO(data))
    except Exception as exc:
        return Extraction("unsupported", "none", "", error=f"ole: {exc}")
    try:
        names = ["/".join(parts).lower() for parts in ole.listdir()]
        if any(name.endswith("worddocument") for name in names):
            return _extract_word97(ole)
        if any(name.endswith(("workbook", "book")) for name in names):
            return _extract_xls(data)
        if any("powerpoint" in name for name in names):
            return _extract_stream_text(ole, "PowerPoint Document", "ppt_ole")
        return Extraction(
            "unsupported", "none", "", error=f"ole streams: {', '.join(names[:4])}"
        )
    finally:
        ole.close()


def _extract_zip(data: bytes, ocr_pages: int, depth: int) -> Extraction:
    parts: list[str] = []
    methods: set[str] = set()
    total = 0
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for info in archive.infolist():
                if info.is_dir() or info.flag_bits & 0x1:
                    continue
                if info.file_size > MAX_ZIP_MEMBER_BYTES or total > MAX_ZIP_TOTAL_BYTES:
                    continue
                if len(methods) >= MAX_ZIP_MEMBERS:
                    break
                member = archive.read(info)
                total += len(member)
                inner = extract_document(member, ocr_pages, depth + 1)
                methods.add(inner.method)
                if inner.text.strip():
                    parts.append(f"[{info.filename}]\n{inner.text}")
    except (zipfile.BadZipFile, OSError, RuntimeError) as exc:
        return Extraction("error", "none", "", error=f"zip: {exc}")
    text = "\n\n".join(parts)
    status = "ok" if text.strip() else "empty_text"
    method = "zip+" + "+".join(sorted(methods)) if methods else "zip"
    return Extraction(status, method, text)


def extract_document(
    data: bytes, ocr_pages: int = OCR_PAGE_CAP, depth: int = 0
) -> Extraction:
    """Text of one document plus how it was obtained."""
    kind = classify_document(data)
    if kind == "pdf":
        return _extract_pdf(data, ocr_pages)
    if kind in ("docx", "xlsx", "pptx", "odf"):
        text = _zip_text(data)
        status = "ok" if text.strip() else "empty_text"
        return Extraction(status, "xml", text)
    if kind == "rtf":
        text = "" if not data else _RTF_RE.sub(" ", data.decode("latin-1", "replace"))
        status = "ok" if text.strip() else "empty_text"
        return Extraction(status, "rtf", text)
    if kind in ("jpeg", "tiff", "png"):
        return _extract_image(data, ocr_pages)
    if kind == "zip":
        if depth >= ZIP_DEPTH_LIMIT:
            return Extraction("unsupported", "none", "", error="nested archive")
        return _extract_zip(data, ocr_pages, depth)
    if kind == "ole":
        return _extract_ole(data)
    return Extraction("unsupported", "none", "", error=f"unsupported kind: {kind}")


def _zip_text(data: bytes) -> str:
    chunks: list[str] = []
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for name in archive.namelist():
            if name.endswith(".xml"):
                chunks.append(
                    _TAG_RE.sub(" ", archive.read(name).decode("utf-8", "replace"))
                )
    return re.sub(r"[ \t]+", " ", " ".join(chunks)).strip()


def _extract_safely(data: bytes, ocr_pages: int) -> Extraction:
    try:
        return extract_document(data, ocr_pages)
    except Exception as exc:
        return Extraction("error", "none", "", error=f"{type(exc).__name__}: {exc}")


# -- bundle reading ----------------------------------------------------------
def _locate_bundle(bundle: str, bundles_dir: str) -> Path | None:
    path = Path(bundles_dir) / bundle
    if path.is_file():
        return path
    part = path.with_name(path.name + ".part")
    return part if part.is_file() else None


def _iter_tar_members(path: Path) -> Iterator[tuple[str, bytes]]:
    """Stream a bundle; an unclosed ``.part`` simply ends early."""
    try:
        archive = tarfile.open(path, "r|gz")
    except (tarfile.TarError, OSError):
        return
    try:
        while True:
            try:
                member = archive.next()
            except (tarfile.TarError, EOFError):
                break
            if member is None:
                break
            if not member.isfile():
                continue
            fileobj = archive.extractfile(member)
            if fileobj is None:
                continue
            try:
                data = fileobj.read()
            except (tarfile.TarError, EOFError, OSError):
                break
            yield member.name, data
    finally:
        archive.close()


def _missing(reason: str) -> Extraction:
    return Extraction("missing_blob", "none", "", error=reason)


def _record(task: DocTask, extraction: Extraction) -> BipDocumentParsed:
    text = extraction.text
    return BipDocumentParsed(
        sha256=task.sha256,
        url=task.url,
        host=task.host,
        filename=task.filename,
        content_type=task.content_type,
        size=task.size,
        bundle=task.bundle,
        parser_version=PARSER_VERSION,
        status=extraction.status,
        method=extraction.method,
        text=text,
        text_hash=hashlib.sha256(text.encode("utf-8")).hexdigest(),
        text_chars=len(text),
        pages=extraction.pages,
        ocr_pages=extraction.ocr_pages,
        ocr_confidence=extraction.ocr_confidence,
        title=extraction.title,
        error=extraction.error,
    )


def _parse_bundle(
    bundle: str, tasks: list[DocTask], bundles_dir: str, ocr_pages: int = OCR_PAGE_CAP
) -> list[BipDocumentParsed]:
    path = _locate_bundle(bundle, bundles_dir)
    if path is None:
        return [_record(task, _missing("bundle file not found")) for task in tasks]
    wanted = {task.sha256: task for task in tasks}
    found: dict[str, Extraction] = {}
    for _name, data in _iter_tar_members(path):
        digest = hashlib.sha256(data).hexdigest()
        if digest not in wanted or digest in found:
            continue
        found[digest] = _extract_safely(data, ocr_pages)
        if len(found) == len(wanted):
            break
    return [
        _record(task, found.get(task.sha256, _missing("blob not in bundle")))
        for task in tasks
    ]


def _parse_all(
    tasks: list[DocTask], bundles_dir: str, workers: int, ocr_pages: int = OCR_PAGE_CAP
) -> Iterator[BipDocumentParsed]:
    by_bundle: dict[str, list[DocTask]] = defaultdict(list)
    for task in tasks:
        by_bundle[task.bundle].append(task)
    items = sorted(by_bundle.items())
    print(f"bundles to read: {len(items)}")

    if workers <= 1:
        for bundle, group in items:
            yield from _parse_bundle(bundle, group, bundles_dir, ocr_pages)
            tqdm.write(f"parsed bundle {bundle} ({len(group)} docs)")
        return

    mp_context = multiprocessing.get_context("fork")
    with ProcessPoolExecutor(max_workers=workers, mp_context=mp_context) as pool:
        pending: dict[Future[list[BipDocumentParsed]], str] = {}
        iterator = iter(items)
        exhausted = False
        while not exhausted or pending:
            while not exhausted and len(pending) < workers * MAX_BUNDLES_IN_FLIGHT:
                try:
                    bundle, group = next(iterator)
                except StopIteration:
                    exhausted = True
                    break
                pending[
                    pool.submit(_parse_bundle, bundle, group, bundles_dir, ocr_pages)
                ] = bundle
            for future in as_completed(list(pending)):
                bundle = pending.pop(future)
                try:
                    rows = future.result()
                except Exception as exc:
                    print(f"bundle {bundle} failed: {exc}")
                    rows = [
                        _record(task, Extraction("error", "none", "", error=str(exc)))
                        for task in by_bundle[bundle]
                    ]
                tqdm.write(f"parsed bundle {bundle} ({len(rows)} docs)")
                yield from rows
                break


# -- postgres / incremental state --------------------------------------------
def _load_tasks(host_regex: str) -> list[DocTask]:
    pg = PostgresClient.from_env(max_size=2)
    try:
        rows = pg.fetchall(
            """
            SELECT sha256, url, host, filename, content_type, size, bundle
              FROM bip_docs
             WHERE host ~ %s AND bundle <> ''
             ORDER BY bundle, sha256
            """,
            (host_regex,),
        )
    finally:
        pg.close()
    return [DocTask(*row) for row in rows]


def _index_existing(paths: list[Path]) -> dict[str, dict[str, Any]]:
    """sha256 -> {parser_version, status, ocr_pages}, later sources winning."""
    previous: dict[str, dict[str, Any]] = {}
    for path in paths:
        if not path.exists():
            continue
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                try:
                    row = json.loads(line)
                except Exception:
                    continue
                sha = row.get("sha256")
                if isinstance(sha, str):
                    previous[sha] = {
                        "parser_version": int(row.get("parser_version") or 0),
                        "status": row.get("status"),
                        "ocr_pages": int(row.get("ocr_pages") or 0),
                    }
    return previous


def _select_by_category(
    tasks: list[DocTask], categories: dict[str, str], raw: str | None
) -> list[DocTask]:
    """Limit tasks to the given comma-separated URL categories (None = all)."""
    if not raw:
        return tasks
    wanted = {part.strip() for part in raw.split(",") if part.strip()}
    unknown = sorted(wanted - set(CATEGORIES))
    if unknown:
        raise ValueError(
            f"unknown categories {unknown}; available: {', '.join(CATEGORIES)}"
        )
    return [task for task in tasks if categories.get(task.url) in wanted]


def _ocr_only_tasks(
    already: dict[str, dict[str, Any]], needs: list[DocTask], ocr_pages: int
) -> list[DocTask]:
    """The OCR backlog: documents a previous run could not parse normally."""
    if ocr_pages <= 0:
        raise ValueError("--bip-ocr-only requires --bip-ocr-pages > 0")
    if not already:
        raise ValueError(
            "--bip-ocr-only selects documents a previous run could not parse, "
            "but no previous output exists. Run the normal pass first (or "
            "drop --bip-ocr-only)."
        )
    return [
        task
        for task in needs
        if (already.get(task.sha256) or {}).get("status") == "empty_text"
    ]


def _needs_parse(existing: dict[str, Any] | None, ocr_pages: int) -> bool:
    """Whether this run should parse the document again.

    Documents that produced text (or failed permanently) are reused as long as
    the parser version matches. Empty results are retried when this run allows
    at least as many OCR pages as the run that produced them, so a fast
    ``--bip-ocr-pages 0`` sweep can be followed by an OCR pass. Unsupported
    formats are retried whenever encountered: the parsers gain formats over
    time, and re-checking a small legacy file is cheap.
    """
    if existing is None or existing.get("parser_version") != PARSER_VERSION:
        return True
    status = existing.get("status")
    if status == "unsupported":
        return True
    if status != "empty_text":
        return False
    return int(existing.get("ocr_pages") or 0) < ocr_pages


def _load_categories(path: Path) -> dict[str, str]:
    """url -> predicted category, from BipUrlsClassified's output."""
    categories: dict[str, str] = {}
    if not path.exists():
        return categories
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            try:
                row = json.loads(line)
            except Exception:
                continue
            url = row.get("url")
            category = row.get("category")
            if isinstance(url, str) and isinstance(category, str):
                categories[url] = category
    return categories


class BipDocumentsParsed(IncrementalJsonlPipeline[BipDocumentParsed]):
    filename = "bip_documents_parsed"
    backup_to_shared_cache = False  # corpus text is large, keep it local
    interrupt_exceptions = (KeyboardInterrupt, InterruptedError)
    interrupt_note = "will save parsed documents written so far"

    urls: BipUrlsClassified

    @property
    def output_class(self):
        return BipDocumentParsed

    def _stash_stale_tmp(self) -> Path | None:
        """Keep a `.tmp` left by a killed run as a recovery source."""
        tmp = self.temp_output_path
        if not tmp.exists():
            return None
        stash = tmp.with_name(self.final_output_path.name + ".recover")
        tmp.replace(stash)
        print(f"recovering records from a previous run: {stash.name}")
        return stash

    def process(self, ctx: Context) -> pd.DataFrame:
        options = _args()
        if not options.bip_host_regex:
            raise ValueError(
                "BipDocumentsParsed needs --bip-host-regex, "
                "e.g. --bip-host-regex '^bip\\.poznan\\.pl$'"
            )
        stash = self._stash_stale_tmp()
        self.prepare_temp_output()
        sources = [self.final_output_path] + ([stash] if stash else [])
        tasks = _load_tasks(options.bip_host_regex)
        if options.bip_limit:
            tasks = tasks[: options.bip_limit]
        print(f"documents for {options.bip_host_regex!r}: {len(tasks)}")
        categories = _load_categories(self.urls.final_output_path)
        print(f"categories from BipUrlsClassified: {len(categories):,}")
        selected = _select_by_category(tasks, categories, options.bip_categories)
        if options.bip_categories:
            print(
                f"category filter {options.bip_categories!r}: "
                f"{len(selected):,} of {len(tasks):,} documents"
            )

        already = {} if options.bip_force_parse else _index_existing(sources)
        needs = [
            task
            for task in selected
            if _needs_parse(already.get(task.sha256), options.bip_ocr_pages)
        ]
        pending = needs
        if options.bip_ocr_only:
            pending = _ocr_only_tasks(already, needs, options.bip_ocr_pages)
        print(f"already parsed: {len(tasks) - len(needs)}, to parse: {len(pending)}")

        success = False
        try:
            # Carried over first: an interrupt then cannot drop previously
            # parsed documents from the output, only leave this run's own
            # pending documents to be parsed again next time.
            carried = self._carry_over(
                ctx, {task.sha256 for task in pending}, sources, categories
            )
            emitted: set[str] = set()
            try:
                self._emit_pending(ctx, pending, options, emitted, categories)
            except (KeyboardInterrupt, InterruptedError):
                # Pending documents not reached before the interrupt keep their
                # previous rows: the output stays complete, the next run simply
                # retries them.
                print("interrupted: restoring unparsed documents from the output")
                self._carry_over(
                    ctx,
                    {task.sha256 for task in pending} - emitted,
                    sources,
                    categories,
                )
                raise
            if already and carried + len(emitted) == 0:
                raise RuntimeError(
                    "nothing was carried over or parsed while a previous output "
                    f"exists ({len(already):,} rows): refusing to finalize an "
                    f"empty file (temp kept at {self.temp_output_path})"
                )
            success = True
        finally:
            if stash is not None and success:
                stash.unlink(missing_ok=True)
        return pd.DataFrame()

    def _emit_pending(
        self,
        ctx: Context,
        pending: list[DocTask],
        options: argparse.Namespace,
        emitted: set[str],
        categories: dict[str, str],
    ) -> None:
        with tqdm(
            total=len(pending),
            desc="Parsing BIP documents",
            unit="doc",
            smoothing=0.05,
        ) as bar:
            for record in _parse_all(
                pending,
                options.bip_bundles,
                options.bip_workers,
                options.bip_ocr_pages,
            ):
                record = replace(
                    record, url_category=categories.get(record.url, "")
                )
                ctx.io.dumper.insert_into(record, [])  # type: ignore[attr-defined]
                emitted.add(record.sha256)
                bar.update(1)
                if len(emitted) % FLUSH_EVERY == 0:
                    ctx.io.dumper.flush()  # type: ignore[attr-defined]

    def _carry_over(
        self,
        ctx: Context,
        skip: set[str],
        sources: list[Path],
        categories: dict[str, str],
    ) -> int:
        """Keep previously parsed documents (other hosts included) in the file.

        Newer sources are read first, so a recovered `.tmp` row wins over the
        older finalized row for the same document.
        """
        carried = 0
        seen: set[str] = set()
        for path in reversed(sources):
            if not path.exists():
                continue
            with path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    try:
                        row = json.loads(line)
                    except Exception:
                        continue
                    sha = row.get("sha256")
                    if not isinstance(sha, str) or sha in skip or sha in seen:
                        continue
                    try:
                        record = BipDocumentParsed(**row)
                    except TypeError:
                        continue
                    category = categories.get(record.url)
                    if category:
                        record = replace(record, url_category=category)
                    seen.add(sha)
                    ctx.io.dumper.insert_into(record, [])  # type: ignore[attr-defined]
                    carried += 1
                    if carried % FLUSH_EVERY == 0:
                        ctx.io.dumper.flush()  # type: ignore[attr-defined]
        print(f"carried over: {carried}")
        return carried
