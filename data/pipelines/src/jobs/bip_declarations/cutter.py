"""Cut the birth date and the name out of one BIP asset declaration.

Ported from the 2026-10-29 prototype (`~/.cache/koryta/bip-birthdates-2026-10-23`,
`ocr_cache.py` and `cut.py`, README section "Crops"), which cut 1,070
declarations: of 145 handwritten crops read by a person, 87% read clearly and
none was cut on the wrong line.

A page is rendered with its long side at 2340 px (200 dpi for A4) and read with
RapidOCR. The date's line is the one starting with the printed "urodzony(a)":
read as such, read with up to two wrong letters, or placed under the name's
line where a cut of the line's start still reads like the label. The crop runs
from the label to the printed "w" before the place of birth, from the line
above it down to the dotted line found in the pixels. The name's crop runs from
"podpisany(a)" to the right margin, down to the printed "(imiona i nazwisko ...)".

Then the date is read, if anybody can read it but a person:

- `text_layer`: a PDF drawn from text, not a scan, gives the date after its
  label, and the crop's OCR does not read another one;
- `ocr`: RapidOCR reads a valid date in the crop with a score of 0.9 or more -
  typed text mostly, and neat handwriting (6 of 24 checked on 10-29, all read
  right);
- `handwritten`: pen strokes taller than the dotted line's dots, but no clean date;
- `blank`: nothing on the line but the printed dots.

A declaration of one person has its part A on one of the first pages, so those
are read upright and then turned, until one has the label. A council's file
holds every councillor's declaration one after another: every page is read
upright, and each that has the label is a crop of its own, for the name on it
to say whose.

The files are untrusted downloads. Nothing in them is executed, and what is
taken out of a Word file stays in memory.
"""

from __future__ import annotations

import io
import re
import zipfile
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import Any, TypedDict

import cv2
import numpy as np
from PIL import Image, ImageOps

from jobs.bip_declarations.reading import (
    LABEL,
    born_in_text,
    date_in,
    declaration_year,
    fold,
    looks_typed,
    name_in_text,
)

#: The page's long side when rendered: 200 dpi for A4, what the geometry was tuned on.
LONG_SIDE = 2340
#: Pictures in a Word file smaller than this are logos and fragments, not pages.
MIN_IMAGE_BYTES = 40_000
#: Pages of one person's declaration read upright, and of those, turned.
PAGES_UPRIGHT = 3
PAGES_TURNED = 2
#: Pages of a council's file read at most. One reads in ~10 core-seconds.
COUNCIL_PAGES = 150
#: The site refuses a picture over 200 kB (`MAX_IMAGE_BYTES` in
#: frontend/shared/declarations.ts); the largest crop of 10-29 was 78 kB.
MAX_PNG_BYTES = 190_000
#: A PDF page counts as a scan when one picture covers this much of it: its
#: text, if any, is a scanner's OCR, not what the declarant typed.
SCAN_COVER = 0.5

NAME_LABEL = re.compile(r"p\s?o\s?d\s?p\s?i\s?s\s?a\s?n")
UNDER_NAME = re.compile(r"\(?\s?i\s?m\s?i\s?o\s?n|nazwisk")
SEPARATOR_BOX = {"w", "w.", "w..", "w...", "we", "w:", ".w", "..w", "w,"}
# OCR's usual misreadings of the printed labels: "podpsany", "(lmlona ...",
# "nazwiskgoraz", "zatrudnlenia".
NAME_ANCHOR = re.compile(r"p\s?o\s?d\s?p\s?i?\s?s\s?a\s?n")
UNDER_NAME_ANCHOR = re.compile(
    r"[il1]\s?m\s?[il1]\s?[o0]\s?n\w*\s?[il1y]?\s?nazw|nazwisk\w?\s?(?:oraz|g?oraz)?\s?nazwisk|rodow"
)
EMPLOYER_ANCHOR = re.compile(r"zatrud|stanowisk")
#: A Word file posted to be filled in, not a filled one.
TEMPLATE_URL = re.compile(r"wz[oó]r|druk|formularz|szablon|template", re.I)

Box = tuple[float, float, float, float]


class OcrLine(TypedDict):
    box: list[list[int]]
    text: str
    score: float
    words: list[list[list[int]]] | None


# -- OCR ---------------------------------------------------------------------------


class Ocr:
    """RapidOCR, loaded on first use: one per process."""

    def __init__(self, threads: int = 2) -> None:
        self.threads = threads
        self._engine: Any = None

    def _run(self, image: Image.Image, words: bool = False) -> list[Any]:
        if self._engine is None:
            from rapidocr_onnxruntime import RapidOCR  # noqa: PLC0415 - loads a model

            self._engine = RapidOCR(
                use_cls=False, intra_op_num_threads=self.threads, inter_op_num_threads=1
            )
        result, _ = self._engine(np.array(image.convert("RGB")), return_word_box=words)
        return list(result or [])

    def lines(self, image: Image.Image) -> list[OcrLine]:
        """Every line RapidOCR reads on the page, with its box and its words' boxes."""
        lines: list[OcrLine] = []
        for entry in self._run(image, words=True):
            box, text, score = entry[0], entry[1], entry[2]
            words = entry[3] if len(entry) > 3 else None
            lines.append(
                {
                    "box": [[round(float(x)), round(float(y))] for x, y in box],
                    "text": str(text),
                    "score": round(float(score), 3),
                    "words": (
                        [
                            [[round(float(x)), round(float(y))] for x, y in w]
                            for w in words
                        ]
                        if words
                        else None
                    ),
                }
            )
        return lines

    def read(self, piece: Image.Image) -> list[tuple[str, float]]:
        """What RapidOCR reads in a crop at twice its size: (text, score) per box."""
        doubled = piece.resize(
            (piece.width * 2, piece.height * 2), Image.Resampling.LANCZOS
        )
        return [(str(r[1]), round(float(r[2]), 3)) for r in self._run(doubled)]

    def text(self, piece: Image.Image) -> str:
        return " ".join(str(r[1]) for r in self._run(piece))


# -- the file's pages -----------------------------------------------------------------


def kind_of(data: bytes) -> str:
    """What a downloaded file is, by its first bytes: never by the server's word."""
    if data[:4] == b"%PDF":
        return "pdf"
    if data[:2] == b"PK":
        try:
            names = zipfile.ZipFile(io.BytesIO(data)).namelist()
        except zipfile.BadZipFile:
            return "bad_zip"
        if "word/document.xml" in names:
            return "docx"
        if "content.xml" in names:
            return "odt"
        return "zip"
    if data[:4] == b"\xd0\xcf\x11\xe0":
        return "doc"
    if (
        data[:3] == b"\xff\xd8\xff"
        or data[:8] == b"\x89PNG\r\n\x1a\n"
        or data[:4] in (b"II*\x00", b"MM\x00*")
    ):
        return "image"
    if data.lstrip()[:15].lower().startswith((b"<!doctype", b"<html")):
        return "html"
    return "unknown"


def _fit(image: Image.Image) -> Image.Image:
    image = image.convert("L")
    scale = LONG_SIDE / max(image.size)
    if 0.95 < scale < 1.05:
        return image
    size = (round(image.width * scale), round(image.height * scale))
    return image.resize(size, Image.Resampling.LANCZOS)


def _carve(data: bytes) -> list[bytes]:
    """JPEG and PNG streams inside an old .doc (pictures are stored whole)."""
    found = []
    for match in re.finditer(rb"\xff\xd8\xff[\xe0-\xef\xdb]", data):
        end = data.find(b"\xff\xd9", match.start())
        while end != -1:
            piece = data[match.start() : end + 2]
            try:
                Image.open(io.BytesIO(piece)).load()
                found.append(piece)
                break
            except Exception:  # noqa: BLE001 - a marker inside the stream, look further
                end = data.find(b"\xff\xd9", end + 2)
                if end - match.start() > 50_000_000:
                    break
    for match in re.finditer(rb"\x89PNG\r\n\x1a\n", data):
        end = data.find(b"IEND\xaeB`\x82", match.start())
        if end != -1:
            found.append(data[match.start() : end + 8])
    return found


class Pages:
    """A file's pages, rendered when first asked for: a council's file can run to
    a hundred, and only the ones read need to be in memory."""

    def __init__(self, data: bytes, kind: str) -> None:
        self.kind = kind
        self._pdf: Any = None
        self._images: list[Image.Image] = []
        if kind == "pdf":
            import pypdfium2 as pdfium  # noqa: PLC0415 - only PDFs need it

            self._pdf = pdfium.PdfDocument(data)
            self.count = len(self._pdf)
        else:
            self._images = _picture_pages(data, kind)
            self.count = len(self._images)

    def image(self, index: int) -> Image.Image:
        if self._pdf is None:
            return self._images[index]
        page = self._pdf[index]
        width, height = page.get_size()
        rendered = page.render(scale=LONG_SIDE / max(width, height), grayscale=True)
        return rendered.to_pil().convert("L")

    def text(self, index: int) -> str:
        """The page's text layer, if it was drawn from text and is not a scan."""
        if self._pdf is None:
            return ""
        page = self._pdf[index]
        if _is_scan(page):
            return ""
        return str(page.get_textpage().get_text_range())

    def close(self) -> None:
        if self._pdf is not None:
            self._pdf.close()


def _is_scan(page: Any) -> bool:
    import pypdfium2.raw as pdfium_c  # noqa: PLC0415 - only PDFs need it

    width, height = page.get_size()
    area = max(1.0, width * height)
    for obj in page.get_objects(filter=[pdfium_c.FPDF_PAGEOBJ_IMAGE], max_depth=2):
        left, bottom, right, top = obj.get_bounds()
        if (right - left) * (top - bottom) >= SCAN_COVER * area:
            return True
    return False


def _picture_pages(data: bytes, kind: str) -> list[Image.Image]:
    if kind == "image":
        image = Image.open(io.BytesIO(data))
        frames = []
        for index in range(getattr(image, "n_frames", 1)):
            image.seek(index)
            frames.append(_fit(image))
        return frames
    if kind in ("docx", "odt"):
        archive = zipfile.ZipFile(io.BytesIO(data))
        folder = "word/media/" if kind == "docx" else "Pictures/"
        members = [
            m
            for m in archive.infolist()
            if m.filename.startswith(folder) and m.file_size >= MIN_IMAGE_BYTES
        ]
        blobs = [archive.read(m) for m in sorted(members, key=lambda m: -m.file_size)]
    elif kind == "doc":
        blobs = sorted(
            (b for b in _carve(data) if len(b) >= MIN_IMAGE_BYTES),
            key=len,
            reverse=True,
        )
    else:
        return []
    pages = []
    for blob in blobs[:PAGES_UPRIGHT]:
        try:
            pages.append(_fit(Image.open(io.BytesIO(blob))))
        except Exception:  # noqa: BLE001 - EMF, WMF and the like
            continue
    return pages


# -- geometry ------------------------------------------------------------------------


def bounds(points: list[list[int]]) -> Box:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def span(line: OcrLine, start: int, end: int) -> Box:
    """The box of text[start:end] of an OCR line, from its words' boxes when
    RapidOCR gives one per character, else in proportion."""
    x0, y0, x1, y1 = bounds(line["box"])
    words = line["words"]
    if words and len(words) == len(line["text"]) and 0 <= start < end <= len(words):
        part = [bounds(w) for w in words[start:end]]
        return (
            min(c[0] for c in part),
            min(c[1] for c in part),
            max(c[2] for c in part),
            max(c[3] for c in part),
        )
    n = max(1, len(line["text"]))
    return x0 + (x1 - x0) * start / n, y0, x0 + (x1 - x0) * end / n, y1


def label_end(folded: str, end: int) -> int:
    """Past the "y(a)", "a", "/a", "(-na)" that follows the label's stem."""
    tail = re.match(
        r"[a-z]{0,2}\s?(?:\(\s?-?\s?[a-z]{1,2}\s?\)|/\s?[a-z]{1,2})?\s?[,:.]?",
        folded[end:],
    )
    return end + (tail.end() if tail else 0)


def find_label(
    lines: list[OcrLine], pattern: re.Pattern[str]
) -> tuple[int, int, int] | None:
    """(line index, label start, label end) of the first line the pattern matches."""
    for index, line in enumerate(lines):
        folded = fold(line["text"])
        match = pattern.search(folded)
        if match:
            start = match.start()
            if start > 0 and folded[start - 1] in "un":
                start -= 1
            return index, start, label_end(folded, match.end())
    return None


def has_label(lines: list[OcrLine]) -> bool:
    return find_label(lines, LABEL) is not None


def looks_upright(lines: list[OcrLine]) -> bool:
    """Ten or more long lines read with confidence: the page is the right way up."""
    return (
        sum(1 for line in lines if line["score"] > 0.9 and len(line["text"]) > 15) >= 10
    )


def dark_level(piece: np.ndarray, under_paper: int) -> float:
    """Grey levels under this count as ink: Otsu's split, and at least
    `under_paper` under the paper's own grey. A black-and-white scan has two
    levels only, where OpenCV's Otsu answers 0: split those in the middle."""
    paper = float(np.percentile(piece, 90))
    otsu, _ = cv2.threshold(piece, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if otsu < 40:
        otsu = 128.0
    return min(float(otsu), paper - under_paper)


def dotted_line(
    grey: np.ndarray,
    rows: range,
    x0: int,
    x1: int,
    bins: int = 24,
    expect: float | None = None,
) -> int | None:
    """The row in `rows` whose dark pixels spread furthest across [x0, x1): the
    dotted (or ruled) line the date is written on. Dark is the window's own
    threshold, so pale dots on a grey scan count. Of the rows spreading nearly
    as far as the best, the one nearest `expect` (else the lowest) wins: the
    next line's dots can be in the window too."""
    x0, x1 = max(0, x0), min(grey.shape[1], x1)
    y0, y1 = max(0, rows.start - 1), min(grey.shape[0], rows.stop + 2)
    if x1 - x0 < bins * 4 or y1 - y0 < 3:
        return None
    window = grey[y0:y1, x0:x1]
    ink = window < dark_level(window, 30)
    edges = np.linspace(0, x1 - x0, bins + 1).astype(int)
    spreads = {}
    for y in rows:
        if not y0 + 1 <= y < y1 - 1:
            continue
        row = ink[y - y0 - 1 : y - y0 + 2].max(axis=0)
        spreads[y] = sum(bool(row[a:b].any()) for a, b in zip(edges[:-1], edges[1:]))
    if not spreads or max(spreads.values()) < 0.6 * bins:
        return None
    floor = max(0.6 * bins, 0.85 * max(spreads.values()))
    near = [y for y, spread in spreads.items() if spread >= floor]
    if expect is None:
        return max(near)
    return min(near, key=lambda y: (abs(y - expect), -y))


def is_separator(text: str) -> bool:
    """A box of the printed "w" before the place of birth, alone or run into
    the handwritten place ("W.BED.ZINIE")."""
    folded = fold(text).strip()
    return folded in SEPARATOR_BOX or bool(
        re.match(r"w\s?[.…_]{1,}\s?[a-z]{3}", folded)
    )


def _distance(a: str, b: str) -> int:
    row = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev, row[0] = row[0], i
        for j, cb in enumerate(b, 1):
            prev, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, prev + (ca != cb))
    return row[-1]


def fuzzy_label(line: OcrLine) -> tuple[int, int] | None:
    """(start, end) of an "urodzony" misread by up to two letters, at the line's
    start."""
    folded = fold(line["text"])
    letters = [(i, c) for i, c in enumerate(folded[:20]) if c.isalpha()]
    for skip in range(0, 3):
        piece = letters[skip : skip + 8]
        if len(piece) < 7:
            break
        word = "".join(c for _, c in piece)
        if (
            min(
                _distance(word, "urodzony"),
                _distance(word, "urodzona"),
                _distance(word[:7], "urodzon"),
            )
            <= 2
        ):
            return piece[0][0], label_end(folded, piece[-1][0] + 1)
    return None


def anchors(lines: list[OcrLine]) -> dict[str, Box]:
    """The printed lines around the date's: "CZĘŚĆ A", the name's label,
    "(imiona i nazwisko ...)" and "(miejsce zatrudnienia ...)", top to bottom."""
    found: dict[str, Box] = {}
    for line in sorted(lines, key=lambda line: bounds(line["box"])[1]):
        folded = fold(line["text"])
        box = bounds(line["box"])
        opened = "podpisan" in found or "czesc" in found
        if "czesc" not in found and re.fullmatch(r"\s*cz\s?e\s?s\s?c\s?a\s*", folded):
            found["czesc"] = box
        elif "podpisan" not in found and NAME_ANCHOR.search(folded):
            found["podpisan"] = box
        elif "imiona" not in found and UNDER_NAME_ANCHOR.search(folded) and opened:
            found["imiona"] = box
        elif "zatrudn" not in found and EMPLOYER_ANCHOR.search(folded) and opened:
            found["zatrudn"] = box
    return found


def body_height(lines: list[OcrLine]) -> float:
    heights = sorted(
        bounds(line["box"])[3] - bounds(line["box"])[1]
        for line in lines
        if line["score"] >= 0.95 and len(line["text"]) >= 25
    )
    return heights[len(heights) // 2] if heights else 36.0


@dataclass
class Label:
    """Where the date's label is, and how it was found."""

    line: OcrLine | None
    start: int
    end: int
    box: Box
    how: str


def locate_label(
    lines: list[OcrLine], width: int, grey: np.ndarray, ocr: Ocr
) -> Label | None:
    """The label's line, its span and box, and how it was found: the label read
    as such, read with up to two wrong letters, or placed from the lines around it."""
    found = find_label(lines, LABEL)
    if found:
        index, start, end = found
        return Label(lines[index], start, end, span(lines[index], start, end), "label")
    marks = anchors(lines)
    body = body_height(lines)
    # Where the date's line can be: under the name (or "CZĘŚĆ A"), over the
    # employer's label.
    start_box = marks.get("imiona", marks.get("podpisan", marks.get("czesc")))
    if start_box is None:
        return None
    lower = (
        marks["zatrudn"][1]
        if "zatrudn" in marks and marks["zatrudn"][1] > start_box[3]
        else start_box[3] + 6 * body
    )
    for line in lines:
        x0, y0, x1, y1 = bounds(line["box"])
        if start_box[1] < (y0 + y1) / 2 < lower:
            fuzzy = fuzzy_label(line)
            if fuzzy:
                return Label(
                    line, fuzzy[0], fuzzy[1], span(line, *fuzzy), "label misread"
                )
    return _place_label(lines, marks, lower, width, grey, ocr)


def _starts_with_label(
    grey: np.ndarray, left: float, h: float, ocr: Ocr
) -> Callable[[float], bool]:
    """Whether the line whose foot is at a row starts like the label. Two cuts of
    the line's start: a tall one, and one of the label's own line, for when the
    line above (often "(imiona ...)", set close) is read instead. White round
    each, or RapidOCR detects nothing."""

    def check(foot: float) -> bool:
        for above, below in ((1.6, 0.6), (1.1, 0.45)):
            piece = Image.fromarray(grey).crop(
                (
                    int(max(0, left - 0.5 * h)),
                    int(foot - above * h),
                    int(left + 6 * h),
                    int(foot + below * h),
                )
            )
            piece = ImageOps.expand(piece, border=30, fill=255)
            letters = re.sub(r"[^a-z]", "", fold(ocr.text(piece)))
            if re.search(r"odzon|rodz|urod", letters) or any(
                _distance(letters[i : i + 8], "urodzony") <= 3
                for i in range(0, max(1, len(letters) - 5))
            ):
                return True
        return False

    return check


def _place_label(
    lines: list[OcrLine],
    marks: dict[str, Box],
    lower: float,
    width: int,
    grey: np.ndarray,
    ocr: Ocr,
) -> Label | None:
    """Placed, not read: under the name's line, a line counts only if its start
    still reads like the label. Otherwise it is another line of the form,
    another form (the judges' one has no birth date) or an information clause."""
    if "imiona" in marks:
        upper = marks["imiona"][3]
    elif "podpisan" in marks:
        upper = marks["podpisan"][3]
    else:
        # "CZĘŚĆ A", then the name's line: start a line lower.
        upper = marks["czesc"][3] + 1.2 * body_height(lines)
    h = body_height(lines) * 0.95
    if "podpisan" in marks:
        left = marks["podpisan"][0]
    elif "czesc" in marks:
        left = marks["czesc"][0]
    else:
        left = 0.1 * width
    # Under the name's label its own dotted line comes first, so start lower.
    start_row = int(upper + 0.4 * h) if "imiona" in marks else int(upper + 1.2 * h)
    x0, x1 = int(left + 5 * h), int(min(width * 0.95, left + 0.5 * width))
    starts_with_label = _starts_with_label(grey, left, h, ocr)
    separators = sorted(
        bounds(line["box"])
        for line in lines
        if is_separator(line["text"])
        and start_row - 0.5 * h < bounds(line["box"])[3] < lower
        and bounds(line["box"])[0] > left + 6 * h
    )
    baseline = None
    if separators:
        foot = min(separators, key=lambda b: b[3])[3]
        rows = range(int(foot - 0.6 * h), int(foot + 0.5 * h))
        candidate = dotted_line(grey, rows, x0, x1) or int(foot)
        if starts_with_label(candidate):
            baseline = candidate
    if baseline is None:
        baseline = _next_label_line(
            grey, start_row, lower, x0, x1, h, starts_with_label
        )
    if baseline is None:
        return None
    box = (left, baseline - h, left + 4.3 * h, baseline)
    how = "under (imiona ...)" if "imiona" in marks else "under the name line"
    return Label(None, 0, 0, box, how)


def _next_label_line(
    grey: np.ndarray,
    start_row: int,
    lower: float,
    x0: int,
    x1: int,
    h: float,
    starts_with_label: Callable[[float], bool],
) -> int | None:
    """Down the dotted lines under the name, the first whose start reads like
    the label."""
    y = start_row
    for _ in range(4):
        candidate = None
        for row in range(y, int(lower)):
            if dotted_line(grey, range(row, row + 1), x0, x1) is not None:
                candidate = dotted_line(grey, range(row, int(row + 0.4 * h)), x0, x1)
                break
        if candidate is None:
            return None
        if starts_with_label(candidate):
            return candidate
        y = int(candidate + 0.6 * h)
    return None


@dataclass
class Band:
    """The date's crop on its page, and what was found on the way."""

    box: tuple[int, int, int, int]
    label: Box
    right: float
    how: str
    height: float
    line: OcrLine | None
    baseline: int | None
    printed: list[Box]


def _label_height(label: Label) -> float:
    lx0, ly0, lx1, ly1 = label.box
    if label.line is None:
        return max(12.0, ly1 - ly0)
    # RapidOCR's character boxes take the whole line's height, which grows when
    # the handwriting merges into the label's line. Their widths hold, so the
    # printed height comes from the label's width (about 2.6 character widths).
    n = max(1, label.end - label.start)
    return max(12.0, min(ly1 - ly0, 1.15 * 2.6 * (lx1 - lx0) / n))


def _right_edge(
    label: Label, lines: list[OcrLine], h: float, width: int
) -> tuple[float, str]:
    """Where the date's field ends: the printed "w" before the place of birth."""
    lx0, ly0, lx1, ly1 = label.box
    cy = (ly0 + ly1) / 2
    right: float | None = None
    right_by = ""
    if label.how == "label" and label.line is not None:
        folded = fold(label.line["text"])
        separator = re.search(
            r"[.…_\s]\s?w[e]?\s?[.…_\s]|[.…_\s]w$", folded[label.end :]
        )
        if separator:
            at = label.end + separator.start() + separator.group().index("w")
            right = span(label.line, at, at + 1)[0]
            right_by = "w in the label's line"
    for other in lines:
        if other is label.line:
            continue
        ox0, oy0, ox1, oy1 = bounds(other["box"])
        if (
            is_separator(other["text"])
            and ox0 > lx1 + 2 * h
            and abs((oy0 + oy1) / 2 - cy) < 1.2 * h
            and (right is None or ox0 < right)
        ):
            right, right_by = ox0, "w box"
    if right is None or right - lx1 < 3 * h:
        return min(width * 0.97, lx1 + 0.45 * width), "half the page"
    return right, right_by


def _top_and_printed(
    lines: list[OcrLine], label: Label, right: float, foot: float, h: float
) -> tuple[float, list[Box]]:
    """How high the crop goes, and the printed lines over the field.

    Not up into a printed line over the field: "(imiona i nazwisko ...)", or
    "Ja, niżej podpisany(a)" on forms without it. The crop goes a little into
    it, for tall digits written over it. The stroke count leaves out what is
    inside those lines' boxes: often "(imiona ...)" sits over the right half of
    the field and the date is written beside it, as high."""
    lx0, ly0, lx1, _ = label.box
    top = foot - 2.4 * h
    printed: list[Box] = []
    for other in lines:
        if other is label.line:
            continue
        ox0, oy0, ox1, oy1 = bounds(other["box"])
        folded = fold(other["text"])
        is_printed = UNDER_NAME.search(folded) or (
            other["score"] >= 0.93 and NAME_LABEL.search(folded)
        )
        if (
            is_printed
            and (oy0 + oy1) / 2 < ly0
            and foot - oy1 < 3.2 * h
            and ox0 < right
            and ox1 > lx1
        ):
            printed.append((ox0, oy0, ox1, oy1))
        # Any line over the field's start, printed or the handwritten name, is
        # the line above: the date is written under it.
        if (
            (oy0 + oy1) / 2 < ly0 - 0.5 * h
            and foot - 3.2 * h < oy1 < foot - 1.2 * h
            and ox0 <= lx1 + 3 * h
            and ox1 > lx0
        ):
            top = max(top, oy1 - 0.6 * h)
    return top, printed


def date_band(
    lines: list[OcrLine], width: int, height: int, grey: np.ndarray, ocr: Ocr
) -> Band | None:
    label = locate_label(lines, width, grey, ocr)
    if label is None:
        return None
    h = _label_height(label)
    lx0, ly0, lx1, ly1 = label.box
    right, right_by = _right_edge(label, lines, h, width)
    # The line the date sits on: the dots' row near the label's foot. A label
    # read as such ends at its own foot; a misread one's box often takes the
    # handwriting's descenders too, so expect the foot a little higher.
    expect = ly1 if label.how == "label" else ly1 - 0.3 * h
    baseline = dotted_line(
        grey,
        range(int(max(ly0 + 0.5 * h, ly1 - 0.8 * h)), int(ly1 + 0.6 * h)),
        int(lx1 + 0.5 * h),
        int(right - 0.5 * h),
        expect=expect,
    )
    foot = baseline if baseline is not None else ly1
    top, printed = _top_and_printed(lines, label, right, foot, h)
    box = (
        int(max(0, lx0 - 0.4 * h)),
        int(max(0, top)),
        int(min(width, right + 1.2 * h)),
        int(min(height, foot + 0.5 * h)),
    )
    return Band(
        box,
        label.box,
        right,
        f"{label.how}; {right_by}",
        h,
        label.line,
        baseline,
        printed,
    )


def name_band(
    lines: list[OcrLine], width: int, height: int
) -> tuple[int, int, int, int] | None:
    found = find_label(lines, NAME_LABEL)
    if not found:
        return None
    index, start, end = found
    lx0, ly0, lx1, ly1 = span(lines[index], start, end)
    h = max((ly1 - ly0) * 0.8, 12)
    bottom = ly1 + 0.9 * h
    for other in lines:
        ox0, oy0, ox1, oy1 = bounds(other["box"])
        folded = fold(other["text"])
        if (
            oy0 > ly0
            and oy0 - ly1 < 3.5 * h
            and UNDER_NAME.search(folded)
            and not LABEL.search(folded)
        ):
            bottom = oy0 + 0.3 * h
            break
    left = lx1 - 0.3 * h if bottom - ly1 < 2.2 * h else lx0
    return (
        int(max(0, left)),
        int(max(0, ly0 - 1.4 * h)),
        int(width * 0.97),
        int(min(height, bottom)),
    )


def strokes_in(
    grey: np.ndarray, region: Box, h: float, tallest_print: float = 0.4
) -> int:
    """Pen strokes in the region: components at least 0.4 label heights tall.

    The printed dots and a ruled line are short, however long; a handwritten
    digit is taller than them. The threshold is the region's own (Otsu, and at
    least 35 levels under its paper), so a pale pen on a page of black print
    still counts."""
    x0, y0, x1, y1 = (int(v) for v in region)
    if x1 - x0 < 5 or y1 - y0 < 5:
        return 0
    piece = grey[max(0, y0) : y1, max(0, x0) : x1]
    ink = (piece < dark_level(piece, 35)).astype(np.uint8)
    count, _, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
    strokes = 0
    for label in range(1, count):
        _, _, _, tall, area = stats[label]
        if tall >= tallest_print * h and area >= 0.03 * h * h and tall < 4 * h:
            strokes += 1
    return strokes


# -- one page ------------------------------------------------------------------------


@dataclass
class PageCrop:
    """The crops of one page that has the date's line, and what was read on it."""

    page: int
    rotation: int
    #: text_layer, ocr, handwritten or blank (see the module doc).
    sort: str
    #: The date as read, YYYY-MM-DD, or "" when only a person can read it.
    birth_date: str = ""
    #: RapidOCR's score for the box the date was read in; 1.0 from a text layer.
    score: float = 0.0
    #: The declarant's name as read, from the text layer or the name's crop.
    name: str = ""
    #: "według stanu na dzień": the year the declaration is for.
    declaration_year: int | None = None
    date_png: bytes = b""
    name_png: bytes = b""
    notes: list[str] = field(default_factory=list)


def png(image: Image.Image) -> bytes:
    """The crop as a PNG the site takes: under its 200 kB, shrunk if need be."""
    while True:
        buffer = io.BytesIO()
        image.save(buffer, format="PNG", optimize=True)
        data = buffer.getvalue()
        if len(data) <= MAX_PNG_BYTES or image.width < 200:
            return data
        image = image.resize(
            (int(image.width * 0.8), int(image.height * 0.8)), Image.Resampling.LANCZOS
        )


def _field_strokes(grey: np.ndarray, band: Band) -> int:
    """Pen strokes between the label and the "w", above the dots: the field itself."""
    h = band.height
    x0, top, _, bottom = band.box
    above_dots = band.baseline - 0.12 * h if band.baseline is not None else bottom
    region = (band.label[2] + 0.3 * h, top, band.right - 0.2 * h, above_dots)
    masked = grey.copy()
    for bx0, by0, bx1, by1 in band.printed:
        masked[int(by0) : int(by1 + 0.1 * h), int(bx0) : int(bx1)] = 255
    strokes = strokes_in(masked, region, h)
    if strokes == 0 and band.printed:
        # A date written across "(imiona ...)" is masked out with it. The small
        # print is about half the label's height; a digit is taller.
        unmasked = strokes_in(grey, region, h, tallest_print=0.8)
        if unmasked >= 2:  # a date is several strokes; one is the printed "w"
            return unmasked
    return strokes


def _read_field(
    lines: list[OcrLine], grey: np.ndarray, band: Band, ocr: Ocr
) -> tuple[str, float, list[str]]:
    """The date the crop's OCR reads, with the score of the box it is in, else
    a clean one the page's own OCR read inside the field."""
    h = band.height
    x0, top, x1, bottom = band.box
    left, right = band.label[2] + 0.3 * h, band.right - 0.2 * h
    masked = grey.copy()
    for bx0, by0, bx1, by1 in band.printed:
        masked[int(by0) : int(by1 + 0.1 * h), int(bx0) : int(bx1)] = 255
    field_piece = Image.fromarray(masked).crop(
        (int(left - 0.2 * h), top, int(right + 0.2 * h), bottom)
    )
    pieces = ocr.read(field_piece)
    # The score of the box the date is in: a stray mark beside a typed date
    # reads with a low score and should not make it handwriting.
    dated = [
        (born, score) for born, score in ((date_in(t), s) for t, s in pieces) if born
    ]
    if dated:
        return dated[0][0].isoformat(), dated[0][1], []
    whole = date_in(" ".join(text for text, _ in pieces))
    score = min((s for _, s in pieces), default=0.0)
    if whole:
        return whole.isoformat(), score, []
    for line in lines:
        ox0, oy0, ox1, oy1 = bounds(line["box"])
        if ox1 > left and ox0 < right and oy1 > top and oy0 < bottom:
            found = date_in(line["text"])
            if found and line["score"] >= 0.9:
                return found.isoformat(), line["score"], ["date read in the page's OCR"]
    return "", score, []


def cut_page(
    image: Image.Image,
    lines: list[OcrLine],
    text: str,
    ocr: Ocr,
    page: int,
    rotation: int = 0,
) -> PageCrop | None:
    """The page's crops and readings, or None when it has no date's line."""
    grey = np.array(image.convert("L"))
    width, height = image.size
    band = date_band(lines, width, height, grey, ocr)
    if band is None:
        return None
    crop = PageCrop(page, rotation, "handwritten", date_png=png(image.crop(band.box)))
    if band.baseline is None:
        crop.notes.append("no dotted line found")
    read, crop.score, notes = _read_field(lines, grey, band, ocr)
    crop.notes += notes
    typed, field_text = born_in_text(text) if text else (None, "")
    if typed and looks_typed(field_text) and read in ("", typed.isoformat()):
        crop.sort, crop.birth_date, crop.score = "text_layer", typed.isoformat(), 1.0
    elif read and crop.score >= 0.9:
        crop.sort, crop.birth_date = "ocr", read
        if typed:
            crop.notes.append(f"text layer reads {typed.isoformat()}")
    elif _field_strokes(grey, band) == 0:
        crop.sort = "blank"
    names = name_band(lines, width, height)
    if names:
        name_piece = image.crop(names)
        crop.name_png = png(name_piece)
        crop.name = " ".join(t for t, _ in ocr.read(name_piece))[:200]
    typed_name = name_in_text(text) if text else ""
    if typed_name:
        crop.name = typed_name
    crop.declaration_year = declaration_year(text) or declaration_year(
        " ".join(line["text"] for line in lines)
    )
    return crop


# -- one file ---------------------------------------------------------------------


@dataclass
class FileCut:
    """What a file gave: its crops, or why it gave none."""

    #: cut, or the reason nothing was cut, in the site's words
    #: (FAILED_REASONS in frontend/server/utils/declarationOverview.ts):
    #: no_label, no_date_line, blank_form, scan_in_word, not_fetched, unreadable.
    status: str
    kind: str = ""
    pages: int = 0
    pages_read: int = 0
    crops: list[PageCrop] = field(default_factory=list)
    error: str = ""


def _upright(pages: Pages, council: bool) -> Iterator[int]:
    limit = min(pages.count, COUNCIL_PAGES if council else PAGES_UPRIGHT)
    yield from range(limit)


def cut_file(data: bytes, url: str, ocr: Ocr, *, council: bool = False) -> FileCut:
    """The crops of a declaration file.

    `council`: the file holds several people's declarations, so every page with
    the date's line is a crop; otherwise the first one is the declaration's.
    """
    kind = kind_of(data)
    if kind == "html":
        return FileCut("not_fetched", kind)
    if kind not in ("pdf", "image", "docx", "odt", "doc"):
        return FileCut("unreadable", kind)
    try:
        pages = Pages(data, kind)
    except Exception as exc:  # noqa: BLE001 - a broken download is a result, not a crash
        return FileCut("unreadable", kind, error=f"{type(exc).__name__}: {exc}"[:300])
    try:
        result = _cut_pages(pages, ocr, council)
    except Exception as exc:  # noqa: BLE001
        result = FileCut("unreadable", error=f"{type(exc).__name__}: {exc}"[:300])
    finally:
        pages.close()
    result.kind, result.pages = kind, pages.count
    if result.status == "no_label" and kind in ("docx", "odt", "doc"):
        # A Word file with no scan in it is a form posted for download; one with
        # pictures that hold no label is a scan converted to Word, the
        # handwriting left in fragments (osieczna.biuletyn.net's, 10-29).
        result.status = (
            "blank_form"
            if pages.count == 0 or TEMPLATE_URL.search(url)
            else "scan_in_word"
        )
    return result


def _cut_pages(pages: Pages, ocr: Ocr, council: bool) -> FileCut:
    result = FileCut("no_label")
    if pages.count == 0:
        return result
    upright: set[int] = set()
    label_read = False
    for index in _upright(pages, council):
        text = pages.text(index)
        if council and text and not re.search(r"urodzon|podpisan", fold(text)):
            continue  # a page drawn from text, and not a form's part A
        image = pages.image(index)
        lines = ocr.lines(image)
        result.pages_read += 1
        label_read = label_read or has_label(lines)
        crop = cut_page(image, lines, text, ocr, index)
        if crop is not None:
            result.crops.append(crop)
            if not council:
                break
        elif looks_upright(lines):
            upright.add(index)
    if not result.crops and not council:
        _cut_turned(pages, ocr, upright, result)
    if result.crops:
        result.status = "cut"
    elif label_read:
        result.status = "no_date_line"
    return result


def _cut_turned(pages: Pages, ocr: Ocr, upright: set[int], result: FileCut) -> None:
    """Pages 1-2 turned 180, 90 and 270 degrees, where a scan was fed sideways.

    Only the label read as such counts on a turned page: on 10-29 eight pages
    "found" it at 270 degrees in sideways noise. A page that reads fine upright
    is not turned at all."""
    for rotation in (180, 90, 270):
        for index in range(min(PAGES_TURNED, pages.count)):
            if index in upright:
                continue
            image = pages.image(index).rotate(rotation, expand=True)
            lines = ocr.lines(image)
            result.pages_read += 1
            if not has_label(lines):
                continue
            crop = cut_page(image, lines, pages.text(index), ocr, index, rotation)
            if crop is not None:
                result.crops.append(crop)
                return
