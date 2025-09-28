from dataclasses import dataclass

from analysis.people import find_all_matches, con

df = find_all_matches(con, limit=4000)


class Person:
    krs_name: str
    pkw_name: str
    any: str = ""

    def __init__(self, krs_name: str = "", pkw_name: str = "", any: str = ""):
        self.krs_name = krs_name
        self.pkw_name = pkw_name
        self.any = any


def exists_in_output(person: Person):
    krs_match = df.loc[df["krs_name"] == person.krs_name]
    pkw_match = df.loc[df["pkw_name"] == person.pkw_name]
    return krs_match is not None or pkw_match is not None


def test_included_matches():
    assert len(df) > 0

    assert not exists_in_output(
        Person(krs_name="Magdalena Stanilewicz", pkw_name="STANKIEWICZ Magdalena Anna")
    )
    assert not exists_in_output(
        Person(krs_name="Dariusz Jerzy Kowalczyk", pkw_name="KOWALCZYK Dariusz Anatol")
    )
    assert exists_in_output(Person(any="Wojciech Bartelski"))


def test_second_names_match():
    assert False  # TODO Implement
