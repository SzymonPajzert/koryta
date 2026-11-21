"""The cut command: files from the crawler's bundles into the job's tables."""

from __future__ import annotations

import hashlib
import io
import tarfile
from pathlib import Path

import pytest

import jobs.bip_declarations as job
from jobs.bip_declarations.cutter import FileCut, PageCrop
from jobs.bip_declarations.employment import BANDS, BandCut, FileBands, Strip
from scrapers.stores import (
    DeclarationCropRow,
    DeclarationCutRow,
    DeclarationFile,
    DeclarationLink,
    PersonRow,
)
from stores.bip_declarations import MemoryBipDeclarationStore, png_hash


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


# -- cut-employment ----------------------------------------------------------------

#: Each file's cut as asked: its due pages, how far each band runs, and every
#: date page of the file.
asked: list[
    tuple[tuple[tuple[int, int], ...], dict[tuple[int, str], int], tuple[int, ...]]
] = []


def fake_bands(data: bytes, pages, ocr, widen=None, starts=()) -> FileBands:
    asked.append((tuple(pages), dict(widen or {}), tuple(starts)))
    result = FileBands("cut", "pdf", 5, 3)
    for page, _ in pages:
        result.bands[page] = [
            BandCut(
                band,
                widen=(widen or {}).get((page, band), 0),
                dpi=200,
                width=1654,
                strips=[Strip(page, 100, 300, b"\x89PNG " + band.encode())],
                lines=[(0, 10, 60)],
                text="Urzad Gminy Testowo",
                score=0.97,
                typed=True,
                source="ocr",
                notes=["a note"],
            )
            for band in BANDS
        ]
    return result


@pytest.fixture
def banded(store, monkeypatch) -> MemoryBipDeclarationStore:
    """The `store` with a date page in each file, two in the one on disk."""
    monkeypatch.setattr(job, "cut_bands", fake_bands)
    asked.clear()
    on_disk, later = store.files.values()
    store.record_cut(
        DeclarationCutRow(on_disk.sha256, job.CUT_VERSION, "cut"),
        [
            DeclarationCropRow(on_disk.sha256, 0),
            DeclarationCropRow(on_disk.sha256, 4, rotation=180),
        ],
    )
    store.record_cut(
        DeclarationCutRow(later.sha256, job.CUT_VERSION, "cut"),
        [DeclarationCropRow(later.sha256, 0)],
    )
    return store


def run(store, root, max_minutes=None, **kw) -> int:
    return job.run_cut_employment(
        store, root, workers=1, threads=1, limit=None, max_minutes=max_minutes, **kw
    )


def test_cut_employment_keeps_each_date_page_s_bands(banded, tmp_path, capsys):
    code = run(banded, tmp_path)

    assert code == 0
    on_disk = next(iter(banded.files))
    assert asked == [(((0, 0), (4, 180)), {}, (0, 4))]
    rows = banded.bands(job.EMPLOYMENT_CUT_VERSION, with_images=True)
    assert [(r.page, r.band) for r in rows] == [
        (page, band) for page in (0, 4) for band in sorted(BANDS)
    ]
    row = rows[0]
    assert (row.sha256, row.status, row.dpi, row.typed, row.notes) == (
        on_disk,
        "cut",
        200,
        True,
        "a note",
    )
    assert row.strips[0].png_hash == png_hash(row.strips[0].png)
    assert row.lines == ((0, 10, 60),)
    # The file whose bundle is not on disk yet is tried again next time.
    assert "1 files' bundles are not on disk" in capsys.readouterr().out
    assert [d.file.sha256 for d in banded.pages_to_band(1, None)] == ["9" * 64]


def test_cut_employment_takes_only_the_pages_named(banded, tmp_path):
    on_disk = next(iter(banded.files))
    names = tmp_path / "pages.txt"
    names.write_text(f"# slice 1\n{on_disk}-p4\n")

    run(banded, tmp_path, items=job.read_items(names))

    assert asked == [(((4, 180),), {}, (0, 4))]
    with pytest.raises(ValueError):
        names.write_text("not-a-page\n")
        job.read_items(names)


def test_a_page_cut_alone_ends_where_its_file_s_next_date_page_starts(banded, tmp_path):
    on_disk = next(iter(banded.files))
    names = tmp_path / "pages.txt"
    names.write_text(f"{on_disk}-p0\n")

    run(banded, tmp_path, items=job.read_items(names))

    # Page 4 is not due, but it starts the declaration after page 0's.
    assert asked == [(((0, 0),), {}, (0, 4))]


def test_a_recut_runs_the_band_readers_flagged_one_caption_further(banded, tmp_path):
    on_disk = next(iter(banded.files))
    run(banded, tmp_path)
    asked.clear()

    recut = [job.recut_bands(f"{on_disk}-p0:employer")]
    run(banded, tmp_path, recut=recut)
    run(banded, tmp_path, recut=recut)

    assert asked == [
        (
            ((0, 0),),
            {(0, "employer"): 1, (0, "header"): 0, (0, "vii"): 0, (0, "viii"): 0},
            (0, 4),
        ),
        (
            ((0, 0),),
            {(0, "employer"): 2, (0, "header"): 0, (0, "vii"): 0, (0, "viii"): 0},
            (0, 4),
        ),
    ]
    widths = {
        (r.page, r.band): r.widen for r in banded.bands(job.EMPLOYMENT_CUT_VERSION)
    }
    assert widths[(0, "employer")] == 2
    assert widths[(4, "employer")] == widths[(0, "vii")] == 0


def test_recut_names_a_page_and_a_band():
    with pytest.raises(Exception, match="<sha256>-p<page>:<band>"):
        job.recut_bands(f"{'a' * 64}-p0:name")
    assert job.recut_bands(f"{'a' * 64}-p2:viii") == (f"{'a' * 64}-p2", "viii")


def test_cut_employment_stops_when_its_time_is_up(banded, tmp_path):
    code = run(banded, tmp_path, max_minutes=-1)

    assert code == job.EXIT_TRY_LATER
    assert len(asked) == 1


def test_cut_employment_is_a_command_of_the_job():
    args = job._args(
        [
            "cut-employment",
            "--limit",
            "20",
            "--max-minutes",
            "30",
            "--recut",
            f"{'a' * 64}-p0:vii",
        ]
    )

    assert args.func is job.cmd_cut_employment
    assert (args.limit, args.max_minutes, args.recut) == (
        20,
        30.0,
        [(f"{'a' * 64}-p0", "vii")],
    )
