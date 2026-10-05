import base64
import hashlib

import pytest
from google.api_core import exceptions
from google.cloud import storage

from stores.storage import Client, _make_gcs_client


def test_the_gcs_client_asks_for_scopes(monkeypatch: pytest.MonkeyPatch):
    """Credentials with no scopes cannot be impersonated.

    Passing `credentials=` and `_http=` to storage.Client skips the
    with_scopes_if_required() it does for itself, so google.auth.default() has
    to be asked for the scopes directly. Nothing local notices -- a
    service-account key and a gcloud login both mint tokens without a scope --
    but under Workload Identity Federation google-auth puts the scopes in the
    `scope` field of the generateAccessToken body, and IAM rejects an empty one
    with a 400. Every nightly run between 2026-07-31 and 2026-09-01 died there.
    """
    asked: dict[str, object] = {}
    expected = storage.Client.SCOPE

    class FakeSession:
        def mount(self, prefix: str, adapter: object) -> None:
            pass

    class FakeClient:
        # The real one carries it, and the code under test reads it.
        SCOPE = expected

        def __init__(self, **kwargs: object) -> None:
            self.kwargs = kwargs

    def fake_default(*args: object, **kwargs: object):
        asked.update(kwargs)
        return object(), "koryta-pl"

    monkeypatch.setattr("stores.storage.google.auth.default", fake_default)
    monkeypatch.setattr(
        "stores.storage.google.auth.transport.requests.AuthorizedSession",
        lambda credentials: FakeSession(),
    )
    monkeypatch.setattr("stores.storage.storage.Client", FakeClient)

    _make_gcs_client()

    scopes = asked.get("scopes")
    assert scopes, "google.auth.default() was called without scopes"
    assert isinstance(scopes, (list, tuple, set))
    assert set(scopes) == set(expected)


class _Blob:
    """Stands in for a GCS blob whose create fails the way a lost response does."""

    def __init__(self, stored: bytes | None, uploads: list[bytes]):
        self.stored = stored
        self.uploads = uploads
        self.md5_hash: str | None = None

    def upload_from_string(self, data, content_type, if_generation_match):
        self.uploads.append(data)
        if self.stored is not None:
            raise exceptions.PreconditionFailed("412 conditionNotMet")
        self.stored = data

    def reload(self):
        assert self.stored is not None
        self.md5_hash = base64.b64encode(hashlib.md5(self.stored).digest()).decode()


def _client_with(blob: _Blob):
    class Bucket:
        def blob(self, name):
            return blob

    class Storage:
        def bucket(self, name):
            return Bucket()

    client = Client.__new__(Client)
    client.storage_client = Storage()  # type: ignore[assignment]
    return client


def test_a_create_that_landed_before_its_response_was_lost_is_a_write():
    uploads: list[bytes] = []
    client = _client_with(_Blob(stored=b"part", uploads=uploads))

    assert client.create_object("b", "p", b"part", "application/gzip") == "gs://b/p"
    assert uploads == [b"part"]


def test_a_name_already_holding_other_bytes_is_refused():
    client = _client_with(_Blob(stored=b"another run's part", uploads=[]))

    with pytest.raises(exceptions.PreconditionFailed):
        client.create_object("b", "p", b"part", "application/gzip")
