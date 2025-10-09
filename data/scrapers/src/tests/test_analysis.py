import pytest
import regex as re

from scrapers.krs.process import KRS, iterate_blobs
from analysis.people import find_all_matches, con
from util.config import versioned
from util.lists import IGNORE_FAILURES


SCORE_CUTOFF = 10.5


df_all = find_all_matches(con)
df = df_all[df_all["overall_score"] > SCORE_CUTOFF]


scraped_krs = set(KRS.from_blob_name(blob) for blob, _ in iterate_blobs())


class Person:
    krs_name: str
    pkw_name: str
    any: str = ""

    def __init__(self, krs_name: str = "", pkw_name: str = "", any: str = ""):
        self.krs_name = krs_name
        self.pkw_name = pkw_name
        self.any = any

    def __str__(self):
        return f"Person(krs={self.krs_name}, pkw={self.pkw_name}, any={self.any})"

    def __repr__(self) -> str:
        return str(self)


def find_column_match(column, name):
    name = name.replace(" ", " .*")
    return len(df[df[column].str.match(name, na=False)]) > 0


def exists_in_output(person: Person):
    if person.any != "":
        krs_match = find_column_match("krs_name", person.any)
        pkw_match = find_column_match("pkw_name", person.any)
        wiki_match = find_column_match("wiki_name", person.any)
        return krs_match or pkw_match or wiki_match

    return find_column_match("krs_name", person.krs_name) and find_column_match(
        "pkw_name", person.pkw_name
    )


def list_values(cols):
    for col in cols:
        for val in df[col].unique():
            yield col, val


@pytest.mark.parametrize(
    ["column", "value"], list_values(["krs_name", "pkw_name", "wiki_name"])
)
@pytest.mark.parametrize_skip_if(lambda column, value: value in IGNORE_FAILURES)  # type: ignore
def test_not_duplicated(column, value):
    # Make sure that peeple are not duplicated in the output
    # I.e each value occurs only once in the krs_name, pkw_name or wiki_name in df
    assert len(df[df[column] == value]) == 1


def get_words(name):
    if name is None:
        return set()
    return set(re.findall(r"\b\w+\b", name.lower()))


def no_diff_sets(a, b):
    if len(a.difference(b)) == 0:
        return ""
    if len(b.difference(a)) == 0:
        return ""
    disjoint_words = b.difference(a) | a.difference(b)
    return " ".join(disjoint_words)


@pytest.mark.parametrize(
    "row", (row for _, row in df.iterrows()), ids=lambda row: f"{row["krs_name"]}"
)
def test_second_names_match(row):
    # Split each row and each _name column into single words.
    # Make sure that each lowercase word matches the words in other columns, e.g. second names match

    krs_words = get_words(row["krs_name"])
    pkw_words = get_words(row["pkw_name"])
    wiki_words = get_words(row["wiki_name"])

    assert no_diff_sets(krs_words, pkw_words) == ""
    assert no_diff_sets(krs_words, wiki_words) == ""
    assert no_diff_sets(pkw_words, wiki_words) == ""

    # Check if there's at least one common word between krs_name and pkw_name
    if krs_words and pkw_words:
        assert (
            len(krs_words.intersection(pkw_words)) > 0
        ), f"No common words between KRS: '{row['krs_name']}' and PKW: '{row['pkw_name']}'"

    # If wiki_name exists, check for common words with krs_name or pkw_name
    if wiki_words:
        if krs_words and pkw_words:
            assert (
                len(wiki_words.intersection(krs_words)) > 0
                or len(wiki_words.intersection(pkw_words)) > 0
            ), f"No common words between Wiki: '{row['wiki_name']}' and KRS/PKW: '{row['krs_name']}', '{row['pkw_name']}'"
        elif krs_words:
            assert (
                len(wiki_words.intersection(krs_words)) > 0
            ), f"No common words between Wiki: '{row['wiki_name']}' and KRS: '{row['krs_name']}'"
        elif pkw_words:
            assert (
                len(wiki_words.intersection(pkw_words)) > 0
            ), f"No common words between Wiki: '{row['wiki_name']}' and PKW: '{row['pkw_name']}'"


def file_lines(filename):
    with open(versioned.get_path(filename)) as people_list:
        for line in people_list:
            yield line.strip()


@pytest.mark.parametrize(
    "person",
    [
        Person(krs_name="Piotr Adam Pawłowski", pkw_name="Pawłowski Piotr Krzysztof"),
        Person(
            krs_name="Radosław Andrzej Zawierucha",
            pkw_name="ZAWIERUCHA Radosław Marian",
        ),
        Person(krs_name="Magdalena Stanilewicz", pkw_name="STANKIEWICZ Magdalena Anna"),
        Person(krs_name="Dariusz Jerzy Kowalczyk", pkw_name="KOWALCZYK Dariusz Anatol"),
        Person(krs_name="Sławomir Kamiński", pkw_name="Kamińska Sławomira Maria"),
        Person(any="Łukasz Krawiec"),
        Person(any="Jerzy Skrzypek"),
    ],
)
def test_missing(person):
    assert not exists_in_output(person)


@pytest.mark.parametrize(
    "person",
    [
        "Wojciech Bartelski",
        "Tomasz Mencina",
        # is a lawyer in wiki, but also connected to PiS
        "Grzegorz Pastuszko",
        "Krzysztof Czeszejko-Sochacki",
    ],
)
@pytest.mark.parametrize_skip_if(lambda person: person in IGNORE_FAILURES)
def test_exists(person):
    person = Person(any=person)
    assert exists_in_output(person)


@pytest.mark.parametrize("person", file_lines("psl_lista.txt"))
@pytest.mark.parametrize_skip_if(lambda person: person in IGNORE_FAILURES)
def test_list_psl(person):
    person = Person(any=person)
    assert exists_in_output(person)


@pytest.mark.parametrize("person", file_lines("stop_pato_lista.txt"))
@pytest.mark.parametrize_skip_if(lambda person: person in IGNORE_FAILURES)
def test_list_stop_pato(person):
    person = Person(any=person)
    assert exists_in_output(person)


@pytest.mark.parametrize(
    "krs",
    [
        "23302",
        "140528",
        "489456",
        "0000512140",
        "271591",
        "0000028860",
        "0000025667",
        "0000204527",
    ],
)
def test_krs_present(krs):
    krs = KRS(krs)
    assert krs in scraped_krs
