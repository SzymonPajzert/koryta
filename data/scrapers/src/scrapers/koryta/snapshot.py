"""Read one Firestore export of koryta.pl as a single, consistent snapshot.

`FirestoreCollection` in :mod:`scrapers.koryta.download` lists the whole
``hostname=koryta.pl`` prefix and keeps the blobs whose path contains
``date=<day>``. That is fine for the pipelines, which only want "the most recent
people", but it is the wrong tool for checking invariants:

* the site is exported **twice a day**, so a day-granular filter merges two
  exports and returns every document twice - a broken document then shows up as
  two failures, and any count is doubled;
* different collections are read in separate passes, so nothing guarantees they
  come from the same export. A referential check ("this edge's target exists")
  run across two snapshots taken twelve hours apart reports differences that are
  just the site changing in between.

This module addresses both: it resolves one export directory and reads every
collection from that directory alone, so the documents describe one moment in
time. Restricting the GCS prefix to the export also means the listing returns
only the shards of the collection asked for, rather than every shard of every
export ever taken.
"""

from dataclasses import dataclass, field

from leveldb_export import parse_leveldb_documents  # type: ignore

from scrapers.stores import CloudStorage, Context
from scrapers.stores.file import DownloadableFile

DUMP_PREFIX = "hostname=koryta.pl"

#: Firestore writes this file last, once every collection has been exported. Its
#: absence means the export is still running or was aborted - the same check
#: `frontend/scripts/check-db-export.sh` makes before starting the emulators.
EXPORT_METADATA_SUFFIX = ".overall_export_metadata"

#: The document's own fields never include its id; the export carries it in a
#: separate `_key` entry, whose `name` is the Firestore document id.
KEY_FIELD = "_key"


def export_dates(ctx: Context) -> list[str]:
    """All export timestamps in the bucket, oldest first.

    They are ISO-8601 in UTC (``2026-07-28T14:25:08.897Z``), so sorting them as
    strings sorts them chronologically.
    """
    return ctx.io.list_namespaces(CloudStorage(prefix=DUMP_PREFIX), "date")


def is_complete(ctx: Context, date: str) -> bool:
    """Whether the export taken at ``date`` finished writing."""
    # The metadata file sits directly inside the export directory and is named
    # after it, so this prefix matches it and nothing else - no need to list the
    # export's thousands of collection shards to find out.
    ref = CloudStorage(prefix=f"{DUMP_PREFIX}/date={date}/date=", binary=True)
    return any(
        isinstance(blob, DownloadableFile)
        and blob.filename.endswith(EXPORT_METADATA_SUFFIX)
        for blob in ctx.io.list_files(ref)
    )


def latest_export(ctx: Context, max_lookback: int = 5) -> str:
    """The most recent export that finished writing.

    Backs off to earlier exports because the newest directory may belong to a
    run that is still in progress, which would otherwise read as a database that
    lost most of its documents.
    """
    dates = export_dates(ctx)
    if not dates:
        raise RuntimeError(f"No exports found under gs://.../{DUMP_PREFIX}")

    for date in reversed(dates[-max_lookback:]):
        if is_complete(ctx, date):
            return date

    raise RuntimeError(
        f"None of the {max_lookback} most recent exports under {DUMP_PREFIX} has "
        f"a *{EXPORT_METADATA_SUFFIX} file; the newest tried was {dates[-1]}"
    )


def read_collection(ctx: Context, date: str, collection: str) -> list[dict]:
    """Every document of ``collection`` in the export taken at ``date``.

    Each returned dict holds the document's stored fields plus ``id``, the
    Firestore document id. A document that stores an ``id`` field of its own
    keeps it under ``stored_id``, so the two can be told apart - the frontend
    lets a stored ``id`` shadow the real one (`{ id: doc.id, ...data }`), which
    is worth being able to check for rather than to reproduce silently.
    """
    ref = CloudStorage(
        prefix=f"{DUMP_PREFIX}/date={date}/all_namespaces/kind_{collection}/",
        binary=True,
    )

    documents: list[dict] = []
    for blob in ctx.io.list_files(ref):
        assert isinstance(blob, DownloadableFile)
        # Alongside the `output-N` shards each collection directory holds an
        # `.export_metadata` file, which is not a document stream.
        if "output" not in blob.filename:
            continue

        content = ctx.io.read_data(blob).read_file()
        for document in parse_leveldb_documents(content):
            key = document.pop(KEY_FIELD, None) or {}
            if "id" in document:
                document["stored_id"] = document["id"]
            document["id"] = str(key.get("name", ""))
            documents.append(document)

    return documents


def is_reference(value) -> bool:
    """Whether an exported field is a Firestore document reference.

    A reference survives the export as a datastore ``Key`` rather than as the
    string id an equality query would need. Recognised by shape rather than by
    importing ``google.appengine`` - reading an export is the scrapers' job, and
    the layering rules keep that package out of this package.
    """
    return hasattr(value, "id_or_name")


def reference_id(value) -> str | None:
    """The document id a link field points at, whatever shape it was stored in.

    Links to other documents appear as a reference, as a bare id, or as a
    ``collection/id`` path, depending on which writer produced them. This
    flattens all three to the id.
    """
    if value is None:
        return None
    if is_reference(value):
        return str(value.id_or_name())
    if isinstance(value, str):
        return value.rsplit("/", 1)[-1]
    if isinstance(value, dict) and "path" in value:
        return str(value["path"]).rsplit("/", 1)[-1]
    return None


@dataclass
class Snapshot:
    """One export, read lazily and kept in memory once read."""

    ctx: Context
    date: str
    _collections: dict[str, list[dict]] = field(default_factory=dict)

    def collection(self, name: str) -> list[dict]:
        if name not in self._collections:
            self._collections[name] = read_collection(self.ctx, self.date, name)
        return self._collections[name]

    def ids(self, name: str) -> set[str]:
        return {document["id"] for document in self.collection(name)}

    def by_id(self, name: str) -> dict[str, dict]:
        return {document["id"]: document for document in self.collection(name)}


def load_snapshot(ctx: Context, date: str | None = None) -> Snapshot:
    """The named export, or the most recent complete one."""
    return Snapshot(ctx=ctx, date=date or latest_export(ctx))
