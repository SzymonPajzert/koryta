"""Which payloads a re-ingest may submit without creating anybody new."""

import sys
from unittest.mock import patch

import pandas as pd

from analysis.payloads.person import PeoplePayloads, matching_one_page
from analysis.payloads.site import SiteSnapshot
from entities.composite import Person


def payload(name: str, register: str | None = None, koryta_id: str | None = None):
    return Person(
        name=name,
        companies=[],
        elections=[],
        sources=[],
        rejestrIo=register,
        korytaId=koryta_id,
    )


def names(payloads: list[Person]) -> list[str]:
    return [person.name for person in payloads]


def site(*people: tuple[str, str, str | None]) -> SiteSnapshot:
    """A snapshot holding these person nodes: (node id, name, register link)."""
    nodes = pd.DataFrame(
        [
            {"id": node_id, "type": "person", "name": name, "rejestrIo": register}
            for node_id, name, register in people
        ],
        columns=["id", "type", "name", "rejestrIo"],
    )
    return SiteSnapshot(nodes, pd.DataFrame(columns=["id", "source", "target", "type"]))


def test_somebody_with_a_page_is_kept():
    snapshot = site(("1", "Jan Kowalski", None))
    assert names(matching_one_page([payload("Jan Kowalski")], snapshot)) == [
        "Jan Kowalski"
    ]


def test_somebody_without_a_page_is_dropped():
    """The ingest would create them: every lookup misses."""
    snapshot = site(("1", "Anna Nowak", None))
    assert matching_one_page([payload("Jan Kowalski")], snapshot) == []


def test_an_empty_site_keeps_nobody():
    assert matching_one_page([payload("Jan Kowalski")], site()) == []


def test_the_register_link_is_what_identifies_a_person():
    """Matched on the link, so the name it is filed under does not matter."""
    snapshot = site(("1", "Jan Kowalski", "https://rejestr.io/osoby/1"))
    kept = matching_one_page(
        [payload("Jan Kowalski", register="https://rejestr.io/osoby/1")], snapshot
    )
    assert names(kept) == ["Jan Kowalski"]


def test_the_same_name_on_a_different_link_is_dropped():
    """The case that created 105 people on 2026-09-12. `lookupPersonDoc` reads
    a page carrying a *different* register link as a different human and
    creates, so a filter that stops at the name lets a new page through."""
    snapshot = site(("1", "Tomasz Kowalski", "https://rejestr.io/osoby/421303"))
    dropped = matching_one_page(
        [payload("Tomasz Kowalski", register="https://rejestr.io/osoby/1238531")],
        snapshot,
    )
    assert dropped == []


def test_a_page_with_no_link_is_matched_by_name():
    """The fallback the ingest keeps for the 868 pages carrying no link."""
    snapshot = site(("1", "Jan Kowalski", None))
    kept = matching_one_page(
        [payload("Jan Kowalski", register="https://rejestr.io/osoby/1")], snapshot
    )
    assert names(kept) == ["Jan Kowalski"]


def test_the_node_id_beats_a_disagreeing_name():
    """The payload already knows which page it is; nothing is left to work out."""
    snapshot = site(("abc", "Jan Kowalski", None))
    kept = matching_one_page([payload("Jan Nowak", koryta_id="abc")], snapshot)
    assert names(kept) == ["Jan Nowak"]


def test_two_candidates_for_one_page_are_both_dropped():
    """Both would land on that page, pooling two people's candidacies."""
    payloads = [payload("Piotr Mroziński"), payload("Piotr Mroziński")]
    assert matching_one_page(payloads, site(("1", "Piotr Mroziński", None))) == []


def test_two_pages_for_one_candidate_is_dropped():
    """Which of the two `limit(1)` returns is not something to guess at."""
    snapshot = site(("1", "Piotr Mroziński", None), ("2", "Piotr Mroziński", None))
    assert matching_one_page([payload("Piotr Mroziński")], snapshot) == []


def test_an_ambiguous_name_does_not_cost_anybody_else_their_payload():
    payloads = [
        payload("Piotr Mroziński"),
        payload("Piotr Mroziński"),
        payload("Jan Kowalski"),
    ]
    snapshot = site(("1", "Piotr Mroziński", None), ("2", "Jan Kowalski", None))
    assert names(matching_one_page(payloads, snapshot)) == ["Jan Kowalski"]


def test_a_shared_name_is_no_obstacle_once_the_links_are_known():
    """The ambiguity guard is only for the fallback. Two namesakes the site has
    two pages for are resolved by link, and neither has to be dropped."""
    snapshot = site(
        ("1", "Piotr Mroziński", "https://rejestr.io/osoby/1"),
        ("2", "Piotr Mroziński", "https://rejestr.io/osoby/2"),
    )
    payloads = [
        payload("Piotr Mroziński", register="https://rejestr.io/osoby/1"),
        payload("Piotr Mroziński", register="https://rejestr.io/osoby/2"),
    ]
    assert len(matching_one_page(payloads, snapshot)) == 2


def test_the_match_is_exact():
    """`where("name", "==", ...)` is; a filter that is looser than the lookup
    passes through payloads that go on to create a second person."""
    snapshot = site(("1", "Jan Kowalski", None))
    assert matching_one_page([payload("jan kowalski")], snapshot) == []
    assert matching_one_page([payload("Jan  Kowalski")], snapshot) == []
    assert matching_one_page([payload("Jan Kowalski ")], snapshot) == []


def test_the_pipeline_reads_the_site_off_the_export():
    payloads = [payload("Jan Kowalski"), payload("Anna Nowak")]
    snapshot = site(("1", "Jan Kowalski", None))
    with patch.object(sys, "argv", ["koryta", "PeoplePayloads", "--all"]):
        with patch.object(SiteSnapshot, "read", return_value=snapshot) as read:
            kept = PeoplePayloads().only_on_koryta(None, payloads)

    read.assert_called_once_with(None, None)
    assert names(kept) == ["Jan Kowalski"]


def test_the_export_can_be_pinned_to_a_date():
    """So a run repeats against the snapshot it was rehearsed on."""
    argv = ["koryta", "PeoplePayloads", "--all", "--koryta-date", "2026-08-11"]
    with patch.object(sys, "argv", argv):
        with patch.object(SiteSnapshot, "read", return_value=site()) as read:
            PeoplePayloads().only_on_koryta(None, [])

    read.assert_called_once_with(None, "2026-08-11")


def test_the_export_is_read_once_for_both_filters():
    """`--on-koryta --only-changed` asks one snapshot two questions."""
    with patch.object(sys, "argv", ["koryta", "PeoplePayloads", "--all"]):
        with patch.object(SiteSnapshot, "read", return_value=site()) as read:
            pipeline = PeoplePayloads()
            pipeline.only_on_koryta(None, [])
            pipeline.only_changed(None, [])

    read.assert_called_once()
