"""Cut the bands a reader reads a declaration's posts from.

The date cut (`cutter`) found each declaration's part A: the page with the
birth date's line. From that page, and the pages after it up to the next
declaration's, this pass cuts four bands. The next declaration starts at the
file's next date page, due in this run or not, or at a page that reads
"CZĘŚĆ A", the name's label or the birth date's:

- `header`: from the title, "OŚWIADCZENIE MAJĄTKOWE", with its list of
  functions (struck ones too), the "według stanu na dzień" line where the form
  prints one, the "dnia" line and any receipt stamp beside them, down to
  "Uwaga:" or "CZĘŚĆ A";
- `employer`: from the first line under the birth date to the printed
  "(miejsce zatrudnienia, stanowisko lub funkcja)" under the employer; with
  nothing written there, as where the post is on the birth date's line, which
  no band shows, `empty`;
- `vii`: section VII, from "W spółkach handlowych (nazwa, siedziba spółki)",
  which section III's shares in "spółkach handlowych" do not name, to VIII;
- `viii`: section VIII, to the next heading: IX, X or "CZĘŚĆ B".

No band shows the declarant's name or birth date (decision on 2026-11-20), and
none runs past "CZĘŚĆ B", whose addresses are not public. An electronic
signature's block ("PODPIS ZAUFANY", the signer's name, "Dokument podpisany
elektronicznie") is painted white on every page a band is drawn from, and its
lines are not read. A band whose lines read the declarant's first name or
surname anyway, as a sole trader's firm on the employer's line does, is kept
as `holds_name` and never sent; no word of it is masked.

A band runs from its printed caption to the next one, read by RapidOCR with a
few letters wrong, and on across a page break: a piece of each page, in order,
together the whole band without a gap. Its written lines are y-ranges: the
dotted lines a hand writes on (`cutter.dotted_line`), and the lines OCR reads
where there are none.

Each band is read as `Ocr.read` reads a crop, at twice its size. It is typed
when every line read off it scores 0.9 or more: it stays at the cutter's 200
dpi, and its text may later suggest what it says. Otherwise it is handwriting,
drawn again at 300 dpi for a phone's zoom. A PDF page drawn from text gives its
text layer instead; a scan's layer stands in for a line only where it says what
OCR read there. Either way a band is pictures of at most `MAX_PNG_BYTES` each,
cut between its lines.

Lines of a receipt stamp, a signature's caption or a form generator's footer
are left out of what a band says; the pictures keep them. The header's "dnia"
and "stanu na" dates are read, each with the score of its line.

When readers say a band lacks a part, it is cut again one caption wider
(`widen`): past the heading it stopped at, to the next one, never past
"CZĘŚĆ A" (the header) nor "CZĘŚĆ B".
"""

from __future__ import annotations

import difflib
import io
import re
from collections.abc import Collection, Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field

import numpy as np
import regex
from PIL import Image, ImageDraw

from jobs.bip_declarations.cutter import (
    LONG_SIDE,
    MAX_PNG_BYTES,
    Band,
    Box,
    Ocr,
    OcrLine,
    Pages,
    body_height,
    bounds,
    dark_level,
    date_band,
    dotted_line,
    has_label,
    kind_of,
    png,
    strokes_in,
)
from jobs.bip_declarations.reading import (
    DECLARED_YEARS,
    LABEL,
    date_in,
    dnia_in,
    fold,
    name_tokens,
    stan_na_in,
)

#: The pass's version, apart from the date cut's `CUT_VERSION`. Raising it
#: cuts every date page's bands again; a recut keeps the version.
EMPLOYMENT_CUT_VERSION = 1
BANDS = ("header", "employer", "vii", "viii")
#: Handwriting is drawn again at 300 dpi, against the cutter's 200.
FINE_LONG_SIDE = LONG_SIDE * 3 // 2
#: Pages after the date page that VII and VIII are looked for on.
PAGES_AFTER = 4
#: A band runs on across at most this many page breaks.
PAGE_BREAKS = 2
#: A band is typed when every line read off it scores this much or more.
TYPED_SCORE = 0.9
#: A scan's text layer stands in for a line OCR read when they agree this much.
LAYER_AGREES = 0.9
#: No strip is shorter, in px: a picture cut is between lines, not at an edge.
MIN_STRIP = 24
#: A declarant's surname this long is looked for inside other letters too.
GLUED = 5


def squash(text: str) -> str:
    """Letters and digits only, folded: how a printed label is matched."""
    return re.sub(r"[^a-z0-9]", "", fold(text))


def _near(key: str, edits: int) -> regex.Pattern[str]:
    """`key` read with up to `edits` letters wrong, missing or extra."""
    return regex.compile(f"(?:{key}){{e<={edits}}}")


#: Printed captions and headings, matched in a line as `squash` gives it.
MARKS: dict[str, tuple[regex.Pattern[str], ...]] = {
    "uwaga": (regex.compile(r"^(?:uwaga){e<=1}"),),
    # "1. Osoba składająca oświadczenie obowiązana jest ...", not part B's
    # "Adres zamieszkania osoby składającej oświadczenie".
    "notes": (_near("osobaskladajacaoswiadczenieobowiazan", 5),),
    "czesc_a": (regex.compile(r"^(?:czesc){e<=1}a$"),),
    "name": (_near("nizejpodpisan", 2), _near("imionainazwisko", 3)),
    "caption": (_near("miejscezatrudnienia", 3), _near("stanowiskolubfunkcj", 3)),
    "zapoznaniu": (_near("pozapoznaniusie", 2),),
    "section_i": (_near("zasobypieniezne", 2),),
    "viii": (
        _near("innedochody", 2),
        _near("zkazdegotytulu", 2),
        _near("zpodaniemkwot", 2),
    ),
    "ix": (_near("skladnikimienia", 2), _near("mieniaruchomego", 2)),
    "x": (_near("zobowiazaniapieniezne", 3),),
    "czesc_b": (regex.compile(r"^(?:czesc){e<=1}b$"),),
    # Part B's own lines, not page 1's note about "adresu zamieszkania ...
    # miejsca położenia nieruchomości".
    "part_b": (
        _near("adreszamieszkaniaosobyskladajacej", 3),
        _near("miejscepolozenianieruchomosciwymienionych", 4),
    ),
    "signed": (_near("powyzszeoswiadczenieskladam", 4),),
}
#: The declaration's title, where the header starts; "Oświadczenie" alone on a
#: line where the rest was not read.
TITLE = (_near("oswiadczeniemajatkow", 3), regex.compile(r"^(?:oswiadczenie){e<=2}$"))
#: A numbered note under "Uwaga:" ("4. Oświadczenie majątkowe dotyczy ..."),
#: which is no title.
NOTE_NUMBER = re.compile(r"^\W*\d{1,2}\s*[.)]")
#: The printed lines of an electronic signature's block: ePUAP's "PODPIS
#: ZAUFANY" and "Dokument podpisany elektronicznie podpisem zaufanym", a
#: qualified signature's "podpisany przez", "Signed by".
E_SIGNATURE = (
    _near("podpiszaufany", 2),
    _near("podpisanyelektronicznie", 3),
    _near("podpisemkwalifikowanym", 3),
    _near("podpisemzaufanym", 2),
    _near("dokumentpodpisany", 2),
    _near("podpisanyprzez", 2),
    _near("signedby", 1),
)
#: VII's heading: companies, by their name and seat ("nazwa", "siedziba").
COMPANIES = _near("handlowych", 2)
NAMED = (_near("nazwa", 1), _near("siedzib", 1))
#: A section's number alone on its line, as OCR reads it: "VII." as "VIl.",
#: "Vll.", "VI1.", even "VIll."; "VIII." as "VIlll." or "VIlf."; IX, and V
#: or X with their dot.
NUMERAL = re.compile(r"(?:v[il1|!]{1,4}[ft]?|[il1|!]x|[vx]\.)[.,:;]?", re.I)
#: Where a declaration's band stops whatever was asked: part B, the
#: signature's paragraph.
HARD_STOPS = frozenset({"czesc_b", "part_b", "signed"})
#: A later page with these, or with the birth date's label, is another
#: declaration's part A.
NEXT_DECLARATION = frozenset({"czesc_a", "name"})
#: Lines of a receipt stamp ("wpłynęło", "data wpływu", "Z up.", "L.dz."), a
#: signature's caption and a form generator's footer.
STAMP = re.compile(
    r"wp[l1ti|]?y[nw]|\bz\s?up\b|www\.|podpis(?!an)|kancelaria\s*og|\bl\.?\s?dz\b"
)
#: Print a band's text leaves out when a line says nothing more.
PRINTED: dict[str, tuple[str, ...]] = {
    "header": (),
    "employer": ("miejscezatrudnieniastanowiskolubfunkcja", "zatrudnionyw"),
    "vii": (
        "wspolkachhandlowychnazwasiedzibaspolki",
        "jestemczlonkiemzarzaduodkiedy",
        "jestemczlonkiemradynadzorczejodkiedy",
        "jestemczlonkiemkomisjirewizyjnejodkiedy",
        "ztegotytuluosiagnalemelamwrokuubieglymdochodwwysokosci",
        "wspoldzielniach",
        "wfundacjachprowadzacychdzialalnoscgospodarcza",
    ),
    "viii": (
        "innedochodyosiaganeztytuluzatrudnienialubinnejdzialalnoscizarobkowej"
        "lubzajeczpodaniemkwotuzyskiwanychzkazdegotytulu",
    ),
}
PLACE_CAPTION = _near("miejscowos", 2)
#: A page's running header or footer: the act's "Dziennik Ustaw" and "Poz.",
#: "Strona 3 z 5", a page number alone, a form generator's address.
RUNNING = re.compile(
    r"dziennik\s*ustaw|\bpoz\.?\s*\d|strona\s*\d+\s*(?:z|/)\s*\d+|^\W*\d{1,3}\W*$|www\."
)


# -- one page -----------------------------------------------------------------


@dataclass
class Mark:
    """A printed caption or heading on a page, by what it reads as."""

    kinds: frozenset[str]
    top: float
    bottom: float


@dataclass
class PageScan:
    """A page drawn at the cutter's 200 dpi, read, its captions found."""

    index: int
    image: Image.Image
    grey: np.ndarray
    lines: list[OcrLine]
    boxes: list[Box]
    marks: list[Mark]
    #: The body text's line height.
    h: float
    #: Grey levels under this are ink (`cutter.dark_level` of the page).
    level: float
    #: Dark pixels in each row, the scan's outer edges left out.
    ink: np.ndarray
    #: Where the text runs across the page.
    left: int
    right: int
    #: The electronic signatures' blocks painted white on `image`.
    signed: list[Box] = field(default_factory=list)

    @property
    def width(self) -> int:
        return int(self.grey.shape[1])

    @property
    def height(self) -> int:
        return int(self.grey.shape[0])

    @property
    def blank(self) -> int:
        """Dark pixels a row may have and still be empty paper."""
        return max(3, int(0.002 * self.width))


def kinds_of(text: str) -> set[str]:
    """What a line of print is, by the captions and headings it reads as."""
    s = squash(text)
    if not s:
        return set()
    found = {kind for kind, keys in MARKS.items() if any(k.search(s) for k in keys)}
    if COMPANIES.search(s) and any(k.search(s) for k in NAMED):
        found.add("vii")
    return found


def is_numeral(line: OcrLine, box: Box, left: float, h: float) -> bool:
    """A section's number at the margin, on a line of its own."""
    text = re.sub(r"\s", "", line["text"])
    return bool(NUMERAL.fullmatch(text)) and box[0] <= left + 3 * h


def _marks(lines: list[OcrLine], boxes: list[Box], left: float, h: float) -> list[Mark]:
    marks = []
    for index, (line, box) in enumerate(zip(lines, boxes)):
        kinds = kinds_of(line["text"])
        if "vii" not in kinds and COMPANIES.search(squash(line["text"])):
            # "W spółkach handlowych" with "(nazwa, siedziba spółki)" under it.
            below = [
                lines[i]
                for i in range(index + 1, len(lines))
                if 0 <= boxes[i][1] - box[3] < 0.8 * h
            ]
            if any(any(k.search(squash(b["text"])) for k in NAMED) for b in below):
                kinds.add("vii")
        if is_numeral(line, box, left, h):
            kinds.add("numeral")
        if kinds:
            marks.append(Mark(frozenset(kinds), box[1], box[3]))
    return marks


def _within(block: Box, box: Box) -> bool:
    """Whether a line's middle is inside a block."""
    x, y = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    return block[0] <= x <= block[2] and block[1] <= y <= block[3]


def names_a_signature(text: str) -> bool:
    """A printed line of an electronic signature's block."""
    s = squash(text)
    return any(p.search(s) for p in E_SIGNATURE)


def signature_blocks(
    lines: list[OcrLine], boxes: list[Box], grey: np.ndarray, h: float
) -> list[Box]:
    """The electronic signatures' blocks on a page: each line that names one
    (`E_SIGNATURE`) with the lines of its column on the rows next to it, which
    name the signer, and the ink on their rows either side of them up to a gap
    (the block's icon, a name too wide to read), with a margin."""
    blocks: list[Box] = []
    for seed, line in enumerate(lines):
        if not names_a_signature(line["text"]):
            continue
        if any(_within(block, boxes[seed]) for block in blocks):
            continue
        x0, y0, x1, y1 = boxes[seed]
        members = {seed}
        grew = True
        while grew:
            grew = False
            for i, box in enumerate(boxes):
                width = max(1.0, box[2] - box[0])
                column = min(x1, box[2]) - max(x0, box[0]) >= 0.5 * width
                if i in members or not column:
                    continue
                if box[1] <= y1 + 0.8 * h and box[3] >= y0 - 0.8 * h:
                    members.add(i)
                    x0, y0 = min(x0, box[0]), min(y0, box[1])
                    x1, y1 = max(x1, box[2]), max(y1, box[3])
                    grew = True
        x0, x1 = _inked_across(grey, (x0, y0, x1, y1), h)
        pad = 0.4 * h
        blocks.append((x0 - pad, y0 - pad, x1 + pad, y1 + pad))
    return blocks


def _inked_across(grey: np.ndarray, box: Box, h: float) -> tuple[float, float]:
    """A block's columns widened over the ink on its rows either side of it
    (and a little over and under them, where an icon's frame runs), up to a
    gap of more than half a line, and at most four lines out."""
    x0, x1 = int(box[0]), int(box[2])
    y0, y1 = int(box[1] - 0.3 * h), int(box[3] + 0.3 * h)
    rows = grey[max(0, y0) : y1 + 1]
    if not rows.size:
        return box[0], box[2]
    inked = (rows < dark_level(rows, 30)).any(axis=0)
    gap, most = max(2, int(0.6 * h)), int(4 * h)
    right = x1
    while right < min(inked.size - 1, x1 + most):
        ahead = np.flatnonzero(inked[right + 1 : right + 1 + gap])
        if not ahead.size:
            break
        right += 1 + int(ahead[-1])
    left = x0
    while left > max(0, x0 - most):
        behind = np.flatnonzero(inked[max(0, left - gap) : left])
        if not behind.size:
            break
        left = max(0, left - gap) + int(behind[0])
    return float(min(left, box[0])), float(max(right, box[2]))


def blank(image: Image.Image, blocks: list[Box], scale: float = 1.0) -> Image.Image:
    """The page (grey) with the blocks, in its rows at 200 dpi, painted white."""
    if not blocks:
        return image
    painted = image.copy()
    draw = ImageDraw.Draw(painted)
    for x0, y0, x1, y1 in blocks:
        draw.rectangle((x0 * scale, y0 * scale, x1 * scale, y1 * scale), fill=255)
    return painted


def scan_page(
    image: Image.Image, index: int, ocr: Ocr, *, words: bool = False
) -> PageScan:
    """Read a page drawn at 200 dpi and find its captions. An electronic
    signature's block is painted white, and its lines are not the page's."""
    lines = sorted(
        ocr.lines(image, with_words=words), key=lambda line: bounds(line["box"])[1]
    )
    boxes = [bounds(line["box"]) for line in lines]
    grey = np.array(image.convert("L"))
    signed = signature_blocks(lines, boxes, grey, body_height(lines))
    if signed:
        image = blank(image, signed)
        grey = np.array(image.convert("L"))
        kept = [
            i for i, b in enumerate(boxes) if not any(_within(s, b) for s in signed)
        ]
        lines, boxes = [lines[i] for i in kept], [boxes[i] for i in kept]
    height, width = grey.shape
    edge = int(0.04 * width)
    level = dark_level(grey, 30)
    ink = (grey[:, edge : width - edge] < level).sum(axis=1)
    h = body_height(lines)
    body = [
        box
        for line, box in zip(lines, boxes)
        if len(line["text"]) >= 10 and line["score"] >= 0.8
    ]
    left = int(min((b[0] for b in body), default=0.08 * width))
    right = int(max((b[2] for b in body), default=0.92 * width))
    return PageScan(
        index,
        image,
        grey,
        lines,
        boxes,
        _marks(lines, boxes, left, h),
        h,
        level,
        ink,
        left,
        right,
        signed,
    )


def gap(scan: PageScan, upper: float, lower: float, prefer: str) -> int:
    """A row of empty paper between two lines: the first under the upper one
    or the last over the lower one, as `prefer` says. With none, the middle of
    the emptiest rows between them, or, where they touch, round where they
    meet."""
    a = int(max(0, min(scan.height, upper)))
    b = int(max(0, min(scan.height, lower)))
    if b > a:
        empty = np.flatnonzero(scan.ink[a:b] <= scan.blank)
        if empty.size:
            return a + int(empty[0] if prefer == "first" else empty[-1])
    if b - a >= 4:
        lo, hi = a, b
    else:
        lo, hi = max(0, min(a, b) - 8), min(scan.height, max(a, b) + 8)
    rows = scan.ink[lo:hi]
    if not rows.size:
        return a
    low = np.flatnonzero(rows <= rows.min() + 1)
    runs = np.split(low, np.flatnonzero(np.diff(low) != 1) + 1)
    run = max(runs, key=len)
    return lo + int(run[len(run) // 2])


def bottom_above(scan: PageScan, y: float) -> float:
    """Where the last line above row `y` ends; 0 with none."""
    return max(
        (
            b[3]
            for b in scan.boxes
            if (b[1] + b[3]) / 2 < y and b[3] <= y + 0.3 * scan.h
        ),
        default=0.0,
    )


def ink_runs(scan: PageScan) -> list[tuple[int, int]]:
    """Runs of three or more rows with ink, top down: print, writing, and the
    dots OCR reads nothing in; not a speck."""
    rows = np.flatnonzero(scan.ink > scan.blank)
    if not rows.size:
        return []
    runs = np.split(rows, np.flatnonzero(np.diff(rows) != 1) + 1)
    return [(int(r[0]), int(r[-1]) + 1) for r in runs if len(r) >= 3]


def running(scan: PageScan, line: OcrLine, box: Box) -> bool:
    """A page's running header or footer at its top or foot: "Dziennik
    Ustaw", "Strona 3 z 5", a page number."""
    at_edge = box[3] < 0.1 * scan.height or box[1] > 0.88 * scan.height
    return at_edge and bool(RUNNING.search(fold(line["text"])))


def _body(scan: PageScan) -> tuple[list[Box], float, float]:
    """The page's lines but its running ones, and the rows between those."""
    body, ceiling, floor = [], 0.0, float(scan.height)
    for line, box in zip(scan.lines, scan.boxes):
        if not running(scan, line, box):
            body.append(box)
        elif box[1] < scan.height / 2:
            ceiling = max(ceiling, box[3])
        else:
            floor = min(floor, box[1])
    return body, ceiling, floor


def over(scan: PageScan, y: float) -> int:
    """Where to cut over a line starting at row `y`: the last empty row over
    it, never into it when the line above touches it, and never more than a
    line above it: where OCR read none of a hand's lines over a heading, its
    writing and dots can leave no empty row up to the last line OCR read."""
    upper = max(bottom_above(scan, y), y - 0.6 * scan.h)
    return min(gap(scan, upper, y, "last"), int(y))


def under(scan: PageScan, y: float) -> int:
    """Where to cut under a line ending at row `y`: the first empty row under
    it, within a line of it. Only a line starting under `y` bounds it: a box
    on the same row (the printed "w" before a place of birth) is that line."""
    starts = [b[1] for b in scan.boxes if b[1] > y + 2]
    lower = min([*starts, y + 0.8 * scan.h])
    return max(gap(scan, y, lower, "first"), int(y))


def content_top(scan: PageScan) -> int:
    """Over the page's first ink under its running header, read or not: the
    empty dotted lines a section runs on with are the section's too. Not a
    scanner's dark edge."""
    body, ceiling, _ = _body(scan)
    ceiling = max(ceiling, 0.01 * scan.height)
    tops = [b[1] for b in body if b[1] >= ceiling]
    tops += [float(s) for s, _ in ink_runs(scan) if s >= ceiling][:1]
    return max(0, int(min(tops, default=ceiling)) - 4)


def content_bottom(scan: PageScan) -> int:
    """Under the page's last line, and the dotted lines under it that OCR
    reads nothing in, over the page's running footer."""
    body, _, floor = _body(scan)
    bottom = max((b[3] for b in body if b[3] <= floor), default=0.0)
    for start, end in ink_runs(scan):
        if bottom < end <= floor and start <= bottom + 1.2 * scan.h:
            bottom = end
    return min(scan.height, int(bottom) + 4)


def first_ink(scan: PageScan) -> int:
    """Over everything on the page: a receipt stamp's barcode reads as nothing."""
    tops = [b[1] for b in scan.boxes] + [float(s) for s, _ in ink_runs(scan)[:1]]
    return max(0, int(min(tops, default=0.0)) - 4)


def heading_top(scan: PageScan, mark: Mark) -> float:
    """A heading's top, with its section's number where that stands above it."""
    top = mark.top
    for other in scan.marks:
        if (
            "numeral" in other.kinds
            and mark.top - 2.5 * scan.h <= other.top < mark.top + 0.3 * scan.h
            and other.bottom <= mark.bottom + 0.3 * scan.h
        ):
            top = min(top, other.top)
    return top


def _spread(scan: PageScan, rows: range) -> float:
    """The share of the text's width the darkest of these rows reach, in
    `dotted_line`'s 24 bins."""
    window = scan.grey[max(0, rows.start) : max(0, rows.stop), scan.left : scan.right]
    if not window.size:
        return 0.0
    ink = (window < dark_level(window, 30)).max(axis=0)
    edges = np.linspace(0, ink.size, 25).astype(int)
    return sum(bool(ink[a:b].any()) for a, b in zip(edges[:-1], edges[1:])) / 24


def dotted_rows(scan: PageScan, top: int, bottom: int) -> list[int]:
    """The dotted (or ruled) lines between two rows, top down, where a hand
    writes. A row of print spreads as far, but so do the rows over its foot;
    over a dotted line only the writing on it does, rarely across it all, and
    where it does OCR reads no line there."""
    h = scan.h
    found: list[int] = []
    y = int(top + 0.3 * h)
    while y < bottom:
        hit = next(
            (
                row
                for row in range(y, bottom)
                if dotted_line(scan.grey, range(row, row + 1), scan.left, scan.right)
                is not None
            ),
            None,
        )
        if hit is None:
            break
        rows = range(hit, min(bottom, int(hit + 0.4 * h) + 1))
        base = dotted_line(scan.grey, rows, scan.left, scan.right) or hit
        on = _spread(scan, range(base - 1, base + 2))
        above = _spread(scan, range(int(base - 0.55 * h), int(base - 0.25 * h)))
        read = any(b[1] < base and b[3] > base - 0.8 * h for b in scan.boxes)
        if above < 0.6 * on or not read:
            found.append(base)
        y = int(base + 0.6 * h)
    return found


def written_lines(scan: PageScan, top: int, bottom: int) -> list[tuple[int, int]]:
    """The written lines between two rows, as y-ranges from `top`, none over
    another: each dotted line with the writing over it, then each line OCR
    read where no dotted line is."""
    h = scan.h
    ranges: list[tuple[float, float]] = []
    for base in dotted_rows(scan, top, bottom):
        upper = max(top, base - 1.4 * h, ranges[-1][1] if ranges else top)
        ranges.append((upper, min(bottom, base + 0.3 * h)))
    for line, box in zip(scan.lines, scan.boxes):
        y0, y1 = box[1], box[3]
        if not top <= (y0 + y1) / 2 <= bottom or STAMP.search(fold(line["text"])):
            continue
        if any(min(y1, b) - max(y0, a) > 0.5 * (y1 - y0) for a, b in ranges):
            continue
        ranges.append((max(top, y0), min(bottom, y1)))
    lines: list[tuple[float, float]] = []
    for a, b in sorted(ranges):
        if lines and lines[-1][1] > a:
            last = lines[-1]
            if last[1] - a > 0.6 * min(b - a, last[1] - last[0]):
                lines[-1] = (last[0], max(b, last[1]))
                continue
            a = last[1]
        if b - a >= 4:
            lines.append((a, b))
    return [(int(a - top), int(b - top)) for a, b in lines]


# -- one declaration ----------------------------------------------------------


@dataclass(frozen=True)
class Piece:
    """Rows `top` to `bottom` of a page, at 200 dpi: a band's part on a page."""

    page: int
    top: int
    bottom: int


@dataclass
class Strip:
    """One picture of a band: rows `top` to `bottom` of a page at the band's dpi."""

    page: int
    top: int
    bottom: int
    png: bytes


@dataclass
class BandCut:
    """One band of a declaration as cut, or why it was not."""

    band: str
    #: cut, or why not: no_stop, no_title, no_birth_line, no_caption,
    #: no_heading, empty, unreadable; or holds_name, drawn but reading the
    #: declarant's name, so never to be sent.
    status: str = "cut"
    widen: int = 0
    dpi: int = 0
    #: The first page's width at `dpi`: every strip of the band is as wide as
    #: its page.
    width: int = 0
    strips: list[Strip] = field(default_factory=list)
    #: The written lines: (strip, top, bottom), rows of that strip at `dpi`.
    lines: list[tuple[int, int, int]] = field(default_factory=list)
    text: str = ""
    score: float = 0.0
    typed: bool = False
    #: ocr, text_layer, or ocr+text_layer where a scan's layer agreed with OCR.
    source: str = ""
    dnia: str = ""
    dnia_score: float = 0.0
    stan_na: str = ""
    stan_na_score: float = 0.0
    notes: list[str] = field(default_factory=list)


@dataclass
class Found:
    """Where a band is, before it is read and drawn."""

    status: str
    pieces: list[Piece] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    #: The heading it starts at, and the one it ended at (the next band's
    #: start, maybe), each with its page after the date page.
    start: tuple[int, Mark] | None = None
    end: tuple[int, Mark] | None = None


def turned(image: Image.Image, rotation: int) -> Image.Image:
    return image.rotate(rotation, expand=True) if rotation else image


class Declaration:
    """One declaration's pages from its date page on, read only as far as a
    band needs them; never into another declaration's."""

    def __init__(
        self, pages: Pages, ocr: Ocr, first: int, rotation: int, end: int
    ) -> None:
        self.pages = pages
        self.ocr = ocr
        self.first = first
        self.rotation = rotation
        self.end = min(end, pages.count, first + 1 + PAGES_AFTER)
        image = turned(pages.image(first), rotation)
        # The date's band needs each character's box, as the date cut had it.
        self.scans = [scan_page(image, first, ocr, words=True)]
        self._fine: dict[int, Image.Image] = {}
        self._layer: dict[int, bool] = {}

    def scan(self, n: int) -> PageScan | None:
        """The page `n` after the date page, read; None past the declaration."""
        while len(self.scans) <= n:
            index = self.first + len(self.scans)
            if index >= self.end:
                return None
            scan = scan_page(
                turned(self.pages.image(index), self.rotation), index, self.ocr
            )
            if any(mark.kinds & NEXT_DECLARATION for mark in scan.marks) or has_label(
                scan.lines
            ):
                self.end = index
                return None
            self.scans.append(scan)
        return self.scans[n]

    def page(self, index: int) -> PageScan:
        return self.scans[index - self.first]

    def marks_after(
        self, n: int, after: float, last: int
    ) -> Iterator[tuple[int, Mark]]:
        """Every mark under row `after` of page `n`, then of the pages after
        it up to page `last`, in reading order."""
        while n <= last and (scan := self.scan(n)) is not None:
            for mark in scan.marks:
                if mark.top > after:
                    yield n, mark
            n, after = n + 1, -1.0

    def fine(self, index: int) -> Image.Image:
        """The page drawn at 300 dpi (a picture as it is), turned as read, its
        electronic signatures' blocks painted white as on its scan."""
        if index not in self._fine:
            image = turned(self.pages.image(index, FINE_LONG_SIDE), self.rotation)
            scan = self.page(index)
            self._fine[index] = blank(image, scan.signed, image.height / scan.height)
        return self._fine[index]

    def digital(self, index: int) -> bool:
        return not self.rotation and self.pages.born_digital(index)

    def layer(self, index: int, box: Box) -> str:
        """A scan's text layer in a box of the page at 200 dpi; "" without one."""
        if self.rotation:
            return ""
        if index not in self._layer:
            whole = (
                0.0,
                0.0,
                float(self.page(index).width),
                float(self.page(index).height),
            )
            self._layer[index] = bool(self.pages.text_in(index, whole).strip())
        return self.pages.text_in(index, box) if self._layer[index] else ""


# -- where each band is ---------------------------------------------------------


def title_top(scan: PageScan, stop: float) -> float | None:
    """Where the declaration's title starts, over row `stop`; None where it
    was not read. A stamp or a signature over it is not the header's."""
    tops = [
        box[1]
        for line, box in zip(scan.lines, scan.boxes)
        if box[1] < stop
        and not NOTE_NUMBER.match(line["text"])
        and any(t.search(squash(line["text"])) for t in TITLE)
    ]
    return min(tops, default=None)


def find_header(scan: PageScan, birth: Band | None, widen: int) -> Found:
    """From the title to "Uwaga:" (or the notes it heads), or, a caption
    wider, to "CZĘŚĆ A"; never down to the name or the birth date. From the
    page's first ink where the title was not read."""
    h = scan.h
    guards = [m.top for m in scan.marks if m.kinds & {"czesc_a", "name"}]
    if birth is not None:
        guards.append(birth.label[1])
    guard = min(guards, default=float(scan.height))
    stops = [] if widen else [m for m in scan.marks if m.kinds & {"uwaga", "notes"}]
    stops = [m for m in stops if m.top < guard] or [
        m for m in scan.marks if "czesc_a" in m.kinds and m.top <= guard
    ]
    if not stops:
        return Found("no_stop")
    stop = min(stops, key=lambda m: m.top)
    above = [b for b in scan.boxes if b[3] < stop.top + 0.3 * h and b[1] < stop.top]
    if not above:
        return Found("no_title")
    notes = []
    title = title_top(scan, stop.top)
    if title is not None:
        top = over(scan, title)
    else:
        top = first_ink(scan)
        notes.append("title not read: starts at the page's first ink")
    bottom = min(over(scan, stop.top), int(guard))
    return Found("cut", [Piece(scan.index, top, bottom)], notes)


def find_employer(scan: PageScan, birth: Band | None, widen: int) -> Found:
    """From the first line under the birth date's line to its caption, or, a
    caption wider, to section I; "po zapoznaniu się ..." where the caption
    was not read."""
    if birth is None:
        return Found("no_birth_line")
    h = scan.h
    foot = birth_foot(scan, birth)
    below = [m for m in scan.marks if m.top > foot]
    after = next((m for m in below if "zapoznaniu" in m.kinds), None)
    limit = after.top if after is not None else foot + 14 * h
    captions = [m for m in below if "caption" in m.kinds and m.top < limit]
    notes = []
    if widen:
        ends = [m for m in below if "section_i" in m.kinds]
        if ends:
            end = over(scan, ends[0].top)
        else:
            notes.append("section I not read: one caption wider is not wider")
            widen = 0
    if not widen:
        if captions:
            end = under(scan, captions[0].bottom)
        elif after is not None:
            end = over(scan, after.top)
            notes.append("caption not read: ends at „po zapoznaniu”")
        else:
            return Found("no_caption")
    top = under(scan, foot)
    # Never a line read as the birth date's label, wherever it was placed.
    for line, box in zip(scan.lines, scan.boxes):
        if top <= (box[1] + box[3]) / 2 < end and LABEL.search(fold(line["text"])):
            top = max(top, under(scan, box[3]))
            notes.append("a line read as „urodzony” left out at the top")
    if end - top < 0.5 * h:
        return Found("no_caption", notes=notes)
    return Found("cut", [Piece(scan.index, top, end)], notes)


def label_rows(scan: PageScan, birth: Band) -> tuple[int, int]:
    """The rows of the printed "urodzony(a)": the run of ink in its columns
    with the most ink, which is the word, not a line over or under it. When
    the writing under it touches it, the run is cut where they meet."""
    x0, top, x1, bottom = birth.label
    h = birth.height
    lo = int(max(0, top - 0.3 * h))
    hi = int(min(scan.height, bottom + h))
    ink = (scan.grey[lo:hi, int(x0) : int(x1)] < scan.level).sum(axis=1)
    inked = np.flatnonzero(ink > 1)
    if not inked.size:
        return int(top), int(bottom)
    # Two empty rows do not part a word: the dot of an "i", an accent. The
    # word is inside its box; the lines over and under it are not.
    runs = np.split(inked, np.flatnonzero(np.diff(inked) > 3) + 1)
    inside = [r for r in runs if lo + r[0] < bottom and lo + r[-1] > top]
    run = max(inside or runs, key=lambda r: int(ink[r[0] : r[-1] + 1].sum()))
    start, end = int(run[0]), int(run[-1]) + 1
    if end - start > 1.3 * h:
        rows = np.arange(int(start + 0.6 * h), int(min(end, start + 1.4 * h)))
        end = int(rows[np.argmin(ink[rows])])
    return lo + start, lo + end


def birth_foot(scan: PageScan, birth: Band) -> float:
    """Where the birth date's line ends: on the dots the date is written on,
    else under the printed "urodzony(a)" itself. The box OCR read the label in
    can take in writing under it, so the label's own columns say where it
    ends. On a form without dots the date's "dots" can be the next line, its
    print or its writing: dots inside the box of a line starting under the
    label do not count."""
    top, end = label_rows(scan, birth)
    foot = float(end)
    baseline = birth.baseline
    if baseline is None or baseline < foot:
        return foot
    for b in scan.boxes:
        margin = 0.2 * (b[3] - b[1])
        if b[1] > (top + end) / 2 and b[1] + margin <= baseline <= b[3] - margin:
            return foot
    return float(baseline)


def _end_of(
    doc: Declaration, n: int, after: float, soft: frozenset[str], widen: int
) -> tuple[int, Mark | None]:
    """The heading a band from page `n` ends at, past `widen` of them, or a
    hard stop. With none within PAGE_BREAKS, (the page after `n`, None): a
    section runs onto one page more at most."""
    passed: tuple[int, float] | None = None
    count = 0
    for page, mark in doc.marks_after(n, after, n + PAGE_BREAKS):
        if mark.kinds & HARD_STOPS:
            return page, mark
        if not mark.kinds & soft:
            continue
        scan = doc.scan(page)
        assert scan is not None
        # A section's number and the words under it are one heading.
        if passed and passed[0] == page and mark.top - passed[1] < 2.5 * scan.h:
            passed = (page, mark.bottom)
            continue
        if count < widen:
            count += 1
            passed = (page, mark.bottom)
            continue
        return page, mark
    return (n + 1 if doc.scan(n + 1) is not None else n), None


def _pieces(
    doc: Declaration, start: tuple[int, float], end: tuple[int, Mark | None]
) -> list[Piece]:
    """A band from a start row to the heading it ends at (or the foot of the
    last page read), as a piece of each page."""
    (n0, top0), (n1, mark) = start, end
    pieces = []
    for n in range(n0, n1 + 1):
        scan = doc.scan(n)
        if scan is None:
            break
        top = top0 if n == n0 else content_top(scan)
        if n == n1 and mark is not None:
            upper = heading_top(scan, mark)
            bottom = over(scan, upper)
        else:
            bottom = content_bottom(scan)
        if bottom - top >= 0.5 * scan.h:
            pieces.append(Piece(scan.index, int(top), int(bottom)))
    return pieces


def _section(
    doc: Declaration, start: tuple[int, Mark], soft: frozenset[str], widen: int
) -> Found:
    n, mark = start
    scan = doc.scan(n)
    assert scan is not None
    upper = heading_top(scan, mark)
    top = over(scan, upper)
    end = _end_of(doc, n, mark.bottom - 0.3 * scan.h, soft, widen)
    notes = []
    if end[1] is None:
        notes.append("no heading after it read: runs to the next page's foot")
    return Found(
        "cut",
        _pieces(doc, (n, top), end),
        notes,
        start,
        (end[0], end[1]) if end[1] is not None else None,
    )


def _first(
    doc: Declaration, kind: str, n: int = 0, after: float = -1.0
) -> tuple[int, Mark] | None:
    """The first heading of a kind, before part B or the signature."""
    for page, mark in doc.marks_after(n, after, PAGES_AFTER):
        if kind in mark.kinds:
            return page, mark
        if mark.kinds & HARD_STOPS:
            return None
    return None


def _number_before(doc: Declaration, kind: str) -> tuple[int, Mark] | None:
    """The section's number last before a heading of a kind (not that
    heading's own number), on its page or the page before."""
    numbers: list[tuple[int, Mark]] = []
    for page, mark in doc.marks_after(0, -1.0, PAGES_AFTER):
        if kind in mark.kinds:
            scan = doc.scan(page)
            assert scan is not None
            own = heading_top(scan, mark)
            before = [(n, m) for n, m in numbers if n < page or m.top < own]
            if before and before[-1][0] >= page - 1:
                return before[-1]
            return None
        if mark.kinds & HARD_STOPS:
            return None
        if "numeral" in mark.kinds:
            numbers.append((page, mark))
    return None


def find_vii(doc: Declaration, widen: int) -> Found:
    """Section VII: from its heading to VIII's, or the next heading. Where its
    words were not read, from the section's number before VIII's heading."""
    start = _first(doc, "vii")
    numbered = start is None
    if start is None:
        start = _number_before(doc, "viii")
    if start is None:
        return Found("no_heading")
    soft = frozenset({"viii", "ix", "x", "numeral"})
    found = _section(doc, start, soft, widen)
    if numbered:
        found.notes.append("heading not read: starts at its number")
    return found


def find_viii(doc: Declaration, vii: Found, widen: int) -> Found:
    """Section VIII: from its heading to IX's, X's or part B. Where its words
    were not read, from the section's number that ended VII."""
    soft = frozenset({"ix", "x", "numeral"})
    if vii.start is not None:
        n, mark = vii.start
        start = _first(doc, "viii", n, mark.bottom)
    else:
        start = _first(doc, "viii")
    numbered = False
    if start is None and vii.end is not None and vii.end[1].kinds == {"numeral"}:
        start, numbered = vii.end, True
    if start is None:
        return Found("no_heading")
    found = _section(doc, start, soft, widen)
    if numbered:
        found.notes.append("heading not read: starts at its number")
    return found


# -- what a band says ---------------------------------------------------------


@dataclass
class Row:
    """A line read off a band: its box in the piece's rows, what it says, its
    score."""

    box: Box
    text: str
    score: float
    printed: bool = False


def printed(text: str, band: str) -> bool:
    """A line that is the band's own print and nothing more."""
    if NUMERAL.fullmatch(re.sub(r"\s", "", text)):
        return True
    s = squash(text)
    if len(s) < 3:
        return False
    piece = regex.compile(f"(?:{s}){{e<={max(1, len(s) // 7)}}}")
    return any(piece.search(key) for key in PRINTED[band])


def keep(rows: list[Row], written: list[tuple[int, int]], h: float) -> list[Row]:
    """The rows worth reading: no stamp, footer or signature's caption, nothing
    without two letters or digits, nothing between the written lines."""
    kept = []
    for row in rows:
        centre = (row.box[1] + row.box[3]) / 2
        if STAMP.search(fold(row.text)) or len(squash(row.text)) < 2:
            continue
        if written and not any(
            a - 0.3 * h <= centre <= b + 0.3 * h for a, b in written
        ):
            continue
        kept.append(row)
    return kept


def text_lines(rows: list[Row]) -> list[Row]:
    """Rows of boxes as lines, each left to right: OCR's own order scrambles a
    justified line."""
    groups: list[list[Row]] = []
    for row in sorted(rows, key=lambda r: (r.box[1] + r.box[3]) / 2):
        centre = (row.box[1] + row.box[3]) / 2
        if groups and min(r.box[1] for r in groups[-1]) <= centre <= max(
            r.box[3] for r in groups[-1]
        ):
            groups[-1].append(row)
        else:
            groups.append([row])
    lines = []
    for group in groups:
        group.sort(key=lambda r: r.box[0])
        lines.append(
            Row(
                (
                    min(r.box[0] for r in group),
                    min(r.box[1] for r in group),
                    max(r.box[2] for r in group),
                    max(r.box[3] for r in group),
                ),
                " ".join(r.text for r in group),
                min(r.score for r in group),
                all(r.printed for r in group),
            )
        )
    return lines


def agrees(layer: str, read: str) -> bool:
    a, b = squash(layer), squash(read)
    return bool(a) and difflib.SequenceMatcher(None, a, b).ratio() >= LAYER_AGREES


def read_piece(
    doc: Declaration, band: str, piece: Piece, written: list[tuple[int, int]]
) -> tuple[list[Row], str, list[str]]:
    """What a piece says, line by line, and where that came from; and every
    line read in it, stamps and print too, as its picture shows them."""
    scan = doc.page(piece.page)
    if doc.digital(piece.page):
        box = (0.0, float(piece.top), float(scan.width), float(piece.bottom))
        texts = doc.pages.text_in(piece.page, box).splitlines()
        ocr_reads = sum(
            len(squash(line["text"]))
            for line, b in zip(scan.lines, scan.boxes)
            if piece.top <= (b[1] + b[3]) / 2 <= piece.bottom
        )
        # A page drawn from text can still carry a picture of what was filled
        # in by hand: its layer then says much less than OCR sees.
        if sum(len(squash(t)) for t in texts) >= 0.5 * ocr_reads:
            rows = [
                Row((0, i, 0, i), " ".join(t.split()), 1.0, printed(t, band))
                for i, t in enumerate(texts)
                if not STAMP.search(fold(t))
                and not names_a_signature(t)
                and len(squash(t)) >= 2
            ]
            return rows, "text_layer", texts
    crop = scan.image.crop((0, piece.top, scan.width, piece.bottom))
    rows = [
        Row(bounds(line["box"]), line["text"], line["score"])
        for line in doc.ocr.read_lines(crop)
    ]
    shown = [row.text for row in rows]
    source = "ocr"
    rows = keep(rows, written, scan.h)
    for row in rows:
        x0, y0, x1, y1 = row.box
        layer = doc.layer(piece.page, (x0, y0 + piece.top, x1, y1 + piece.top))
        if layer and agrees(layer, row.text):
            row.text, source = " ".join(layer.split()), "ocr+text_layer"
            shown.append(row.text)
        row.printed = printed(row.text, band)
    return text_lines(rows), source, shown


def holds_name(texts: Iterable[str], people: Iterable[tuple[str, str]]) -> bool:
    """Whether a line reads one of the people's (first name, surname): a first
    name or a surname's part ("Nowak-Kowalska" has two) as a whole word,
    folded; or a surname's part of `GLUED` letters or more inside the line's
    letters run together. OCR runs the words of bold capitals together
    ("TOMASZKOWALSKI"), and a firm its owner's initials ("JKOWALSKI sp.k.")."""
    words: set[str] = set()
    glued: set[str] = set()
    for first, last in people:
        words.update(name_tokens(first))
        for part in name_tokens(last):
            words.add(part)
            if len(part) >= GLUED:
                glued.add(part)
    for text in texts:
        if words & set(name_tokens(text)):
            return True
        letters = re.sub(r"[^a-z]", "", fold(text))
        if any(part in letters for part in glued):
            return True
    return False


def header_dates(cut: BandCut, rows: list[Row]) -> None:
    """The header's "dnia" date: the date on the line over "(miejscowość)",
    else one after a "dnia"; and its "stanu na" date; each with its line's
    score. A receipt stamp's lines are not read."""
    kept = [row for row in rows if not STAMP.search(fold(row.text))]
    placed = [
        row
        for row, under in zip(kept, kept[1:])
        if PLACE_CAPTION.search(squash(under.text))
    ]
    for row in [*placed, *kept]:
        day = dnia_in(row.text)
        if day is None and row in placed:
            day = date_in(row.text, DECLARED_YEARS)
        if day is not None:
            cut.dnia, cut.dnia_score = day.isoformat(), row.score
            break
    for row in kept:
        stan = stan_na_in(row.text, title=True)
        if stan is not None:
            cut.stan_na, cut.stan_na_score = stan.isoformat(), row.score
            break


# -- pictures -------------------------------------------------------------------


def _encode(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def blank_rows(image: Image.Image) -> list[int]:
    """The middle of each run of empty rows: where a picture can be cut
    without cutting through writing."""
    grey = np.array(image.convert("L"))
    width = grey.shape[1]
    edge = int(0.04 * width)
    ink = (grey[:, edge : width - edge] < dark_level(grey, 30)).sum(axis=1)
    empty = np.flatnonzero(ink <= max(3, int(0.002 * width)))
    if not empty.size:
        return []
    runs = np.split(empty, np.flatnonzero(np.diff(empty) != 1) + 1)
    return [int(run[len(run) // 2]) for run in runs if len(run) >= 3]


def pack(region: Image.Image, cuts: Sequence[int]) -> list[tuple[int, int, bytes]]:
    """The region as PNGs the site takes, as tall as each can be, cut only at
    `cuts`; a single line over the limit is shrunk (`cutter.png`). No strip is
    a sliver of paper at either end."""
    inner = (c for c in cuts if MIN_STRIP <= c <= region.height - MIN_STRIP)
    edges = sorted({0, region.height, *inner})
    out = []
    start = 0
    while start < len(edges) - 1:
        whole = _encode(region.crop((0, edges[start], region.width, region.height)))
        if len(whole) <= MAX_PNG_BYTES:
            out.append((edges[start], region.height, whole))
            break
        lo, hi, fit = start + 1, len(edges) - 2, None
        while lo <= hi:
            mid = (lo + hi) // 2
            data = _encode(region.crop((0, edges[start], region.width, edges[mid])))
            if len(data) <= MAX_PNG_BYTES:
                fit, lo = (mid, data), mid + 1
            else:
                hi = mid - 1
        if fit is None:
            end = start + 1
            fit = (end, png(region.crop((0, edges[start], region.width, edges[end]))))
        out.append((edges[start], edges[fit[0]], fit[1]))
        start = fit[0]
    return out


def draw(
    doc: Declaration,
    cut: BandCut,
    pieces: list[Piece],
    written: list[list[tuple[int, int]]],
) -> None:
    """The band's strips at its dpi, and its written lines in them."""
    for piece, lines in zip(pieces, written):
        scan = doc.page(piece.page)
        page = scan.image if cut.typed else doc.fine(piece.page)
        scale = page.height / scan.height
        cut.dpi = round(200 * scale)
        cut.width = cut.width or page.width
        top, bottom = round(piece.top * scale), round(piece.bottom * scale)
        region = page.crop((0, top, page.width, bottom))
        bounds_at = [(round(a * scale), round(b * scale)) for a, b in lines]
        between = [
            (bounds_at[i][1] + bounds_at[i + 1][0]) // 2
            for i in range(len(bounds_at) - 1)
            if bounds_at[i][1] <= bounds_at[i + 1][0]
        ]
        first = len(cut.strips)
        for y0, y1, data in pack(region, [*between, *blank_rows(region)]):
            cut.strips.append(Strip(piece.page, top + y0, top + y1, data))
        for a, b in bounds_at:
            for k in range(first, len(cut.strips)):
                strip = cut.strips[k]
                if strip.top <= top + a < strip.bottom:
                    cut.lines.append(
                        (k, top + a - strip.top, min(top + b, strip.bottom) - strip.top)
                    )
                    break


def inked(scan: PageScan, piece: Piece) -> bool:
    """Whether a piece holds ink wider than a scanner's speck: a word, the
    dots of a line."""
    return any(
        piece.top + 2 <= start
        and end <= piece.bottom - 2
        and scan.ink[start:end].max() >= 0.015 * scan.width
        for start, end in ink_runs(scan)
    )


def written_on(scan: PageScan, piece: Piece, printed: list[Box]) -> bool:
    """Whether a piece holds a word besides its own print (`printed`, boxes in
    its rows): a stroke as tall as a letter, which the dots of an empty line
    are not, whether OCR read it or not."""
    grey = scan.grey[piece.top : piece.bottom].copy()
    margin = 0.15 * scan.h
    for x0, y0, x1, y1 in printed:
        rows = slice(int(max(0, y0 - margin)), int(y1 + margin) + 1)
        grey[rows, int(max(0, x0 - margin)) : int(x1 + margin) + 1] = 255
    region = (scan.left, 0, scan.right, grey.shape[0])
    return strokes_in(grey, region, scan.h) > 0


def finish(
    doc: Declaration,
    band: str,
    found: Found,
    widen: int,
    names: Collection[tuple[str, str]] = (),
) -> BandCut:
    """Read a band, decide whether it is typed, and draw it. A band any line
    of which reads the declarant's name (`names`: first name and surname) is
    `holds_name`: drawn and kept, never to be sent (decision on 2026-11-20)."""
    cut = BandCut(band, found.status, widen, notes=list(found.notes))
    if found.status != "cut":
        return cut
    if not found.pieces:
        cut.status = "empty"
        return cut
    rows: list[Row] = []
    shown: list[str] = []
    sources = set()
    pieces, written = [], []
    blank_lines = True
    for n, piece in enumerate(found.pieces):
        scan = doc.page(piece.page)
        lines = written_lines(scan, piece.top, piece.bottom)
        if n and not lines and not inked(scan, piece):
            continue  # the next page's paper over the next heading: nothing on it
        pieces.append(piece)
        written.append(lines)
        read, source, said = read_piece(doc, band, piece, lines)
        rows += read
        shown += said
        sources.add(source)
        if source != "text_layer" and blank_lines:
            own_print = [r.box for r in read if r.printed]
            blank_lines = not written_on(scan, piece, own_print)
    content = [r for r in rows if not r.printed]
    digital = sources == {"text_layer"}
    cut.score = 1.0 if digital else min((r.score for r in content), default=0.0)
    cut.typed = digital or (bool(content) and cut.score >= TYPED_SCORE)
    if digital:
        cut.source = "text_layer"
    else:
        cut.source = "ocr+text_layer" if sources - {"ocr"} else "ocr"
    cut.text = "\n".join(r.text for r in content)
    if band == "header":
        header_dates(cut, rows)
    draw(doc, cut, pieces, written)
    if not cut.typed and cut.dpi == 200:
        cut.notes.append("a picture, not a PDF: nothing finer to draw")
    if band == "employer" and not content and blank_lines:
        # Readers would agree on „Brak” where the post was written elsewhere
        # (decision on 2026-11-20): not sent.
        cut.status = "empty"
        cut.notes.append(
            "nothing written under the birth date's line: the post may be on "
            "the birth date's line, which no band shows"
        )
    if holds_name(shown, names):
        cut.status = "holds_name"
        cut.notes.append("the declarant's name is read in it: never to be sent")
    return cut


# -- one file -------------------------------------------------------------------


@dataclass
class FileBands:
    """What a file gave: each date page's bands, or why it gave none."""

    #: cut, or not_fetched, unreadable (`cutter.FileCut`'s words).
    status: str
    kind: str = ""
    pages: int = 0
    pages_read: int = 0
    bands: dict[int, list[BandCut]] = field(default_factory=dict)
    error: str = ""


def cut_declaration(
    doc: Declaration,
    widen: Mapping[str, int],
    names: Collection[tuple[str, str]] = (),
) -> list[BandCut]:
    """The four bands of the declaration whose date page `doc` starts at;
    `names`, the declarant's first name and surname, which no band sent may
    read."""
    scan = doc.scans[0]
    birth = date_band(scan.lines, scan.width, scan.height, scan.grey, doc.ocr)
    vii = find_vii(doc, widen.get("vii", 0))
    found = {
        "header": find_header(scan, birth, widen.get("header", 0)),
        "employer": find_employer(scan, birth, widen.get("employer", 0)),
        "vii": vii,
        "viii": find_viii(doc, vii, widen.get("viii", 0)),
    }
    cuts = [finish(doc, band, found[band], widen.get(band, 0), names) for band in BANDS]
    header = cuts[0]
    if not header.stan_na:
        # Some forms print it under "CZĘŚĆ A" or beside the employer.
        for line in scan.lines:
            stan = stan_na_in(line["text"])
            if stan is not None:
                header.stan_na, header.stan_na_score = stan.isoformat(), line["score"]
                header.notes.append("„stanu na” read off the page, not the header")
                break
    return cuts


def cut_bands(
    data: bytes,
    pages: Sequence[tuple[int, int]],
    ocr: Ocr,
    widen: Mapping[tuple[int, str], int] | None = None,
    starts: Collection[int] = (),
    names: Mapping[int, Collection[tuple[str, str]]] | None = None,
) -> FileBands:
    """The bands of each date page (`pages`: page and rotation, as the date
    cut found them) of a declaration file; `widen` runs a band of a page that
    many captions further. `starts`: every date page of the file, those not
    due in this run too, each the start of a declaration and so the end of the
    one before it. `names`: for each date page, the first name and surname of
    whoever it may be the declaration of, which a band sent may not show."""
    kind = kind_of(data)
    if kind == "html":
        return FileBands("not_fetched", kind)
    if kind not in ("pdf", "image", "docx", "odt", "doc"):
        return FileBands("unreadable", kind)
    try:
        source = Pages(data, kind)
    except Exception as exc:  # noqa: BLE001 - a broken download is a result
        return FileBands("unreadable", kind, error=f"{type(exc).__name__}: {exc}"[:300])
    result = FileBands("cut", kind, source.count)
    date_pages = sorted({page for page, _ in pages} | set(starts))
    try:
        for page, rotation in sorted(pages):
            following = [p for p in date_pages if p > page]
            end = following[0] if following else source.count
            mine = {band: n for (p, band), n in (widen or {}).items() if p == page}
            try:
                doc = Declaration(source, ocr, page, rotation, end)
                result.bands[page] = cut_declaration(
                    doc, mine, (names or {}).get(page, ())
                )
                result.pages_read += len(doc.scans)
            except Exception as exc:  # noqa: BLE001 - one page's failure, not the file's
                why = f"{type(exc).__name__}: {exc}"[:300]
                result.bands[page] = [
                    BandCut(band, "unreadable", mine.get(band, 0), notes=[why])
                    for band in BANDS
                ]
                result.error = result.error or why
    finally:
        source.close()
    return result
