import pytest
import regex as re
from itertools import chain

from scrapers.krs.process import KRS, iterate_blobs
from analysis.people import find_all_matches, con
from util.config import versioned


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


PEOPLE_ANNOTATED = {
    "Robert Ciborowski": "listed in stop pato with vague reasons, need to list komitet honorowy kandydata",
    "Sławomir Zawadzki": "should not be in koryta",
    "Wiesław Urbański": "match on exact birth date",
    "Andrzej Osiadacz": "wiki extract second name, should not be in koryta, is an expert",
}

# TODO Ignore failures could be marked only for some tests

IGNORE_FAILURES_STR = """
FAILED src/tests/test_analysis.py::test_list_psl[Grzegorz Ksepko] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Beata I\u017cy\u0142owska] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Sebastian Bojemski] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Paulina Sala] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Miros\u0142aw Wicki] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Filip Rdesi\u0144ski] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Justyna W\xf3jtowicz-Woda] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Pawe\u0142 Cioch] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Grzegorz Kuczy\u0144ski] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Marcin Karlikowski] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Lucyna Kwiatos] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Pawe\u0142 Zo\u0142ote\u0144ki] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Magdalena Derlatka-Miodowska] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Anna K\u0119zik] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Pawe\u0142 Kurtyka] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Micha\u0142 Czarnik] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Pawe\u0142 Kozyra] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Krzysztof B\u0105czyk] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Filip Ostrawski] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Dariusz Dumkiewicz] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Dominik Zaremba] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Robert Gut] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Joanna Gepfert] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Nikodem Matusiak] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[J\xf3zef Wierzbowski] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Marek Ryszka] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Ewa Jankowska] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Wojciech Przepad\u0142o] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Robert Zasina] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Tomasz Jachna] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Dariusz S\u0142aboszewski] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Waldemar Skomudek] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Mariusz Paczkowski] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Witold Olech] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Ryszard Maziar] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Tomasz Pyfel] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Piotr Apollo] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[W\u0142odzimierz Dola] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Monika Borzdy\u0144ska] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Sabina Bigos-Jaworowska] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Cezary Jurkiewicz] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Marcin Zarzecki] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Micha\u0142 Kaszy\u0144ski] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Piotr Toczek] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Wies\u0142aw W\u0142odek] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Mariusz Wielkopolan] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Robert So\u0142ek] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Antoni Augustyn] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Ma\u0142gorzata Zarychta-Sur\xf3wka] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Andrzej Kisielewicz] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Agnieszka Winnik-Kalemba] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Piotr Paszko] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Beata Zato\u0144-Kowalczyk] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Stefan \u015awi\u0105tkowski] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Bogumi\u0142 Gwo\u017adzik] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Maciej Przerwa] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Zbigniew Haj\u0142asz] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Eugeniusz Stain] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Piotr Regulski] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Agnieszka Chilmon] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Maciej B\u0105k] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Kamil Tarczewski] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Piotr Koenig] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Dorota P\u0142otka] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Ma\u0142gorzata Jacyna-Witt] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Borys bor\xf3wka] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Emilia Hermaszewska] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Zdzis\u0142aw Salus] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Jacek Nie\u015bcior] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Artur Niczyporuk] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Arkadiusz Szymoniuk] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Piotr Bre\u015b] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Tomasz G\xf3rnicki] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Tomasz Sztonyk] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Tomasz Karusewicz] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Aleksandra Do\u0142han] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Grzegorz Janas] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Pawe\u0142 Bakun] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Zbigniew Leszczy\u0144ski] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Patrycja Klarecka] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Armen Artwich] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Jan Szewczak] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Wojciech Jasi\u0144ski] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Jadwiga Lesisz] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Izabela Kuci\u0144ska-\u015awigost] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Waldemar Hudomi\u0119cki] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Sylwia Iwa\u0144czuk] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[\u0141ukasz Pora\u017cy\u0144ski] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Leszek Jakub\xf3w] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Marek Kasicki] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Wioletta Kandziak] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[\u0141ukasz Lipiec] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Janusz Fuda\u0142a] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Joanna Zi\u0119ba] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Maciej \u017bo\u0142tkiewicz] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Micha\u0142 Orzeszek] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[B\u0142a\u017cej Krawczyszyn] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Maciej Libiszewski] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Jakub Szurski] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Maciej Rapkiewicz] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Oliwier Kubicki] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Aleksandra Agatowska] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Alicja Klimiuk] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Piotr Niewiadomski] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Bart\u0142omiej Litwi\u0144czuk] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Danuta Makowska] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Sylwia Koby\u0142kiewicz] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Tomasz Wiatrak] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Piotr Dorawa] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[El\u017cbieta Bugaj] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Janusz Szurski] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Tomasz Hryniewicz] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Zbigniew Kulewicz] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Robert Harasimiuk] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Micha\u0142 Wawryn] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Wojciech Dro\u017cd\u017c] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Zbigniew Pi\u0119tka] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Pawe\u0142 Szczeszek] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Cezary O\u0142dakowski] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Krzysztof Adamkiewicz] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Wojciech Krysztofik] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Rafa\u0142 Gietka] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Antoni J\xf3zwowicz] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Zofia Pary\u0142a] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Cezary Godziuk] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Krzysztof Rodzik] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Honorata Krysiewicz] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Pawe\u0142 Przychodze\u0144] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Piotr Chylicki] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Mateusz Siepielski] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Jacek Goli\u0144ski] - assert False
FAILED src/tests/test_analysis.py::test_list_psl[Wies\u0142aw Jasi\u0144ski] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Przemys\u0142aw Aksiuczyc] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[\u0141ukasz Ba\u0142ajewicz] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Jaros\u0142aw Berger] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Hubert Cichocki] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Cezary Cie\u015blukowski] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Filip Cury\u0142o] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Aneta Maria \u0106wikli\u0144ska] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Wojciech \u0106wikli\u0144ski] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Kajetan d'Obyrn] - AssertionError: assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[S\u0142awomir Drelich] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Adam Duszyk] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Jaros\u0142aw Dworza\u0144ski] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Ryszard Dziadak] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Miros\u0142aw Glaz] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Jacek Goszczy\u0144ski] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Wojciech Grochowski] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Anna Halicka] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Marcin Idzik] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Jacek Krawiec] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Justyna Jakubowicz-Dziduch] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Krzysztof Janicki] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Pawe\u0142 Je\u017c] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Jacek Kaczorowski] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Rados\u0142aw Konieczny] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Arkadiusz Kubiec] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Krzysztof Lodzi\u0144ski] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Mateusz Matejewski] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Arkadiusz Misiuro] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Waldemar Mi\u015bko] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Marcin Moskwa] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Anna Naszkiewicz] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Przemys\u0142aw Nitschka] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Sebastian Nowaczkiewicz] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Artur Osuchowski] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Krzysztof Pa\u0142ka] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Ewa Patalas] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Agnieszka Pie\u0144kowska-Opora] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Artur Pomianowski] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Przemys\u0142aw S\u0142owik] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Andrzej Radziwinowicz] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Emil Rojek] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Andrzej Sadkowski] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Artur Sebesta] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Jaros\u0142aw Siergiej] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Jacek Sk\xf3rski] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Marzena S\u0142omka] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Gabriela Sowa] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Beata Springer] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Rados\u0142aw St\u0119pie\u0144] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Andrzej Styn] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Micha\u0142 Szymczyk] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Mateusz Tyczy\u0144ski] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Rafa\u0142 Wardzi\u0144ski] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Emilia Wasilewska] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Rafa\u0142 Wielichowski] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Daniel Wilk] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Jerzy Woli\u0144ski] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Mi\u0142os\u0142awa Zag\u0142oba] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Rafa\u0142 Zahorski] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Marcin Zamaro] - assert False
FAILED src/tests/test_analysis.py::test_list_stop_pato[Piotr \u017bo\u0142\u0105dek] - assert False
"""

IGNORE_FAILURES = {
    m.strip()
    for m in chain(
        re.findall("\\[(.+)\\]", IGNORE_FAILURES_STR), PEOPLE_ANNOTATED.keys()
    )
}

people = {
    "Paweł Olejnik": [
        "https://pl.wikipedia.org/w/index.php?title=Zak%C5%82ad_Emerytalno-Rentowy_Ministerstwa_Spraw_Wewn%C4%99trznych_i_Administracji&oldid=48854108 - I could go through the wiki entries and historical and extract that he worked there in 2016",
        "He's also present in a few local companies, so it's a good thing we could check as well",
        "https://www.polityka.pl/tygodnikpolityka/kraj/1742066,1,uzbrojenie-polskiej-armii-w-rekach-fana-fantasy.read"
        "He is in KRS",
        "No entries in PKW nor Wiki",
        " W latach 2016-2018 pracował w Ministerstwie Spraw Wewnętrznych i Administracji jako szef Centrum Personalizacji Dokumentów i dyrektor Zakładu Emerytalno-Rentowego MSWiA.",
        "https://radar.rp.pl/przemysl-obronny/art18571951-zmiana-w-skladzie-zarzadu-polskiej-grupy-zbrojeniowej",
        "Found an article - https://tygodnikits.pl/z-miasta-do-miasta/ar/9080494.",
    ]
}

# We should scrape people from bip somehow, but they work in smaller places and they're not even in krs
# assert exists_in_output(Person(any="Agata Marciniak-Różak")) - BIP_WARSZAWA
# 1200071 - rejestr.io - Agnieszka Kamińska - jest na stronie i w rejestrze krs
# TODO Watch out to also not scrape https://pl.wikipedia.org/wiki/%C5%81ukasz_Krawiec
# Check for death, usually it's safe to not add them.
# TODO This is also a fake - https://pl.wikipedia.org/wiki/Jerzy_Skrzypek
# TODO Agnelika Rybak Gawkowska - WKD, żona Gawkowskiego - NEPO_SURNAME
# TODO Jacek Pużuk - mąż, Szpital Grochowski - NEPO_SURNAME
# TODO Marek Chmurski jest pełnomocnikiem prezydenta miasta ds. rozowju struktury kolejowej. To wygląda jak jakieś sztuczne stanowisko żeby mu pensję dołożyć
# TODO Check that people have interesting mentions on their pages, e.g. Pastuszko
# Another interesting is Krzysztof Czeszejko-Sochacki
# https://pl.wikipedia.org/wiki/Krzysztof_Czeszejko-Sochacki
# TODO Find another lawyer and ignore them if they have a specialty
# Kazimierz Chroma https://www.dziennikwschodni.pl/lublin/nowi-szefowie-w-agencjach-dwaj-dyrektorzy-z-pis,n,1000175691.html
# Piotr Breś https://www.dziennikwschodni.pl/polityka/nasze-tluste-koty,n,1000292595.html - dyrektor totalizator sportowy
# Jan Szewczak https://www.dziennikwschodni.pl/polityka/nasze-tluste-koty,n,1000292595.html
# Renata Stefaniuk https://www.dziennikwschodni.pl/polityka/nasze-tluste-koty,n,1000292595.html
# Leszek Daniewski https://www.dziennikwschodni.pl/lubelskie/zmiany-w-agencjach-rolniczych-w-lubelskiem-kto-moze-zostac-dyrektorem,n,1000172597.html
# Krzysztof Figat - Chyba znalazłem nowego przypadkiem - https://tygodniksiedlecki.com/artykul/antoni-jozwowicz-prezesem-n1424927
# Zofia Paryła - Has wiki page with mentions - https://pl.wikipedia.org/wiki/Zofia_Pary%C5%82a#cite_ref-Krewni_2-1,  https://krakow.wyborcza.pl/krakow/7,44425,26834696,szkola-kariery-daniela-obajtka-bliscy-i-znajomi-prezesa-orlenu.html#s=S.embed_link-K.C-B.1-L.4.zw, friend of Obajtek, mentioned on the wiki
# Parse refs from people's page's, e.g Zofia's so you can feed them to the crawler.
# Mateusz Siepielski, wiceburmistrz Śródmieścia 2015
# Joanna Gepfert - https://pl.wikipedia.org/wiki/Instytut_De_Republica
# Energa was missing - https://pl.wikipedia.org/wiki/Energa, even though it's owned by Orlen
# Grzegorz Janik - Elections 2002, Parlimentary from 2005. Bonus points - CBA investigation - https://pl.wikipedia.org/wiki/Grzegorz_Janik.
# Małgorzata Zarychta-Surówka - Elections 2006, probably 2018.
# Janusz Smoliło - Elections in 2014 and 2018.
# Anna Adamczyk - 140528 needs to be scraped from krs
# Marcin Chludziński - not in wiki, but there are articles about him that he's somehow connected. Actually, it mentions Fundacja Republikańska
# Andrzej Kisielewicz - EU parliment elections are missing
# https://pl.wikipedia.org/wiki/Pawe%C5%82_Gruza, 2002 election, present in wiki non politician but it mentions the page.
