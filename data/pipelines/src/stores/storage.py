import argparse
import atexit
import contextlib
import io
import os
import shutil
import tarfile
import threading
import time
import typing
from collections import defaultdict
from datetime import datetime
from functools import cached_property
from typing import Generator
from zoneinfo import ZoneInfo

import google.auth
import google.auth.transport.requests
import google.cloud.storage as storage
import requests.adapters
from google.api_core import exceptions as gcs_exceptions
from tqdm import tqdm
from uuid_extensions import uuid7str  # type: ignore

from entities.util import NormalizedParse
from scrapers.stores import IO, CloudStorage
from scrapers.stores.file import DownloadableFile
from stores.user import get_username, pick_user

CRAWLED_BUCKET = "koryta-pl-crawled"
SHARED_BUCKET = "koryta-pl-sharedcache"
warsaw_tz = ZoneInfo("Europe/Warsaw")


_GCS_POOL_SIZE = 256  # generous cap; pool is lazy so unused slots cost nothing


def _make_gcs_client() -> storage.Client:
    # Scopes have to be named here. Passing `credentials=` and `_http=` to
    # storage.Client skips the with_scopes_if_required() it would otherwise do
    # for itself, so whatever google.auth.default() returns is what gets used.
    #
    # Unscoped is harmless for a service-account key or a gcloud user login --
    # neither needs a scope to mint a token, which is why this only ever broke
    # on CI. Under Workload Identity Federation the credentials are impersonated,
    # and google-auth sends the scopes as the `scope` field of the
    # generateAccessToken body; empty, IAM rejects the call as
    #
    #   RefreshError: ('Unable to acquire impersonated credentials',
    #     {"code": 400, "message": "Request contains an invalid argument."})
    #
    # which is what every nightly run did from the first one on 2026-07-31.
    credentials, project = google.auth.default(scopes=storage.Client.SCOPE)
    session = google.auth.transport.requests.AuthorizedSession(credentials)
    adapter = requests.adapters.HTTPAdapter(
        pool_connections=_GCS_POOL_SIZE, pool_maxsize=_GCS_POOL_SIZE
    )
    session.mount("https://", adapter)
    return storage.Client(credentials=credentials, project=project, _http=session)


class Client:
    def __init__(self):
        self.now = datetime.now(warsaw_tz)
        try:
            self.storage_client = _make_gcs_client()
        except OSError as e:
            if "project" in str(e).lower():
                raise ConnectionAbortedError(
                    "Specify the project with 'gcloud config set project koryta-pl'"
                ) from e
            raise

    def download_from_gcs(self, blob_name: str, filename: str, binary: bool):
        """Downloads a blob from GCS to a local path.

        Written aside and renamed on success, as `stores.download` already does
        for the wiki dumps and for the same reason: a transfer interrupted
        part-way leaves a truncated file at the real path, and nothing looks at
        a cached file again once it is there - `FileSource.downloaded()` asks
        only whether the path exists. The truncation is then permanent, and
        silent, because half a JSON document raises a parse error somewhere
        else entirely.
        """
        bucket = self.storage_client.bucket(CRAWLED_BUCKET)
        blob = bucket.blob(blob_name)
        partial = f"{filename}.part"
        try:
            if not binary:
                # TODO try removing it and just using download_to_filename
                text = blob.download_as_text()
                with open(partial, "w") as out:
                    out.write(text)
            else:
                blob.download_to_filename(partial)
            os.replace(partial, filename)
            return filename
        except Exception as e:
            # Best effort: a leftover .part is inert, but it is still litter.
            with contextlib.suppress(OSError):
                os.remove(partial)
            print(f"Failed to download gs://{CRAWLED_BUCKET}/{blob_name}: {e}")
            raise

    def cached_storage(
        self, blob_name: str, binary: bool, size: int | None = None
    ) -> DownloadableFile:
        filename = blob_name.replace("/", ".")
        return DownloadableFile(
            f"gs://{CRAWLED_BUCKET}/{blob_name}",
            filename,
            download_lambda=lambda path: self.download_from_gcs(
                blob_name, path, binary
            ),
            binary=binary,
            size=size,
        )

    def list_blobs(self, ref: CloudStorage) -> Generator[DownloadableFile, None, None]:
        """Lists blobs in a GCS bucket with a given prefix."""
        bucket = self.storage_client.bucket(CRAWLED_BUCKET)
        prefix = ref.prefix
        glob = None

        if len(ref.max_namespaces) > 0:
            # Split blobs and extract max value for each namespace
            blobs = bucket.list_blobs(prefix=ref.prefix, delimiter="/")
            max_namespace_values: dict[str, str] = dict()
            for blob in blobs:
                parts = blob.name.split("/")
                for ns in parts:
                    if "=" in ns:
                        ns_name, ns_value = ns.split("=", 1)
                        if ns_name in ref.max_namespaces:
                            max_namespace_values[ns_name] = max(
                                max_namespace_values.get(ns_name, ""), ns_value
                            )

            if len(max_namespace_values) > 1:
                raise NotImplementedError(
                    "Need to implement ordering of the namespace elements"
                )

            glob = (
                "**"
                + "**".join(f"{k}={v}" for k, v in max_namespace_values.items())
                + "**"
            )

        if len(ref.namespace_values) > 0:
            glob = (
                "**"
                + "**".join(f"{k}={v}" for k, v in ref.namespace_values.items())
                + "**"
            )

        # Now list all blobs recursively under the chosen prefix
        print(f"Attempting bucket.list_blobs(prefix={prefix}, match_glob={glob})")
        blobs = bucket.list_blobs(prefix=prefix, match_glob=glob)
        for blob in blobs:
            # blob.size comes from the listing response, so carrying it here
            # costs no extra request and saves a caller a download each time
            # it needs to tell a failed crawl from a real one.
            yield self.cached_storage(blob.name, ref.binary, size=blob.size)

    def iterate_blobs(self, io: IO, ref: CloudStorage):
        """List blobs for a given hostname and yield their path and JSON data."""
        blobs = self.list_blobs(ref)
        for blob in tqdm(blobs):
            f = io.read_data(blob)
            content = f.read_bytes() if ref.binary else f.read_string()
            if not content:
                print(f"  [ERROR] Could not download {blob}")
                continue
            yield blob.url, content

    def upload(
        self,
        source: NormalizedParse | str,
        data,
        content_type,
        include_query=False,
        verbose=True,
    ):
        if isinstance(source, str):
            source = NormalizedParse.parse(source)
        try:
            now = datetime.now(warsaw_tz)
            path = source.path if source.path else "index"
            if include_query:
                for k, v in sorted(source.query.items(), key=lambda item: item[0]):
                    # We split the keys, so they create folders as well
                    path += f"/?{k}={v}"
            date = f"{now.strftime('%Y')}-{now.strftime('%m')}-{now.strftime('%d')}"
            destination_blob_name = f"hostname={source.hostname}/{path}/date={date}"
            destination_blob_name = destination_blob_name.replace("//", "/")
            destination_blob_name = destination_blob_name.rstrip("/")
            bucket = self.storage_client.bucket(CRAWLED_BUCKET)
            blob = bucket.blob(destination_blob_name)
            try:
                # if_generation_match=0: only upload if the object doesn't exist yet.
                # Raises PreconditionFailed (412) if it does — treat that as success
                # since the bytes are already there from a previous run that crashed
                # before mark_done was written to the DB.
                blob.upload_from_string(
                    data,
                    content_type=f"{content_type}; charset=utf-8",
                    if_generation_match=0,
                )
            except gcs_exceptions.PreconditionFailed:
                pass  # already uploaded, nothing to do

            full_path = f"gs://{CRAWLED_BUCKET}/{destination_blob_name}"
            file_path = f"{CRAWLED_BUCKET}/{destination_blob_name}"
            if verbose:
                print(
                    f"Successfully uploaded data to: {full_path}. Go to https://console.cloud.google.com/storage/browser/_details/{file_path}"
                )

        except Exception as e:
            print(f"An error occurred: {e}")
            return None

    def batch_upload(
        self,
        source: NormalizedParse | str,
        data,
        content_type,
        include_query=False,
        verbose=True,
    ) -> str:
        raise NotImplementedError("Use BatchClient instead")

    def list_namespaces(self, ref: CloudStorage, namespace: str) -> list[str]:
        """Lists available values for a given namespace (e.g. 'date')."""
        bucket = self.storage_client.bucket(CRAWLED_BUCKET)
        # We assume the structure is prefix/ns=val/...
        # We list with delimiter to get folders (prefixes)
        # The prefix should be ref.prefix + "/" if not empty
        prefix = ref.prefix
        if prefix and not prefix.endswith("/"):
            prefix += "/"

        blobs = bucket.list_blobs(prefix=prefix, delimiter="/")
        # Trigger iteration to populate prefixes
        for _ in blobs:
            pass

        values = set()
        for p in blobs.prefixes:
            parts = p.rstrip("/").split("/")
            last_part = parts[-1]
            if "=" in last_part:
                k, v = last_part.split("=", 1)
                if k == namespace:
                    values.add(v)

        return sorted(list(values))

    def upload_backup(
        self,
        filename: str,
        content: str | typing.Callable[[io.BufferedWriter], None],
    ):
        """Uploads a versioned backup as a tar.gz archive to GCS.

        Creates an archive containing the data file and an empty metadata.json,
        then uploads it to the backup bucket under a path partitioned by
        filename, user, and datetime.
        """

        user = get_username()
        dt_str = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")

        blob_name = f"filename={filename}/user={user}/datetime={dt_str}/backup.tar.gz"

        bucket = self.storage_client.bucket(SHARED_BUCKET)
        blob = bucket.blob(blob_name)

        tar_buf = io.BytesIO()
        with tarfile.open(fileobj=tar_buf, mode="w:gz") as tar:
            df_bytes = io.BytesIO()
            if isinstance(content, str):
                df_bytes.write(content.encode("utf-8"))
            else:
                content(df_bytes)  # type: ignore
            df_bytes.seek(0)

            info = tarfile.TarInfo(name=filename)
            info.size = len(df_bytes.getvalue())
            tar.addfile(info, df_bytes)

            meta_info = tarfile.TarInfo(name="metadata.json")
            meta_info.size = 0
            tar.addfile(meta_info, io.BytesIO(b""))

        tar_buf.seek(0)
        blob.upload_from_file(tar_buf, content_type="application/gzip")
        print(f"Successfully uploaded backup to gs://{SHARED_BUCKET}/{blob_name}")

    def upload_backup_from_path(self, filename: str, src_path: str) -> None:
        """Uploads a local file as a versioned backup tar.gz to GCS.

        Like upload_backup, but streams the source file from disk into the
        archive instead of buffering it in memory -- for multi-GB outputs like
        article_parsed. Same blob layout:
        ``filename={filename}/user={user}/datetime={dt}/backup.tar.gz``.
        """
        user = get_username()
        dt_str = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")

        blob_name = f"filename={filename}/user={user}/datetime={dt_str}/backup.tar.gz"

        bucket = self.storage_client.bucket(SHARED_BUCKET)
        blob = bucket.blob(blob_name)

        tmp_path = src_path + ".bak"
        try:
            with tarfile.open(tmp_path, mode="w:gz") as tar:
                info = tarfile.TarInfo(name=filename)
                info.size = os.path.getsize(src_path)
                with open(src_path, "rb") as f:
                    tar.addfile(info, f)
                meta_info = tarfile.TarInfo(name="metadata.json")
                meta_info.size = 0
                tar.addfile(meta_info, io.BytesIO(b""))

            with open(tmp_path, "rb") as f:
                blob.upload_from_file(f, content_type="application/gzip")
        finally:
            os.unlink(tmp_path)
        print(f"Successfully uploaded backup to gs://{SHARED_BUCKET}/{blob_name}")

    def _latest_backup_blob(self, filename: str):
        """The most recent versioned backup blob for a filename.

        Prefers backups from the current user. If none exist for the current
        user, lists available users and prompts for a choice. Raises
        FileNotFoundError when no backups exist at all.
        """
        prefix = f"filename={filename}/"
        bucket = self.storage_client.bucket(SHARED_BUCKET)
        blobs = list(bucket.list_blobs(prefix=prefix))

        if not blobs:
            raise FileNotFoundError(
                f"No versioned backups found for '{filename}' "
                f"in gs://{SHARED_BUCKET}/{prefix}"
            )

        # Group blobs by user
        user_blobs: dict[str, list] = {}
        for blob in blobs:
            parts = blob.name.split("/")
            user = None
            for part in parts:
                if part.startswith("user="):
                    user = part.removeprefix("user=")
                    break
            if user:
                user_blobs.setdefault(user, []).append(blob)

        current_user = get_username()
        chosen_user = pick_user(current_user, list(user_blobs.keys()))

        # Pick the latest backup (sorted by datetime in the blob name)
        chosen_blobs = sorted(user_blobs[chosen_user], key=lambda b: b.name)
        return chosen_blobs[-1]

    def download_backup(self, filename: str) -> io.BytesIO:
        """Downloads the latest versioned backup for a filename from GCS.

        Prefers backups from the current user. If none exist for the current
        user, lists available users and prompts for a choice.

        Returns a BytesIO of the extracted data file from the tar.gz archive.
        """
        latest_blob = self._latest_backup_blob(filename)
        print(f"Downloading backup from gs://{SHARED_BUCKET}/{latest_blob.name}")
        tar_buf = io.BytesIO(latest_blob.download_as_bytes())
        tar_buf.seek(0)

        with tarfile.open(fileobj=tar_buf, mode="r:gz") as tar:
            for member in tar.getmembers():
                if member.name != "metadata.json":
                    extracted = tar.extractfile(member)
                    if extracted is not None:
                        return io.BytesIO(extracted.read())

        raise FileNotFoundError(
            f"Backup archive at '{latest_blob.name}' contains no data file."
        )

    def restore_backup_to_path(self, filename: str, dest_path: str) -> None:
        """Streams the latest versioned backup for a filename to a local path.

        Unlike download_backup, the tar.gz and its payload are streamed to disk
        instead of buffered in memory -- the whole point of a local restore for
        multi-GB outputs like article_parsed.

        Writes to ``dest_path`` (atomically via a temp sibling) and leaves the
        archive blob untouched.
        """
        latest_blob = self._latest_backup_blob(filename)
        print(f"Downloading backup from gs://{SHARED_BUCKET}/{latest_blob.name}")

        tmp_path = dest_path + ".bak"
        with open(tmp_path, "wb") as f:
            latest_blob.download_to_file(f)
        try:
            with tarfile.open(tmp_path, mode="r:gz") as tar:
                for member in tar.getmembers():
                    if member.name != "metadata.json":
                        src = tar.extractfile(member)
                        if src is None:
                            continue
                        with open(dest_path, "wb") as out:
                            shutil.copyfileobj(src, out)
                        return
            raise FileNotFoundError(
                f"Backup archive at '{latest_blob.name}' contains no data file."
            )
        finally:
            os.unlink(tmp_path)


class BatchClient(Client):
    @cached_property
    def args(self):
        parser = argparse.ArgumentParser()
        parser.add_argument(
            "--max_batch_size",
            help="Size of the data to be cached until it's uploaded",
            default=50 * 1024 * 1024,
            required=False,
        )
        parser.add_argument(
            "--batch_idle_timeout",
            type=float,
            default=3600.0,
            help="Flush a domain batch if idle for this many seconds (default: 600).",
        )
        parser.add_argument(
            "--flush_max_workers",
            type=int,
            default=16,
            help="Max concurrent uploads when flushing batches in parallel.",
        )
        args, _ = parser.parse_known_args()
        return args

    def __init__(self):
        super().__init__()
        self._batch_locks = defaultdict(threading.Lock)
        self._batches = {}
        self._global_lock = threading.Lock()
        atexit.register(self.flush_all)
        self._start_idle_flusher()

    def _start_idle_flusher(self) -> None:
        def _loop() -> None:
            while True:
                time.sleep(30)
                self._flush_idle()

        t = threading.Thread(target=_loop, daemon=True, name="batch-idle-flusher")
        t.start()

    def _flush_idle(self) -> None:
        timeout = self.args.batch_idle_timeout
        now = time.monotonic()
        with self._global_lock:
            keys = list(self._batches.keys())
        for key in keys:
            lock = self._batch_locks[key]
            with lock:
                batch = self._batches.get(key)
                if batch is None:
                    continue
                if now - batch["last_updated"] >= timeout:
                    print(f"Flushing idle batch for {key[0]} (idle >{timeout:.0f}s)")
                    self._flush_batch(key, batch)
                    del self._batches[key]

    def batch_upload(
        self,
        source: NormalizedParse | str,
        data,
        content_type,
        include_query=False,
        verbose=True,
    ) -> str:
        if isinstance(source, str):
            source = NormalizedParse.parse(source)

        hostname = source.hostname
        date = datetime.now(warsaw_tz).strftime("%Y-%m-%d")
        key = (hostname, date)

        with self._global_lock:
            lock = self._batch_locks[key]

        with lock:
            if key not in self._batches:
                uid = uuid7str()
                buf = io.BytesIO()
                tar = tarfile.open(fileobj=buf, mode="w:gz")
                self._batches[key] = {
                    "uid": uid,
                    "buffer": buf,
                    "tar": tar,
                    "uncompressed_size": 0,
                    "index": [],
                    "last_updated": time.monotonic(),
                }

            batch = self._batches[key]

            path = source.path if source.path else "index"
            if include_query:
                for k, v in sorted(source.query.items(), key=lambda item: item[0]):
                    path += f"/?{k}={v}"

            rel_path = f"{source.hostname}/{path}".replace("//", "/").rstrip("/")

            if isinstance(data, str):
                data = data.encode("utf-8")

            info = tarfile.TarInfo(name=rel_path)
            info.size = len(data)
            info.mtime = int(datetime.now(warsaw_tz).timestamp())

            batch["tar"].addfile(info, io.BytesIO(data))
            batch["index"].append(rel_path)
            batch["uncompressed_size"] += len(data)
            batch["last_updated"] = time.monotonic()

            if batch["uncompressed_size"] >= self.args.max_batch_size:
                self._flush_batch(key, batch)
                del self._batches[key]

            return f"gs://{CRAWLED_BUCKET}/hostname={hostname}/date={date}/uid_{batch['uid']}.tar.gz"

    def _flush_batch(self, key, batch):
        index_data = ("\n".join(batch["index"]) + "\n").encode("utf-8")
        idx_info = tarfile.TarInfo(name="index.txt")
        idx_info.size = len(index_data)
        idx_info.mtime = int(datetime.now(warsaw_tz).timestamp())
        batch["tar"].addfile(idx_info, io.BytesIO(index_data))

        batch["tar"].close()
        compressed_data = batch["buffer"].getvalue()

        hostname, date = key
        uid = batch["uid"]

        destination_blob_name = f"hostname={hostname}/date={date}/uid_{uid}.tar.gz"
        bucket = self.storage_client.bucket(CRAWLED_BUCKET)
        blob = bucket.blob(destination_blob_name)

        try:
            blob.upload_from_string(compressed_data, content_type="application/gzip")
            full_path = f"gs://{CRAWLED_BUCKET}/{destination_blob_name}"
            print(f"Successfully uploaded batch to: {full_path}")
        except Exception as e:
            print(
                f"An error occurred when batch_upload to {destination_blob_name}: {e}"
            )

    def flush_all(self):
        with self._global_lock:
            keys = list(self._batches.keys())

        to_flush = []
        for key in keys:
            lock = self._batch_locks[key]
            with lock:
                if key in self._batches:
                    to_flush.append((key, self._batches.pop(key)))

        if not to_flush:
            return

        max_workers = self.args.flush_max_workers
        print(f"Flushing {len(to_flush)} batches in parallel (max {max_workers})...")
        sem = threading.Semaphore(max_workers)

        def _flush_with_sem(key, batch):
            with sem:
                self._flush_batch(key, batch)

        threads = [
            threading.Thread(target=_flush_with_sem, args=(key, batch), daemon=False)
            for key, batch in to_flush
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
