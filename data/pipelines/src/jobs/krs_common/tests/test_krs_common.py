"""Asking api-krs: what comes back, and what of it is kept."""

import json

import pytest

import jobs.krs_common as common
from scrapers.krs.people_parsing import is_not_found
from scrapers.krs.scrape import NOT_FOUND_SIZE_BOUND

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


def test_a_204_is_kept_as_the_register_saying_no(answers):
    """0000043031's P register answered 204 and its S 404: a company struck off."""
    answers(204, None)

    kept = common.query_krs_api(URL, verbose=False)

    assert kept is not None, "an empty object reads as a crawl that failed"
    assert is_not_found(json.loads(kept))
    # KRSAlreadyScraped opens only the bodies a listing says are this small.
    assert len(kept.encode()) <= NOT_FOUND_SIZE_BOUND


def test_an_empty_answer_that_is_not_a_204_is_still_a_failure(answers):
    answers(503, None)

    assert common.query_krs_api(URL, verbose=False) is None
