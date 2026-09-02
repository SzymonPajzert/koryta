from __future__ import annotations

import io
import json
import tarfile
from dataclasses import replace
from pathlib import Path

import pytest

from service import people as service_people
from service import storage as service_storage
from service.config import Config
from service.people import PersonLookup

ARTICLE = (
    "Wczoraj Jan Kowalski zostal prezesem spolki. "
    "Obecna byla takze Anna Nowak, radna miasta."
)


def _config(tmp_path: Path, people: list[tuple[str, str]], ttl: int = 24 * 3600):
    """A Config pointed at a dump written for one test."""
    path = tmp_path / "person_koryta.jsonl"
    path.write_text(
        "\n".join(
            json.dumps({"id": pid, "full_name": name}) for pid, name in people
        ),
        encoding="utf-8",
    )
    return Config(
        koryta_url="https://koryta.test",
        firebase_api_key="key",
        extractor_uid="capture-extractor",
        firestore_database="koryta-pl",
        llm_model="test-model",
        llm_base_url="",
        llm_api_key="key",
        llm_lanes=1,
        llm_timeout_seconds=1,
        extraction_tag="capture_test",
        verify_facts=False,
        match_people=True,
        people_index_path=str(path),
        people_index_ttl_seconds=ttl,
        min_score=None,
    )


def test_a_person_named_in_the_article_becomes_a_koryta_id(tmp_path: Path):
    cfg = _config(tmp_path, [("p1", "Jan Kowalski"), ("p2", "Zbigniew Ziobro")])

    match = PersonLookup().match(cfg, ARTICLE)

    assert match.ids == ("p1",)
    assert match.names == ("Jan Kowalski",)
    # Somebody in the dump but not in the article is not a candidate.
    assert "Zbigniew Ziobro" not in match.names


def test_a_name_two_people_share_is_dropped_rather_than_guessed(tmp_path: Path):
    """The batch pipeline separates namesakes with register proof this has
    none of, so picking one would file a stranger's job on a real person."""
    cfg = _config(tmp_path, [("p1", "Jan Kowalski"), ("p2", " Jan  Kowalski ")])

    match = PersonLookup().match(cfg, ARTICLE)

    assert match.ids == ()
    assert match.ambiguous == ("Jan Kowalski",)
    # Still worth telling the model a known person is in the text.
    assert "Jan Kowalski" in match.names


def test_the_dump_is_read_once_and_reused(tmp_path: Path):
    """Re-reading it per capture is the cost this source exists to avoid."""
    cfg = _config(tmp_path, [("p1", "Jan Kowalski")])
    lookup = PersonLookup()

    lookup.match(cfg, ARTICLE)
    Path(cfg.people_index_path).unlink()

    assert lookup.match(cfg, ARTICLE).ids == ("p1",)


def test_the_index_is_rebuilt_once_it_goes_stale(tmp_path: Path):
    cfg = _config(tmp_path, [("p1", "Jan Kowalski")], ttl=-1)
    lookup = PersonLookup()

    lookup.match(cfg, ARTICLE)
    Path(cfg.people_index_path).write_text(
        json.dumps({"id": "p9", "full_name": "Jan Kowalski"}), encoding="utf-8"
    )

    assert lookup.match(cfg, ARTICLE).ids == ("p9",)


def test_an_empty_page_reads_nothing(tmp_path: Path):
    cfg = _config(tmp_path, [("p1", "Jan Kowalski")])
    Path(cfg.people_index_path).unlink()

    assert PersonLookup().match(cfg, "   ").ids == ()


def test_a_missing_dump_leaves_the_facts_unlinked_rather_than_raising(
    tmp_path: Path,
):
    """Losing the whole capture over an unreadable dump would be worse than
    submitting the facts the way every capture did before this existed."""
    cfg = _config(tmp_path, [("p1", "Jan Kowalski")])
    Path(cfg.people_index_path).unlink()

    assert service_people.match_people(cfg, ARTICLE) == service_people.PeopleMatch()


def test_a_dump_can_be_read_out_of_its_backup_archive(tmp_path: Path):
    """The shared cache ships the jsonl inside a tar.gz beside an empty
    metadata.json, and that is also what a pinned copy would be."""
    cfg = _config(tmp_path, [("p1", "Jan Kowalski")])
    jsonl = Path(cfg.people_index_path).read_bytes()

    archive = tmp_path / "backup.tar.gz"
    with tarfile.open(archive, mode="w:gz") as tar:
        info = tarfile.TarInfo(name="person_koryta_2026-09-01")
        info.size = len(jsonl)
        tar.addfile(info, io.BytesIO(jsonl))
        meta = tarfile.TarInfo(name="metadata.json")
        meta.size = 0
        tar.addfile(meta, io.BytesIO(b""))

    match = PersonLookup().match(replace(cfg, people_index_path=str(archive)), ARTICLE)

    assert match.ids == ("p1",)


@pytest.mark.parametrize(
    "names, expected",
    [
        # Both segments sort chronologically, so the greatest name is newest.
        (
            [
                "filename=person_koryta_2026-08-31/user=mp/datetime=2026-08-31T09:00:00/backup.tar.gz",
                "filename=person_koryta_2026-09-01/user=mp/datetime=2026-09-01T21:34:15/backup.tar.gz",
            ],
            "filename=person_koryta_2026-09-01/user=mp/datetime=2026-09-01T21:34:15/backup.tar.gz",
        ),
        # Two users on the same day: the later run wins, whoever ran it.
        (
            [
                "filename=person_koryta_2026-09-01/user=zz/datetime=2026-09-01T08:00:00/backup.tar.gz",
                "filename=person_koryta_2026-09-01/user=mp/datetime=2026-09-01T21:34:15/backup.tar.gz",
            ],
            "filename=person_koryta_2026-09-01/user=zz/datetime=2026-09-01T08:00:00/backup.tar.gz",
        ),
    ],
)
def test_the_newest_backup_is_picked_without_asking_anybody(
    monkeypatch: pytest.MonkeyPatch, names, expected
):
    """`stores.storage.download_backup` prompts on stdin to choose a user,
    which on Cloud Run is a hang rather than a question."""
    class _Blob:
        def __init__(self, name: str) -> None:
            self.name = name

    class _Client:
        def list_blobs(self, bucket: str, prefix: str):
            return [_Blob(n) for n in names if n.startswith(prefix)]

    monkeypatch.setattr(service_storage.storage, "Client", _Client)

    picked = service_storage.latest_backup_blob_name("b", service_people.BACKUP_PREFIX)
    assert picked == expected
