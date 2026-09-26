"""That a rejestr.io run is priced and addressed the way the service bills it.

The price is the reason this is tested at all: every call is 0.05 PLN of real
money, and a run is sized from `cost_pln` before anybody agrees to it. An
arithmetic slip here is not a wrong number on a screen, it is a bill.
"""

from scrapers.krs.rejestrio import (
    PLN_PER_CALL,
    REJESTRIO_QUERIES,
    cost_pln,
    rejestrio_urls,
)


def test_a_company_is_two_calls_by_default():
    """The org record carries no connections, so it is not bought by default."""
    urls = rejestrio_urls("0000907937")
    assert len(urls) == len(REJESTRIO_QUERIES) == 2
    assert all("krs-powiazania" in u for u in urls)


def test_both_aktualnosc_values_are_asked_for():
    """`historyczne` is the only place a member who resigned is named."""
    urls = rejestrio_urls("0000907937")
    assert [u.rsplit("=", 1)[1] for u in urls] == ["aktualne", "historyczne"]


def test_the_krs_number_is_padded():
    """rejestr.io keys on the ten-digit form; an unpadded number 404s."""
    assert "/org/0000907937/" in rejestrio_urls("907937")[0]


def test_the_org_record_is_one_more_call_and_leads():
    urls = rejestrio_urls("0000907937", with_org_record=True)
    assert len(urls) == 3
    assert "krs-powiazania" not in urls[0]


def test_cost_is_per_call_not_per_company():
    assert cost_pln(1) == 2 * PLN_PER_CALL
    assert cost_pln(100) == 10.0
    assert cost_pln(100, with_org_record=True) == 15.0


def test_nothing_costs_nothing():
    """A worklist that is already complete must not print a price."""
    assert cost_pln(0) == 0.0
