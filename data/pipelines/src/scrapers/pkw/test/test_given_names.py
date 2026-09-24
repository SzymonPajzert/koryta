import pytest

from scrapers.pkw.process import extract_data, given_names
from util.polish import PkwFormat


@pytest.mark.parametrize(
    ("written", "names"),
    [
        ("Henryk s. Stefana", "Henryk"),
        ("Józef s.Wincentego", "Józef"),
        ("Józef Lucjan s. Józefa", "Józef Lucjan"),
        ("Maria, c. Jana", "Maria"),
        ("Franciszek,Marian", "Franciszek Marian"),
        ("Ludwik, Zdzisław", "Ludwik Zdzisław"),
        ("Jan Maria", "Jan Maria"),
    ],
)
def test_given_names(written, names):
    assert given_names(written) == names


def test_a_patronymic_is_not_a_second_name():
    # `pkw_name` is where the merge looks for a second name when the row has
    # none, so the patronymic must be gone from it too.
    person = extract_data(
        "2006",
        "samorządu",
        PkwFormat.UNKNOWN,
        first_name="Henryk s. Stefana",
        last_name="Szymański",
    )

    assert (person.first_name, person.middle_name, person.pkw_name) == (
        "Henryk",
        None,
        "Szymański Henryk",
    )


def test_a_patronymic_in_the_second_name_column_is_dropped():
    # The 1997 Sejm and 2002 council files give the second name a column of
    # its own, and put the patronymic there.
    person = extract_data(
        "1997",
        "sejmu",
        PkwFormat.UNKNOWN,
        first_name="Jan",
        middle_name="s. Stanisława",
        last_name="Wójcik",
    )

    assert (person.first_name, person.middle_name) == ("Jan", None)
