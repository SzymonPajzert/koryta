"""Document blob storage.

Bundles documents into one `tar.gz` per (host, date) with an `index.txt`, the
same shape the article crawler produces via `BatchClient.batch_upload`
(`stores/storage.py`). The local implementation exists so iteration 1 can run
without GCS credentials; swapping in `ctx.io.batch_upload` later is a class
swap, not a redesign.
"""

from __future__ import annotations

import hashlib
import json
import tarfile
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from scrapers.bip.models import DocRow


@dataclass
class _Bundle:
    host: str
    uid: str
    date: str
    part_path: Path
    final_path: Path
    tar: tarfile.TarFile
    size: int = 0
    index: list[str] = field(default_factory=list)


class LocalBundleStore:
    """Writes documents into per-host tar.gz bundles under `root`."""

    def __init__(self, root: Path, max_bundle_bytes: int = 64_000_000) -> None:
        self.root = Path(root)
        self.max_bundle_bytes = max_bundle_bytes
        self._bundles: dict[str, _Bundle] = {}
        self._seen: dict[str, str] = {}  # sha256 -> bundle path
        self._uid_counter = 0
        # Crawl workers run in threads; tarfile handles and the bundle map are
        # shared, so every mutation goes through this lock (a concurrent add
        # deadlocked the first 100-host run).
        self._lock = threading.RLock()

    def _next_uid(self, host: str, date: str) -> str:
        self._uid_counter += 1
        return f"{date}-{self._uid_counter:04d}"

    def _open(self, host: str) -> _Bundle:
        bundle = self._bundles.get(host)
        if bundle is not None:
            return bundle
        date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        uid = self._next_uid(host, date)
        directory = self.root / f"hostname={host}" / f"date={date}"
        directory.mkdir(parents=True, exist_ok=True)
        final_path = directory / f"uid_{uid}.tar.gz"
        part_path = directory / f"uid_{uid}.tar.gz.part"
        tar = tarfile.open(part_path, mode="w:gz")
        bundle = _Bundle(
            host=host,
            uid=uid,
            date=date,
            part_path=part_path,
            final_path=final_path,
            tar=tar,
        )
        self._bundles[host] = bundle
        return bundle

    def _close(self, bundle: _Bundle) -> None:
        index_data = ("\n".join(bundle.index) + "\n").encode("utf-8")
        info = tarfile.TarInfo(name="index.txt")
        info.size = len(index_data)
        bundle.tar.addfile(info, _BytesReader(index_data))
        bundle.tar.close()
        bundle.part_path.rename(bundle.final_path)
        self._bundles.pop(bundle.host, None)

    def add(
        self,
        *,
        host: str,
        url: str,
        data: bytes,
        content_type: str,
        filename: str,
        title: str,
        chain: list[str],
    ) -> tuple[DocRow, bool]:
        """Store one document. Returns (row, is_new_blob)."""
        with self._lock:
            return self._add(
                host=host,
                url=url,
                data=data,
                content_type=content_type,
                filename=filename,
                title=title,
                chain=chain,
            )

    def _add(
        self,
        *,
        host: str,
        url: str,
        data: bytes,
        content_type: str,
        filename: str,
        title: str,
        chain: list[str],
    ) -> tuple[DocRow, bool]:
        digest = hashlib.sha256(data).hexdigest()
        bundle_path = self._seen.get(digest)
        if bundle_path is None:
            bundle = self._open(host)
            member = f"{host}/{filename}"
            info = tarfile.TarInfo(name=member)
            info.size = len(data)
            info.mtime = int(datetime.now(timezone.utc).timestamp())
            bundle.tar.addfile(info, _BytesReader(data))
            bundle.index.append(member)
            bundle.size += len(data)
            bundle_path = str(bundle.final_path.relative_to(self.root))
            self._seen[digest] = bundle_path
            if bundle.size >= self.max_bundle_bytes:
                self._close(bundle)
            is_new = True
        else:
            is_new = False
        row = DocRow(
            sha256=digest,
            url=url,
            host=host,
            content_type=content_type,
            size=len(data),
            filename=filename,
            title=title,
            bundle=bundle_path,
            chain=chain,
        )
        return row, is_new

    def flush(self) -> list[DocRow]:
        """Close every open bundle. Returns rows for its manifest entries."""
        rows: list[DocRow] = []
        with self._lock:
            for bundle in list(self._bundles.values()):
                self._close(bundle)
        return rows

    def close_host(self, host: str) -> None:
        """Finalize a host's open bundle so its documents get a real blob.

        Without this the bundle only closes at `max_bundle_bytes` or at process
        end, so every killed run strands one `.part` per crawled host and the
        docs table points at a file that never materialized.
        """
        with self._lock:
            bundle = self._bundles.get(host)
            if bundle is not None:
                self._close(bundle)

    def known_digest(self, digest: str) -> bool:
        with self._lock:
            return digest in self._seen

    def blob_exists(self, bundle_rel: str) -> bool:
        """Whether the bundle a document row points at is still on disk."""
        if not bundle_rel:
            return False
        return (self.root / bundle_rel).exists()


class _BytesReader:
    """Minimal read-only file object for tarfile.addfile."""

    def __init__(self, data: bytes) -> None:
        self._data = data
        self._offset = 0

    def read(self, size: int = -1) -> bytes:
        if size < 0:
            chunk = self._data[self._offset :]
            self._offset = len(self._data)
            return chunk
        chunk = self._data[self._offset : self._offset + size]
        self._offset += len(chunk)
        return chunk


def write_run_manifest(root: Path, stats: list[dict[str, object]]) -> Path:
    """Append a run summary to `root/runs.jsonl` for later reporting."""
    root.mkdir(parents=True, exist_ok=True)
    path = root / "runs.jsonl"
    with path.open("a", encoding="utf-8") as handle:
        for entry in stats:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return path
