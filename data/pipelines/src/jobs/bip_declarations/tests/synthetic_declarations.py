"""Made-up asset declarations to cut: the repository is public, so no real
declaration, name or birth date goes into a test.

`scan` draws part A of the form the way a scanner gives it: a picture of the
page, the printed labels with dotted lines, and the filled-in name, date and
place over the dots. `typed` writes the same form as a PDF drawn from text, as
an office's word processor exports it. Pillow's own font draws both, so they do
not depend on the fonts a machine has.

`employment_declaration` draws a whole declaration for the employment cut: part
A under a title with its list of functions and the "dnia" line, then sections
VII and VIII on the next page, VIII running onto a third page or stopped by
"CZĘŚĆ B". `council_file` draws two declarations in one file, as a council
publishes them. `Drawn` says where each thing went, for a test to hold a band
against.
"""

from __future__ import annotations

import io
import math
import random
from dataclasses import dataclass, field

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


def typed_pdf(
    name: str, born: str, place: str = "Testowie", employer: str = ""
) -> bytes:
    """Part A as a PDF drawn from text, in Helvetica: one page, no pictures,
    with the employer typed over the dots when one is given."""
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
    if employer:
        lines.append((120, 455, 11, employer))
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


# -- a whole declaration, for the employment cut --------------------------------

FUNCTIONS = (
    "wojta, zastepcy wojta, sekretarza gminy, skarbnika gminy, kierownika jednostki",
    "organizacyjnej gminy, osoby zarzadzajacej i czlonka organu zarzadzajacego",
    "gminna osoba prawna oraz osoby wydajacej decyzje administracyjne w imieniu wojta",
)
#: Section III names "spolkach handlowych" too, but no company's name and seat.
SECTION_III = (
    "1. Posiadam udzialy w spolkach handlowych - nalezy podac liczbe i emitenta",
    "udzialow: nie dotyczy",
)
SECTION_VII = (
    "W spolkach handlowych (nazwa, siedziba spolki): nie dotyczy",
    "- jestem czlonkiem zarzadu (od kiedy): nie dotyczy",
    "- jestem czlonkiem rady nadzorczej (od kiedy): nie dotyczy",
    "- jestem czlonkiem komisji rewizyjnej (od kiedy): nie dotyczy",
    "Z tego tytulu osiagnalem(elam) w roku ubieglym dochod: nie dotyczy",
)
VIII_HEADING = (
    "Inne dochody osiagane z tytulu zatrudnienia lub innej dzialalnosci",
    "zarobkowej lub zajec, z podaniem kwot uzyskiwanych z kazdego tytulu:",
)
INCOME = (
    "Urzad Gminy Testowo - wynagrodzenie 85 000,00 zl",
    "Spoldzielnia Testowa - umowa zlecenie 4 000,00 zl",
    "Dieta radnego Rady Gminy Testowo 12 000,00 zl",
    "Emerytura 30 000,00 zl brutto",
)
PART_B = (
    "Adres zamieszkania osoby skladajacej oswiadczenie: ul. Testowa 1, Testowo",
    "Miejsce polozenia nieruchomosci wymienionych w punkcie II czesci A: Testowo",
)


@dataclass
class Drawn:
    """A drawn declaration's pages, and where each thing a test looks for is:
    its page and its rows."""

    pages: list[Image.Image] = field(default_factory=list)
    at: dict[str, tuple[int, int, int]] = field(default_factory=dict)

    def pdf(self) -> bytes:
        return scanned_pdf(*self.pages)


class _Page:
    """Lines written down a page, each remembered by a name when given one."""

    def __init__(self, drawn: Drawn) -> None:
        self.drawn = drawn
        self.index = len(drawn.pages)
        self.image = Image.new("L", (WIDTH, HEIGHT), 250)
        self.draw = ImageDraw.Draw(self.image)
        drawn.pages.append(self.image)

    def _write(self, y: int, text: str, size: int, x: int) -> tuple[int, int]:
        """Write a line at row `y`: the rows its ink takes."""
        font = _font(size)
        self.draw.text((x, y), text, font=font, fill=25)
        _, top, _, bottom = self.draw.textbbox((x, y), text, font=font)
        return int(top), int(bottom)

    def text(
        self, y: int, text: str, *, size: int = 28, x: int = 140, name: str = ""
    ) -> int:
        """Write a line at row `y`, remembering its ink's rows under `name`."""
        top, bottom = self._write(y, text, size, x)
        if name:
            self.drawn.at[name] = (self.index, top, bottom)
        return y + int(size * 1.7)

    def lines(
        self, y: int, texts: tuple[str, ...], *, size: int = 28, name: str = ""
    ) -> int:
        rows = []
        for text in texts:
            rows.append(self._write(y, text, size, 140))
            y += int(size * 1.7)
        if name:
            self.drawn.at[name] = (self.index, rows[0][0], rows[-1][1])
        return y

    def signature(self, x: int, y: int, signer: str, name: str) -> None:
        """An electronic signature's block, as ePUAP prints it in a corner:
        "PODPIS ZAUFANY", the signer's name a word a line, the time, and
        "Dokument podpisany elektronicznie podpisem zaufanym"."""
        top = y
        for text, size in (
            ("PODPIS ZAUFANY", 22),
            *((word.upper(), 26) for word in signer.split()),
            ("24.04.2025 10:15:33 (GMT+2)", 16),
            ("Dokument podpisany elektronicznie", 16),
            ("podpisem zaufanym", 16),
        ):
            _, bottom = self._write(y, text, size, x)
            y = bottom + 6
        self.drawn.at[name] = (self.index, top, y)

    def scribble(self, x: int, y: int, width: int, seed: int) -> None:
        """Pen strokes no OCR reads as print: words of loops along a line."""
        rng = random.Random(seed)
        start = x
        while start < x + width:
            word = rng.randrange(90, 220)
            points = [
                (
                    start + i,
                    y
                    + 16 * math.sin(i / 7.0) * (0.5 + 0.5 * math.sin(i / 23.0))
                    + rng.uniform(-2, 2),
                )
                for i in range(0, word, 2)
            ]
            self.draw.line(points, fill=40, width=4)
            start += word + rng.randrange(30, 60)


#: Where a drawn electronic signature's block starts across the page.
SIGNATURE_X = 1300


def _part_a(
    drawn: Drawn,
    name: str,
    born: str,
    employer: str,
    scribbled: bool,
    *,
    signed: bool = False,
    on_birth_line: bool = False,
) -> None:
    page = _Page(drawn)
    if signed:
        page.text(40, "Wplynelo 25.04.2025", size=26, name="stamp")
        page.signature(SIGNATURE_X, 30, name, "signature")
    page.text(110, "OSWIADCZENIE MAJATKOWE", size=40, x=540, name="title")
    page.lines(180, FUNCTIONS, size=26, name="functions")
    page.text(330, "Testowo, dnia 24.04.2025 r.", x=1000, name="dnia")
    page.text(375, "(miejscowosc)", size=20, x=1080)
    page.text(450, "Uwaga:", size=26, name="uwaga")
    page.lines(495, NOTES, size=22)
    page.text(930, "CZESC A", size=30, x=760, name="czesc_a")
    page.text(1010, "Ja, nizej podpisany(a), " + "." * 70, size=30)
    page.text(980, name, size=44, x=620, name="name")
    page.text(1060, "(imiona i nazwisko oraz nazwisko rodowe)", size=22, x=560)
    page.text(
        1150, "urodzony(a) " + "." * 32 + " w " + "." * 40, size=30, name="born_line"
    )
    page.text(1115, born, size=44, x=420, name="born")
    page.text(1115, "Testowie", size=44, x=1020)
    page.text(1250, "." * 95, size=30)
    if on_birth_line:
        # After the place of birth; the employer's own dotted line stays empty.
        page.text(1125, employer, size=30, x=1240, name="employer")
    elif scribbled:
        page.scribble(300, 1235, 1000, seed=7)
        drawn.at["employer"] = (page.index, 1215, 1255)
    else:
        page.text(1215, employer, size=40, x=300, name="employer")
    page.text(
        1300,
        "(miejsce zatrudnienia, stanowisko lub funkcja)",
        size=22,
        x=600,
        name="caption",
    )
    page.lines(
        1400,
        (
            "po zapoznaniu sie z przepisami ustawy z dnia 8 marca 1990 r. o",
            "samorzadzie gminnym, zgodnie z art. 24h tej ustawy oswiadczam, ze",
            "posiadam wchodzace",
            "w sklad malzenskiej wspolnosci majatkowej lub stanowiace moj majatek:",
        ),
        size=22,
    )
    page.text(1560, "I.", size=28)
    page.text(1610, "Zasoby pieniezne:", size=28)
    page.text(1660, "- srodki pieniezne w walucie polskiej: nie dotyczy", size=28)


def _part_b(page: _Page, y: int) -> int:
    page.text(y, "CZESC B", size=30, x=760, name="czesc_b")
    return page.lines(y + 70, PART_B, size=24, name="part_b")


def employment_declaration(
    name: str,
    born: str,
    employer: str = "Urzad Gminy Testowo - Sekretarz Gminy",
    *,
    viii_runs_on: bool = False,
    scribbled: bool = False,
    signed: bool = False,
    on_birth_line: bool = False,
) -> Drawn:
    """Part A, then VII and VIII on the next page: VIII running onto a third
    page over IX and X when `viii_runs_on`, else stopped by "CZĘŚĆ B" right
    under it. `scribbled` writes the employer by hand, which no OCR reads.
    `signed` adds a receipt stamp over the title and the declarant's
    electronic signature's block beside it, and another beside VII.
    `on_birth_line` writes the employer at the end of the birth date's line,
    leaving its own dotted line empty."""
    drawn = Drawn()
    _part_a(
        drawn,
        name,
        born,
        employer,
        scribbled,
        signed=signed,
        on_birth_line=on_birth_line,
    )
    page = _Page(drawn)
    y = page.text(150, "III.", size=28)
    page.lines(y, SECTION_III, name="section_iii")
    top = 1300 if viii_runs_on else 400
    if signed:
        page.signature(SIGNATURE_X, top + 20, name, "signature_vii")
    page.text(top, "VII.", size=28, name="vii")
    y = page.lines(top + 50, SECTION_VII)
    y = page.text(y + 40, "VIII.", size=28, name="viii")
    y = page.lines(y, VIII_HEADING)
    if not viii_runs_on:
        y = page.lines(y + 20, INCOME, name="income")
        _part_b(page, y + 60)
        return drawn
    page.lines(y + 20, INCOME[:2], name="income")
    page = _Page(drawn)
    y = page.lines(150, INCOME[2:], name="income_more")
    y = page.text(y + 60, "IX.", size=28, name="ix")
    y = page.text(y, "Skladniki mienia ruchomego o wartosci powyzej 10 000 zlotych:")
    y = page.text(y, "samochod osobowy Testowa marka 2010 r.", name="ix_text")
    y = page.text(y + 40, "X.", size=28)
    y = page.text(y, "Zobowiazania pieniezne o wartosci powyzej 10 000 zlotych:")
    y = page.text(y, "nie dotyczy")
    _part_b(page, y + 60)
    return drawn


def council_file(name: str, born: str, *, other_label: str = "urodzona") -> Drawn:
    """Two declarations in one file, as a council publishes them: the first
    on pages 0-1, its part B left out, so nothing on page 1 ends it; the
    second on pages 2-3, on another form, which prints no "CZĘŚĆ A" and names
    its declarant under "Nazwisko i imię". `other_label` is that form's label
    in front of the birth date ("Data urodzenia:" is none that OCR reads as
    the date's label)."""
    drawn = Drawn()
    _part_a(drawn, name, born, "Urzad Gminy Testowo - Sekretarz Gminy", False)
    page = _Page(drawn)
    y = page.text(150, "III.", size=28)
    page.lines(y, SECTION_III)
    page.text(400, "VII.", size=28)
    y = page.lines(450, SECTION_VII)
    y = page.text(y + 40, "VIII.", size=28, name="viii")
    y = page.lines(y, VIII_HEADING)
    page.lines(y + 20, INCOME, name="income")
    page = _Page(drawn)
    page.text(110, "OSWIADCZENIE MAJATKOWE", size=40, x=540)
    page.text(180, "radnej gminy", size=30, x=700)
    page.text(330, "Testowo, dnia 20.04.2025 r.", x=1000)
    page.text(375, "(miejscowosc)", size=20, x=1080)
    page.text(450, "Uwaga:", size=26)
    page.lines(495, NOTES, size=22)
    page.text(1010, "Nazwisko i imie: Anna Druga", size=34, name="other_name")
    page.text(1150, other_label + " " + "." * 30 + " w " + "." * 40, size=30)
    page.text(1115, "01.02.1970", size=44, x=420, name="other_born")
    page.text(1115, "Testowie", size=44, x=1020)
    page.text(1215, "Szkola Podstawowa w Testowie - nauczycielka", size=40, x=300)
    page.text(1300, "(miejsce zatrudnienia, stanowisko lub funkcja)", size=22, x=600)
    page.text(
        1400,
        "po zapoznaniu sie z przepisami ustawy z dnia 8 marca 1990 r.",
        size=22,
    )
    page.text(1560, "I.", size=28)
    page.text(1610, "Zasoby pieniezne:", size=28)
    page = _Page(drawn)
    page.text(150, "VII.", size=28)
    page.lines(200, SECTION_VII)
    return drawn
