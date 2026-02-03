from datetime import datetime
from typing import Generator
from zoneinfo import ZoneInfo

from google.cloud import storage
from tqdm import tqdm

from entities.util import NormalizedParse
from scrapers.stores import IO, CloudStorage, DownloadableFile

BUCKET = "koryta-pl-crawled"
warsaw_tz = ZoneInfo("Europe/Warsaw")


class Client:
    def __init__(self):
        self.now = datetime.now(warsaw_tz)
        self.storage_client = storage.Client()

    def download_from_gcs(self, blob_name: str, filename: str, binary: bool):
        """Downloads a blob from GCS as a string."""
        bucket = self.storage_client.bucket(BUCKET)
        blob = bucket.blob(blob_name)
        try:
            if not binary:
                # TODO try removing it and just using download_to_filename
                text = blob.download_as_text()
                open(filename, "w").write(text)
            else:
                blob.download_to_filename(filename)
            return filename
        except Exception as e:
            print(f"Failed to download gs://{BUCKET}/{blob_name}: {e}")
            raise

    def cached_storage(self, blob_name: str, binary: bool) -> DownloadableFile:
        filename = blob_name.replace("/", ".")
        return DownloadableFile(
            f"gs://{BUCKET}/{blob_name}",
            filename,
            download_lambda=lambda path: self.download_from_gcs(
                blob_name, path, binary
            ),
            binary=binary,
        )

    def list_blobs(self, ref: CloudStorage) -> Generator[DownloadableFile, None, None]:
        """Lists blobs in a GCS bucket with a given prefix."""
        bucket = self.storage_client.bucket(BUCKET)
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
            yield self.cached_storage(blob.name, ref.binary)

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
    ):
        if isinstance(source, str):
            source = NormalizedParse.parse(source)
        try:
            now = datetime.now(warsaw_tz)
            if source.path == "":
                source.path = "index"  # type: ignore
            date = f"{now.strftime('%Y')}-{now.strftime('%m')}-{now.strftime('%d')}"
            destination_blob_name = (
                f"hostname={source.hostname}/{source.path}/date={date}"
            )
            destination_blob_name = destination_blob_name.replace("//", "/")
            destination_blob_name = destination_blob_name.rstrip("/")
            bucket = self.storage_client.bucket(BUCKET)
            blob = bucket.blob(destination_blob_name)
            # Upload the string data
            blob.upload_from_string(data, content_type=f"{content_type}; charset=utf-8")

            full_path = f"gs://{BUCKET}/{destination_blob_name}"
            print(f"Successfully uploaded data to: {full_path}")
            return full_path

        except Exception as e:
            print(f"An error occurred: {e}")
            return None

    def list_namespaces(self, ref: CloudStorage, namespace: str) -> list[str]:
        """Lists available values for a given namespace (e.g. 'date')."""
        bucket = self.storage_client.bucket(BUCKET)
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
