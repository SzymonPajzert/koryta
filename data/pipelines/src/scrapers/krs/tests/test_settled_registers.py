"""Not asking a register a question it has already answered.

A KRS entry is in one register, and the other answers 404. That answer is
about the company and is permanent, unlike a crawl that did not come back,
which is about the crawl and worth repeating.
"""

import pandas as pd

from entities.company import KRS
from scrapers.krs.people_parsing import is_not_found
from scrapers.krs.scrape import QueryType, save_org_connections, settled_registers

P = QueryType.API_KRS_ODPIS_AKTUALNY_P.value
S = QueryType.API_KRS_ODPIS_AKTUALNY_S.value

NOT_FOUND_BODY = {
    "type": "https://tools.ietf.org/html/rfc7231#section-6.5.4",
    "title": "Not Found",
    "status": 404,
    "traceId": "00-a163d581d830cd69c7d8d13e95284f2a-d97f8970433f67d8-00",
}


def scraped(*rows):
    return pd.DataFrame(rows, columns=["krs", "method", "date", "not_found"])


def test_a_404_settles_that_register():
    settled = settled_registers(
        scraped(
            ("0000059625", P, "2026-07-01", False),
            ("0000059625", S, "2026-08-18", True),
        )
    )
    assert settled == {"0000059625": {QueryType.API_KRS_ODPIS_AKTUALNY_S}}


def test_a_crawl_that_did_not_come_back_settles_nothing():
    """Those are dropped from the frame entirely, as zero-byte objects."""
    settled = settled_registers(scraped(("0000059625", S, "2026-08-18", False)))
    assert settled == {}


def test_an_output_written_before_the_column_existed_settles_nothing():
    old = pd.DataFrame(
        [("0000059625", S, "2026-08-18")], columns=["krs", "method", "date"]
    )
    assert settled_registers(old) == {}


def _queries_for(already_scraped, krs_id="0000059625"):
    empty = pd.DataFrame(columns=["krs", "method", "date", "update_date"])
    queries = list(
        save_org_connections(
            already_scraped_krs=already_scraped,
            needs_refresh_krs=empty,
            already_scraped_people={},
            connections=[KRS(krs_id)],
            names=[],
            people=[],
        )
    )
    return {q for query in queries for q in query.queries}


def test_the_settled_register_is_not_asked_again():
    asked = _queries_for(scraped(("0000059625", S, "2026-08-18", True)))
    assert QueryType.API_KRS_ODPIS_AKTUALNY_S not in asked
    # The register it is in has not answered yet, so it is still asked.
    assert QueryType.API_KRS_ODPIS_AKTUALNY_P in asked


def test_a_register_that_never_answered_is_still_asked():
    """A crawl that did not come back leaves no row at all, so nothing is settled.

    Those are dropped from the frame as zero-byte objects, which is what
    makes the S query here look unasked rather than answered.
    """
    asked = _queries_for(scraped(("0000059625", P, "2026-07-01", False)))
    assert QueryType.API_KRS_ODPIS_AKTUALNY_S in asked


def test_the_body_that_settles_it_is_the_register_saying_not_found():
    assert is_not_found(NOT_FOUND_BODY)
    # A 204 has no body; the scrape stores it in the 404's shape.
    assert is_not_found({"title": "Not Found", "status": 204, "detail": "..."})
    assert not is_not_found({"status": 404})
    assert not is_not_found({"title": "Not Found"})
    assert not is_not_found({"status": 500, "title": "Not Found"})
    for nothing in (None, "", [], {}):
        assert not is_not_found(nothing)
