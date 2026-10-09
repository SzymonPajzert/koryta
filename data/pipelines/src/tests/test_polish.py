import pytest

from util.polish import (
    PkwFormat,
    adds_middle_names,
    format_person_name,
    names_agree,
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
    ("full", "short", "expected"),
    [
        # The register's two spellings of one entry, the reason this exists.
        ("Antoni Ignacy Sikoń", "Antoni Sikoń", True),
        ("Jan Maria Józef Kowalski", "Jan Kowalski", True),
        ("Jan Maria Józef Kowalski", "Jan Maria Kowalski", True),
        # The words between the first name and the surname are not checked for
        # being given names: a double surname written with a space is a fuller
        # spelling of the same woman as well.
        ("Anna Nowak Kowalska", "Anna Kowalska", True),
        ("Piotr Jan van der Coghen", "Piotr van der Coghen", True),
        # Anything that changes a word is another spelling, not more of this one.
        ("Anna Maria Nowak", "Anna Kowalska", False),
        ("Łukasz Jan Nowak", "Lukasz Nowak", False),
        ("Kamil Sebastian Barczyk", "KAMIL BARCZYK", False),
        ("Jan Kowalski Nowak", "Jan Kowalski", False),
        # A slip of the register's, not a middle name.
        ("Mirosław Dywan Dywan", "Mirosław Dywan", False),
        ("Jan Jan Kowalski", "Jan Kowalski", False),
        # Nothing added, or nothing to add to.
        ("Jan Kowalski", "Jan Kowalski", False),
        ("Jan Kowalski", "Jan Maria Kowalski", False),
        ("Jan Maria Kowalski", "Kowalski", False),
        ("Jan Maria Kowalski", "", False),
    ],
)
def test_adds_middle_names(full, short, expected):
    assert adds_middle_names(full, short) is expected


# The same table as `namesAgree` in frontend/tests/shared/names.test.ts: the
# ingest matches by that rule, and `SiteSnapshot` predicts it by this one.
@pytest.mark.parametrize(
    ("one", "other", "expected"),
    [
        ("Łukasz Żelewski", "Lukasz Zelewski", True),
        ("Łukasz Jan Żelewski", "Lukasz Zelewski", True),
        ("Lukasz Zelewski", "ŁUKASZ JAN ŻELEWSKI", True),
        ("Anna Kowalska-Nowak", "Anna Kowalska Nowak", True),
        ("Anna Nowak Kowalska", "Anna Kowalska", True),
        ("Jan Adam Nowak", "Jan Piotr Nowak", False),
        ("Anna Nowak", "Anna Kowalska", False),
        ("Jan Kowalski", "Jan Kowalski Nowak", False),
        ("Jan Kowalski", "", False),
    ],
)
def test_names_agree(one, other, expected):
    assert names_agree(one, other) is expected
    assert names_agree(other, one) is expected
