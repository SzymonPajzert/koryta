"""Asking api-krs: what comes back, and what of it is kept."""

import json
from datetime import datetime

import pytest

import jobs.krs_common as common
from scrapers.krs.people_parsing import is_not_found
from scrapers.krs.scrape import NOT_FOUND_SIZE_BOUND
from stores.storage import Client, warsaw_tz

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


def test_a_session_given_is_the_one_asked():
    class Session:
        def __init__(self):
            self.asked: list[str] = []

        def get(self, url, **kwargs):
            self.asked.append(url)
            return Response(200, NO_TOWN)

    session = Session()

    common.query_krs_api(URL, verbose=False, session=session)  # type: ignore[arg-type]

    assert session.asked == [URL]


class Bucket:
    def __init__(self):
        self.names: list[str] = []

    def blob(self, name):
        bucket = self

        class Blob:
            def upload_from_string(
                self, data, content_type=None, if_generation_match=None
            ):
                bucket.names.append(name)

        return Blob()


def test_an_answer_is_named_as_upload_stores_it(tmp_path, monkeypatch):
    """What the free scrape skips as answered today is found by this name."""
    monkeypatch.setattr("stores.config.DOWNLOADED_DIR", str(tmp_path))
    bucket = Bucket()
    client = Client.__new__(Client)
    client.storage_client = type("GCS", (), {"bucket": lambda self, n: bucket})()  # type: ignore[assignment]
    day = datetime.now(warsaw_tz).date().isoformat()

    client.upload(common.stored_url(URL), "{}", "application/json", include_query=True)

    assert bucket.names == [common.answer_name(URL, day)]
