"""Which payloads a re-ingest may submit without creating anybody new."""

import sys
from unittest.mock import patch

import pandas as pd

from analysis.payloads.person import PeoplePayloads, matching_one_page
from entities.composite import Person


def payload(name: str) -> Person:
    return Person(name=name, companies=[], elections=[], sources=[])


def names(payloads: list[Person]) -> list[str]:
    return [person.name for person in payloads]


def test_somebody_with_a_page_is_kept():
    assert names(matching_one_page([payload("Jan Kowalski")], ["Jan Kowalski"])) == [
        "Jan Kowalski"
    ]


def test_somebody_without_a_page_is_dropped():
    """The ingest would create them: it looks a person up by name and misses."""
    assert matching_one_page([payload("Jan Kowalski")], ["Anna Nowak"]) == []


def test_an_empty_site_keeps_nobody():
    assert matching_one_page([payload("Jan Kowalski")], []) == []


def test_two_candidates_for_one_page_are_both_dropped():
    """Both would land on that page, pooling two people's candidacies."""
    payloads = [payload("Piotr Mroziński"), payload("Piotr Mroziński")]
    assert matching_one_page(payloads, ["Piotr Mroziński"]) == []


def test_two_pages_for_one_candidate_is_dropped():
    """Which of the two `limit(1)` returns is not something to guess at."""
    payloads = [payload("Piotr Mroziński")]
    assert matching_one_page(payloads, ["Piotr Mroziński", "Piotr Mroziński"]) == []


def test_an_ambiguous_name_does_not_cost_anybody_else_their_payload():
    payloads = [
        payload("Piotr Mroziński"),
        payload("Piotr Mroziński"),
        payload("Jan Kowalski"),
    ]
    kept = matching_one_page(payloads, ["Piotr Mroziński", "Jan Kowalski"])
    assert names(kept) == ["Jan Kowalski"]


def test_the_match_is_exact():
    """`where("name", "==", ...)` is; a filter that is looser than the lookup
    passes through payloads that go on to create a second person."""
    assert matching_one_page([payload("Jan Kowalski")], ["jan kowalski"]) == []
    assert matching_one_page([payload("Jan Kowalski")], ["Jan  Kowalski"]) == []
    assert matching_one_page([payload("Jan Kowalski ")], ["Jan Kowalski"]) == []


def koryta_export(*names: str) -> pd.DataFrame:
    """What `KorytaPeople` yields: one row per person node on the site."""
    return pd.DataFrame(
        {
            "id": [str(i) for i, _ in enumerate(names)],
            "full_name": list(names),
        }
    )


def test_the_pipeline_reads_the_site_off_the_export():
    """The name on the export is the node's `name`, which is the field the
    ingest looks a person up by - so the two are compared as they are."""
    payloads = [payload("Jan Kowalski"), payload("Anna Nowak")]
    with patch.object(sys, "argv", ["koryta", "PeoplePayloads", "--all"]):
        with patch("analysis.payloads.person.KorytaPeople") as koryta_people:
            koryta_people.return_value.read_or_process.return_value = koryta_export(
                "Jan Kowalski"
            )
            kept = PeoplePayloads().only_on_koryta(None, payloads)

    koryta_people.assert_called_once_with(None)
    assert names(kept) == ["Jan Kowalski"]


def test_the_export_can_be_pinned_to_a_date():
    """So a run repeats against the snapshot it was rehearsed on."""
    argv = ["koryta", "PeoplePayloads", "--all", "--koryta-date", "2026-08-11"]
    with patch.object(sys, "argv", argv):
        with patch("analysis.payloads.person.KorytaPeople") as koryta_people:
            koryta_people.return_value.read_or_process.return_value = koryta_export()
            PeoplePayloads().only_on_koryta(None, [])

    koryta_people.assert_called_once_with("2026-08-11")
