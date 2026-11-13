"""`koryta_scrape_bip signers`: the "Ja, niżej podpisany(a)" line of each file a
walk credited, beside the candidacy it went to. The lines are the text and
the OCR of files the walks of 11-13 credited."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pymupdf

from jobs.bip_crawler.signers import cmd_signers, signer, signers, verdict
from stores.bip_bundles import LocalBundleStore

#: Łukasz Kogut's declaration, filed on Mariusz Kędziora's page in Głogów:
#: its text layer as OCR left it.
KOGUT = (
    "A Ja, nizej podpisany(a), tukasz Kotut., (imiona i nazwisko oraz nazwisko "
    "rodolre) urodzony(a) ,j1.08.1!,87 r. w clogowie Rada Mieislo w GloSowie"
)
KEDZIORA = (
    ".la, niiej podpisany(a), MARIUSZ KAMIL KEOZIORA, urodzony(a) 23 SIERPNIA "
    "1991 R. w GLOGOWIE RADNY RADY MIEJSKIEJ W GIOGOWIE"
)
PODLEJSKI = (
    "Ja, niżej podpisany Grzegorz, Jerzy Podlejski........ (imiona i nazwisko "
    "oraz nazwisko rodowe) urodzony 20.10.1961 r. w Bytomiu"
)


#: Rufin Majchrzyk's, a scan in Lubliniec, as OCR read its first page: the
#: words of the line glued together.
MAJCHRZYK = (
    "CZESCA Ja,nizejpodpisany，Rufin,Roman Majchrzyk Urodzony 19.11.1957r."
    "wKoszecinie emeryt, radnyRadyPowiatuLublinieckiego"
)


def test_the_line_says_whose_declaration_it_is() -> None:
    assert signer(KOGUT) == "tukasz kotut"
    assert signer(KEDZIORA) == "mariusz kamil keoziora"
    assert signer(PODLEJSKI) == "grzegorz jerzy podlejski"
    assert signer(MAJCHRZYK) == "rufin roman majchrzyk"
    assert signer("Klauzula informacyjna RODO dla składających oświadczenia") == ""


def test_a_line_without_the_candidacys_surname_is_to_be_checked() -> None:
    assert verdict("Mariusz KĘDZIORA", signer(KOGUT)) == "check"
    assert verdict("Grzegorz PODLEJSKI", signer(PODLEJSKI)) == "theirs"
    # OCR garbles a name now and then: a line to look at, not a wrong one.
    assert verdict("Mariusz KĘDZIORA", signer(KEDZIORA)) == "check"
    assert verdict("Bożena CZEKAŃSKA-SMYKALLA", "bozena czekanska smykalla") == (
        "theirs"
    )
    assert verdict("Jan Nowak", "") == "no line"


def walked(tmp_path: Path, files: dict[str, bytes]) -> tuple[dict, Path]:
    """A walk's report and --out folder: each file credited to Mariusz
    Kędziora, as `walk` keeps them."""
    root = tmp_path / "out"
    bundles = LocalBundleStore(root)
    docs = []
    for name, data in files.items():
        row, _ = bundles.add(
            host="glogow.bip.info.pl",
            crawl_id="walk",
            url=f"https://glogow.bip.info.pl/api/fo/files/{name}/download",
            data=data,
            content_type="application/pdf",
            filename="download",
            chain=[],
        )
        docs.append(
            {"status": "ok", "sha256": row.sha256, "bundle": row.bundle, "url": row.url}
        )
    bundles.flush()
    docs.append({"status": "http 404", "sha256": "", "bundle": "", "url": "x"})
    report = {
        "candidacies": [
            {"name": "Mariusz KĘDZIORA", "election_year": 2018, "docs": docs}
        ]
    }
    return report, root


def test_each_credited_file_is_read_once_from_the_walks_bundles(
    tmp_path: Path,
) -> None:
    report, root = walked(
        tmp_path, {"0ecda5": KOGUT.encode(), "2fd01e": KEDZIORA.encode()}
    )
    report["candidacies"].append(dict(report["candidacies"][0], election_year=2014))
    read: list[bytes] = []

    def text(data: bytes) -> str:
        read.append(data)
        return data.decode()

    rows = signers(report, root, text)
    assert [(r["year"], r["signed"]) for r in rows] == [
        ("2018", "tukasz kotut"),
        ("2018", "mariusz kamil keoziora"),
        ("2014", "tukasz kotut"),
        ("2014", "mariusz kamil keoziora"),
    ]
    assert len(read) == 2


def test_the_command_reads_a_pdf_as_the_nights_parse_does(
    tmp_path: Path, capsys
) -> None:
    document = pymupdf.open()
    page = document.new_page()
    form = (
        "OSWIADCZENIE MAJATKOWE radnego gminy. Uwaga: osoba skladajaca "
        "oswiadczenie obowiazana jest do zgodnego z prawda wypelnienia rubryk. "
        "Ja, nizej podpisany(a), Mariusz Kamil Kedziora, urodzony(a) w Glogowie"
    )
    page.insert_textbox(pymupdf.Rect(50, 50, 550, 400), form)
    report, root = walked(tmp_path, {"2fd01e": document.tobytes()})
    path = tmp_path / "walk.json"
    path.write_text(json.dumps(report), encoding="utf-8")
    assert cmd_signers(argparse.Namespace(report=path, root=root)) == 0
    said = capsys.readouterr().out
    assert "theirs   Mariusz KĘDZIORA (2018): 'mariusz kamil kedziora'" in said
    assert said.rstrip().endswith("theirs 1")
