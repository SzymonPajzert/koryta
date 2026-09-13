"""That a NIP is read out of the shapes published spend lists actually use.

The rows quoted here are real, from the 2025 and 2026 "pakiet promocyjny"
lists: 2,205 contracts and 71.8 m PLN between them, with the NIP buried in a
free-text party column whose separator, spacing and line breaks vary row to
row.
"""

import pytest

from scrapers.krs.nip_sources import (
    Recipient,
    from_spreadsheet,
    money,
    read_nips,
    summarise,
    total_paid,
)

REAL_ROWS = [
    # The common form.
    ("Ars Animae z siedzibą przy ul. Staszica 11, 08-400 Garwolin, NIP: 8262224957",
     ["8262224957"]),
    # No space after the colon.
    ("Fundacja Fundusz Współpracy  z siedzibą w Warszawie, NIP:5260005468",
     ["5260005468"]),
    # A line break inside the cell, which is how the xlsx exported.
    ("Gminny Ośrodek Kultury w Czerwinie przy ulicy Szkolnej 1, 07-407 Czerwin \n"
     "NIP: 7582355169", ["7582355169"]),
    # Curly quotes and a diacritic-heavy name around it.
    ('Koło Gospodyń Wiejskich w Myszkowicach "Cyganeczki", z siedzibą w '
     "m. Myszkowice 28, 08-210 Platerów, NIP: 4960255468", ["4960255468"]),
]


@pytest.mark.parametrize("text, expected", REAL_ROWS)
def test_reads_the_nip_out_of_a_party_cell(text, expected):
    assert read_nips(text) == expected


def test_a_dashed_nip_reads_the_same_as_a_bare_one():
    assert read_nips("Firma, NIP: 758-235-51-69") == ["7582355169"]


def test_a_truncated_nip_is_not_padded_into_a_wrong_one():
    """15 rows of the 2025-26 lists carry nine digits. That is a source error.

    Reading it as a NIP anyway would spend a request and, worse, could resolve
    to a real and entirely unrelated company.
    """
    assert read_nips("Stowarzyszenie ..., NIP: 821268376") == []


def test_an_unlabelled_ten_digit_run_is_only_used_as_a_fallback():
    """An address line can hold a ten-digit run that is not a NIP.

    Preferring the labelled form keeps a phone number or a REGON stem out when
    a real NIP is present, while still reading a column that holds only a NIP.
    """
    assert read_nips("tel. 0048123456, NIP: 5260005468") == ["5260005468"]
    assert read_nips("5260005468") == ["5260005468"]


def test_a_row_naming_two_parties_yields_both():
    text = "Konsorcjum: A sp. z o.o., NIP: 5260005468 oraz B S.A., NIP: 5730003841"
    assert read_nips(text) == ["5260005468", "5730003841"]


def test_the_same_nip_twice_in_a_cell_is_one_nip():
    assert read_nips("NIP: 5260005468 (NIP: 5260005468)") == ["5260005468"]


@pytest.mark.parametrize(
    "written, expected",
    [
        ("  20,000.00 zł ", 20000.00),
        ("  1,500.00 zł ", 1500.00),
        ("49 571 724,00 zł", 49571724.00),
        ("4065,04", 4065.04),
        ("3 600,00 zł", 3600.00),
        ("", None),
        (None, None),
    ],
)
def test_money_reads_both_separator_conventions(written, expected):
    """Both conventions occur in the same file.

    The last separator is the decimal point and every earlier one groups
    thousands -- guessing from the character alone reads "1,500.00" as 1.5 or
    "1 500,00" as 150000.
    """
    assert money(written) == expected


def test_a_spreadsheet_is_read_by_its_lp_column(tmp_path):
    """Data rows are found by the Lp. counter, not by skipping headers.

    These files carry a title block, merged cells and blank spacer rows whose
    count differs between the 2025 and 2026 editions of the same list.
    """
    path = tmp_path / "spend.csv"
    path.write_text(
        ",,,\n"
        "Zawarte umowy na zakup pakietu promocyjnego,,,\"  49,571,724.00 zł \"\n"
        ",,,\n"
        "Lp.,Nazwa i dane podmiotu,\"Nazwa i data wydarzenia\", kwota\n"
        "1,\"Ars Animae, Garwolin, NIP: 8262224957\",koncert,\"  20,000.00 zł \"\n"
        "2,\"Klub, NIP: 5260005468\",turniej,\"  6,000.00 zł \"\n"
        "3,\"Stowarzyszenie bez numeru, NIP: 8212\",gala,\"  1,000.00 zł \"\n",
        encoding="utf-8",
    )

    rows, unreadable = from_spreadsheet(path)

    assert [row.nips for row in rows] == [["8262224957"], ["5260005468"]]
    assert [row.amount for row in rows] == [20000.00, 6000.00]
    assert rows[0].subject == "koncert"
    assert rows[0].source_row.endswith(":1")

    # The truncated one is reported, not dropped: it is a finding about the
    # published document.
    assert len(unreadable) == 1
    assert "8212" in unreadable[0].party_text


def test_the_title_row_amount_is_not_read_as_a_contract(tmp_path):
    """The header holds the grand total, which would double the reported value."""
    path = tmp_path / "spend.csv"
    path.write_text(
        "Zawarte umowy,,,\"  49,571,724.00 zł \"\n"
        "Lp.,Nazwa,Przedmiot, kwota\n"
        "1,\"A, NIP: 8262224957\",x,\"  20,000.00 zł \"\n",
        encoding="utf-8",
    )
    rows, _ = from_spreadsheet(path)
    assert len(rows) == 1
    assert sum(row.amount or 0 for row in rows) == 20000.00


def test_summarise_counts_the_invalid_nips(tmp_path):
    path = tmp_path / "spend.csv"
    path.write_text(
        "Lp.,Nazwa,Przedmiot, kwota\n"
        "1,\"A, NIP: 8262224957\",x,\"  10,00 zł \"\n"
        "2,\"B, NIP: 5231844247\",x,\"  10,00 zł \"\n",
        encoding="utf-8",
    )
    rows, unreadable = from_spreadsheet(path)
    report = summarise(rows, unreadable)
    assert "distinct NIPs" in report
    # 5231844247 is one of the 6 in the real lists that fails its check digit.
    assert "checksum-invalid   " in report
    assert report.count("\n") == 4


def test_total_paid_sums_the_aggregate_not_the_rows():
    """`Recipient.paid` is already summed, so this must not re-derive it."""
    recipients = [
        Recipient("9710723801", "Fundacja A", 298900.00, 3),
        Recipient("7743294391", "Fundacja B", 257500.00, 9),
    ]
    assert total_paid(recipients) == 556400.00


def test_total_paid_of_nothing_is_zero():
    """A worklist with nothing left on it prints 0, not a crash."""
    assert total_paid([]) == 0.0
