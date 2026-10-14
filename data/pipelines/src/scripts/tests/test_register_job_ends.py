"""`register_job_ends`: the register file the crawl-stamp migration reads."""

import io
import json
import tarfile

from scripts import register_job_ends as script

#: One row of `person_krs_combined`, as the nightly backup holds it.
ROW = {
    "id": "111",
    "first_name": "JAN",
    "last_name": "KOWALSKI",
    "full_name": "JAN KOWALSKI",
    "employed_krs": "123456",
    "employed_start": "2020-01-01",
    "employed_end": None,
    "employed_for": "6",
    "employed_role": "Zarząd",
    "birth_date": "1970-01-01",
    "second_names": None,
    "sex": "M",
    "rejestrio_type": "osoba",
    "crawled_on": "2026-10-02",
    "source": "rejestr.io",
    "pesel_fingerprint": "f" * 32,
}


def test_a_post_keeps_what_the_migration_matches_on():
    assert script.register_row(ROW) == {
        "krs": "0000123456",
        "entry": "rejestr.io/111",
        "rejestrId": "111",
        "fullName": "JAN KOWALSKI",
        "firstName": "JAN",
        "lastName": "KOWALSKI",
        "birthDate": "1970-01-01",
        "role": "Zarząd",
        "start": "2020-01-01",
        "end": None,
        "crawledOn": "2026-10-02",
        "source": "rejestr.io",
    }


def test_an_end_is_a_day():
    row = script.register_row({**ROW, "employed_end": "2026-07-17T00:00:00"})
    assert row is not None and row["end"] == "2026-07-17"


def test_an_odpis_only_entry_is_named_by_a_digest_never_the_fingerprint():
    row = script.register_row({**ROW, "id": None, "source": "odpis"})
    assert row is not None
    assert row["rejestrId"] is None
    assert row["entry"].startswith("odpis/")
    assert ROW["pesel_fingerprint"] not in json.dumps(row)
    other = script.register_row({**ROW, "id": None, "pesel_fingerprint": "e" * 32})
    assert other is not None and other["entry"] != row["entry"]


def test_an_entry_with_neither_id_nor_fingerprint_is_its_name_and_birth():
    row = script.register_row({**ROW, "id": None, "pesel_fingerprint": None})
    assert row is not None
    assert row["entry"] == "odpis/JAN KOWALSKI|1970-01-01"


def test_a_post_without_company_role_or_start_is_left_out():
    for blank in ("employed_krs", "employed_role", "employed_start"):
        assert script.register_row({**ROW, blank: None}) is None


def test_reads_the_nightly_backup_tarball(tmp_path):
    payload = (json.dumps(ROW) + "\n").encode()
    archive = tmp_path / "backup.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        for name, data in (("metadata.json", b"{}"), ("person_krs_combined", payload)):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    rows, skipped = script.convert(script.read_lines(archive))
    assert [row["entry"] for row in rows] == ["rejestr.io/111"]
    assert skipped == 0


def test_refuses_to_write_into_the_repository(tmp_path, capsys):
    source = tmp_path / "person_krs_combined"
    source.write_text(json.dumps(ROW) + "\n")
    inside = script.REPOSITORY / "data" / "register.jsonl"
    assert script.main([str(source), "--output", str(inside)]) == 2
    assert not inside.exists()
    assert "public" in capsys.readouterr().err

    outside = tmp_path / "out" / "register.jsonl"
    assert script.main([str(source), "--output", str(outside)]) == 0
    assert json.loads(outside.read_text())["krs"] == "0000123456"
