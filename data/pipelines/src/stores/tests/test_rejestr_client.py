"""How the rejestr.io clients read an answer, and that neither prints the key."""

import pytest

from stores import rejestr
from stores.rejestr import (
    Rejestr,
    RejestrRefused,
    RejestrUnavailable,
    UnattendedRejestr,
)

KEY = "secret-key-0123456789"
URL = "https://rejestr.io/api/v2/org/0000000029/krs-powiazania?aktualnosc=aktualne"


class Response:
    def __init__(self, status_code: int, text: str = ""):
        self.status_code = status_code
        self.text = text


class Session:
    def __init__(self, response: Response):
        self.response = response
        self.calls: list[tuple[str, dict, float]] = []

    def get(self, url, headers, timeout):
        self.calls.append((url, headers, timeout))
        return self.response


@pytest.fixture(autouse=True)
def no_key_from_dotenv(monkeypatch):
    # The workspace's .env must not decide what a test sees.
    monkeypatch.setattr(rejestr, "load_dotenv", lambda: None)
    monkeypatch.delenv("REJESTR_KEY", raising=False)


def client(status: int, text: str = "") -> tuple[UnattendedRejestr, Session]:
    session = Session(Response(status, text))
    return UnattendedRejestr(KEY, session=session), session  # type: ignore[arg-type]


def test_an_answer_is_bought_with_the_key_and_a_timeout():
    rejestr_io, session = client(200, '[{"id": 1}]')

    assert rejestr_io.get_rejestr_io(URL) == '[{"id": 1}]'
    [(url, headers, timeout)] = session.calls
    assert (url, headers["Authorization"]) == (URL, KEY)
    assert timeout == rejestr.REQUEST_TIMEOUT


def test_nothing_under_the_id_is_none():
    assert client(404)[0].get_rejestr_io(URL) is None


@pytest.mark.parametrize("status", [401, 402, 403, 429])
def test_a_refusal_of_the_account_ends_the_run(status):
    with pytest.raises(RejestrRefused) as refused:
        client(status, "Brak środków")[0].get_rejestr_io(URL)

    assert refused.value.status == status


def test_a_server_error_costs_one_call():
    with pytest.raises(RejestrUnavailable):
        client(503)[0].get_rejestr_io(URL)


def test_the_unattended_client_needs_a_key(monkeypatch):
    with pytest.raises(RuntimeError, match="REJESTR_KEY"):
        UnattendedRejestr()

    monkeypatch.setenv("REJESTR_KEY", KEY)
    assert UnattendedRejestr()._key == KEY


def test_the_hand_client_never_prints_the_key(monkeypatch, capsys):
    monkeypatch.setenv("REJESTR_KEY", KEY)
    monkeypatch.setattr("builtins.input", lambda *a: "")

    Rejestr()

    assert KEY not in capsys.readouterr().out
