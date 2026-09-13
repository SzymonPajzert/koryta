"""That the hand-off list stays a list of things genuinely still missing.

Two properties matter and neither is about the code. The list must not contain
a NIP the wykaz already resolved -- that would buy a rejestr.io call for a
company we have -- and it must not contain a malformed one, which would spend a
call on nothing. Both are checked against the same rules the resolver uses, so
a future edit to the list is caught rather than trusted.
"""

import pytest

from scrapers.krs.nip_lookup import nip_valid
from scrapers.krs.sponsorship_nips import (
    PLN_PER_CALL,
    REJESTRIO_QUERIES,
    UNRESOLVED,
    by_value,
    cost_pln,
    nips,
    rejestrio_urls,
    total_paid,
)


def test_every_nip_is_well_formed():
    """A malformed NIP buys a rejestr.io call that can only fail."""
    bad = [r.nip for r in UNRESOLVED if not nip_valid(r.nip)]
    assert bad == []


def test_no_nip_appears_twice():
    assert len(set(nips())) == len(UNRESOLVED)


def test_the_list_is_ordered_by_value_descending():
    """A run stopped halfway should have covered the money, not the alphabet."""
    paid = [r.paid for r in UNRESOLVED]
    assert paid == sorted(paid, reverse=True)


def test_every_recipient_carries_a_name_and_a_contract():
    for recipient in UNRESOLVED:
        assert recipient.name.strip(), recipient.nip
        assert recipient.contracts >= 1, recipient.nip
        assert recipient.paid > 0, recipient.nip


def test_by_value_limits_from_the_top():
    assert by_value(5) == UNRESOLVED[:5]
    assert by_value() == UNRESOLVED
    assert total_paid(by_value(5)) <= total_paid()


def test_both_connection_lists_are_asked_for():
    """`aktualne` and `historyczne` are not interchangeable.

    A politician who resigned the month before the money arrived is only in
    the historical list, which is the whole reason to ask twice.
    """
    assert set(REJESTRIO_QUERIES) == {"aktualne", "historyczne"}


def test_urls_are_the_two_connection_lists_and_nothing_else():
    """The org record carries no connections, so it is not bought by default.

    `scrapers.krs.scrape` says as much in
    `test_the_org_lookup_is_not_a_connections_call`, and its
    `already_scraped_companies` counts a company as done once it has the pair.
    Its name, city and teryt are in the free api-krs odpis already.
    """
    urls = rejestrio_urls("6301")
    assert len(urls) == 2
    # Zero-filled: rejestr.io keys on the ten-digit form.
    assert all("0000006301" in url for url in urls)
    assert not any(url.endswith("/org/0000006301") for url in urls)
    assert "aktualnosc=aktualne" in urls[0]
    assert "aktualnosc=historyczne" in urls[1]


def test_the_org_record_is_available_on_request():
    urls = rejestrio_urls("6301", with_org_record=True)
    assert len(urls) == 3
    assert urls[0].endswith("/org/0000006301")


def test_cost_matches_the_repo_s_own_price():
    from entities.company import KRS  # noqa: PLC0415
    from scrapers.krs.scrape import QueryType, RejestrIOQuery  # noqa: PLC0415

    query = RejestrIOQuery(
        krs=KRS(id="0000006301"),
        queries=[
            QueryType.REJESTRIO_ORG,
            QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE,
            QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_HISTORYCZNE,
        ],
    )
    assert cost_pln(1, with_org_record=True) == pytest.approx(query.cost())
    assert PLN_PER_CALL == 0.05


def test_the_default_is_two_calls_a_company():
    """Dropping the org record is 18.05 PLN across the 361."""
    assert cost_pln(10) == pytest.approx(10 * 2 * 0.05)
    assert cost_pln(10, with_org_record=True) == pytest.approx(10 * 3 * 0.05)
    saved = cost_pln(len(UNRESOLVED), True) - cost_pln(len(UNRESOLVED))
    assert saved == pytest.approx(len(UNRESOLVED) * 0.05)


def test_the_worked_example_is_on_the_list():
    """Fundacja "Bez Granic" is why this file exists.

    A foundation is necessarily in KRS and the wykaz holds nothing for it, by
    NIP or by REGON. If it ever drops off this list without the wykaz gap
    being closed, something has quietly started excluding it.
    """
    assert "7743261776" in nips()
