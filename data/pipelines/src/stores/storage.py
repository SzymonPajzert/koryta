import argparse
import atexit
import base64
import contextlib
import hashlib
import io
import json
import os
import shutil
import tarfile
import threading
import time
import typing
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
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
from stores import config
from stores.user import get_username, interactive, pick_user

CRAWLED_BUCKET = "koryta-pl-crawled"
SHARED_BUCKET = "koryta-pl-sharedcache"
warsaw_tz = ZoneInfo("Europe/Warsaw")

#: Guards `Client._listings`: the free scrape uploads from a pool of threads.
_listings_lock = threading.Lock()

#: The only two fields a listing is read for.
LISTING_FIELDS = "items(name,size),nextPageToken"


def _backup_datetime(blob) -> str:
    """The `datetime=` segment of a backup's name; ISO, so it sorts by time."""
    for part in blob.name.split("/"):
        if part.startswith("datetime="):
            return part.removeprefix("datetime=")
    return ""


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

    def download_from_gcs(
        self, blob_name: str, filename: str, binary: bool, bucket: str | None = None
    ):
        """Downloads a blob from GCS to a local path.

        Written aside and renamed on success, as `stores.download` already does
        for the wiki dumps and for the same reason: a transfer interrupted
        part-way leaves a truncated file at the real path, and nothing looks at
        a cached file again once it is there - `FileSource.downloaded()` asks
        only whether the path exists. The truncation is then permanent, and
        silent, because half a JSON document raises a parse error somewhere
        else entirely.
        """
        # TODO remove the default and always set it in the caller
        # Alternatively, make it receive an object configuring the read.
        bucket_name = bucket or CRAWLED_BUCKET
        blob = self.storage_client.bucket(bucket_name).blob(blob_name)
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
            print(f"Failed to download gs://{bucket_name}/{blob_name}: {e}")
            raise

    def cached_storage(
        self,
        blob_name: str,
        binary: bool,
        size: int | None = None,
        bucket: str | None = None,
    ) -> DownloadableFile:
        filename = blob_name.replace("/", ".")
        if bucket and bucket != CRAWLED_BUCKET:
            # The local cache is one flat directory keyed by object name, and
            # two buckets may hold the same name.
            filename = f"bucket={bucket}.{filename}"
        return DownloadableFile(
            f"gs://{bucket or CRAWLED_BUCKET}/{blob_name}",
            filename,
            download_lambda=lambda path: self.download_from_gcs(
                blob_name, path, binary, bucket
            ),
            binary=binary,
            size=size,
        )

    def _listing_glob(self, bucket, ref: CloudStorage) -> str | None:
        """The match_glob a listing of `ref` filters by, if any."""
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
        return glob

    def list_blobs(self, ref: CloudStorage) -> Generator[DownloadableFile, None, None]:
        """Lists blobs in a GCS bucket with a given prefix."""
        bucket = self.storage_client.bucket(ref.bucket or CRAWLED_BUCKET)
        prefix = ref.prefix
        glob = self._listing_glob(bucket, ref)

        key = (ref.bucket or CRAWLED_BUCKET, prefix, glob)
        listed = self._listing(key)
        if listed is not None:
            print(f"Listed {prefix} {time.monotonic() - listed[0]:.0f} s ago; reusing")
            for name, size in listed[1]:
                yield self.cached_storage(
                    name, ref.binary, size=size, bucket=ref.bucket
                )
            return

        started = time.monotonic()
        seen: list[tuple[str, int | None]] | None = []
        bounds = self._range_bounds(key) if glob is None else None
        if bounds:
            print(f"Listing {prefix} as {len(bounds) + 1} ranges at once")
            seen = self._list_ranges(bucket, prefix, bounds)
            for name, size in seen:
                yield self.cached_storage(
                    name, ref.binary, size=size, bucket=ref.bucket
                )
        else:
            # Now list all blobs recursively under the chosen prefix
            print(f"Attempting bucket.list_blobs(prefix={prefix}, match_glob={glob})")
            # Only the two fields read below. Unmasked, every item carries the
            # object's whole metadata: 83 s against 55 s for the 32k api-krs
            # objects, and listings egressed 2.7x what reads did in the 30 days
            # to 2026-09-11.
            blobs = bucket.list_blobs(
                prefix=prefix,
                match_glob=glob,
                fields=LISTING_FIELDS,
            )
            for blob in blobs:
                if seen is not None:
                    seen.append((blob.name, blob.size))
                    if len(seen) > self.LISTING_KEPT_AT_MOST:
                        seen = None
                # blob.size comes from the listing response, so carrying it here
                # costs no extra request and saves a caller a download each time
                # it needs to tell a failed crawl from a real one.
                yield self.cached_storage(
                    blob.name, ref.binary, size=blob.size, bucket=ref.bucket
                )
        # Kept only once the caller has read it to the end: a listing it
        # stopped part way through is not the whole prefix.
        if seen is not None and len(seen) <= self.LISTING_KEPT_AT_MOST:
            with _listings_lock:
                self._listings()[key] = (started, seen)
            if glob is None:
                self._keep_range_bounds(key, seen)

    #: Ranges a big prefix is listed in at once. Listing is all waiting: GCS
    #: takes ~1.3 s to answer each page of 1,000 names, so the 43k api-krs
    #: objects took 65 s in turn on 2026-10-02, and 6.4 s as sixteen ranges.
    LISTING_RANGES = 16

    #: A prefix is split only from this many objects; below it, one listing of
    #: a few pages is about as quick.
    LISTING_SPLIT_FROM = 16_000

    def _ranges_file(self, key) -> str:
        bucket, prefix, _ = key
        digest = hashlib.sha1(f"{bucket}/{prefix}".encode()).hexdigest()[:16]
        return os.path.join(config.DOWNLOADED_DIR, ".listing-ranges", f"{digest}.json")

    def _range_bounds(self, key) -> list[str] | None:
        """Where the last listing of this prefix split into equal ranges.

        Any boundaries cover the prefix whole - the ranges run from one to the
        next and the first and last are open - so stale ones only list
        unevenly. A prefix never listed here, as on a fresh container, has
        none, and is listed in one go.
        """
        try:
            with open(self._ranges_file(key), encoding="utf-8") as f:
                kept = json.load(f)
        except (OSError, ValueError):
            return None
        bounds = kept.get("bounds") if isinstance(kept, dict) else None
        if kept.get("prefix") != key[1] or not isinstance(bounds, list):
            return None
        if not all(isinstance(b, str) for b in bounds) or bounds != sorted(set(bounds)):
            return None
        return bounds or None

    def seed_listing_ranges(
        self, ref: CloudStorage, names: typing.Iterable[str]
    ) -> None:
        """Split the next listing of `ref` by names known another way.

        For a prefix this machine has never listed - every prefix, on a fresh
        container - when the compressed mirror has just named most of what is
        under it. A prefix already split is left as its own last listing left it.
        """
        if ref.max_namespaces or ref.namespace_values:
            return  # a filtered listing is never split
        key = (ref.bucket or CRAWLED_BUCKET, ref.prefix, None)
        if self._range_bounds(key) is not None:
            return
        self._keep_range_bounds(
            key, [(name, None) for name in sorted(names) if name.startswith(ref.prefix)]
        )

    def _keep_range_bounds(self, key, listed: list[tuple[str, int | None]]) -> None:
        if len(listed) < self.LISTING_SPLIT_FROM:
            return
        n = self.LISTING_RANGES
        bounds = sorted({listed[len(listed) * i // n][0] for i in range(1, n)})
        path = self._ranges_file(key)
        part = f"{path}.part"
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(part, "w", encoding="utf-8") as f:
                json.dump({"bucket": key[0], "prefix": key[1], "bounds": bounds}, f)
            os.replace(part, path)
        except OSError as e:
            print(f"Could not keep the listing ranges of {key[1]}: {e}")

    def _list_ranges(
        self, bucket, prefix: str, bounds: list[str]
    ) -> list[tuple[str, int | None]]:
        """The prefix's names and sizes in listing order, its ranges listed at once."""
        edges: list[str | None] = [None, *bounds, None]
        # Asked first by sixteen threads at once, a missing token was fetched
        # sixteen times, and urllib3 warned of a full pool seven times a run.
        self._fresh_token()

        def one(i: int) -> list[tuple[str, int | None]]:
            blobs = bucket.list_blobs(
                prefix=prefix,
                start_offset=edges[i],
                end_offset=edges[i + 1],
                fields=LISTING_FIELDS,
            )
            return [(blob.name, blob.size) for blob in blobs]

        with ThreadPoolExecutor(len(edges) - 1) as pool:
            parts = list(pool.map(one, range(len(edges) - 1)))
        return [item for part in parts for item in part]

    def _fresh_token(self) -> None:
        """An access token now, rather than one per thread a moment later."""
        credentials = getattr(self.storage_client, "_credentials", None)
        if credentials is not None and not credentials.valid:
            credentials.refresh(google.auth.transport.requests.Request())

    #: How long a listing is reused. While a run builds its tree it lists the
    #: same prefixes again and again within minutes - rejestr.io and api-krs
    #: three times each, 205 of the free scrape's 314 s of listing on
    #: 2026-10-02. What this run writes it forgets at once (`_forget_listings`);
    #: what other machines write in the meantime waits for the next listing.
    LISTING_REUSED_FOR = 30 * 60

    #: Listings longer than this are not kept: a crawl prefix of millions of
    #: pages would hold its names in memory for little gain.
    LISTING_KEPT_AT_MOST = 500_000

    def _listings(self) -> dict:
        # Not set in __init__: tests build a Client without calling it.
        return self.__dict__.setdefault("_listing_memo", {})

    def _listing(self, key) -> tuple[float, list[tuple[str, int | None]]] | None:
        with _listings_lock:
            listed = self._listings().get(key)
            if listed and time.monotonic() - listed[0] > self.LISTING_REUSED_FOR:
                del self._listings()[key]
                listed = None
        return listed

    def _forget_listings(self, bucket: str, blob_name: str) -> None:
        """Drop every kept listing a new object under this name belongs in."""
        with _listings_lock:
            for key in [k for k in self._listings() if k[0] == bucket]:
                if blob_name.startswith(key[1]):
                    del self._listings()[key]

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
    ) -> bool:
        """Store a crawl under today's Warsaw date; False when it could not.

        Prints the error and carries on rather than raising, which the crawler
        relies on. Callers that have to count failures read the result.
        """
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
                self._forget_listings(CRAWLED_BUCKET, destination_blob_name)
                self.remember(destination_blob_name, data)
            except gcs_exceptions.PreconditionFailed:
                pass  # already uploaded, nothing to do

            full_path = f"gs://{CRAWLED_BUCKET}/{destination_blob_name}"
            file_path = f"{CRAWLED_BUCKET}/{destination_blob_name}"
            if verbose:
                print(
                    f"Successfully uploaded data to: {full_path}. Go to https://console.cloud.google.com/storage/browser/_details/{file_path}"
                )
            return True

        except Exception as e:
            print(f"An error occurred: {e}")
            return False

    def batch_upload(
        self,
        source: NormalizedParse | str,
        data,
        content_type,
        include_query=False,
        verbose=True,
    ) -> str:
        raise NotImplementedError("Use BatchClient instead")

    def create_object(
        self, bucket: str, blob_name: str, data: bytes, content_type: str
    ) -> str:
        """Writes an object that must not exist yet, and raises if it cannot.

        Unlike `upload`, which prints and carries on, and which takes an
        existing object for success: a job writing its state has to know
        that the write landed, and a name it reuses is a bug, not a retry.
        Create-only, so a service account without delete can do it.

        One 412 is not a reused name: the library retries a request whose
        response was lost, and the retry of a create that did land is refused.
        The same bytes already under the name are that write.
        """
        blob = self.storage_client.bucket(bucket).blob(blob_name)
        try:
            blob.upload_from_string(
                data, content_type=content_type, if_generation_match=0
            )
        except gcs_exceptions.PreconditionFailed:
            blob.reload()
            if blob.md5_hash != base64.b64encode(hashlib.md5(data).digest()).decode():
                raise
        # The same bytes are under the name either way.
        self._forget_listings(bucket, blob_name)
        self.remember(blob_name, data, bucket=bucket)
        return f"gs://{bucket}/{blob_name}"

    def remember(
        self, blob_name: str, data: str | bytes, bucket: str | None = None
    ) -> None:
        """Put what was just uploaded where reading it back would download it to.

        Runs read what earlier runs wrote - CompaniesKRS every api-krs answer,
        the odpis pipelines every PDF - and an upload left the cache without
        it, so the next run on the same machine fetched each one back: 540
        objects at 8 a second on 2026-10-02, the answers stored by the run just
        before. Best effort: a cache that cannot take it only means a slower
        read later.
        """
        ref = self.cached_storage(blob_name, binary=True, bucket=bucket)
        path = os.path.join(config.DOWNLOADED_DIR, ref.filename)
        if os.path.exists(path):
            return
        part = f"{path}.part"
        try:
            with open(part, "wb") as out:
                out.write(data.encode("utf-8") if isinstance(data, str) else data)
            os.replace(part, path)
        except OSError as e:
            print(f"Could not keep {blob_name} in the local cache: {e}")
            with contextlib.suppress(OSError):
                os.remove(part)

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
        user, lists available users and prompts for a choice - or, with nobody
        at a terminal to choose, takes the newest backup whoever wrote it.
        Raises FileNotFoundError when no backups exist at all.
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
        if current_user not in user_blobs and not interactive():
            # A scheduled run under its own name has no backups of what it
            # never builds itself, and nobody to ask whose to take.
            newest = max(
                (blob for named in user_blobs.values() for blob in named),
                key=_backup_datetime,
            )
            print(f"No backup of {filename} by {current_user}; taking the newest")
            return newest
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

        # A pipeline restored before it ever ran here has no directory yet.
        os.makedirs(os.path.dirname(dest_path) or ".", exist_ok=True)
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
                        # Renamed into place: a restore cut short must not
                        # leave a short file that the next run reads as done.
                        part_path = dest_path + ".part"
                        with open(part_path, "wb") as out:
                            shutil.copyfileobj(src, out)
                        os.replace(part_path, dest_path)
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
