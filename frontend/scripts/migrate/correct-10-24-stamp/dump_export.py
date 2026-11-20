"""Dump the fields `build-plan.ts` reads from one Firestore export to JSONL.

Usage, with the pipelines' interpreter (it has `leveldb_export`):

    data/pipelines/.venv/bin/python -I \\
      frontend/scripts/migrate/correct-10-24-stamp/dump_export.py \\
      <export dir holding all_namespaces/> <out dir> [nodes edges revisions]

Writes `<out dir>/<kind>.jsonl`, one document a line, with its id as `id`.
Instants become ISO 8601 UTC strings with milliseconds, the form the site
stores `content_changed_at` in; a reference becomes the bare id it points at.
Only the fields the plan needs are kept, so a dump of the whole database stays
in the tens of megabytes - none of them is prose about a person.
"""

import datetime as dt
import glob
import json
import os
import sys

from leveldb_export import parse_leveldb_documents  # type: ignore

FIELDS = {
    "nodes": (
        "type",
        "name",
        "published",
        "deleted",
        "content_changed_at",
        "revision_id",
        "revisions",
        "categories",
        "parties",
    ),
    "edges": (
        "type",
        "source",
        "target",
        "name",
        "position",
        "start_date",
        "end_date",
        "published",
        "deleted",
        "revision_id",
    ),
    "revisions": ("node_id", "update_time", "update_automatic", "status"),
}


def plain(value):
    if isinstance(value, dt.datetime):
        if value.tzinfo is not None:
            value = value.astimezone(dt.timezone.utc).replace(tzinfo=None)
        return (
            value.strftime("%Y-%m-%dT%H:%M:%S.") + f"{value.microsecond // 1000:03d}Z"
        )
    if hasattr(value, "id_or_name"):
        return value.id_or_name()
    if isinstance(value, dict):
        return {key: plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain(item) for item in value]
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return value


def main() -> None:
    export, out = sys.argv[1], sys.argv[2]
    kinds = sys.argv[3:] or list(FIELDS)
    os.makedirs(out, exist_ok=True)
    for kind in kinds:
        shards = sorted(glob.glob(f"{export}/all_namespaces/kind_{kind}/output-*"))
        if not shards:
            raise SystemExit(f"{export} has no {kind}")
        count = 0
        with open(f"{out}/{kind}.jsonl", "w") as dump:
            for shard in shards:
                for doc in parse_leveldb_documents(shard):
                    row = {k: plain(doc[k]) for k in FIELDS[kind] if k in doc}
                    row["id"] = doc["_key"]["name"]
                    dump.write(json.dumps(row, ensure_ascii=False) + "\n")
                    count += 1
        print(f"{kind}: {count}")


if __name__ == "__main__":
    main()
