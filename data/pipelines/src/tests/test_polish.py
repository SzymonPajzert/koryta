import pytest

from util.polish import (
    PkwFormat,
    format_person_name,
    normalize_person_name,
    parse_name,
)


def all_configurations(first_name, middle_name, last_name):
    yield (
        f"{first_name} {middle_name} {last_name}",
        PkwFormat.First_Last,
        (first_name, middle_name, last_name),
    )
    yield (
        f"{first_name} {last_name}",
        PkwFormat.First_Last,
        (first_name, "", last_name),
    )
    yield (
        f"{first_name} {middle_name} {last_name.upper()}",
        PkwFormat.First_LAST,
        (first_name, middle_name, last_name),
    )
    yield (
        f"{first_name} {last_name.upper()}",
        PkwFormat.First_LAST,
        (first_name, "", last_name),
    )
    yield (
        f"{last_name.upper()} {first_name} {middle_name}",
        PkwFormat.LAST_First,
        (first_name, middle_name, last_name),
    )
    yield (
        f"{last_name.upper()} {first_name}",
        PkwFormat.LAST_First,
        (first_name, "", last_name),
    )


@pytest.mark.parametrize(
    "pkw_name, format, expected",
    [
        *all_configurations("Jan", "Adam", "Nowak"),
        *all_configurations("Anna", "Maria", "Kowalska-Nowak"),
        *all_configurations("Paweł", "Piotr", "Kleszcz"),
        *all_configurations("Agnieszka", "Anna", "Gęślą-Żółć"),
        ("VON DER LEYEN Ursula", PkwFormat.LAST_First, ("Ursula", "", "VON DER LEYEN")),
    ],
)
def test_parse_name(pkw_name, format, expected):
    expected_first, expected_middle, expected_last = expected
    first_name, middle_name, last_name = parse_name(pkw_name, format)
    assert first_name.lower() == expected_first.lower()
    assert middle_name.lower() == expected_middle.lower()
    assert last_name.lower() == expected_last.lower()


@pytest.mark.parametrize(
    "raw, expected",
    [
        # A shouted name, which is the whole point: this is how the five worst
        # koryta.pl pages are named today.
        ("MAŁGORZATA GRADZIUK", "Małgorzata Gradziuk"),
        ("ŁUKASZ ŚWIĘCICKI", "Łukasz Święcicki"),
        # PKW shouts the surname and leaves the rest alone; so does this.
        ("KOWALSKA-NOWAK Anna", "Kowalska-Nowak Anna"),
        ("Dawid JABROCKI", "Dawid Jabrocki"),
        ("KAROLINA GŁOWACKA-JOŃCZYK", "Karolina Głowacka-Jończyk"),
        ("MAŁGORZATA PROCHWICZ O'SHAUGHNESSY", "Małgorzata Prochwicz O'Shaughnessy"),
        # Already in case, and so left alone - this renames nobody whose name
        # the register spelled properly.
        ("Andrzej Grzyb", "Andrzej Grzyb"),
        ("Anna Maria Kowalska-Nowak", "Anna Maria Kowalska-Nowak"),
        ("Jan A. Kowalski", "Jan A. Kowalski"),
        # Putting a shouted name back in case, a particle belongs to the surname
        # and stays lowercase; leading it, there is nothing for it to hang off.
        ("PIOTR VAN DER COGHEN", "Piotr van der Coghen"),
        ("VAN DER COGHEN PIOTR", "Van der Coghen Piotr"),
        ("Piotr van der Coghen", "Piotr van der Coghen"),
        ("Jan Kowalski vel Kuropatwa", "Jan Kowalski vel Kuropatwa"),
        # A particle word that is somebody's actual surname keeps the capital
        # its writer gave it - these are real koryta.pl people.
        ("Jolanta Den", "Jolanta Den"),
        ("Maria Du Vall", "Maria Du Vall"),
        # Not shouting, so not this function's business, however it reads: a
        # name typed flat, one whose elided article was left lowercase, and the
        # whitespace a scraper left behind all come back untouched.
        ("jerzy hardie-douglas", "jerzy hardie-douglas"),
        ("Kajetan Ludwik D'obyrn", "Kajetan Ludwik D'obyrn"),
        ("  Anna   Nowak\t", "  Anna   Nowak\t"),
        # Case somebody chose is information, and `str.title()` would lose it.
        ("Ronald McDonald", "Ronald McDonald"),
        ("", ""),
    ],
)
def test_format_person_name(raw, expected):
    assert format_person_name(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "MAŁGORZATA GRADZIUK",
        "Dawid JABROCKI",
        "PIOTR VAN DER COGHEN",
        "jerzy hardie-douglas",
        "Piotr van der Coghen",
        "Jolanta Den",
        "Ronald McDonald",
        "Bartosz Kopania (Pablo Morales)",
        "Maciej Rembiś `",
    ],
)
def test_format_person_name_is_idempotent(raw):
    """Formatting a formatted name changes nothing.

    The invariant the pipeline and the export tests state is
    `format_person_name(name) == name`, which only says something about a name
    the pipeline wrote if a second pass is a no-op.
    """
    once = format_person_name(raw)
    assert format_person_name(once) == once


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Rafał Trzaskowski", "rafal trzaskowski"),
        ("Rafal Trzaskowski", "rafal trzaskowski"),
        ("RAFAŁ TRZASKOWSKI", "rafal trzaskowski"),
        # ł and Ł are their own codepoints, so NFD leaves them alone and they
        # need their own replacement - the one bug this function is easy to
        # write with.
        ("Łukasz Żółw", "lukasz zolw"),
        # Hyphens, apostrophes and dots are word breaks, not characters.
        ("Jerzy Hardie-Douglas", "jerzy hardie douglas"),
        ("D'Obyrn", "d obyrn"),
        ("Jan  Kowalski ", "jan kowalski"),
        # Nothing a name can be reduced to is still nothing: the caller has to
        # fall back rather than look a page up under the empty key.
        ("   ", ""),
        ("???", ""),
    ],
)
def test_normalize_person_name(raw, expected):
    """A transcription of `normalizePersonName` in `frontend/shared/names.ts`.

    The cases are the ones that distinguish the two implementations rather than
    a sample: if these agree, the pipeline predicts the page the ingest's
    `nameNormalized` lookup would land on.
    """
    assert normalize_person_name(raw) == expected


def test_normalize_person_name_is_idempotent():
    """It is a key, and a key of a key has to be the same key."""
    for raw in ("Rafał Trzaskowski", "Jerzy Hardie-Douglas", "Łukasz Żółw"):
        once = normalize_person_name(raw)
        assert normalize_person_name(once) == once
