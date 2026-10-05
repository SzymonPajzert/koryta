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
        self.ranges: list[tuple[str | None, str | None]] = []

    def list_blobs(
        self,
        prefix,
        match_glob=None,
        fields=None,
        delimiter=None,
        start_offset=None,
        end_offset=None,
    ):
        self.listings += 1
        self.ranges.append((start_offset, end_offset))
        for name, size in sorted(self.objects.items()):
            if not name.startswith(prefix):
                continue
            if start_offset is not None and name < start_offset:
                continue
            if end_offset is not None and name >= end_offset:
                continue
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


def company(n: int) -> str:
    return f"{ODPIS}/{n:010d}/?rejestr=P/date=2026-10-01"


@pytest.fixture
def big(monkeypatch, bucket) -> Bucket:
    """A prefix past the split, in three ranges."""
    monkeypatch.setattr(Client, "LISTING_SPLIT_FROM", 6)
    monkeypatch.setattr(Client, "LISTING_RANGES", 3)
    bucket.objects = {company(n): 40 for n in range(10, 100, 10)}
    return bucket


def fresh(bucket: Bucket) -> Client:
    """A client of a later run: nothing kept in memory, the ranges on disk."""
    c = Client.__new__(Client)
    c.storage_client = GCS(bucket)  # type: ignore[assignment]
    return c


def test_a_big_prefix_is_listed_next_time_as_ranges_at_once(client, big):
    first = names(client.list_blobs(CloudStorage(prefix=API_KRS)))
    assert big.ranges == [(None, None)], "the first listing has no ranges to go by"

    big.ranges.clear()
    second = names(fresh(big).list_blobs(CloudStorage(prefix=API_KRS)))

    assert second == first, "the same names, in the same order"
    # Recorded in whatever order the threads got there: compare as a chain.
    starts, ends = zip(*sorted(big.ranges, key=lambda r: r[0] or ""))
    assert len(big.ranges) == 3
    assert starts[0] is None and ends[-1] is None
    assert list(starts[1:]) == list(ends[:-1]), "each range starts where one ends"


def test_what_was_written_since_the_ranges_were_taken_is_listed(client, big):
    list(client.list_blobs(CloudStorage(prefix=API_KRS)))
    # Before the first boundary, between two, and after the last.
    for n in (1, 55, 999):
        big.objects[company(n)] = 7

    listed = [
        url for url, _ in names(fresh(big).list_blobs(CloudStorage(prefix=API_KRS)))
    ]

    assert listed == sorted(f"gs://{CRAWLED_BUCKET}/{name}" for name in big.objects)


def test_a_small_prefix_is_listed_in_one_go(client, bucket):
    list(client.list_blobs(CloudStorage(prefix=API_KRS)))
    bucket.ranges.clear()

    list(fresh(bucket).list_blobs(CloudStorage(prefix=API_KRS)))

    assert bucket.ranges == [(None, None)]


def test_names_known_another_way_split_a_first_listing(client, big):
    """The mirror's archive names a prefix this machine never listed."""
    known = [company(n) for n in range(10, 100, 10)]

    client.seed_listing_ranges(CloudStorage(prefix=API_KRS), known)
    listed = names(fresh(big).list_blobs(CloudStorage(prefix=API_KRS)))

    assert len(big.ranges) == 3
    assert [url for url, _ in listed] == [f"gs://{CRAWLED_BUCKET}/{n}" for n in known]


def test_a_prefix_split_by_its_own_listing_keeps_that_split(client, big):
    list(client.list_blobs(CloudStorage(prefix=API_KRS)))
    kept = client._range_bounds((CRAWLED_BUCKET, API_KRS, None))

    client.seed_listing_ranges(CloudStorage(prefix=API_KRS), [company(1), company(2)])

    assert client._range_bounds((CRAWLED_BUCKET, API_KRS, None)) == kept


def test_one_token_is_fetched_before_the_ranges_are_listed(client, big):
    class Credentials:
        valid = False
        refreshes = 0

        def refresh(self, request):
            Credentials.refreshes += 1
            Credentials.valid = True

    list(client.list_blobs(CloudStorage(prefix=API_KRS)))
    later = fresh(big)
    later.storage_client._credentials = Credentials()  # type: ignore[attr-defined]

    list(later.list_blobs(CloudStorage(prefix=API_KRS)))

    assert (Credentials.refreshes, len(big.ranges)) == (1, 4)
