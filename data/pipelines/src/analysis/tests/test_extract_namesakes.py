"""Extract keeps every person it is given, namesakes included."""

import json

import pandas as pd

from analysis.extract import Extract
from scrapers.stores import Pipeline
from scrapers.tests.mocks import get_test_context, setup_test_context

KRS = "0000000001"
COMPANIES = [
    {
        "krs": KRS,
        "name": "Wodociągi",
        "children": [],
        "parents": [],
        "teryt_code": "1400",
    }
]


def person(rejestrio_id: str, born: str) -> dict:
    """A KRS person on the company's board, as `PeopleEnriched` leaves them."""
    return {
        "krs_name": "Jan Nowak",
        "pkw_name": "NOWAK Jan",
        "wiki_name": None,
        "history": "",
        "birth_date": born,
        "employed_total": 1000,
        "first_employed": 1704067200000,
        "last_employed": 1735689600000,
        "employment": [{"employed_krs": KRS}],
        "elections": [],
        "teryt_wojewodztwo": [],
        "overall_score": 20,
        "unique_chance": 0.0,
        "rejestrio_id": [rejestrio_id],
    }


class Args:
    krss = [KRS]
    region = None
    approved = False
    recent = False
    ignore_elections = False
    currently_employed = False
    all = False
    employed_after = None
    election_after = None
    rejestrio_id = None
    public_employer = False
    min_score = None
    employed_roles = None
    company_category = None
    paid_supervision = False


def extract(people: list[dict]) -> pd.DataFrame:
    ctx = setup_test_context(
        get_test_context(),
        {
            "people_enriched/people_enriched.jsonl": "\n".join(map(json.dumps, people)),
            "company_krs/company_krs.jsonl": "\n".join(map(json.dumps, COMPANIES)),
        },
    )
    pipeline = Pipeline.create(Extract)
    for name, frame in (("people", people), ("companies", COMPANIES)):
        dependency = Pipeline.create(type(getattr(pipeline, name)))
        dependency.read_or_process = lambda ctx, frame=frame: pd.DataFrame(frame)
        setattr(pipeline, name, dependency)
        pipeline.dependencies[name] = dependency
    pipeline.teryt = Pipeline.create(type(pipeline.teryt))
    pipeline.dependencies["teryt"] = pipeline.teryt
    pipeline.teryt.read_or_process = lambda ctx: None
    pipeline.args = Args()
    return pipeline.process(ctx)


def test_two_namesakes_on_one_board_are_both_extracted():
    """The bug: Extract kept the first row of each name and left out the rest.

    Two register entries are two people, however alike they are called - on
    the 2026-10-07 inputs it left out 12,397 people with an entry of their
    own, 546 of them with a page that no upload refreshed.
    """
    result = extract([person("7", "1970-02-08"), person("8", "1981-11-30")])

    assert sorted(i for ids in result["rejestrio_id"] for i in ids) == ["7", "8"]
