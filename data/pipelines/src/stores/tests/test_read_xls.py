import pandas as pd

from stores.file import read_xls


def workbook(tmp_path, rows) -> str:
    path = tmp_path / "kandydaci.xlsx"
    pd.DataFrame(rows).to_excel(path, header=False, index=False)
    return str(path)


def test_the_first_candidate_is_read(tmp_path):
    path = workbook(
        tmp_path,
        [["Nazwisko", "Mandat"], ["KOWALSKI", "T"], ["NOWAK", "N"]],
    )

    assert list(read_xls(path, header_rows=1)) == [
        ["Nazwisko", "Mandat"],
        ("KOWALSKI", "T"),
        ("NOWAK", "N"),
    ]


def test_two_header_rows_are_read_as_one(tmp_path):
    path = workbook(
        tmp_path,
        [["Dane", None], ["Nazwisko", "Imiona"], ["KOWALSKI", "Jan"]],
    )

    assert list(read_xls(path, header_rows=2)) == [
        ["Dane Nazwisko", "Dane Imiona"],
        ("KOWALSKI", "Jan"),
    ]
