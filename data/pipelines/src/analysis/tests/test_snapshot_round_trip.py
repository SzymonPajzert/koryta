"""What `--only-changed` knows of a stored page once it has been through the export.

`SiteSnapshot` is built from `KorytaNodes` and `KorytaEdges`: the export cut
down to `NODE_FIELDS` and `EDGE_FIELDS`, written as jsonl and read back with
their dtypes, as the nightly people step reads them. A field the comparison
reads and the cut drops arrives as one the page lacks, so every page holding it
looks like a page the payload would change. `birthDate` and a candidacy's
`elected` did: on 2026-10-08 they put 1,167 pages into the plan that an upload
would have left as they were, 4 of them among the 100 the night sent.
"""

import dataclasses

import pandas as pd
import pytest

from analysis.payloads.site import EDGE_SEMANTICS, ENRICHED_CANDIDACY, SiteSnapshot
from entities.composite import Person
from scrapers.koryta.download import KorytaEdges, KorytaExport, KorytaNodes

PERSON = {
    "id": "person-1",
    "type": "person",
    "name": "Jan Kowalski",
    "rejestrIo": "https://rejestr.io/osoby/123",
}
REGION = {"id": "teryt1465", "type": "region", "name": "Warszawa", "teryt": "1465"}

#: A value of each field a person payload states about the node itself.
NODE_FACTS = {
    "content": "Prezes zarządu.",
    "parties": ["PiS"],
    "wikipedia": "https://pl.wikipedia.org/wiki/Jan_Kowalski",
    "rejestrIo": "https://rejestr.io/osoby/123",
    "birthDate": "1967-09-20",
}

#: The payload's fields that are not facts about the node: the name, which an
#: upload never rewrites, the page's id, and the edges.
NOT_NODE_FACTS = {"name", "korytaId", "companies", "elections", "sources"}

STORED_CANDIDACY = {
    "id": "edge-election-1",
    "type": "election",
    "source": "person-1",
    "target": "teryt1465",
    "name": "kandydatura",
    "position": "Samorząd",
    "start_date": "2024-01-01",
}
#: An edge with no result, so the column holds a NaN as a real export's does.
OTHER_EDGE = {"id": "edge-other", "type": "mentions", "source": "a", "target": "b"}

WON = {
    "election_type": "Samorząd",
    "election_year": "2024",
    "teryt": "1465",
    "elected": True,
}


def payload(**fields) -> dict:
    """What `PeoplePayloads` sends for the stored person, plus `fields`."""
    return {
        "name": "Jan Kowalski",
        "companies": [],
        "elections": [],
        "sources": [],
        "parties": [],
        "rejestrIo": "https://rejestr.io/osoby/123",
        **fields,
    }


def through_the_export(
    rows: list[dict], pipeline: type[KorytaExport], tmp_path
) -> pd.DataFrame:
    """`rows` as the people step reads them: cut to the pipeline's columns,
    written as `write_dataframe` writes and read back as `FromPath` reads."""
    path = tmp_path / f"{pipeline.collection_name}.jsonl"
    frame = pd.DataFrame.from_records(rows).reindex(columns=pipeline.fields)
    frame.to_json(path, orient="records", lines=True)
    return pd.read_json(path, lines=True, dtype=pipeline.dtype)


def test_every_node_fact_a_payload_states_is_listed_here():
    """So that a field the payload learns to state is tested below, too."""
    stated = {field.name for field in dataclasses.fields(Person)} - NOT_NODE_FACTS

    assert stated == set(NODE_FACTS)


@pytest.mark.parametrize("name", sorted(NODE_FACTS))
def test_a_page_already_saying_what_the_payload_says_is_not_news(tmp_path, name):
    stored = through_the_export(
        [dict(PERSON, **{name: NODE_FACTS[name]}), REGION], KorytaNodes, tmp_path
    )
    snapshot = SiteSnapshot(stored, pd.DataFrame())

    assert snapshot.changes(payload(**{name: NODE_FACTS[name]})) == []


def test_every_edge_field_the_comparison_reads_is_exported():
    read = {
        name
        for rules in EDGE_SEMANTICS.values()
        for name in (*rules.discriminators, *rules.annotations)
    }

    assert read <= set(KorytaEdges.fields)


@pytest.mark.parametrize(
    ("elected", "expected"),
    [
        # Stored as won: the payload saying so is not news.
        (True, []),
        # An edit form's unticked box, which the ingest reads as a blank and
        # fills in - not a recorded defeat the win would contradict.
        (False, [ENRICHED_CANDIDACY]),
        (None, [ENRICHED_CANDIDACY]),
    ],
)
def test_a_stored_result_is_read_as_the_ingest_reads_it(tmp_path, elected, expected):
    """Back off disk the flag is 1.0, 0.0 or NaN rather than a boolean."""
    candidacy = dict(STORED_CANDIDACY)
    if elected is not None:
        candidacy["elected"] = elected
    stored = through_the_export([candidacy, OTHER_EDGE], KorytaEdges, tmp_path)
    nodes = through_the_export([PERSON, REGION], KorytaNodes, tmp_path)

    snapshot = SiteSnapshot(nodes, stored)

    assert snapshot.changes(payload(elections=[WON])) == expected
