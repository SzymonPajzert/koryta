from __future__ import annotations

import hashlib
import io
import json
import tarfile
import zipfile
from pathlib import Path

import pytest

from analysis.bip_documents_parsed import (
    PARSER_VERSION,
    DocTask,
    _index_existing,
    _needs_parse,
    _ocr_only_tasks,
    _parse_bundle,
    _select_by_category,
    classify_document,
    extract_document,
)
from scrapers.article.pipelines import incremental
from scrapers.article.pipelines.incremental import IncrementalJsonlPipeline
from scrapers.stores import Context


def _docx_bytes(text: str) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", f"<w:t>{text}</w:t>")
    return buffer.getvalue()


def test_classify_document_uses_magic_not_extension() -> None:
    assert classify_document(b"%PDF-1.7") == "pdf"
    assert classify_document(b"PK\x03\x04rest") == "zip"
    assert classify_document(b"{\\rtf1 hello}") == "rtf"
    assert classify_document(b"\xff\xd8rest") == "jpeg"
    assert classify_document(b"II*\x00rest") == "tiff"
    assert classify_document(b"\x89PNG\r\n\x1a\nrest") == "png"
    assert classify_document(b"hello") == "other"


def _zip_bytes(members: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data in members.items():
            archive.writestr(name, data)
    return buffer.getvalue()


def test_extract_zip_members_recursively() -> None:
    payload = _zip_bytes(
        {"a.rtf": b"{\\rtf1\\ansi Grien}", "b.bin": b"\x00\x01\x02"}
    )
    extraction = extract_document(payload)
    assert extraction.method.startswith("zip")
    assert extraction.status == "ok"
    assert "Grien" in extraction.text


def test_extract_docx_text_needs_no_heavy_deps() -> None:
    extraction = extract_document(_docx_bytes("Oswiadczenie majatkowe"))
    assert extraction.method == "xml"
    assert extraction.status == "ok"
    assert "Oswiadczenie majatkowe" in extraction.text


def test_extract_rtf_text() -> None:
    extraction = extract_document(b"{\\rtf1\\ansi Malgorzata Grien}")
    assert extraction.method == "rtf"
    assert extraction.status == "ok"
    assert "Malgorzata Grien" in extraction.text


def test_extract_unsupported_kind_is_marked() -> None:
    extraction = extract_document(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1legacy")
    assert extraction.status == "unsupported"
    assert extraction.method == "none"


def test_index_existing_merges_sources_with_later_winning(tmp_path: Path) -> None:
    older = tmp_path / "older.jsonl"
    newer = tmp_path / "newer.jsonl"
    older.write_text(
        json.dumps({"sha256": "aaa", "parser_version": 1, "status": "ok"}) + "\n"
    )
    newer.write_text(
        json.dumps({"sha256": "aaa", "parser_version": 1, "status": "unsupported"})
        + "\n"
        + json.dumps({"sha256": "bbb", "parser_version": 1, "status": "ok"})
        + "\n"
    )
    index = _index_existing([older, newer])
    assert set(index) == {"aaa", "bbb"}
    assert index["aaa"]["status"] == "unsupported"


def test_needs_parse_reuses_text_and_retries_empty_ocr() -> None:
    parsed_ok = {"parser_version": PARSER_VERSION, "status": "ok", "ocr_pages": 0}
    empty_without_ocr = {
        "parser_version": PARSER_VERSION,
        "status": "empty_text",
        "ocr_pages": 0,
    }
    old_version = {"parser_version": PARSER_VERSION - 1, "status": "ok", "ocr_pages": 2}
    unsupported = {
        "parser_version": PARSER_VERSION,
        "status": "unsupported",
        "ocr_pages": 0,
    }

    assert not _needs_parse(parsed_ok, 2)
    assert not _needs_parse(empty_without_ocr, 0)
    assert _needs_parse(empty_without_ocr, 1)
    assert _needs_parse(old_version, 2)
    assert _needs_parse(unsupported, 2)
    assert _needs_parse(None, 2)


def test_parse_bundle_matches_by_hash_and_reports_missing(tmp_path: Path) -> None:
    payload = b"{\\rtf1\\ansi Grien}"
    bundle_name = "hostname=bip.test/crawl=c1/uid_test-0001.tar.gz"
    bundle_path = tmp_path / bundle_name
    bundle_path.parent.mkdir(parents=True)
    with tarfile.open(bundle_path, "w:gz") as archive:
        for name, data in (
            ("bip.test/a.rtf", payload),
            ("bip.test/b.rtf", b"{\\rtf1\\ansi inny}"),
        ):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))

    found = DocTask(
        sha256=hashlib.sha256(payload).hexdigest(),
        url="https://bip.test/a.rtf",
        host="bip.test",
        filename="a.rtf",
        content_type="application/rtf",
        size=len(payload),
        bundle=bundle_name,
    )
    missing = DocTask(
        sha256="0" * 64,
        url="https://bip.test/z.rtf",
        host="bip.test",
        filename="z.rtf",
        content_type="application/rtf",
        size=1,
        bundle=bundle_name,
    )

    rows = {
        row.sha256: row
        for row in _parse_bundle(bundle_name, [found, missing], str(tmp_path))
    }

    assert rows[found.sha256].status == "ok"
    assert "Grien" in rows[found.sha256].text
    assert rows[found.sha256].parser_version == PARSER_VERSION
    assert rows[found.sha256].text_chars == len(rows[found.sha256].text)
    assert rows[missing.sha256].status == "missing_blob"


def test_ocr_only_refuses_without_previous_output() -> None:
    task = DocTask(
        sha256="a" * 64, url="https://bip.test/a.pdf", host="bip.test",
        filename="a.pdf", content_type="application/pdf", size=1, bundle="b",
    )
    with pytest.raises(ValueError):
        _ocr_only_tasks({}, [task], 1)

    already = {
        "a" * 64: {
            "parser_version": PARSER_VERSION,
            "status": "empty_text",
            "ocr_pages": 0,
        }
    }
    assert _ocr_only_tasks(already, [task], 1) == [task]
    with pytest.raises(ValueError):
        _ocr_only_tasks(already, [task], 0)


class _DummyPipeline(IncrementalJsonlPipeline):
    filename = "dummy"

    def process(self, ctx: Context) -> None:
        return None


def test_finalize_refuses_empty_over_nonempty_and_keeps_a_backup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(incremental, "VERSIONED_DIR", str(tmp_path))
    pipeline = _DummyPipeline()
    final = pipeline.final_output_path
    temp = pipeline.temp_output_path
    final.parent.mkdir(parents=True)
    final.write_text("previous\n")
    temp.write_text("")

    with pytest.raises(RuntimeError):
        pipeline.finalize_temp_output()
    assert final.read_text() == "previous\n"

    temp.write_text("new\n")
    pipeline.finalize_temp_output()
    assert final.read_text() == "new\n"
    assert final.with_name(final.name + ".bak").read_text() == "previous\n"


def test_select_by_category_filters_and_validates() -> None:
    def task(sha: str, url: str) -> DocTask:
        return DocTask(
            sha256=sha, url=url, host="x", filename="a",
            content_type="", size=0, bundle="b",
        )

    tasks = [task("a" * 64, "https://x/a"), task("b" * 64, "https://x/b")]
    categories = {"https://x/a": "oswiadczenia", "https://x/b": "przetargi"}
    assert _select_by_category(tasks, categories, "oswiadczenia") == [tasks[0]]
    assert _select_by_category(tasks, categories, None) == tasks
    with pytest.raises(ValueError):
        _select_by_category(tasks, categories, "bogus")
