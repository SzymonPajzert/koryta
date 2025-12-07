from datetime import datetime
from typing import Generator
from zoneinfo import ZoneInfo

from google.cloud import storage
from tqdm import tqdm

from entities.util import NormalizedParse
from scrapers.stores import IO, DownloadableFile

BUCKET = "koryta-pl-crawled"
warsaw_tz = ZoneInfo("Europe/Warsaw")


class Client:
    def __init__(self):
        self.now = datetime.now(warsaw_tz)
        self.storage_client = storage.Client()

    def download_from_gcs(self, blob_name: str, filename: str):
        """Downloads a blob from GCS as a string."""
        bucket = self.storage_client.bucket(BUCKET)
        blob = bucket.blob(blob_name)
        try:
            text = blob.download_as_text()
            open(filename, "w").write(text)
        except Exception as e:
            print(f"Failed to download gs://{BUCKET}/{blob_name}: {e}")
            raise

    def cached_storage(self, blob_name: str) -> DownloadableFile:
        filename = blob_name.replace("/", ".")
        return DownloadableFile(
            f"gs://{BUCKET}/{blob_name}",
            filename,
            download_lambda=lambda: self.download_from_gcs(blob_name, filename),
        )

    def list_blobs(self, hostname) -> Generator[DownloadableFile]:
        """Lists blobs in a GCS bucket with a given prefix."""
        bucket = self.storage_client.bucket(BUCKET)
        blobs = bucket.list_blobs(prefix=f"hostname={hostname}/")
        for blob in blobs:
            yield self.cached_storage(blob.name)

    def iterate_blobs(self, io: IO, hostname: str):
        """List blobs for a given hostname and yield their path and JSON data."""
        blobs = self.list_blobs(hostname)
        for blob in tqdm(blobs):
            content = io.read_data(blob).read_content()
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
            destination_blob_name = (
                f"hostname={source.hostname}/"
                f"{source.path}/"
                f"date={now.strftime('%Y')}-{now.strftime('%m')}-{now.strftime('%d')}"
            )
            destination_blob_name = destination_blob_name.replace("//", "/")
            destination_blob_name = destination_blob_name.rstrip("/")
            bucket = self.storage_client.bucket(BUCKET)
            blob = bucket.blob(destination_blob_name)
            # Upload the string data
            blob.upload_from_string(data, content_type=f"{content_type}; charset=utf-8")

            full_path = f"gs://{BUCKET}/{destination_blob_name}"
            print(f"Successfully uploaded data to: {full_path}")

        except Exception as e:
            print(f"An error occurred: {e}")
            return None
