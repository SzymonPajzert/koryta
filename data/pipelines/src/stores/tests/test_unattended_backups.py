"""A run nobody is watching must not stop to ask whose backup to restore."""

import builtins

import pytest

from stores import storage, user
from stores.storage import Client

BACKUPS = [
    "filename=people_merged/user=romb/datetime=2026-09-29T12:01:08/backup.tar.gz",
    "filename=people_merged/user=romb/datetime=2026-09-20T09:00:00/backup.tar.gz",
    "filename=people_merged/user=mp/datetime=2026-09-30T08:00:00/backup.tar.gz",
    "filename=people_merged/user=krs-jobs/datetime=2026-09-01T00:40:00/backup.tar.gz",
]


class Blob:
    def __init__(self, name: str):
        self.name = name


class Bucket:
    def __init__(self, names: list[str]):
        self.names = names

    def list_blobs(self, prefix: str):
        return [Blob(name) for name in self.names if name.startswith(prefix)]


class GCS:
    def __init__(self, names: list[str]):
        self.names = names

    def bucket(self, name: str) -> Bucket:
        return Bucket(self.names)


def client(names: list[str]) -> Client:
    c = Client.__new__(Client)
    c.storage_client = GCS(names)  # type: ignore[assignment]
    return c


@pytest.fixture
def nobody_watching(monkeypatch):
    monkeypatch.setattr(storage, "interactive", lambda: False)

    def no_prompts(*args):
        raise AssertionError("asked on stdin")

    monkeypatch.setattr(builtins, "input", no_prompts)


def test_without_backups_of_its_own_a_scheduled_run_takes_the_newest(
    monkeypatch, nobody_watching
):
    monkeypatch.setattr(storage, "get_username", lambda: "cloud-run")

    blob = client(BACKUPS)._latest_backup_blob("people_merged")

    assert blob.name == BACKUPS[2]


def test_a_run_with_backups_of_its_own_still_reads_its_own(
    monkeypatch, nobody_watching
):
    monkeypatch.setattr(storage, "get_username", lambda: "krs-jobs")

    blob = client(BACKUPS)._latest_backup_blob("people_merged")

    assert blob.name == BACKUPS[3]


def test_at_a_terminal_the_choice_is_still_asked(monkeypatch):
    monkeypatch.setattr(storage, "interactive", lambda: True)
    monkeypatch.setattr(storage, "get_username", lambda: "someone-else")
    asked = []

    def pick(username, users):
        asked.append(sorted(users))
        return "romb"

    monkeypatch.setattr(storage, "pick_user", pick)

    blob = client(BACKUPS)._latest_backup_blob("people_merged")

    assert asked == [["krs-jobs", "mp", "romb"]]
    assert blob.name == BACKUPS[0]


def test_without_a_username_a_scheduled_run_fails_instead_of_asking(
    monkeypatch, nobody_watching
):
    monkeypatch.setattr(user, "username", None)
    monkeypatch.setattr(user, "load_dotenv", lambda: None)
    monkeypatch.setattr(user, "interactive", lambda: False)
    monkeypatch.delenv("USERNAME", raising=False)
    monkeypatch.setenv("USER", "szymon")

    with pytest.raises(ValueError, match="USERNAME"):
        user.get_username()


MAIN = "filename=people_merged/user=main/datetime=2026-09-30T01:10:00/backup.tar.gz"


@pytest.mark.parametrize("watched", [False, True])
def test_the_nightly_runs_newer_backup_wins_over_ones_own_older(monkeypatch, watched):
    monkeypatch.setattr(storage, "interactive", lambda: watched)
    monkeypatch.setattr(storage, "get_username", lambda: "romb")

    blob = client([*BACKUPS, MAIN])._latest_backup_blob("people_merged")

    assert blob.name == MAIN


def test_ones_own_newer_backup_wins_over_the_nightly_runs(monkeypatch, nobody_watching):
    monkeypatch.setattr(storage, "get_username", lambda: "mp")

    blob = client([*BACKUPS, MAIN])._latest_backup_blob("people_merged")

    assert blob.name == BACKUPS[2]


def test_without_backups_of_its_own_a_run_takes_the_nightly_runs(monkeypatch):
    monkeypatch.setattr(storage, "interactive", lambda: True)
    monkeypatch.setattr(storage, "get_username", lambda: "someone-else")

    def no_prompts(*args):
        raise AssertionError("asked whose backup to take")

    monkeypatch.setattr(storage, "pick_user", no_prompts)
    newer_elsewhere = MAIN.replace("user=main", "user=mp").replace("09-30", "10-01")

    blob = client([*BACKUPS, MAIN, newer_elsewhere])._latest_backup_blob(
        "people_merged"
    )

    assert blob.name == MAIN
