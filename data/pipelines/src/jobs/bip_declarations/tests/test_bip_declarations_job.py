"""The cut command: files from the crawler's bundles into the job's tables."""

from __future__ import annotations

import hashlib
import io
import tarfile
from pathlib import Path

import pytest

import jobs.bip_declarations as job
from jobs.bip_declarations.cutter import FileCut, PageCrop
from scrapers.stores import DeclarationFile, DeclarationLink, PersonRow
from stores.bip_declarations import MemoryBipDeclarationStore


def bundle(path: Path, members: list[tuple[str, bytes]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(path, "w:gz") as tar:
        for name, data in members:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def test_read_blob_goes_by_the_hash_not_the_name(tmp_path):
    # Two URLs ending in the same file name: the bundle holds two members of one name.
    first, second = b"%PDF one declaration", b"%PDF another declaration"
    bundle(
        tmp_path / "b.tar.gz",
        [("h/oswiadczenie.pdf", first), ("h/oswiadczenie.pdf", second)],
    )
    file = DeclarationFile(
        sha(second), "h", "https://h/oswiadczenie.pdf", "b.tar.gz", "oswiadczenie.pdf"
    )

    assert job.read_blob(tmp_path, file) == second
    gone = DeclarationFile(sha(second), "h", "", "missing.tar.gz", "oswiadczenie.pdf")
    assert job.read_blob(tmp_path, gone) is None


def fake_cut(data: bytes, url: str, ocr, *, council: bool = False) -> FileCut:
    crop = PageCrop(0, 0, "handwritten", name="Jan Testowy", date_png=b"\x89PNG date")
    return FileCut("cut", "pdf", 2, 1, [crop])


@pytest.fixture
def store(tmp_path, monkeypatch) -> MemoryBipDeclarationStore:
    monkeypatch.setattr(job, "cut_file", fake_cut)
    on_disk = b"%PDF a declaration"
    bundle(tmp_path / "hostname=h/b.tar.gz", [("h/a.pdf", on_disk)])
    files = [
        DeclarationFile(
            sha(on_disk), "h", "https://h/a.pdf", "hostname=h/b.tar.gz", "a.pdf"
        ),
        DeclarationFile(
            "9" * 64, "h", "https://h/b.pdf", "hostname=h/sealed-later.tar.gz", "b.pdf"
        ),
    ]
    people = [
        PersonRow("1" * 16, "021704", 0, 2024, "Jan", "Testowy", {"koryta_ids": ["p"]}),
        PersonRow("2" * 16, "021704", 2, 2024, "Adam", "Nieobecny", {"koryta_ids": []}),
    ]
    # People on the site first: Jan's file, then Adam's.
    links = [
        DeclarationLink("1" * 16, files[0].sha256, files[0].url),
        DeclarationLink("2" * 16, files[1].sha256, files[1].url),
    ]
    return MemoryBipDeclarationStore(people, files, links)


def test_cut_keeps_what_it_cut_and_comes_back_for_the_rest(store, tmp_path, capsys):
    code = job.run_cut(
        store, tmp_path, workers=1, threads=1, limit=None, max_minutes=None
    )

    assert code == 0
    [cut] = store.cuts().values()
    assert (cut.status, cut.version, cut.pages, cut.pages_read) == (
        "cut",
        job.CUT_VERSION,
        2,
        1,
    )
    [crop] = store.crops(with_images=True)
    assert (crop.sort, crop.name, crop.date_png) == (
        "handwritten",
        "Jan Testowy",
        b"\x89PNG date",
    )
    assert crop.date_png_hash == sha(b"\x89PNG date")
    # The bundle not sealed yet is not recorded, so the next run tries it again.
    assert "1 files' bundles are not on disk" in capsys.readouterr().out
    assert [f.sha256 for f in store.files_to_cut(job.CUT_VERSION, None)] == ["9" * 64]


def test_a_new_cutter_version_cuts_everything_again(store, tmp_path):
    job.run_cut(store, tmp_path, workers=1, threads=1, limit=None, max_minutes=None)

    assert len(store.files_to_cut(job.CUT_VERSION, None)) == 1
    assert len(store.files_to_cut(job.CUT_VERSION + 1, None)) == 2


def test_cut_stops_when_its_time_is_up(store, tmp_path):
    code = job.run_cut(
        store, tmp_path, workers=1, threads=1, limit=None, max_minutes=-1
    )

    assert code == job.EXIT_TRY_LATER
    assert len(store.cuts()) == 1
