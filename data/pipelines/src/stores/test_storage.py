import pytest
from google.cloud import storage

from stores.storage import _make_gcs_client


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

    assert asked.get("scopes"), "google.auth.default() was called without scopes"
    assert set(asked["scopes"]) == set(expected)  # type: ignore[arg-type]
