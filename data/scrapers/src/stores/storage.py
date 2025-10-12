import os
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from typing import Generator

from tqdm import tqdm
from google.cloud import storage

from util.url import NormalizedParse
from util.config import DOWNLOADED_DIR


base_dir = Path(DOWNLOADED_DIR)

BUCKET = "koryta-pl-crawled"

warsaw_tz = ZoneInfo("Europe/Warsaw")
now = datetime.now(warsaw_tz)

storage_client = storage.Client()


def iterate_blobs(hostname):
    """List blobs for a given hostname and yield their path and JSON data."""
    blobs = list_blobs(hostname)
    for blob_name in tqdm(blobs):
        content = download_from_gcs(blob_name)
        if not content:
            print(f"  [ERROR] Could not download {blob_name}")
            continue
        yield blob_name, content


# TODO why are we discarding query params
def upload_to_gcs(
    source: NormalizedParse | str,
    data,
    content_type,
):
    if isinstance(source, str):
        source = NormalizedParse.parse(source)
    try:
        now = datetime.now(warsaw_tz)
        if source.path == "":
            source.path = "index"
        destination_blob_name = (
            f"hostname={source.hostname}/"
            f"date={now.strftime('%Y')}-{now.strftime('%m')}-{now.strftime('%d')}/"
            f"{source.path}"
        )
        destination_blob_name = destination_blob_name.replace("//", "/")
        destination_blob_name = destination_blob_name.rstrip("/")
        bucket = storage_client.bucket(BUCKET)
        blob = bucket.blob(destination_blob_name)
        # Upload the string data
        blob.upload_from_string(data, content_type=f"{content_type}; charset=utf-8")

        full_path = f"gs://{BUCKET}/{destination_blob_name}"
        print(f"Successfully uploaded data to: {full_path}")

    except Exception as e:
        print(f"An error occurred: {e}")
        return None


def list_blobs(hostname) -> Generator[str]:
    """Lists blobs in a GCS bucket with a given prefix."""
    bucket = storage_client.bucket(BUCKET)
    blobs = bucket.list_blobs(prefix=f"hostname={hostname}/")
    for blob in blobs:
        yield blob.name


class CachedStorage:
    blob_name: str

    def __init__(self, blob_name: str) -> None:
        self.blob_name = blob_name

    @property
    def filename(self) -> str:
        return self.blob_name.replace("/", ".")

    @property
    def downloaded_path(self) -> Path:
        return base_dir / self.filename

    def downloaded(self) -> bool:
        return os.path.exists(base_dir / self.filename)


def download_from_gcs(blob_name: str) -> str | None:
    """Downloads a blob from GCS as a string."""
    cached = CachedStorage(blob_name)
    if cached.downloaded():
        return open(cached.downloaded_path).read()

    bucket = storage_client.bucket(BUCKET)
    blob = bucket.blob(blob_name)
    try:
        text = blob.download_as_text()
        open(cached.downloaded_path, "w").write(text)
        return text
    except Exception as e:
        print(f"Failed to download gs://{BUCKET}/{blob_name}: {e}")
        return None
