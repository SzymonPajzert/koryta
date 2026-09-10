"""Which rejestr.io connections make one company the child of another."""

import collections

from scrapers.krs.graph import QueryRelation
from scrapers.krs.list import is_owned_by_queried


def conn(typ: str, kierunek: str) -> dict:
    return {"typ": typ, "kierunek": kierunek, "data_start": None, "data_koniec": None}


def test_a_passive_shareholding_is_a_child():
    assert QueryRelation.from_rejestrio(conn("KRS_SHAREHOLDER", "PASYWNY")).is_child()


def test_an_active_shareholding_is_not():
    # The other company holds the shares, so it is the parent, not the child.
    assert not QueryRelation.from_rejestrio(
        conn("KRS_SHAREHOLDER", "AKTYWNY")
    ).is_child()


def test_the_entity_a_company_arose_from_is_not_a_child():
    # EXATEL S.A. -> TELBANK S.A. is a merger, not a holding.
    assert not QueryRelation.from_rejestrio(conn("KRS_CREATED", "PASYWNY")).is_child()
    assert not QueryRelation.from_rejestrio(conn("KRS_CREATOR", "PASYWNY")).is_child()


def test_an_unclassified_relation_is_counted_rather_than_raised():
    # This used to raise, uncaught, in the middle of the company pipeline.
    unknown: collections.Counter = collections.Counter()
    relation = QueryRelation.from_rejestrio(conn("KRS_SOMETHING_NEW", "PASYWNY"))

    assert not relation.is_child(unknown)
    assert unknown == {"KRS_SOMETHING_NEW": 1}


def test_ownership_is_found_wherever_it_is_listed():
    unknown: collections.Counter = collections.Counter()
    item = {
        "krs_powiazania_kwerendowane": [
            conn("KRS_SOMETHING_NEW", "PASYWNY"),
            conn("KRS_SHAREHOLDER", "PASYWNY"),
        ]
    }

    assert is_owned_by_queried(item, unknown)
    assert unknown == {"KRS_SOMETHING_NEW": 1}


def test_an_unknown_relation_after_an_ownership_one_is_still_counted():
    unknown: collections.Counter = collections.Counter()
    item = {
        "krs_powiazania_kwerendowane": [
            conn("KRS_SHAREHOLDER", "PASYWNY"),
            conn("KRS_SOMETHING_NEW", "PASYWNY"),
        ]
    }

    assert is_owned_by_queried(item, unknown)
    assert unknown == {"KRS_SOMETHING_NEW": 1}
