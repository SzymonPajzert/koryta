"""Not asking a register a question it has already answered.

A KRS entry is in one register, and the other answers 404. That answer is
about the company and is permanent, unlike a crawl that did not come back,
which is about the crawl and worth repeating.
"""

import pandas as pd

from entities.company import KRS
from scrapers.krs.people_parsing import is_not_found
from scrapers.krs.scrape import (
    QueryType,
    RejestrIOQuery,
    current_extracts_empty,
    save_org_connections,
    settled_registers,
)

P = QueryType.API_KRS_ODPIS_AKTUALNY_P.value
S = QueryType.API_KRS_ODPIS_AKTUALNY_S.value
PELNY_P = QueryType.API_KRS_ODPIS_PELNY_P.value

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
    """Those are zero-byte objects, left out of the answers this is handed."""
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
    """A crawl that did not come back leaves no answer, so nothing is settled.

    Those are zero-byte objects, marked `empty` and left out of the answers
    this is handed, which is what makes the S query here look unasked rather
    than answered.
    """
    asked = _queries_for(scraped(("0000059625", P, "2026-07-01", False)))
    assert QueryType.API_KRS_ODPIS_AKTUALNY_S in asked


# ─── a company with no name ───────────────────────────────


def crawled(*rows):
    """The pipeline's whole output: the answers, and the empty crawls marked."""
    return pd.DataFrame(rows, columns=["krs", "method", "date", "not_found", "empty"])


#: Grupowa Oczyszczalnia Ścieków w Łodzi, struck off the register. P answers
#: its current extract with an empty 204, run after run; S has said 404.
STRUCK_OFF = (
    ("0000069597", P, "2026-09-21", False, True),
    ("0000069597", S, "2026-08-18", True, False),
)


def _asked_for(output, krs_id="0000069597", *, names=True, entries=False):
    subject = [KRS(krs_id)]
    queries = list(
        save_org_connections(
            already_scraped_krs=output[~output["empty"].eq(True)],
            needs_refresh_krs=pd.DataFrame(
                columns=["krs", "method", "date", "update_date"]
            ),
            already_scraped_people={},
            connections=[],
            names=subject if names else [],
            people=[],
            entries=subject if entries else [],
            came_back_empty=current_extracts_empty(output),
        )
    )
    return [q for query in queries for q in query.queries]


def test_a_company_asked_about_for_the_first_time_gets_its_current_extracts():
    """And nothing else: most of them answer, and that names the company."""
    asked = _asked_for(crawled(), "0000999999")

    assert asked == [
        QueryType.API_KRS_ODPIS_AKTUALNY_P,
        QueryType.API_KRS_ODPIS_AKTUALNY_S,
    ]


def test_a_company_whose_current_extract_came_back_empty_is_owed_its_full_one():
    """Asking P's current extract again is all this used to do, run after run."""
    asked = _asked_for(crawled(*STRUCK_OFF))

    assert asked == [
        QueryType.API_KRS_ODPIS_AKTUALNY_P,
        QueryType.API_KRS_ODPIS_PELNY_P,
    ]


def test_a_company_with_a_name_is_not_asked_for_its_full_extract():
    """Only missing its register entry, which the current extract is for."""
    asked = _asked_for(crawled(*STRUCK_OFF), names=False, entries=True)

    assert asked == [QueryType.API_KRS_ODPIS_AKTUALNY_P]


def test_a_company_missing_both_is_asked_once():
    asked = _asked_for(crawled(*STRUCK_OFF), names=True, entries=True)

    assert asked == [
        QueryType.API_KRS_ODPIS_AKTUALNY_P,
        QueryType.API_KRS_ODPIS_PELNY_P,
    ]


def test_the_full_extract_is_asked_for_once():
    asked = _asked_for(
        crawled(*STRUCK_OFF, ("0000069597", PELNY_P, "2026-09-28", False, False))
    )

    assert asked == [QueryType.API_KRS_ODPIS_AKTUALNY_P]


def test_the_newest_crawl_of_a_current_extract_says_whether_it_was_empty():
    """An empty crawl the entry came after was a crawl that failed once."""
    assert current_extracts_empty(
        crawled(
            ("0000059625", P, "2026-07-18", False, True),
            ("0000059625", P, "2026-07-19", False, False),
            # On the same day, the one with the entry in it wins.
            ("0000076705", P, "2026-07-19", False, True),
            ("0000076705", P, "2026-07-19", False, False),
            ("0000069597", P, "2026-07-19", False, False),
            ("0000069597", P, "2026-09-21", False, True),
        )
    ) == {"0000069597": {QueryType.API_KRS_ODPIS_AKTUALNY_P}}


def test_an_output_written_before_the_markers_owes_no_full_extract():
    """Nothing in it says a question came back empty."""
    assert current_extracts_empty(scraped(("0000069597", S, "2026-08-18", True))) == {}


def test_the_full_extract_is_free():
    query = RejestrIOQuery(
        krs=KRS("0000069597"), queries=[QueryType.API_KRS_ODPIS_PELNY_P]
    )

    assert list(query.urls(only_free=True)) == [
        "https://api-krs.ms.gov.pl/api/krs/OdpisPelny/0000069597?rejestr=P&format=json"
    ]
    assert query.cost() == 0


def test_the_body_that_settles_it_is_the_register_saying_not_found():
    assert is_not_found(NOT_FOUND_BODY)
    assert not is_not_found({"status": 404})
    assert not is_not_found({"title": "Not Found"})
    assert not is_not_found({"status": 500, "title": "Not Found"})
    for nothing in (None, "", [], {}):
        assert not is_not_found(nothing)
