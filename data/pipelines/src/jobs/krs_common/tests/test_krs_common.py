"""Asking api-krs: what comes back, and what of it is kept."""

import json

import pytest

import jobs.krs_common as common

URL = "https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000394808?rejestr=P&format=json"

#: The part of 0000394808's entry that matters here, as api-krs served it on
#: 2026-10-02: an address with a country in it and nothing else.
NO_TOWN = {
    "odpis": {
        "dane": {
            "dzial1": {
                "danePodmiotu": {"nazwa": '"COFFEE POLSKA" SPÓŁKA AKCYJNA'},
                "siedzibaIAdres": {
                    "siedziba": {"kraj": "POLSKA"},
                    "adres": {"kraj": "POLSKA"},
                },
            }
        }
    }
}


class Response:
    def __init__(self, status_code: int, body):
        self.status_code = status_code
        self.text = "" if body is None else json.dumps(body)

    def json(self):
        return json.loads(self.text)


@pytest.fixture
def answers(monkeypatch):
    def answer(status_code, body):
        monkeypatch.setattr(
            common.requests, "get", lambda url, **kwargs: Response(status_code, body)
        )

    return answer


@pytest.mark.parametrize("verbose", [False, True])
def test_an_address_without_a_town_is_kept_like_any_other(answers, verbose):
    answers(200, NO_TOWN)

    assert json.loads(common.query_krs_api(URL, verbose=verbose)) == NO_TOWN
