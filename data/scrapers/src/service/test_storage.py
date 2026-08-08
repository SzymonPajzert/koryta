from __future__ import annotations

import io
import tarfile
from pathlib import Path

import pytest

from scrapers.article.pipelines.parsed_pipeline import _member_path_from_url
from service.storage import (
    member_path,
    read_captured_html,
    read_local_path,
    split_gs_path,
)

# The urls the frontend's `crawlMemberPath` was checked against; keeping the
# expectations here as literals means a change on either side has to be made in
# both places deliberately.
CASES = [
    ("https://example.pl/", "example.pl/index"),
    ("https://example.pl", "example.pl/index"),
    ("https://www.example.pl/a/b/", "www.example.pl/a/b"),
    ("https://example.pl/a?x=1", "example.pl/a"),
    ("http://EXAMPLE.pl:8080/A", "example.pl/A"),
    ("example.pl/a", "example.pl/a"),
]


@pytest.mark.parametrize("url,expected", CASES)
def test_member_path_matches_the_frontend(url: str, expected: str):
    assert member_path(url) == expected


@pytest.mark.parametrize("url,_expected", CASES)
def test_member_path_matches_the_batch_parser(url: str, _expected: str):
    """The service and `ArticleParsed` must look a page up the same way.

    They read the same archives — one right after a capture, one on the nightly
    run — and a disagreement here is silent: the page is simply not found.
    """
    assert member_path(url) == _member_path_from_url(url)


def test_split_gs_path():
    assert split_gs_path("gs://bucket/a/b.tar.gz") == ("bucket", "a/b.tar.gz")


@pytest.mark.parametrize(
    "bad", ["", "bucket/blob", "gs://bucket", "gs://", "https://x/y"]
)
def test_split_gs_path_rejects_anything_else(bad: str):
    with pytest.raises(ValueError):
        split_gs_path(bad)


def _archive(members: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, content in members.items():
            info = tarfile.TarInfo(name=name)
            info.size = len(content)
            tar.addfile(info, io.BytesIO(content))
    return buf.getvalue()


def test_read_captured_html_pulls_the_right_member(monkeypatch: pytest.MonkeyPatch):
    url = "https://www.example.pl/artykul"
    archive = _archive(
        {
            member_path(url): b"<html>wanted</html>",
            "www.example.pl/inny": b"<html>other</html>",
            "index.txt": b"www.example.pl/artykul\n",
        }
    )

    class FakeBlob:
        def download_as_bytes(self) -> bytes:
            return archive

    class FakeBucket:
        def blob(self, name: str) -> FakeBlob:
            assert name == "hostname=www.example.pl/date=2026-08-03/uid_1.tar.gz"
            return FakeBlob()

    class FakeClient:
        def bucket(self, name: str) -> FakeBucket:
            assert name == "koryta-pl-crawled"
            return FakeBucket()

    monkeypatch.setattr("service.storage.storage.Client", FakeClient)

    html = read_captured_html(
        "gs://koryta-pl-crawled/hostname=www.example.pl/date=2026-08-03/uid_1.tar.gz",
        url,
    )

    assert html == b"<html>wanted</html>"


def test_read_local_path_unescapes_the_url(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    """A file:// path has to come back as the name that was written.

    Most Polish article slugs carry a diacritic or a space, and `pathToFileURL`
    percent-escapes both.
    """
    monkeypatch.setenv("CAPTURE_LOCAL_DIR", str(tmp_path))
    wanted = tmp_path / "artykuł o czymś"

    assert read_local_path(wanted.as_uri()) == wanted


@pytest.mark.parametrize("bad", ["", "gs://bucket/blob", "file://relative/path"])
def test_read_local_path_rejects_anything_else(bad: str):
    with pytest.raises(ValueError):
        read_local_path(bad)


def test_read_local_path_stays_inside_the_capture_directory(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    """The path comes out of the request body, so it is the caller's to choose.

    Cloud Tasks is the only thing that should reach `/extract`, but that is not
    a reason to hand whatever does reach it an arbitrary file off this disk.
    """
    root = tmp_path / "captures"
    root.mkdir()
    monkeypatch.setenv("CAPTURE_LOCAL_DIR", str(root))

    for outside in [
        Path("/etc/passwd").as_uri(),
        (root / ".." / "elsewhere" / "secret").as_uri(),
        f"file://{root}/../../etc/passwd",
    ]:
        with pytest.raises(ValueError, match="outside"):
            read_local_path(outside)

    inside = root / "hostname=x" / "date=2026-08-08" / "uid_1.tar.gz"
    assert read_local_path(inside.as_uri()) == inside


def test_read_captured_html_reads_the_development_sink(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    """The local sink stands in for the bucket when there is no emulator.

    `uploadCapturedPage` writes the same archive to disk and returns a file://
    path; nothing else about the flow changes, which is the point.
    """
    monkeypatch.setenv("CAPTURE_LOCAL_DIR", str(tmp_path))
    url = "https://www.example.pl/artykuł"
    archive = tmp_path / "hostname=www.example.pl" / "date=2026-08-03" / "uid_1.tar.gz"
    archive.parent.mkdir(parents=True)
    archive.write_bytes(
        _archive(
            {
                member_path(url): b"<html>wanted</html>",
                "index.txt": b"www.example.pl/artyku\xc5\x82\n",
            }
        )
    )

    assert read_captured_html(archive.as_uri(), url) == b"<html>wanted</html>"
