"""Who the BIP crawler's people mode found an oświadczenie majątkowe for, where
the night can read it.

The crawl runs on predator, beside its Postgres (`stores.bip_people`); the
night's people step runs on koryta-nightly, which has neither. So
`koryta_scrape_bip found` writes the found candidacies to the shared cache as a
write-once part, `jobs/bip_crawler/found/date=<UTC day>/<UTC stamp>.jsonl.gz`,
and the people step reads the newest for its declaration groups
(`entities.priority_groups.DECLARATION_GROUPS`).

A line per candidacy with a file downloaded that a link names the person in -
status found, never unconfirmed, whose files may be a stranger's: `key`,
`priority` (`BipPersonOfInterest`'s, as of the crawl's list), `docs`,
`koryta_ids` and `rejestrio_ids`. No name and no birth date: the night finds
people by their ids, and the declarations are read to check the register's date
against, so the register's must not travel with them (Szymon, 2026-10-29).
"""

from __future__ import annotations

import gzip
import json
import typing
from collections.abc import Iterable
from datetime import datetime, timezone

from entities.priority_groups import Declared
from scrapers.stores import PersonRow
from stores.storage import LISTING_FIELDS, SHARED_BUCKET

if typing.TYPE_CHECKING:
    from stores.storage import Client

FOUND_PREFIX = "jobs/bip_crawler/found/"


def found_line(row: PersonRow) -> dict[str, object]:
    """What the night is told of one found candidacy."""
    person = row.person or {}
    return {
        "key": row.key,
        "priority": row.priority,
        "docs": row.docs,
        "koryta_ids": ids(person.get("koryta_ids")),
        "rejestrio_ids": ids(person.get("rejestrio_ids")),
    }


def ids(value: object) -> list[str]:
    """A list of ids as the crawl's list holds them, as text; none for anything else."""
    return [str(i) for i in value] if isinstance(value, (list, tuple)) else []


def found_part(rows: Iterable[PersonRow]) -> bytes:
    lines = "".join(json.dumps(found_line(row), sort_keys=True) + "\n" for row in rows)
    return gzip.compress(lines.encode("utf-8"), mtime=0)


def part_name(now: datetime) -> str:
    """`now`, an aware datetime, as the part's name: sorted by name, the
    parts are in the order they were written."""
    utc = now.astimezone(timezone.utc)
    return f"{FOUND_PREFIX}date={utc:%Y-%m-%d}/{utc:%Y-%m-%dT%H%M%S}Z.jsonl.gz"


def write_found(client: Client, rows: Iterable[PersonRow], now: datetime) -> str:
    """Write the found candidacies as tonight's newest part; its gs:// path."""
    return client.create_object(
        SHARED_BUCKET, part_name(now), found_part(rows), "application/gzip"
    )


def declared_in(part: bytes, source: str = "") -> Declared:
    """The ids of the people one part names."""
    registers: set[str] = set()
    pages: set[str] = set()
    for line in gzip.decompress(part).decode("utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        registers.update(ids(row.get("rejestrio_ids")))
        pages.update(ids(row.get("koryta_ids")))
    return Declared(frozenset(registers), frozenset(pages), source)


def newest_found(client: Client) -> Declared | None:
    """The people the newest part names, or None when there is no part.

    The newest only: a candidacy found stays found (`record_person` never
    takes it back), so each part holds every one before it. Listed by name
    alone, as `jobs.people_import.bought_since` lists."""
    bucket = client.storage_client.bucket(SHARED_BUCKET)
    names = [
        blob.name
        for blob in bucket.list_blobs(prefix=FOUND_PREFIX, fields=LISTING_FIELDS)
        if blob.name.endswith(".jsonl.gz")
    ]
    if not names:
        return None
    newest = max(names)
    part = bucket.get_blob(newest).download_as_bytes()
    return declared_in(part, f"gs://{SHARED_BUCKET}/{newest}")
