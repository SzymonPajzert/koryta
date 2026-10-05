"""A restore lands on disk whole, or not at all."""

import io
import os
import tarfile

import pytest

from stores import storage
from stores.storage import Client

DATA = b'{"id":"0000000110"}\n{"id":"0000000004"}\n'


def archive(payload: bytes) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        info = tarfile.TarInfo(name="people_merged")
        info.size = len(payload)
        tar.addfile(info, io.BytesIO(payload))
        tar.addfile(tarfile.TarInfo(name="metadata.json"), io.BytesIO(b""))
    return buffer.getvalue()


class Blob:
    name = "filename=people_merged/user=romb/datetime=2026-10-02T19:00:00/backup.tar.gz"

    def __init__(self, content: bytes):
        self.content = content

    def download_to_file(self, f):
        f.write(self.content)


def client(monkeypatch, content: bytes) -> Client:
    c = Client.__new__(Client)
    monkeypatch.setattr(c, "_latest_backup_blob", lambda filename: Blob(content))
    return c


def test_a_first_restore_makes_its_directory(tmp_path, monkeypatch):
    dest = tmp_path / "versioned" / "people_merged" / "people_merged.jsonl"

    client(monkeypatch, archive(DATA)).restore_backup_to_path(
        "people_merged", str(dest)
    )

    assert dest.read_bytes() == DATA
    assert sorted(os.listdir(dest.parent)) == ["people_merged.jsonl"]


def test_a_restore_cut_short_leaves_no_output(tmp_path, monkeypatch):
    dest = tmp_path / "people_merged.jsonl"

    def cut(src, out, *args, **kwargs):
        out.write(src.read(5))
        raise OSError("No space left on device")

    monkeypatch.setattr(storage.shutil, "copyfileobj", cut)
    with pytest.raises(OSError):
        client(monkeypatch, archive(DATA)).restore_backup_to_path(
            "people_merged", str(dest)
        )

    assert not dest.exists()
