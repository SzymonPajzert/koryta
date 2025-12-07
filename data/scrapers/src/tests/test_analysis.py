import pandas as pd
import pytest
import regex as re

from analysis.people import PeopleMerged
from main import Pipeline, _setup_context

# TODO from util.lists import IGNORE_FAILURES
IGNORE_FAILURES: list[str] = []


SCORE_CUTOFF = 10.5


@pytest.fixture
def ctx():
    return _setup_context(False)[0]


@pytest.fixture(scope="module")
def df_all(ctx):
    p: PeopleMerged = Pipeline.create(PeopleMerged)
    return p.read_or_process(ctx)


# TODO split it already as another column
@pytest.fixture(scope="module")
def df_matched(df_all):
    return df_all[df_all["overall_score"] > SCORE_CUTOFF]


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


@pytest.fixture(scope="module")
def find_column_match(df_all, df_matched):
    def _find_column_match(use_all: bool, column, name):
        name = name.replace(" ", " .*")
        if use_all:
            return df_all[df_all[column].str.match(name, na=False)]
        else:
            return df_matched[df_matched[column].str.match(name, na=False)]

    return _find_column_match


def has_column_match(use_all: bool, column, name):
    return len(find_column_match(use_all, column, name)) > 0


def exists_in_output(use_all: bool, person: Person):
    if person.any != "":
        krs_match = has_column_match(use_all, "krs_name", person.any)
        pkw_match = has_column_match(use_all, "pkw_name", person.any)
        wiki_match = has_column_match(use_all, "wiki_name", person.any)
        return krs_match or pkw_match or wiki_match

    matches_krs = has_column_match(use_all, "krs_name", person.krs_name)
    matches_pkw = has_column_match(use_all, "pkw_name", person.pkw_name)
    return matches_krs or matches_pkw


def test_not_duplicated(df_all):
    def list_values(cols):
        for col in cols:
            for val in df_all[col].unique():
                if val is None or (isinstance(val, float) and pd.isna(val)):
                    continue
                yield col, val

    for column, value in list_values(["krs_name", "pkw_name", "wiki_name"]):
        # Make sure that peeple are not duplicated in the output
        # I.e each value occurs only once in the krs_name, pkw_name or wiki_name in df
        matches = df_all[df_all[column] == value]
        if len(matches) > 1:
            # Check if they are distinct entities based on rejestrio_id
            # If all sets of rejestrio_id are disjoint, they are distinct people
            ids_list = matches["rejestrio_id"].tolist()
            # Flatten and check for duplicates
            all_ids = []
            for ids in ids_list:
                if isinstance(ids, list) or hasattr(ids, "__iter__"):
                    all_ids.extend(ids)
                else:
                    all_ids.append(ids)

            if len(all_ids) == len(set(all_ids)):
                continue  # All distinct source records

        assert len(matches) == 1, f"{column} == {value}"


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


# TODO reenable
# @pytest.mark.parametrize(
#     "row", (row for _, row in df_all.iterrows()), ids=lambda row: f"{row["krs_name"]}"
# )
# def test_second_names_match(row):
#     # Split each row and each _name column into single words.
#     # Make sure that each lowercase word matches the words in other columns, e.g. second names match

#     krs_words = get_words(row["krs_name"])
#     pkw_words = get_words(row["pkw_name"])
#     wiki_words = get_words(row["wiki_name"])

#     assert no_diff_sets(krs_words, pkw_words) == ""
#     assert no_diff_sets(krs_words, wiki_words) == ""
#     assert no_diff_sets(pkw_words, wiki_words) == ""

#     # Check if there's at least one common word between krs_name and pkw_name
#     if krs_words and pkw_words:
#         assert (
#             len(krs_words.intersection(pkw_words)) > 0
#         ), f"No common words between KRS: '{row['krs_name']}' and PKW: '{row['pkw_name']}'"

#     # If wiki_name exists, check for common words with krs_name or pkw_name
#     if wiki_words:
#         if krs_words and pkw_words:
#             assert (
#                 len(wiki_words.intersection(krs_words)) > 0
#                 or len(wiki_words.intersection(pkw_words)) > 0
#             ), f"No common words between Wiki: '{row['wiki_name']}' and KRS/PKW: '{row['krs_name']}', '{row['pkw_name']}'"
#         elif krs_words:
#             assert (
#                 len(wiki_words.intersection(krs_words)) > 0
#             ), f"No common words between Wiki: '{row['wiki_name']}' and KRS: '{row['krs_name']}'"
#         elif pkw_words:
#             assert (
#                 len(wiki_words.intersection(pkw_words)) > 0
#             ), f"No common words between Wiki: '{row['wiki_name']}' and PKW: '{row['pkw_name']}'"


# def file_lines(filename):
#     with open(versioned.get_path(filename)) as people_list:
#         for line in people_list:
#             yield line.strip()


# @pytest.mark.parametrize(
#     "person",
#     [
#         Person(krs_name="Piotr Adam Pawłowski", pkw_name="Pawłowski Piotr Krzysztof"),
#         Person(
#             krs_name="Radosław Andrzej Zawierucha",
#             pkw_name="ZAWIERUCHA Radosław Marian",
#         ),
#         Person(krs_name="Magdalena Stanilewicz", pkw_name="STANKIEWICZ Magdalena Anna"),
#         Person(krs_name="Dariusz Jerzy Kowalczyk", pkw_name="KOWALCZYK Dariusz Anatol"),
#         Person(krs_name="Sławomir Kamiński", pkw_name="Kamińska Sławomira Maria"),
#         Person(any="Łukasz Krawiec"),
#         Person(any="Jerzy Skrzypek"),
#         Person(any="Sławomir Zawadzki"),
#         Person(any="Andrzej Osiadacz"),
#     ],
# )
# def test_missing(person):
#     assert not exists_in_output(False, person)


# @pytest.mark.parametrize(
#     "person",
#     [
#         "Wojciech Bartelski",
#         "Tomasz Mencina",
#         # is a lawyer in wiki, but also connected to PiS
#         "Grzegorz Michał Pastuszko",
#         "Krzysztof Czeszejko-Sochacki",
#     ],
# )
# @pytest.mark.parametrize_skip_if(lambda person: person in IGNORE_FAILURES)
# def test_exists(person):
#     person = Person(any=person)
#     assert exists_in_output(False, person)


# @pytest.mark.parametrize("person", file_lines("psl_lista.txt"))
# @pytest.mark.parametrize_skip_if(lambda person: person in IGNORE_FAILURES)
# def test_list_psl(person):
#     person = Person(any=person)
#     assert exists_in_output(False, person)


# @pytest.mark.parametrize("person", file_lines("stop_pato_lista.txt"))
# @pytest.mark.parametrize_skip_if(lambda person: person in IGNORE_FAILURES)
# def test_list_stop_pato(person):
#     person = Person(any=person)
#     assert exists_in_output(False, person)


# def test_enrichment():
#     # TODO
#     name = "Adam Borysiewicz"
#     birth = "1977-12-08"
#     first_work = "2015-03-04"
#     rows = find_column_match(True, "krs_name", name)
#     assert len(rows) == 1, rows["birth_date"]
#     row = rows.iloc[0]
#     assert row["birth_date"] == birth
#     assert row["employed_start"] == first_work


# scraped_krs = []


# def find_krs():
#     global scraped_krs
#     scraped_krs = set(
#         KRS.from_blob_name(blob) for blob, _ in iterate_blobs("rejestr.io")
#     )


# @pytest.mark.parametrize(
#     "krs",
#     [
#         "23302",
#         "140528",
#         "489456",
#         "0000512140",
#         "271591",
#         "0000028860",
#         "0000025667",
#         "0000204527",
#     ],
# )
# def test_krs_present(krs):
#     if len(scraped_krs) == 0:
#         find_krs()
#     krs = KRS(krs)
#     assert krs in scraped_krs


def test_andrzej_jan_sikora_duplicated(df_all):
    # Filter for Andrzej Jan Sikora - we expect two people
    sikora_records = df_all[df_all["krs_name"] == "Andrzej Jan Sikora"]
    assert len(sikora_records) == 2, f"Expected 2 records for Andrzej Jan Sikora, found {len(sikora_records)}"

    birth_years = sorted(sikora_records["birth_year"].dropna().astype(int).tolist())

    assert birth_years == [
        1946,
        1950,
    ], f"Expected birth years [1946, 1950], found {birth_years}"


def test_adam_smoter_deduplication(df_all):
    # Adam Smoter should be found only once born in 1947
    smoter_records = df_all[df_all["krs_name"] == "Adam Smoter"]
    assert len(smoter_records) == 1, f"Expected 1 record for Adam Smoter, found {len(smoter_records)}"
    assert smoter_records.iloc[0]["birth_year"] == 1947


def test_teresa_zieba_deduplication(df_all):
    zieba_records = df_all[df_all["krs_name"] == "Teresa Zięba"]
    assert len(zieba_records) == 1, f"Expected 1 record for Teresa Zięba, found {len(zieba_records)}"
    # Check birth year is 1959 (or 1958, but we expect one)
    assert zieba_records.iloc[0]["birth_year"] in [1958, 1959]
