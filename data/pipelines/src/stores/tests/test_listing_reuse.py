"""One listing of a crawl prefix serves a whole tree, until the run writes under it."""

import pytest

from scrapers.stores.file import CloudStorage
from stores import config
from stores.storage import CRAWLED_BUCKET, Client

API_KRS = "hostname=api-krs.ms.gov.pl"
ODPIS = f"{API_KRS}/api/krs/OdpisAktualny"


class Blob:
    def __init__(self, bucket: "Bucket", name: str, size: int | None = None):
        self.bucket, self.name, self.size = bucket, name, size

    def upload_from_string(self, data, content_type=None, if_generation_match=None):
        self.bucket.objects[self.name] = len(data)


class Bucket:
    def __init__(self, objects: dict[str, int]):
        self.objects = objects
        self.listings = 0

    def list_blobs(self, prefix, match_glob=None, fields=None, delimiter=None):
        self.listings += 1
        for name, size in sorted(self.objects.items()):
            if name.startswith(prefix):
                yield Blob(self, name, size)

    def blob(self, name: str) -> Blob:
        return Blob(self, name)


class GCS:
    def __init__(self, bucket: Bucket):
        self.crawled = bucket

    def bucket(self, name: str) -> Bucket:
        assert name == CRAWLED_BUCKET
        return self.crawled


@pytest.fixture
def bucket(tmp_path, monkeypatch) -> Bucket:
    monkeypatch.setattr(config, "DOWNLOADED_DIR", str(tmp_path))
    return Bucket(
        {
            f"{ODPIS}/0000000004/?rejestr=P/date=2026-10-01": 40,
            f"{ODPIS}/0000000110/?rejestr=S/date=2026-10-01": 0,
        }
    )


@pytest.fixture
def client(bucket) -> Client:
    c = Client.__new__(Client)
    c.storage_client = GCS(bucket)  # type: ignore[assignment]
    return c


def names(refs) -> list[tuple[str, int | None]]:
    return [(ref.url, ref.size) for ref in refs]


def test_a_second_listing_of_a_prefix_is_the_first(client, bucket):
    first = names(client.list_blobs(CloudStorage(prefix=API_KRS)))
    second = names(client.list_blobs(CloudStorage(prefix=API_KRS)))

    assert second == first, "names and sizes as listed"
    assert bucket.listings == 1


def test_an_upload_under_the_prefix_is_in_the_next_listing(client, bucket):
    list(client.list_blobs(CloudStorage(prefix=API_KRS)))

    client.upload(
        "https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000394808?rejestr=P",
        '{"odpis": {}}',
        "application/json",
        include_query=True,
        verbose=False,
    )
    listed = names(client.list_blobs(CloudStorage(prefix=API_KRS)))

    assert bucket.listings == 2
    assert any("0000394808" in url for url, _ in listed)


def test_a_listing_left_part_way_is_not_kept(client, bucket):
    next(client.list_blobs(CloudStorage(prefix=API_KRS)))

    list(client.list_blobs(CloudStorage(prefix=API_KRS)))

    assert bucket.listings == 2


def test_an_old_listing_is_listed_again(client, bucket, monkeypatch):
    list(client.list_blobs(CloudStorage(prefix=API_KRS)))
    monkeypatch.setattr(Client, "LISTING_REUSED_FOR", -1)

    list(client.list_blobs(CloudStorage(prefix=API_KRS)))

    assert bucket.listings == 2
