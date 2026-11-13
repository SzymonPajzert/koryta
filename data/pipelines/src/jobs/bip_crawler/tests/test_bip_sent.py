"""`koryta_scrape_bip sent` lists what the site got from the files stored for
candidacies a fix is about to reset, for Szymon to withdraw (11-13: the
leak fix's menu file at Czechowice-Dziedzice went to readers as nine
councillors' declaration)."""

from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from pathlib import Path

from jobs.bip_crawler import build_parser
from jobs.bip_crawler.sent import report, sent_extracts, write_csv
from stores.tests.test_bip_people_store import FakePg

SHA = "e8da97ccbfe79401edf34a9407b1cbd5c36a5d289086f9e14890b31d0fba5ea2"
MENU = "https://www.bip.czechowice-dziedzice.pl/res/serwisy/bip-czdz/komunikaty/_065_001_294059.doc"
SENT_AT = datetime(2026, 11, 2, 17, 49, 11, tzinfo=timezone.utc)


def sent_tables() -> FakePg:
    return FakePg(
        {
            "bip_decl_sent": [
                (
                    "4a78cd40e8964d04",
                    MENU,
                    SHA,
                    f"{SHA}-p0",
                    None,
                    "stored",
                    "",
                    SENT_AT,
                ),
                (
                    "4a78cd40e8964d04",
                    "https://bip.x.pl/lesny_2024.pdf",
                    "b" * 64,
                    f"{'b' * 64}-p2",
                    "Wojciech Leśny",
                    "skipped",
                    "no page",
                    SENT_AT,
                ),
            ]
        }
    )


def test_the_keys_come_from_a_list_or_a_file(tmp_path):
    keys = tmp_path / "reset-keys.txt"
    keys.write_text("# lodz-edge\na\nb\n", encoding="utf-8")
    parser = build_parser()

    from_file = parser.parse_args(["sent", f"@{keys}", "--csv", "w.csv"])
    listed = parser.parse_args(["sent", "a,b"])

    assert from_file.keys == listed.keys == frozenset({"a", "b"})
    assert from_file.csv == Path("w.csv") and listed.csv is None


def test_each_extract_sent_of_their_files_with_the_crops_name():
    rows = sent_extracts(sent_tables(), ["4a78cd40e8964d04", "4a78cd40e8964d04"])  # type: ignore[arg-type]

    assert [(r["extract"], r["name"], r["result"]) for r in rows] == [
        (f"{SHA}-p0", None, "stored"),
        (f"{'b' * 64}-p2", "Wojciech Leśny", "skipped"),
    ]
    out = io.StringIO()
    report(rows, ["4a78cd40e8964d04", "c"], out)
    first = out.getvalue().splitlines()[0]
    assert first == (
        "2 extracts sent of the files of 1 of 2 candidacies, 1 of them stored on "
        "the site"
    )


def test_the_csv_holds_every_extract(tmp_path):
    path = tmp_path / "withdraw.csv"
    write_csv(path, sent_extracts(sent_tables(), ["4a78cd40e8964d04"]))  # type: ignore[arg-type]

    rows = list(csv.DictReader(path.open(encoding="utf-8")))
    assert [(r["url"], r["extract"], r["sent_at"]) for r in rows][0] == (
        MENU,
        f"{SHA}-p0",
        "2026-11-02T17:49:11+00:00",
    )
    assert len(rows) == 2


def test_nothing_sent_says_so():
    out = io.StringIO()
    report(sent_extracts(FakePg({}), ["a"]), ["a"], out)  # type: ignore[arg-type]
    assert out.getvalue() == (
        "0 extracts sent of the files of 0 of 1 candidacies, 0 of them stored on "
        "the site\n"
    )
