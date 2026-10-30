"""The cutter on made-up declarations, through RapidOCR as it runs on predator.

The pages are drawn, not scanned, so these check that the label, the bands
and the reading find what they should, not how well OCR reads handwriting:
the prototype's 145 real crops measured that (README of
~/.cache/koryta/bip-birthdates-2026-10-23, "Crops (2026-10-29)").
"""

from __future__ import annotations

import io
import random
import zipfile

import pytest
from PIL import Image

from jobs.bip_declarations.cutter import (
    MAX_PNG_BYTES,
    Ocr,
    cut_file,
    kind_of,
    png,
)
from jobs.bip_declarations.tests.synthetic_declarations import (
    scan_page,
    scanned_pdf,
    typed_pdf,
)

URL = "https://bip.gmina-testowa.example/oswiadczenie.pdf"


@pytest.fixture(scope="module")
def ocr():
    return Ocr(threads=4)


def test_a_typed_declaration_is_read_from_its_text_layer(ocr):
    result = cut_file(typed_pdf("Jan Testowy", "12.03.1965"), URL, ocr)

    assert (result.status, result.kind, result.pages) == ("cut", "pdf", 1)
    [crop] = result.crops
    assert (crop.page, crop.sort, crop.birth_date) == (0, "text_layer", "1965-03-12")
    assert crop.name == "Jan Testowy"
    assert crop.declaration_year == 2023
    assert crop.date_png.startswith(b"\x89PNG") and len(crop.date_png) <= MAX_PNG_BYTES


def test_a_councils_file_gives_a_crop_per_declaration(ocr):
    data = scanned_pdf(
        scan_page("Jan Testowy", "12.03.1965"),
        scan_page("Ewa Probna", "", place=""),
    )

    result = cut_file(data, URL, ocr, council=True)

    assert result.status == "cut"
    assert [(c.page, c.sort) for c in result.crops] == [(0, "ocr"), (1, "blank")]
    first, second = result.crops
    assert first.birth_date == "1965-03-12"
    assert "Testowy" in first.name
    assert "Probna" in second.name
    assert second.birth_date == ""
    assert first.name_png.startswith(b"\x89PNG")


def test_one_persons_scan_stops_at_its_first_declaration(ocr):
    data = scanned_pdf(
        scan_page("Jan Testowy", "12.03.1965"), scan_page("Ewa Probna", "")
    )

    result = cut_file(data, URL, ocr)

    assert [c.page for c in result.crops] == [0]
    assert result.pages_read == 1


def _zip(members: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data in members.items():
            archive.writestr(name, data)
    return buffer.getvalue()


@pytest.mark.parametrize(
    ("data", "kind"),
    [
        (b"%PDF-1.4 ...", "pdf"),
        (_zip({"word/document.xml": b"<w/>"}), "docx"),
        (_zip({"content.xml": b"<o/>"}), "odt"),
        (_zip({"a.txt": b"a"}), "zip"),
        (b"\xd0\xcf\x11\xe0 an old .doc", "doc"),
        (b"\xff\xd8\xff\xe0 a jpeg", "image"),
        (b"  <!DOCTYPE html><html>", "html"),
        (b"what is this", "unknown"),
    ],
)
def test_kind_of(data, kind):
    assert kind_of(data) == kind


def test_files_that_are_no_declaration(ocr):
    assert cut_file(b"<!doctype html><html></html>", URL, ocr).status == "not_fetched"
    assert cut_file(b"%PDF-1.4 broken", URL, ocr).status == "unreadable"
    assert cut_file(b"what is this", URL, ocr).status == "unreadable"


def test_a_word_file_without_a_scan_is_a_blank_form(ocr):
    docx = _zip({"word/document.xml": b"<w:document/>"})

    result = cut_file(docx, "https://bip.example/wzor-oswiadczenia.docx", ocr)

    assert (result.status, result.kind, result.pages) == ("blank_form", "docx", 0)


def test_png_shrinks_a_crop_the_site_would_refuse():
    rng = random.Random(1)
    noise = Image.frombytes(
        "L", (900, 900), bytes(rng.randrange(256) for _ in range(810_000))
    )

    data = png(noise)

    assert data.startswith(b"\x89PNG")
    assert len(data) <= MAX_PNG_BYTES
