"""How the union search splits a term the register caps at 1,000 rows."""

from types import SimpleNamespace

from jobs.krs_unions import CAP, PAGE, WOJEWODZTWA, Where, powiat_spellings, search

TERM = "ZWIĄZEK ZAWODOWY"


def register(entries: dict[Where, list[str]], totals: dict[Where, int] | None = None):
    """A register answering each filter with these KRS numbers, a page at a time."""
    asked: list[tuple[Where, int]] = []

    def ask(term: str, where: Where, page: int):
        asked.append((where, page))
        numbers = entries.get(where, [])
        total = (totals or {}).get(where, len(numbers))
        rows = numbers[: min(total, CAP)][(page - 1) * PAGE : page * PAGE]
        return total, [SimpleNamespace(krs=n) for n in rows]

    return ask, asked


def numbers(start: int, count: int) -> list[str]:
    return [str(n).zfill(10) for n in range(start, start + count)]


def test_a_term_under_the_cap_is_read_whole():
    ask, asked = register({Where(): numbers(1, 250)})

    found, shortfalls = search(ask, lambda w: [], terms=[TERM], log=lambda _: None)

    assert len(found) == 250
    assert asked == [(Where(), 1), (Where(), 2), (Where(), 3)]
    assert shortfalls == []


def test_a_term_over_the_cap_is_asked_per_wojewodztwo():
    small = Where("OPOLSKIE")
    ask, asked = register(
        {Where(): numbers(1, 1200), small: numbers(5000, 20)},
        totals={Where(): 1200},
    )

    found, _ = search(ask, lambda w: [], terms=[TERM], log=lambda _: None)

    assert {where for where, _ in asked} == {Where(), *map(Where, WOJEWODZTWA)}
    assert set(numbers(5000, 20)) <= set(found)
    assert found[numbers(5000, 1)[0]][1] == f"{TERM} OPOLSKIE"


def test_a_wojewodztwo_over_the_cap_is_asked_per_powiat_in_both_spellings():
    slaskie = Where("ŚLĄSKIE")
    city, land = Where("ŚLĄSKIE", "M. KATOWICE"), Where("ŚLĄSKIE", "BĘDZIŃSKI")
    ask, asked = register(
        {
            Where(): numbers(1, 1000),
            slaskie: numbers(1, 1000),
            city: numbers(1001, 30),
            land: numbers(2001, 10),
        },
        totals={Where(): 5000, slaskie: 1045},
    )

    found, shortfalls = search(
        ask,
        lambda w: ["Katowice", "będziński"] if w == "ŚLĄSKIE" else [],
        terms=[TERM],
        log=lambda _: None,
    )

    assert Where("ŚLĄSKIE", "KATOWICE") in {where for where, _ in asked}
    assert set(numbers(1001, 30)) | set(numbers(2001, 10)) <= set(found)
    assert shortfalls == [f"{TERM} ŚLĄSKIE: 5 of 1045 not reached"]


def test_a_city_powiat_is_asked_as_the_register_writes_it():
    assert powiat_spellings("będziński") == ["BĘDZIŃSKI"]
    assert powiat_spellings("Katowice") == ["KATOWICE", "M. KATOWICE"]
    assert "M. ST. WARSZAWA" in powiat_spellings("Warszawa")
