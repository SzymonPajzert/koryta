"""What predator knows of each candidacy's declarations, where the night can
read it.

The crawl, the cut and the upload run on predator, beside their Postgres
(`stores.bip_declarations`); the night runs on koryta-nightly, which has
neither. So after every crawl chunk, cut and upload `koryta_bip_declarations
facts-part` writes the facts to the shared cache as a write-once part,
`jobs/bip_declarations/facts/date=<UTC day>/<UTC stamp>Z.jsonl.gz`, and the
night's `declarations` step hands the newest to the site, which counts the
declarations in people from them (`jobs.bip_declarations.facts`).

A line per candidacy of the list the writer read, and nothing else: its key,
what the search made of it as codes, and three flags (`CandidacyFacts`). No
name, no date, no file's hash and no URL, as in the found list
(`stores.bip_found`): a candidacy is its key, and who it is stays in the
night's list.
"""

from __future__ import annotations

import gzip
import json
import re
import typing
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timezone

from stores.storage import LISTING_FIELDS, SHARED_BUCKET

if typing.TYPE_CHECKING:
    from stores.storage import Client

FACTS_PREFIX = "jobs/bip_declarations/facts/"
#: A part's name under the prefix, with the second it was written.
PART = re.compile(r"date=\d{4}-\d{2}-\d{2}/(\d{4}-\d{2}-\d{2}T\d{6})Z\.jsonl\.gz$")
#: What a status or a reason may be in a part: a code, never text that could
#: carry a name or a URL (the upload sends a reason on the same terms).
CODE = re.compile(r"[a-z][a-z0-9_]{0,40}")


@dataclass(frozen=True)
class CandidacyFacts:
    """What predator knows of one candidacy's declarations."""

    key: str
    #: What the people mode's search made of it: pending, found, unconfirmed
    #: or not_found.
    status: str = "pending"
    #: The search's reason, as the crawl keeps it.
    reason: str = ""
    #: A file of theirs is not cut by this version of the cutter.
    uncut: bool = False
    #: A file a link names them in is cut. A council's file that names nobody
    #: is theirs only through a crop with their name on it (`waiting`).
    cut_named: bool = False
    #: A crop of theirs the upload would send, which the site does not hold.
    waiting: bool = False


def code(value: str) -> str:
    return value if CODE.fullmatch(value) else ""


def facts_line(facts: CandidacyFacts) -> dict[str, object]:
    """One line of the part: these fields, and no other."""
    return {
        "key": facts.key,
        "status": code(facts.status) or "pending",
        "reason": code(facts.reason),
        "uncut": facts.uncut,
        "cutNamed": facts.cut_named,
        "waiting": facts.waiting,
    }


def from_line(line: Mapping[str, object]) -> CandidacyFacts:
    return CandidacyFacts(
        key=str(line["key"]),
        status=str(line.get("status") or "pending"),
        reason=str(line.get("reason") or ""),
        uncut=line.get("uncut") is True,
        cut_named=line.get("cutNamed") is True,
        waiting=line.get("waiting") is True,
    )


def facts_part(rows: Iterable[CandidacyFacts]) -> bytes:
    lines = "".join(json.dumps(facts_line(row), sort_keys=True) + "\n" for row in rows)
    return gzip.compress(lines.encode("utf-8"), mtime=0)


def part_name(now: datetime) -> str:
    """`now`, an aware datetime, as the part's name: sorted by name, the
    parts are in the order they were written."""
    utc = now.astimezone(timezone.utc)
    return f"{FACTS_PREFIX}date={utc:%Y-%m-%d}/{utc:%Y-%m-%dT%H%M%S}Z.jsonl.gz"


def write_facts(client: Client, rows: Iterable[CandidacyFacts], now: datetime) -> str:
    """Write the facts as the newest part; its gs:// path."""
    return client.create_object(
        SHARED_BUCKET, part_name(now), facts_part(rows), "application/gzip"
    )


def read_part(part: bytes) -> dict[str, CandidacyFacts]:
    """A part's facts, by key."""
    lines = gzip.decompress(part).decode("utf-8").splitlines()
    facts = [from_line(json.loads(line)) for line in lines if line.strip()]
    return {row.key: row for row in facts}


@dataclass(frozen=True)
class FactsPart:
    """The newest part: where it is, when predator wrote it, what it says."""

    url: str
    written: datetime
    facts: dict[str, CandidacyFacts]


def newest_facts(client: Client) -> FactsPart | None:
    """The newest part, or None when there is none yet.

    The newest only: each part holds every candidacy of the list its writer
    read. Listed by name alone, as `stores.bip_found.newest_found` lists."""
    bucket = client.storage_client.bucket(SHARED_BUCKET)
    parts = {
        blob.name: match.group(1)
        for blob in bucket.list_blobs(prefix=FACTS_PREFIX, fields=LISTING_FIELDS)
        if (match := PART.search(blob.name))
    }
    if not parts:
        return None
    newest = max(parts)
    written = datetime.strptime(parts[newest], "%Y-%m-%dT%H%M%S")
    return FactsPart(
        f"gs://{SHARED_BUCKET}/{newest}",
        written.replace(tzinfo=timezone.utc),
        read_part(bucket.get_blob(newest).download_as_bytes()),
    )
