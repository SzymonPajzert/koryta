"""Which removed candidacies `PeopleMerged` reads as somebody else's."""

import math

import pandas as pd

from scrapers.koryta.download import is_verdict, removed_candidacies

NAMESAKE = "Imiennik. Oświadczenie majątkowe tej osoby jest z innego miejsca."


def edge(**fields) -> dict:
    """A candidacy as the export holds it, removed unless told otherwise."""
    return {
        "type": "election",
        "source": "kowalska",
        "target": "teryt0401",
        "position": "Rada gminy",
        "start_date": "2024-01-01",
        "deleted": True,
        "delete_reason": NAMESAKE,
        **fields,
    }


def test_a_namesake_s_run_and_a_reviewer_s_no_are_verdicts():
    assert is_verdict(NAMESAKE)
    assert is_verdict("zła osoba")
    assert is_verdict("Do innego Adama Józefa Pilcha")


def test_a_duplicate_a_merge_and_a_retraction_are_not():
    assert not is_verdict("duplikat")
    assert not is_verdict(
        "Duplikat: ta sama kandydatura (Sejmik, 2024) była zapisana dwa razy"
    )
    assert not is_verdict("Scalenie stron: to samo mówi już powiązanie edge_x")
    assert not is_verdict("wycofane automatycznie")
    assert not is_verdict("")
    assert not is_verdict(None)
    assert not is_verdict(math.nan)


def test_reads_the_place_year_and_election_of_each_verdict():
    frame = pd.DataFrame(
        [
            edge(),
            edge(target="teryt14", position="Sejm", start_date="2019-01-01"),
            edge(position=None, start_date="2014-01-01"),
        ]
    )

    assert removed_candidacies(frame)[["koryta_id", "teryt", "year", "kind"]].to_dict(
        orient="records"
    ) == [
        {"koryta_id": "kowalska", "teryt": "0401", "year": "2024", "kind": "local"},
        {"koryta_id": "kowalska", "teryt": "14", "year": "2019", "kind": "parliament"},
        {"koryta_id": "kowalska", "teryt": "0401", "year": "2014", "kind": None},
    ]


def test_leaves_out_what_is_not_a_removed_verdict():
    frame = pd.DataFrame(
        [
            edge(deleted=False),
            edge(deleted=math.nan),
            edge(delete_reason="duplikat"),
            edge(type="employed"),
            edge(start_date=None),
            edge(target="some-company"),
        ]
    )

    assert removed_candidacies(frame).empty
    assert list(removed_candidacies(frame).columns) == [
        "koryta_id",
        "teryt",
        "year",
        "kind",
        "reason",
    ]
