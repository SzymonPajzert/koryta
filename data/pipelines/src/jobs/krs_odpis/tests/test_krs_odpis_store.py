"""That an odpis is filed before anybody parses it, and under the name it is read by."""

import pytest

from jobs.krs_odpis import search, store
from scrapers.krs import odpis_files


class Served:
    """The service as a table: (krs, register) -> what it answers."""

    def __init__(self, answers):
        self.answers = answers
        self.asked = []

    def __call__(self, krs, register="P", full=True, session=None, timeout=60.0):
        self.asked.append((krs, register))
        answer = self.answers.get((krs, register))
        if isinstance(answer, Exception):
            raise answer
        return answer


@pytest.fixture
def served(monkeypatch):
    def install(answers):
        fake = Served(answers)
        monkeypatch.setattr(search, "fetch_odpis_pdf", fake)
        return fake

    return install


def test_the_first_register_with_a_document_is_filed_and_returned(served):
    fake = served({("0000000029", "S"): b"%PDF-1"})
    put = []
    got = store.fetch_and_store(
        "0000000029",
        ("P", "S"),
        lambda name, data: put.append((name, data)),
        "2026-10-02",
    )
    assert got == ("S", b"%PDF-1")
    assert fake.asked == [("0000000029", "P"), ("0000000029", "S")]
    assert put == [
        (odpis_files.blob_name("0000000029", "S", "2026-10-02"), b"%PDF-1")
    ]


def test_a_hinted_register_is_the_only_one_asked(served):
    fake = served({("0000000029", "S"): b"%PDF-1"})
    store.fetch_and_store("0000000029", ("S",), lambda name, data: None, "2026-10-02")
    assert fake.asked == [("0000000029", "S")]


def test_not_in_either_register_files_nothing(served):
    served({})
    put = []
    assert (
        store.fetch_and_store(
            "0000000029", ("P", "S"), lambda n, d: put.append(n), "2026-10-02"
        )
        is None
    )
    assert put == []


def test_a_gateway_timeout_is_not_an_answer(served):
    served({("0000000029", "P"): search.OdpisUnavailable("HTTP 504", status=504)})
    with pytest.raises(search.OdpisUnavailable) as raised:
        store.fetch_and_store("0000000029", ("P", "S"), lambda n, d: None, "2026-10-02")
    assert raised.value.status == 504


def test_a_write_that_did_not_land_is_not_swallowed(served):
    served({("0000000029", "P"): b"%PDF-1"})

    def refused(name, data):
        raise RuntimeError("403 Forbidden")

    with pytest.raises(RuntimeError):
        store.fetch_and_store("0000000029", ("P",), refused, "2026-10-02")
