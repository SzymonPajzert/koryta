"""Synthetic declaration crops for tests/visual/oswiadczenia.spec.ts.

Fake people, fake places, printed form text in DejaVu Sans and the
"handwriting" in DejaVu Serif Italic, jittered letter by letter and tilted a
little, then softened like a scan. Sizes follow the real crops the page is
drawn for (app/components/oswiadczenia/Crop.vue): a date line about 950 by
105 px, a name line about 1,160 by 94.

Run from frontend/, with data/pipelines' venv, which pins Pillow 12.3.0:

    ../data/pipelines/.venv/bin/python -I tests/visual/fixtures/crops/make_crops.py tests/visual/fixtures/crops

It rewrites the PNGs beside it. With that Pillow and the DejaVu fonts of
fonts-dejavu-core 2.37 they come out byte for byte as committed; another
version may move a pixel, and the oswiadczenia baselines with it.
"""

import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

PRINT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
HAND = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf"
PAPER = 247
PRINT_INK = 35
HAND_INK = 45


def handwriting(text: str, size: int, seed: int) -> Image.Image:
    """`text` as one hand writes it: letters a little uneven in size, height
    and spacing, the whole line tilted by a degree or so. An "L" mask, white
    where the ink is."""
    rng = random.Random(seed)
    layer = Image.new("L", (size * len(text) + 80, size * 2 + 40), 0)
    draw = ImageDraw.Draw(layer)
    x = 20
    for char in text:
        font = ImageFont.truetype(HAND, size + rng.randint(-1, 2))
        y = 20 + rng.randint(-2, 2)
        draw.text((x, y), char, font=font, fill=255)
        x += draw.textlength(char, font=font) * rng.uniform(0.94, 1.04)
    layer = layer.crop((0, 0, int(x) + 30, layer.height))
    return layer.rotate(rng.uniform(-1.4, 1.2), resample=Image.BICUBIC, expand=True)


def paper(width: int, height: int, seed: int) -> Image.Image:
    rng = random.Random(seed)
    image = Image.new("L", (width, height), PAPER)
    draw = ImageDraw.Draw(image)
    # A few specks of dust, as on any scan.
    for _ in range(rng.randint(6, 12)):
        x, y = rng.randrange(width), rng.randrange(height)
        r = rng.choice((0, 0, 1))
        draw.ellipse((x - r, y - r, x + r, y + r), fill=rng.randint(150, 210))
    return image


def ink(image: Image.Image, mask: Image.Image, at: tuple[int, int], tone: int) -> None:
    image.paste(Image.new("L", mask.size, tone), at, mask)


def dotted(draw: ImageDraw.ImageDraw, x0: int, x1: int, y: int, font) -> int:
    dots = "." * max(0, int((x1 - x0) / draw.textlength(".", font=font)))
    draw.text((x0, y), dots, font=font, fill=PRINT_INK)
    return x0 + int(draw.textlength(dots, font=font))


def date_line(date: str, place: str, seed: int) -> Image.Image:
    """`urodzony(a) ....<date>.... w ....<place>....`, cut at the line's left
    end the way the job cuts it."""
    width, height = 950, 105
    image = paper(width, height, seed)
    draw = ImageDraw.Draw(image)
    printed = ImageFont.truetype(PRINT, 27)
    base = 62
    draw.text((10, base), "urodzony(a)", font=printed, fill=PRINT_INK)
    x = 10 + int(draw.textlength("urodzony(a) ", font=printed))
    end = dotted(draw, x, 610, base, printed)
    draw.text((end + 8, base), "w", font=printed, fill=PRINT_INK)
    dotted(draw, end + 8 + int(draw.textlength("w ", font=printed)), width, base, printed)
    rng = random.Random(seed)
    ink(image, handwriting(date, 44, seed), (x + 40 + rng.randint(-10, 10), 4), HAND_INK)
    ink(image, handwriting(place, 40, seed + 1), (end + 60 + rng.randint(-8, 8), 8), HAND_INK)
    return image.filter(ImageFilter.GaussianBlur(0.55))


def name_line(name: str, seed: int) -> Image.Image:
    """`Ja, niżej podpisany(a), ....<name>....`, with the top of the printed
    caption under the line, as the job's name crops have it."""
    width, height = 1160, 94
    image = paper(width, height, seed)
    draw = ImageDraw.Draw(image)
    printed = ImageFont.truetype(PRINT, 27)
    small = ImageFont.truetype(PRINT, 19)
    base = 44
    draw.text((10, base), "Ja, niżej podpisany(a),", font=printed, fill=PRINT_INK)
    x = 10 + int(draw.textlength("Ja, niżej podpisany(a), ", font=printed))
    dotted(draw, x, width - 20, base, printed)
    draw.text((x + 120, base + 36), "(imiona i nazwisko oraz nazwisko rodowe)", font=small, fill=PRINT_INK)
    ink(image, handwriting(name, 42, seed), (x + 70, -14), HAND_INK)
    return image.filter(ImageFilter.GaussianBlur(0.55))


CASES = [
    # file stem, date as written, place of birth, name
    ("crop-1", "15.07.1979", "Testowicach", "Jan Przykładowy", 11),
    ("crop-2", "3 IX 1971", "Przykładowie", "Anna Testowa", 22),
    ("crop-3", "27-11-1958", "Wzorcowie", "Zofia Próbna", 33),
]

if __name__ == "__main__":
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    for stem, date, place, name, seed in CASES:
        date_line(date, place, seed).save(out / f"{stem}-data.png", optimize=True)
        name_line(name, seed).save(out / f"{stem}-nazwisko.png", optimize=True)
    for file in sorted(out.glob("*.png")):
        with Image.open(file) as image:
            print(file.name, image.size, file.stat().st_size)
