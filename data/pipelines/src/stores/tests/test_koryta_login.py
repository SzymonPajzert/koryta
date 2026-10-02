"""Which token a run signs in with, and when it asks for a new one."""

import pytest

from stores import koryta_login
from stores.koryta_login import (
    REFRESH_MARGIN_S,
    BrowserLogin,
    PipelineAccount,
    StaticToken,
    TokenError,
    token_source,
)

EXCHANGE = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken"


@pytest.fixture(autouse=True)
def no_environment(monkeypatch):
    for name in (
        "KORYTA_ID_TOKEN",
        "KORYTA_PIPELINE_UID",
        "FIREBASE_WEB_API_KEY",
        "FIREBASE_AUTH_EMULATOR_HOST",
    ):
        monkeypatch.delenv(name, raising=False)


class Response:
    def __init__(self, status_code: int = 200, body: dict | None = None):
        self.status_code = status_code
        self.body = body or {}
        self.text = str(self.body)

    @property
    def ok(self) -> bool:
        return self.status_code < 400

    def json(self) -> dict:
        return self.body


class Exchange:
    """Firebase Auth's signInWithCustomToken: an id token per custom token."""

    def __init__(self, *answers: Response):
        self.answers = list(answers)
        self.calls: list[dict] = []

    def post(self, url, params=None, json=None, timeout=None):
        self.calls.append(
            {"url": url, "params": params, "json": json, "timeout": timeout}
        )
        if self.answers:
            return self.answers.pop(0)
        n = len(self.calls)
        return Response(200, {"idToken": f"id-{n}", "expiresIn": "3600"})


class Minter:
    def __init__(self):
        self.minted: list[tuple[str, dict]] = []

    def __call__(self, uid, claims) -> str:
        self.minted.append((uid, dict(claims)))
        return f"custom-{len(self.minted)}"


class Clock:
    def __init__(self, at: float = 1_000_000.0):
        self.at = at

    def __call__(self) -> float:
        return self.at


def account(**kwargs) -> tuple[PipelineAccount, Minter, Exchange, Clock]:
    minter, exchange, clock = Minter(), kwargs.pop("exchange", Exchange()), Clock()
    source = PipelineAccount(
        "pipeline-people-import",
        "web-key",
        mint=minter,
        session=exchange,
        clock=clock,
    )
    return source, minter, exchange, clock


def test_a_token_handed_in_is_used_as_it_is_and_wins(monkeypatch):
    monkeypatch.setenv("KORYTA_ID_TOKEN", "handed-in")
    monkeypatch.setenv("KORYTA_PIPELINE_UID", "pipeline-people-import")

    source = token_source("https://autopush.koryta.pl")

    assert isinstance(source, StaticToken)
    assert source.token() == "handed-in"
    assert not source.interactive


def test_a_token_handed_in_cannot_be_renewed():
    with pytest.raises(TokenError, match="KORYTA_ID_TOKEN"):
        StaticToken("handed-in").refresh()


def test_a_pipeline_uid_signs_in_as_that_robot(monkeypatch):
    monkeypatch.setenv("KORYTA_PIPELINE_UID", "pipeline-people-import")
    monkeypatch.setenv("FIREBASE_WEB_API_KEY", "web-key")

    source = token_source("https://autopush.koryta.pl")

    assert isinstance(source, PipelineAccount)
    assert source.uid == "pipeline-people-import"
    assert not source.interactive


def test_a_pipeline_uid_without_the_web_key_is_refused_up_front(monkeypatch):
    monkeypatch.setenv("KORYTA_PIPELINE_UID", "pipeline-people-import")

    with pytest.raises(TokenError, match="FIREBASE_WEB_API_KEY"):
        token_source("https://autopush.koryta.pl")


def test_a_uid_the_site_would_count_as_a_person_is_refused():
    with pytest.raises(TokenError, match="'pipeline'"):
        PipelineAccount("people-import", "web-key", mint=Minter(), session=Exchange())


def test_nothing_set_is_somebody_signing_in_through_the_browser(monkeypatch):
    asked: list[str] = []

    def login(endpoint: str) -> str:
        asked.append(endpoint)
        return "browser"

    monkeypatch.setattr(koryta_login, "authenticate_user", login)

    source = token_source("https://autopush.koryta.pl")

    assert isinstance(source, BrowserLogin)
    assert source.interactive
    # Built, not asked: nobody is sent to the browser before a request needs it.
    assert asked == []
    assert source.token() == "browser"
    assert asked == ["https://autopush.koryta.pl"]


def test_the_browser_login_is_asked_once_and_again_only_on_a_refresh():
    asked: list[str] = []

    def login(endpoint: str) -> str:
        asked.append(endpoint)
        return f"browser-{len(asked)}"

    source = BrowserLogin("https://autopush.koryta.pl", login=login)

    assert (source.token(), source.token()) == ("browser-1", "browser-1")
    assert source.refresh() == "browser-2"
    assert source.token() == "browser-2"
    assert asked == ["https://autopush.koryta.pl"] * 2


def test_a_custom_token_carrying_the_claim_is_exchanged_for_an_id_token():
    source, minter, exchange, _ = account()

    assert source.token() == "id-1"

    assert minter.minted == [("pipeline-people-import", {"datascience": True})]
    assert exchange.calls == [
        {
            "url": EXCHANGE,
            "params": {"key": "web-key"},
            "json": {"token": "custom-1", "returnSecureToken": True},
            "timeout": 30,
        }
    ]


def test_the_id_token_is_kept_until_shortly_before_it_expires():
    source, minter, _, clock = account()
    source.token()

    clock.at += 3600 - REFRESH_MARGIN_S - 1
    assert source.token() == "id-1"
    clock.at += 1
    assert source.token() == "id-2"
    assert len(minter.minted) == 2


def test_the_lifetime_the_exchange_states_is_the_one_kept():
    short = Response(200, {"idToken": "short-lived", "expiresIn": "600"})
    source, _, _, clock = account(exchange=Exchange(short))
    source.token()

    clock.at += 600 - REFRESH_MARGIN_S
    assert source.token() == "id-2"


def test_a_refresh_mints_a_new_token_even_when_the_old_one_is_young():
    source, minter, _, _ = account()
    source.token()

    assert source.refresh() == "id-2"
    assert source.token() == "id-2"
    assert len(minter.minted) == 2


def test_an_exchange_firebase_refuses_says_what_it_answered():
    refused = Response(400, {"error": {"message": "INVALID_CUSTOM_TOKEN"}})
    source, _, _, _ = account(exchange=Exchange(refused))

    with pytest.raises(TokenError, match="400 .*INVALID_CUSTOM_TOKEN"):
        source.token()


@pytest.mark.parametrize(
    "host", ["127.0.0.1:9099", "http://127.0.0.1:9099", "http://127.0.0.1:9099/"]
)
def test_against_the_emulator_the_exchange_goes_to_the_emulator(monkeypatch, host):
    monkeypatch.setenv("FIREBASE_AUTH_EMULATOR_HOST", host)
    source, _, exchange, _ = account()

    source.token()

    assert exchange.calls[0]["url"] == (
        "http://127.0.0.1:9099/identitytoolkit.googleapis.com/"
        "v1/accounts:signInWithCustomToken"
    )
