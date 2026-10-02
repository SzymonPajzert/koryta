"""What a run uploads is in the local cache when the next run reads it."""

import json

import pytest
from google.api_core import exceptions as gcs_exceptions

from scrapers.stores.file import DownloadableFile
from stores import config, download
from stores.storage import CRAWLED_BUCKET, SHARED_BUCKET, Client

ANSWER = json.dumps({"odpis": {"naglowekA": {"numerKRS": "0000394808"}}})


class Blob:
    def __init__(self, bucket: "Bucket", name: str):
        self.bucket, self.name = bucket, name

    def upload_from_string(self, data, content_type=None, if_generation_match=None):
        if self.name in self.bucket.objects:
            raise gcs_exceptions.PreconditionFailed("exists")
        self.bucket.objects[self.name] = data


class Bucket:
    def __init__(self):
        self.objects: dict[str, str | bytes] = {}

    def blob(self, name: str) -> Blob:
        return Blob(self, name)


class GCS:
    def __init__(self):
        self.buckets: dict[str, Bucket] = {}

    def bucket(self, name: str) -> Bucket:
        return self.buckets.setdefault(name, Bucket())


@pytest.fixture
def client(tmp_path, monkeypatch) -> Client:
    monkeypatch.setattr(config, "DOWNLOADED_DIR", str(tmp_path))
    monkeypatch.setattr(download, "base_dir", tmp_path)
    c = Client.__new__(Client)
    c.storage_client = GCS()  # type: ignore[assignment]
    return c


def the_cached_copy(client: Client, blob_name: str, bucket: str | None = None):
    """What a read of the object would find in the cache, without downloading."""
    ref: DownloadableFile = client.cached_storage(blob_name, binary=True, bucket=bucket)
    source = download.FileSource(ref)
    return source.downloaded_path.read_bytes() if source.downloaded() else None


def test_an_uploaded_answer_is_read_back_from_the_cache(client):
    url = "https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000394808?rejestr=P"

    assert client.upload(url, ANSWER, "application/json", include_query=True)

    [name] = client.storage_client.bucket(CRAWLED_BUCKET).objects
    assert the_cached_copy(client, name) == ANSWER.encode()


def test_an_object_already_there_is_not_cached_from_the_upload(client):
    """The bucket keeps the first answer of the day; this one was refused."""
    url = "https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000394808?rejestr=P"
    client.upload(url, ANSWER, "application/json", include_query=True)
    [name] = client.storage_client.bucket(CRAWLED_BUCKET).objects
    client.storage_client.bucket(CRAWLED_BUCKET).objects[name] = "first"
    cached = download.base_dir / name.replace("/", ".")
    cached.unlink()

    client.upload(url, '{"odpis": {}}', "application/json", include_query=True)

    assert not cached.exists()


def test_a_created_object_is_cached_under_its_own_bucket(client):
    name = "jobs/krs_odpis/runs/date=2026-10-02/run-00000.jsonl.gz"

    client.create_object(SHARED_BUCKET, name, b"\x1f\x8b", "application/gzip")

    assert the_cached_copy(client, name, bucket=SHARED_BUCKET) == b"\x1f\x8b"
    assert the_cached_copy(client, name) is None, "not under the crawl bucket's name"
