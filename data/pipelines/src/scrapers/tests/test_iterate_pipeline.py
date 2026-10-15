"""A pipeline's stored output reads back as the dataclasses it was written from."""

import io
from dataclasses import asdict

import pandas as pd

from entities.company import KRS
from entities.person import RejestrIOKey
from scrapers.krs.scrape import QueryType, RejestrIOQuery
from scrapers.stores import iterate_pipeline

QUEUE = [
    RejestrIOQuery(
        krs=KRS("1894", sources={"bulletin", "owned"}, teryts={"1465"}),
        queries=[
            QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_AKTUALNE,
            QueryType.REJESTRIO_ORG_KRS_POWIAZANIA_HISTORYCZNE,
        ],
        reasons=["owned"],
    ),
    RejestrIOQuery(
        person=RejestrIOKey("2145029"),
        queries=[QueryType.REJESTRIO_OSOBY_KRS_POWIAZANIA_AKTUALNE],
        reasons=["person_feed"],
    ),
]


def built(rows: list) -> pd.DataFrame:
    """The frame a pipeline makes of the dataclasses it returns."""
    return pd.DataFrame.from_records([asdict(row) for row in rows])


def stored(rows: list) -> pd.DataFrame:
    """The frame a later run reads: written as a pipeline writes its jsonl, read
    back as the store reads it - the sets as lists, the enum members as
    {"name": ..., "value": ...}."""
    written = built(rows).to_json(orient="records", lines=True)
    return pd.read_json(io.StringIO(written), lines=True)


def test_a_stored_queue_reads_back_as_it_was_written():
    assert list(iterate_pipeline(stored(QUEUE), RejestrIOQuery)) == QUEUE


def test_a_queue_just_built_reads_as_before():
    assert list(iterate_pipeline(built(QUEUE), RejestrIOQuery)) == QUEUE
