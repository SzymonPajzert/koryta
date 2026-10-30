"""Made-up asset declarations to cut: the repository is public, so no real
declaration, name or birth date goes into a test.

`scan` draws part A of the form the way a scanner gives it: a picture of the
page, the printed labels with dotted lines, and the filled-in name, date and
place over the dots. `typed` writes the same form as a PDF drawn from text, as
an office's word processor exports it. Pillow's own font draws both, so they do
not depend on the fonts a machine has.
"""

from __future__ import annotations

import io

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1654, 2339  # A4 at 200 dpi

NOTES = (
    "1. Osoba skladajaca oswiadczenie obowiazana jest do zgodnego z prawda, starannego",
    "i zupelnego wypelnienia kazdej z rubryk.",
    "2. Jezeli poszczegolne rubryki nie znajduja w konkretnym przypadku zastosowania,",
    "nalezy wpisac nie dotyczy.",
    "3. Osoba skladajaca oswiadczenie obowiazana jest okreslic przynaleznosc",
    "poszczegolnych skladnikow majatkowych, dochodow i zobowiazan do majatku odrebnego",
    "i majatku objetego malzenska wspolnoscia majatkowa.",
    "4. Oswiadczenie majatkowe dotyczy majatku w kraju i za granica.",
    "5. Oswiadczenie majatkowe obejmuje rowniez wierzytelnosci pieniezne.",
    "6. Na stronie 1 umieszczone sa informacje jawne,",
    "na stronie 2 informacje niejawne.",
)


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    return ImageFont.load_default(size=size)


def scan_page(name: str, born: str, place: str = "Testowie") -> Image.Image:
    """Part A of a declaration, filled in, as a scanned page."""
    image = Image.new("L", (WIDTH, HEIGHT), 250)
    draw = ImageDraw.Draw(image)
    draw.text((560, 160), "OSWIADCZENIE MAJATKOWE", font=_font(40), fill=20)
    draw.text((700, 220), "radnego gminy", font=_font(30), fill=20)
    draw.text(
        (560, 270), "wedlug stanu na dzien 31.12.2023 r.", font=_font(26), fill=20
    )
    y = 360
    for line in NOTES:
        draw.text((140, y), line, font=_font(22), fill=30)
        y += 40
    draw.text((780, 800), "CZESC A", font=_font(30), fill=20)
    draw.text(
        (140, 880), "Ja, nizej podpisany(a), " + "." * 70, font=_font(30), fill=30
    )
    draw.text((620, 850), name, font=_font(44), fill=60)
    draw.text(
        (560, 925), "(imiona i nazwisko oraz nazwisko rodowe)", font=_font(22), fill=30
    )
    draw.text(
        (140, 1020),
        "urodzony(a) " + "." * 32 + " w " + "." * 40,
        font=_font(30),
        fill=30,
    )
    draw.text((420, 985), born, font=_font(44), fill=50)
    draw.text((1020, 985), place, font=_font(44), fill=50)
    draw.text((140, 1120), "." * 95, font=_font(30), fill=30)
    draw.text(
        (600, 1165),
        "(miejsce zatrudnienia, stanowisko lub funkcja)",
        font=_font(22),
        fill=30,
    )
    draw.text(
        (140, 1260),
        "po zapoznaniu sie z przepisami ustawy z dnia 8 marca 1990 r. o samorzadzie",
        font=_font(22),
        fill=30,
    )
    return image


def scanned_pdf(*pages: Image.Image) -> bytes:
    """Pages as an image-only PDF, as a scanner makes one."""
    buffer = io.BytesIO()
    first, *rest = [page.convert("RGB") for page in pages]
    first.save(buffer, format="PDF", save_all=True, append_images=rest, resolution=200)
    return buffer.getvalue()


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def typed_pdf(name: str, born: str, place: str = "Testowie") -> bytes:
    """Part A as a PDF drawn from text, in Helvetica: one page, no pictures."""
    lines = [
        (200, 780, 14, "OSWIADCZENIE MAJATKOWE"),
        (250, 760, 11, "radnego gminy"),
        (200, 742, 10, "wedlug stanu na dzien 31.12.2023 r."),
        *[(50, 712 - 14 * i, 8, line) for i, line in enumerate(NOTES)],
        (280, 550, 11, "CZESC A"),
        (50, 520, 11, f"Ja, nizej podpisany(a), {name}"),
        (200, 505, 8, "(imiona i nazwisko oraz nazwisko rodowe)"),
        (50, 480, 11, f"urodzony(a) {born} w {place}"),
        (50, 450, 11, "." * 95),
        (215, 435, 8, "(miejsce zatrudnienia, stanowisko lub funkcja)"),
        (50, 410, 8, "po zapoznaniu sie z przepisami ustawy z dnia 8 marca 1990 r."),
    ]
    stream = "".join(
        f"BT /F1 {size} Tf {x} {y} Td ({_escape(text)}) Tj ET\n"
        for x, y, size, text in lines
    ).encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"endstream",
    ]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(out.tell())
        out.write(b"%d 0 obj\n" % number + body + b"\nendobj\n")
    xref = out.tell()
    out.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1))
    for offset in offsets:
        out.write(b"%010d 00000 n \n" % offset)
    out.write(
        b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n"
        % (len(objects) + 1, xref)
    )
    return out.getvalue()
