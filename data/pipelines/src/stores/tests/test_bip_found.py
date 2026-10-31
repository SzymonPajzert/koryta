"""The list of the people the BIP crawl found a declaration for, as the crawl
writes it into the shared cache and the night reads it back."""

import gzip
import json
from datetime import UTC, datetime
from types import SimpleNamespace

from entities.priority_groups import Declared
from scrapers.stores import PersonRow
from stores.bip_found import FOUND_PREFIX, newest_found, write_found
from stores.storage import LISTING_FIELDS, SHARED_BUCKET


class Shared:
    """The shared cache's bucket, written once per name and listed by name."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.listed: list[tuple[str, str]] = []
        self.storage_client = SimpleNamespace(bucket=self.bucket)

    def bucket(self, name: str) -> "Shared":
        assert name == SHARED_BUCKET
        return self

    def create_object(self, bucket, name, data, content_type):
        assert (bucket, content_type) == (SHARED_BUCKET, "application/gzip")
        assert name not in self.objects, f"{name} written twice"
        self.objects[name] = data
        return f"gs://{bucket}/{name}"

    def list_blobs(self, prefix, fields=None):
        self.listed.append((prefix, fields))
        return [SimpleNamespace(name=n) for n in self.objects if n.startswith(prefix)]

    def get_blob(self, name):
        return SimpleNamespace(download_as_bytes=lambda: self.objects[name])


def row(key: str, priority: int, **person) -> PersonRow:
    return PersonRow(
        key, "146501", priority, 2024, "Jan", "Kowalski", person, "found", "", 1
    )


def test_the_night_reads_the_newest_list_by_entry_and_page():
    shared = Shared()
    first = [row("a", 2, rejestrio_ids=["12"], koryta_ids=[])]
    write_found(shared, first, datetime(2026, 10, 31, 9, tzinfo=UTC))  # type: ignore[arg-type]
    later = [
        row("a", 2, rejestrio_ids=["12"], koryta_ids=[]),
        row("b", 0, rejestrio_ids=["34", "35"], koryta_ids=["page"]),
    ]
    url = write_found(shared, later, datetime(2026, 10, 31, 23, tzinfo=UTC))  # type: ignore[arg-type]

    assert url == (
        f"gs://{SHARED_BUCKET}/{FOUND_PREFIX}date=2026-10-31/"
        "2026-10-31T230000Z.jsonl.gz"
    )
    assert newest_found(shared) == Declared(  # type: ignore[arg-type]
        frozenset({"12", "34", "35"}), frozenset({"page"}), url
    )
    assert shared.listed == [(FOUND_PREFIX, LISTING_FIELDS)]


def test_a_line_carries_ids_and_never_a_name_or_a_birth_date():
    """The declarations are read to check the register's date against, so
    the register's must not travel with them (Szymon, 2026-10-29)."""
    shared = Shared()
    person = {
        "rejestrio_ids": ["12"],
        "koryta_ids": [],
        "full_name": "Jan Kowalski",
        "birth_date": "1970-01-01",
        "pkw_birth_year": 1970,
    }
    write_found(shared, [row("a", 2, **person)], datetime(2026, 10, 31, tzinfo=UTC))  # type: ignore[arg-type]

    [part] = shared.objects.values()
    [line] = gzip.decompress(part).decode("utf-8").splitlines()
    assert json.loads(line) == {
        "key": "a",
        "priority": 2,
        "docs": 1,
        "koryta_ids": [],
        "rejestrio_ids": ["12"],
    }


def test_no_list_yet_is_none():
    assert newest_found(Shared()) is None  # type: ignore[arg-type]
