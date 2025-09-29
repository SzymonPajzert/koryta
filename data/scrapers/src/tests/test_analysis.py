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
    assert exists_in_output(Person(any="Wojciech Bartelski"))


def test_excluded_people():
    assert not exists_in_output(
        Person(krs_name="Magdalena Stanilewicz", pkw_name="STANKIEWICZ Magdalena Anna")
    )
    assert not exists_in_output(
        Person(krs_name="Dariusz Jerzy Kowalczyk", pkw_name="KOWALCZYK Dariusz Anatol")
    )


def test_bip_warszawa():
    assert exists_in_output(Person(any="Agata Marciniak-Różak"))
    # We should scrape people from bip somehow, but they work in smaller places and they're not even in krs
    assert False  # Does it work?


# TODO Memoize the df lookup and tell user to remove it if they changed the logic
# TODO Grzegorz Pastuszko is a lawyer in wiki, but also connected to PiS
# TODO Check that people have interesting mentions on their pages
# Another interesting is Krzysztof Czeszejko-Sochacki
# https://pl.wikipedia.org/wiki/Krzysztof_Czeszejko-Sochacki
# TODO Find another lawyer and ignore them if they have a specialty
# TODO Watch out to also not scrape https://pl.wikipedia.org/wiki/%C5%81ukasz_Krawiec
# Check for death, usually it's safe to not add them.
# TODO This is also a fake - https://pl.wikipedia.org/wiki/Jerzy_Skrzypek
# TODO Check other people on wiki without correct infobox


def test_missing_kaminska():
    assert False  # 1200071 - rejestr.io - Agnieszka Kamińska - jest na stronie i w rejestrze krs


def test_second_names_match():
    assert False  # TODO Implement
