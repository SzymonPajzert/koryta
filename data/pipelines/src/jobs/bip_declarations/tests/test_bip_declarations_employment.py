"""The employment cut on made-up declarations, through RapidOCR as it runs on
predator: where each band starts and ends, what it says and how it is drawn.

The declarations are drawn (`synthetic_declarations`), so the tests know where
the name, the birth date and each heading are, and hold every band against
them: no band may show the name or the birth date.
"""

from __future__ import annotations

import io
import random
from datetime import date

import pytest
from PIL import Image

from jobs.bip_declarations.cutter import MAX_PNG_BYTES, Ocr
from jobs.bip_declarations.employment import (
    NUMERAL,
    BandCut,
    FileBands,
    Row,
    cut_bands,
    kinds_of,
    pack,
    printed,
    squash,
    text_lines,
)
from jobs.bip_declarations.reading import date_in, dnia_in, stan_na_in
from jobs.bip_declarations.tests.synthetic_declarations import (
    Drawn,
    council_file,
    employment_declaration,
    typed_pdf,
)

NAME, BORN = "Jan Testowy", "12.03.1965"


@pytest.fixture(scope="module")
def ocr():
    return Ocr(threads=4)


def bands(result: FileBands) -> dict[str, BandCut]:
    assert result.status == "cut", result.error
    [cuts] = result.bands.values()
    return {cut.band: cut for cut in cuts}


@pytest.fixture(scope="module")
def stopped(ocr) -> tuple[Drawn, dict[str, BandCut]]:
    """VIII stopped by "CZĘŚĆ B" right under it."""
    drawn = employment_declaration(NAME, BORN)
    return drawn, bands(cut_bands(drawn.pdf(), [(0, 0)], ocr))


@pytest.fixture(scope="module")
def runs_on(ocr) -> tuple[Drawn, dict[str, BandCut]]:
    """VIII running onto the next page, over IX."""
    drawn = employment_declaration(NAME, BORN, viii_runs_on=True)
    return drawn, bands(cut_bands(drawn.pdf(), [(0, 0)], ocr))


def test_the_employer_band_holds_the_employer_not_the_name_or_the_birth_date(
    stopped,
):
    drawn, cut = stopped
    employer = cut["employer"]

    assert (employer.status, employer.typed, employer.dpi) == ("cut", True, 200)
    assert "sekretarzgminy" in squash(employer.text)
    assert "testowy" not in squash(employer.text)
    assert "1965" not in employer.text
    [strip] = employer.strips
    # Under the birth date's line, down through the caption under the employer.
    assert strip.page == 0
    assert strip.top > drawn.at["born_line"][2] > drawn.at["born"][2]
    assert drawn.at["born"][2] > drawn.at["name"][2]
    assert strip.top < drawn.at["employer"][1]
    assert strip.bottom >= drawn.at["caption"][2]
    assert strip.png.startswith(b"\x89PNG") and len(strip.png) <= MAX_PNG_BYTES


def test_the_header_holds_the_title_and_the_dnia_date_not_the_name(stopped):
    drawn, cut = stopped
    header = cut["header"]

    assert header.status == "cut"
    text = squash(header.text)
    assert "oswiadczeniemajatkowe" in text
    assert "zastepcywojta" in text  # the title's list of functions
    assert "testowy" not in text
    assert (header.dnia, header.dnia_score >= 0.9) == ("2025-04-24", True)
    [strip] = header.strips
    assert strip.top <= drawn.at["title"][1]
    # It ends at "Uwaga:", over "CZĘŚĆ A" and the name under it.
    assert drawn.at["dnia"][2] < strip.bottom <= drawn.at["uwaga"][1]


def test_vii_starts_at_its_own_heading_not_at_section_iii(stopped):
    drawn, cut = stopped
    vii = cut["vii"]

    [strip] = vii.strips
    assert strip.page == 1
    assert drawn.at["section_iii"][2] < strip.top <= drawn.at["vii"][1]
    assert strip.bottom <= drawn.at["viii"][1]
    # The section's number is print alone on its line, left out; a label with
    # what was filled in after it is read whole.
    first = squash(vii.text.splitlines()[0])
    assert first.startswith("wspolkachhandlowych") and first.endswith("niedotyczy")
    assert "jestemczlonkiemzarzaduodkiedyniedotyczy" in squash(vii.text)


def test_viii_spans_the_page_break_as_two_strips(runs_on):
    drawn, cut = runs_on
    viii = cut["viii"]

    assert viii.status == "cut"
    first, second = viii.strips
    assert (first.page, second.page) == (1, 2)
    assert first.top <= drawn.at["viii"][1]
    assert first.bottom >= drawn.at["income"][2]
    assert second.top <= drawn.at["income_more"][1]
    assert second.bottom <= drawn.at["ix"][1]
    text = squash(viii.text)
    assert "wynagrodzenie" in text and "emerytura" in text
    assert "samochod" not in text  # section IX's
    # Each written line sits in its strip.
    assert {strip for strip, _, _ in viii.lines} == {0, 1}
    for strip, top, bottom in viii.lines:
        assert 0 <= top < bottom <= viii.strips[strip].bottom - viii.strips[strip].top


def test_nothing_past_czesc_b(stopped, runs_on):
    for drawn, cut in (stopped, runs_on):
        page, czesc_b, _ = drawn.at["czesc_b"]
        for band in cut.values():
            assert "adres" not in squash(band.text), band.band
            assert "testowa1" not in squash(band.text), band.band
            for strip in band.strips:
                assert strip.page < page or (
                    strip.page == page and strip.bottom * 200 <= czesc_b * band.dpi
                ), band.band


def test_a_handwritten_band_comes_out_at_300_dpi(ocr, stopped):
    drawn = employment_declaration(NAME, BORN, scribbled=True)

    cut = bands(cut_bands(drawn.pdf(), [(0, 0)], ocr))

    employer, typed = cut["employer"], stopped[1]["employer"]
    assert (employer.status, employer.typed, employer.dpi) == ("cut", False, 300)
    assert employer.score < 0.9  # what OCR made of it, if anything, scores low
    [strip] = employer.strips
    image = Image.open(io.BytesIO(strip.png))
    assert image.mode == "L"
    assert image.width == employer.width > 1.45 * typed.width
    # The same rows as the typed band's, drawn half as fine again.
    assert strip.top / 1.5 > drawn.at["born_line"][2]
    assert strip.bottom / 1.5 >= drawn.at["caption"][2]
    assert image.height == strip.bottom - strip.top
    assert len(strip.png) <= MAX_PNG_BYTES


def test_a_pdf_drawn_from_text_gives_its_text_layer(ocr):
    data = typed_pdf(NAME, BORN, employer="Starostwo Powiatowe w Testowie")

    cut = bands(cut_bands(data, [(0, 0)], ocr))

    employer = cut["employer"]
    assert (employer.source, employer.typed, employer.score) == (
        "text_layer",
        True,
        1.0,
    )
    assert "Starostwo Powiatowe w Testowie" in employer.text
    assert NAME not in employer.text
    header = cut["header"]
    assert (header.stan_na, header.stan_na_score) == ("2023-12-31", 1.0)
    # One page: no section VII or VIII on it.
    assert (cut["vii"].status, cut["viii"].status) == ("no_heading", "no_heading")


def test_a_recut_runs_a_band_one_caption_further(ocr, stopped):
    drawn = employment_declaration(NAME, BORN)

    cut = bands(cut_bands(drawn.pdf(), [(0, 0)], ocr, {(0, "vii"): 1}))

    vii, before = cut["vii"], stopped[1]["vii"]
    assert vii.widen == 1
    # Past VIII's heading, to "CZĘŚĆ B": VIII and its income are in it now.
    assert vii.strips[-1].bottom > before.strips[-1].bottom
    assert "wynagrodzenie" in squash(vii.text)
    assert vii.strips[-1].bottom <= drawn.at["czesc_b"][1]


def test_a_page_with_no_date_line_gives_no_employer_band(ocr):
    drawn = employment_declaration(NAME, BORN)

    # The second page has no birth date's line, and no part A under a title.
    result = cut_bands(drawn.pdf(), [(1, 0)], ocr)

    cut = bands(result)
    assert cut["employer"].status == "no_birth_line"
    assert cut["header"].status in ("no_stop", "no_title")


def stays_out_of_the_next_declaration(drawn: Drawn, cut: dict[str, BandCut]) -> None:
    other = drawn.at["other_name"][0]
    assert "wynagrodzenie" in squash(cut["viii"].text)
    for band in cut.values():
        assert all(strip.page < other for strip in band.strips), band.band
        assert "druga" not in squash(band.text), band.band
        assert "1970" not in band.text, band.band


def test_the_file_s_next_date_page_ends_a_declaration_though_it_is_not_due(ocr):
    # `--items` and `--recut` cut one page of a council's file: the file's
    # other date pages still end it. This form's label reads as no label.
    drawn = council_file(NAME, BORN, other_label="Data urodzenia:")

    cut = bands(cut_bands(drawn.pdf(), [(0, 0)], ocr, starts=[0, 2]))

    stays_out_of_the_next_declaration(drawn, cut)


def test_a_page_reading_the_birth_date_s_label_starts_another_declaration(ocr):
    # No "CZĘŚĆ A" and no name's label of the kinds the cut knows over it.
    drawn = council_file(NAME, BORN, other_label="urodzona")

    cut = bands(cut_bands(drawn.pdf(), [(0, 0)], ocr))

    stays_out_of_the_next_declaration(drawn, cut)


# -- without OCR ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("line", "kind"),
    [
        ("W spolkach handlowych (nazwa, siedziba spolki): nie dotyczy", "vii"),
        ("1.Wspotkachhandlowych(nazwa,siedzibaspotki）:", "vii"),
        ("Inne dochody osiagane z tytulu zatrudnienia lub innej", "viii"),
        ("kwot uzyskiwanych z kazdego tytulu:", "viii"),
        ("Sktadnikimieniaruchomegoowartoscipowyzej10000ztotych", "ix"),
        ("Zobowiazania pieniezne o wartosci powyzej 10 000 zlotych", "x"),
        ("CZESCB", "czesc_b"),
        ("CZESC A", "czesc_a"),
        ("Adres zamieszkania osoby skladajacej oswiadczenie:", "part_b"),
        ("Uwaga:", "uwaga"),
        ("(miejsce zatrudnienia, stanowisko lub funkcja)", "caption"),
    ],
)
def test_headings_are_read_with_letters_wrong(line, kind):
    assert kind in kinds_of(line)


@pytest.mark.parametrize(
    "line",
    [
        # Section III's shares in companies, without a company's name and seat.
        "1. Posiadam udzialy w spolkach handlowych - nalezy podac liczbe i emitenta",
        # VII's own income line is no VIII.
        "Z tego tytulu osiagnalem(elam) w roku ubieglym dochod w wysokosci:",
        # Page 1's note on part B is not part B.
        "W czesci A oswiadczenia zawarte sa informacje jawne, w czesci B zas "
        "informacje niejawne dotyczace adresu zamieszkania skladajacego "
        "oswiadczenie oraz miejsca polozenia nieruchomosci.",
    ],
)
def test_lines_like_a_heading_are_not_one(line):
    assert not kinds_of(line) & {"vii", "viii", "part_b", "czesc_b"}


@pytest.mark.parametrize(
    ("text", "number"),
    [
        ("VIl.", True),
        ("Vll.", True),
        ("VI1.", True),
        ("VIll.", True),
        ("VIlll.", True),
        ("VIlf.", True),
        ("IX.", True),
        ("X.", True),
        ("1.", False),
        ("II.", False),
        ("X", False),
    ],
)
def test_a_sections_number_as_ocr_reads_it(text, number):
    assert bool(NUMERAL.fullmatch(text)) is number


def test_the_declarations_own_dates():
    assert stan_na_in("według stanu na dzień 31.12.2023 r.") == date(2023, 12, 31)
    assert stan_na_in("wg stanu na dzien31 grudnia 2024 r.") == date(2024, 12, 31)
    assert stan_na_in("stanu na dzień 31.12.2049") == date(2049, 12, 31)
    assert stan_na_in("stanu na dzień 31.12.2050") is None
    assert stan_na_in("stanu na dzień 31.12.1985") is None
    assert stan_na_in("STAN NA 31.12.2020 r.") == date(2020, 12, 31)
    # A title's plain "na dzień" counts in the header only.
    title = "przed koncem kadencji na dzień 29.02.2024 r."
    assert stan_na_in(title) is None
    assert stan_na_in(title, title=True) == date(2024, 2, 29)
    assert stan_na_in("zatrudniony na stanowisku 12.03.2020", title=True) is None
    assert dnia_in("Brodnica, dnia 24kwietnia 2025r...") == date(2025, 4, 24)
    assert dnia_in("Pajeczno dn.27.04.2023.") == date(2023, 4, 27)
    # A form's heading quotes the act it follows: not the day it was signed.
    assert dnia_in("Rozporzadzenia Rady Ministrow z dnia 26 lutego 2003 r.") is None
    # The birth date's reading keeps its years.
    assert date_in("12.03.2024") is None
    assert date_in("12.03.1965") == date(1965, 3, 12)


def test_a_bands_own_print_says_nothing():
    assert printed("(miejsce zatrudnienia, stanowisko lub funkcja)", "employer")
    assert printed("(miejsse zatrudnienia,stanowiskolub funkcja)", "employer")
    assert printed("VIll.", "viii")
    assert printed("- jestem czlonkiem rady nadzorczej (od kiedy):", "vii")
    assert not printed("Urzad Gminy Testowo - Sekretarz Gminy", "employer")
    assert not printed("nie dotyczy", "vii")


def test_a_justified_line_reads_left_to_right():
    rows = [
        Row((600, 101, 800, 130), "ZARZADU", 0.99),
        Row((100, 100, 300, 131), "PREZES", 0.98),
        Row((100, 150, 400, 180), "RADNY", 0.95),
    ]

    lines = text_lines(rows)

    assert [line.text for line in lines] == ["PREZES ZARZADU", "RADNY"]
    assert lines[0].score == 0.98


def test_pack_cuts_a_band_between_its_lines_into_pictures_the_site_takes():
    rng = random.Random(3)
    noise = Image.frombytes(
        "L", (1200, 900), bytes(rng.randrange(256) for _ in range(1200 * 900))
    )

    strips = pack(noise, [150, 300, 450, 600, 750])

    assert strips[0][0] == 0 and strips[-1][1] == 900
    for (_, bottom, _), (top, _, _) in zip(strips, strips[1:]):
        assert bottom == top  # no gap, no overlap
    for top, bottom, data in strips:
        assert len(data) <= MAX_PNG_BYTES
        assert top in (0, 150, 300, 450, 600, 750)
