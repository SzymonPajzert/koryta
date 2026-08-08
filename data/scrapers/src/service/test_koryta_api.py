from __future__ import annotations

import pytest

from service.koryta_api import identity_toolkit_url

_PATH = "v1/accounts:signInWithCustomToken"


def test_identity_toolkit_url_is_production_by_default(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.delenv("FIREBASE_AUTH_EMULATOR_HOST", raising=False)
    assert (
        identity_toolkit_url(_PATH) == f"https://identitytoolkit.googleapis.com/{_PATH}"
    )


@pytest.mark.parametrize(
    "value",
    ["127.0.0.1:9099", "http://127.0.0.1:9099", "http://127.0.0.1:9099/"],
)
def test_identity_toolkit_url_follows_the_auth_emulator(
    monkeypatch: pytest.MonkeyPatch, value: str
):
    """Without this the exchange goes to real Firebase with an emulator token.

    `firebase_admin` honours the variable when it mints the custom token, so
    pointing only this half at production fails at the last step of a capture --
    after the page is parsed and the model has been paid for.
    """
    monkeypatch.setenv("FIREBASE_AUTH_EMULATOR_HOST", value)
    assert (
        identity_toolkit_url(_PATH)
        == f"http://127.0.0.1:9099/identitytoolkit.googleapis.com/{_PATH}"
    )
