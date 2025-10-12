import pytest
from util.polish import parse_name, PkwFormat


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
