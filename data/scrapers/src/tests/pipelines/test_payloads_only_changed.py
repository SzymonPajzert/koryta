"""What `--only-changed` keeps, against a snapshot of what koryta.pl holds.

Every case here is a decision `frontend/server/api/ingest/person.post.ts` makes
for itself when the payload reaches it. A payload dropped by mistake is a fact
that never reaches the site and nothing to notice it by, so the cases that keep
a payload matter more than the ones that drop it.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pandas as pd
import pytest

from analysis.payloads import PeoplePayloads
from analysis.payloads.site import (
    ENRICHED_CANDIDACY,
    MISSING_COMPANY,
    NEW_CANDIDACY,
    NEW_EMPLOYMENT,
    NEW_PERSON,
    PERSON_FIELDS,
    UNRESOLVED_REGION,
    SiteSnapshot,
)
from scrapers.stores import Context, Pipeline, ProcessPolicy

PERSON_ID = "person-1"
COMPANY_ID = "place-1"


def nodes(*extra, person=None):
    """The site's nodes: one person, one company, one region, plus `extra`."""
    stored_person = {
        "id": PERSON_ID,
        "type": "person",
        "name": "Jan Kowalski",
        "parties": ["PiS"],
        "rejestrIo": "https://rejestr.io/osoby/123",
    }
    stored_person.update(person or {})
    return pd.DataFrame.from_records(
        [
            stored_person,
            {
                "id": COMPANY_ID,
                "type": "place",
                "name": "Testowa S.A.",
                "krsNumber": "0000123456",
            },
            {"id": "teryt1465", "type": "region", "name": "Warszawa", "teryt": "1465"},
            *extra,
        ]
    )


def edges(*rows):
    return pd.DataFrame.from_records(list(rows)) if rows else pd.DataFrame()


def payload(**overrides):
    """The payload `PeoplePayloads` emits for the person the site already has."""
    base = {
        "name": "Jan Kowalski",
        "content": None,
        "companies": [],
        "elections": [],
        "sources": [],
        "parties": ["PiS"],
        "wikipedia": None,
        "rejestrIo": "https://rejestr.io/osoby/123",
        "autoapprove": False,
    }
    base.update(overrides)
    return base


EMPLOYMENT = {
    "krs": "0000123456",
    "role": "Prezes",
    "start": "2020-01-01",
    "end": None,
}

STORED_EMPLOYMENT = {
    "id": "edge-employed-1",
    "type": "employed",
    "source": PERSON_ID,
    "target": COMPANY_ID,
    "name": "Prezes",
    "start_date": "2020-01-01",
}

CANDIDACY = {
    "election_type": "Samorząd",
    "committee": None,
    "election_year": "2024",
    "teryt": "1465",
    "party": None,
    "party_from_committee": False,
}

STORED_CANDIDACY = {
    "id": "edge-election-1",
    "type": "election",
    "source": PERSON_ID,
    "target": "teryt1465",
    "name": "kandydatura",
    "position": "Samorząd",
    "start_date": "2024-01-01",
}


def test_a_payload_the_site_already_holds_is_dropped():
    snapshot = SiteSnapshot(nodes(), edges(STORED_EMPLOYMENT, STORED_CANDIDACY))

    assert (
        snapshot.changes(payload(companies=[EMPLOYMENT], elections=[CANDIDACY])) == []
    )


def test_a_person_the_site_does_not_have_is_kept():
    snapshot = SiteSnapshot(nodes(), edges())

    assert snapshot.changes(payload(name="Anna Nowak")) == [NEW_PERSON]


def test_a_party_the_node_does_not_carry_is_kept():
    snapshot = SiteSnapshot(nodes(), edges())

    assert snapshot.changes(payload(parties=["PiS", "PSL"])) == [PERSON_FIELDS]


def test_a_party_the_node_already_carries_is_dropped():
    snapshot = SiteSnapshot(nodes(), edges())

    assert snapshot.changes(payload(parties=["PiS"])) == []


def test_a_rejestr_io_link_the_node_lacks_is_kept():
    snapshot = SiteSnapshot(nodes(person={"rejestrIo": None}), edges())

    assert snapshot.changes(payload()) == [PERSON_FIELDS]


def test_an_empty_content_is_not_a_change():
    """`updatedPerson` learns nothing from a field the payload leaves blank."""
    snapshot = SiteSnapshot(nodes(), edges())

    assert snapshot.changes(payload(content="")) == []


def test_an_employment_at_a_company_the_site_lacks_is_kept():
    snapshot = SiteSnapshot(nodes(), edges())
    unknown = dict(EMPLOYMENT, krs="0000999999")

    assert snapshot.changes(payload(companies=[unknown])) == [MISSING_COMPANY]


def test_a_second_spell_at_one_company_is_kept():
    """Two spells differ in `start_date`, which is what makes them two facts."""
    snapshot = SiteSnapshot(nodes(), edges(STORED_EMPLOYMENT))
    second = dict(EMPLOYMENT, start="2023-05-01")

    assert snapshot.changes(payload(companies=[EMPLOYMENT, second])) == [NEW_EMPLOYMENT]


def test_a_repeated_row_is_a_second_fact_the_site_may_not_have():
    """A payload stating one spell twice states two, and one stored edge is one.

    `findEdgeOrCreate` reads a repeat as a second fact rather than a duplicate,
    so the second row goes looking for a second stored edge and does not find
    one here. What it does when there *are* two is
    `test_a_repeated_row_is_kept_even_when_both_spells_are_stored`.
    """
    snapshot = SiteSnapshot(nodes(), edges(STORED_EMPLOYMENT))

    assert snapshot.changes(payload(companies=[EMPLOYMENT, EMPLOYMENT])) == [
        NEW_EMPLOYMENT
    ]


def test_a_repeated_row_is_kept_even_when_both_spells_are_stored():
    """Mirroring an ingest that would write here, rather than being right.

    `findEdgeOrCreate` takes `same.filter(unclaimed)[occurrence]`, and claiming
    a match already removes it from that list - so the second of two
    indistinguishable rows looks for index 1 of a one-element list, misses, and
    creates a third edge. The site grows by one per run for as long as that
    holds, and a filter that called this a no-op would hide it.
    """
    stored_twice = edges(
        STORED_EMPLOYMENT, dict(STORED_EMPLOYMENT, id="edge-employed-2")
    )

    assert SiteSnapshot(nodes(), stored_twice).changes(
        payload(companies=[EMPLOYMENT, EMPLOYMENT])
    ) == [NEW_EMPLOYMENT]


def test_an_end_date_does_not_make_a_second_spell():
    """`end_date` is learned later, so one spell closed since is one spell."""
    snapshot = SiteSnapshot(nodes(), edges(STORED_EMPLOYMENT))
    closed = dict(EMPLOYMENT, end="2024-03-01")

    assert snapshot.changes(payload(companies=[closed])) == []


def test_a_candidacy_that_would_learn_a_committee_is_kept():
    """Every stored candidacy predates the ingest accepting a committee."""
    snapshot = SiteSnapshot(nodes(), edges(STORED_CANDIDACY))
    with_committee = dict(
        CANDIDACY,
        committee="Komitet Wyborczy Prawo i Sprawiedliwość",
        party="PiS",
        party_from_committee=True,
    )

    assert snapshot.changes(payload(elections=[with_committee])) == [ENRICHED_CANDIDACY]


def test_a_committee_that_differs_only_in_case_is_dropped():
    """PKW writes the same committee differently from one year's file to the next."""
    stored = dict(STORED_CANDIDACY, committee="KW  Prawo i Sprawiedliwość")
    snapshot = SiteSnapshot(nodes(), edges(stored))
    same = dict(CANDIDACY, committee="kw prawo i sprawiedliwość")

    assert snapshot.changes(payload(elections=[same])) == []


def test_a_candidacy_in_another_year_is_kept():
    snapshot = SiteSnapshot(nodes(), edges(STORED_CANDIDACY))
    older = dict(CANDIDACY, election_year="2018")

    assert snapshot.changes(payload(elections=[older])) == [NEW_CANDIDACY]


def test_a_candidacy_the_stored_edge_contradicts_is_kept():
    snapshot = SiteSnapshot(nodes(), edges(STORED_CANDIDACY))
    other_office = dict(CANDIDACY, election_type="Sejm")

    assert snapshot.changes(payload(elections=[other_office])) == [NEW_CANDIDACY]


def test_a_term_only_the_reviewer_knows_is_not_a_disagreement():
    """The scrapers never send `term`; saying nothing is not saying "none"."""
    stored = dict(STORED_CANDIDACY, term="2024-2029")
    snapshot = SiteSnapshot(nodes(), edges(stored))

    assert snapshot.changes(payload(elections=[CANDIDACY])) == []


def test_a_candidacy_with_no_region_on_the_site_is_kept():
    snapshot = SiteSnapshot(nodes(), edges())
    elsewhere = dict(CANDIDACY, teryt="0201")

    assert snapshot.changes(payload(elections=[elsewhere])) == [UNRESOLVED_REGION]


def test_a_candidacy_the_ingest_skips_is_dropped():
    """A European bid carries no TERYT and the ingest drops it without failing."""
    snapshot = SiteSnapshot(nodes(), edges())
    european = dict(CANDIDACY, election_type="Parlament Europejski", teryt=None)

    assert snapshot.changes(payload(elections=[european])) == []


def test_a_person_with_no_id_column_is_not_indexed():
    """An export row without a document id is not a node anything can point at."""
    snapshot = SiteSnapshot(
        pd.DataFrame.from_records(
            [{"id": "", "type": "person", "name": "Jan Kowalski"}]
        ),
        edges(),
    )

    assert snapshot.changes(payload()) == [NEW_PERSON]


class _FixedPipeline(Pipeline):
    filename = "mock"

    def __init__(self, data):
        super().__init__()
        self.data = pd.DataFrame(data)

    def process(self, ctx: Context) -> pd.DataFrame:
        return self.data

    def read_or_process(self, ctx: Context) -> pd.DataFrame:
        return self.data


EXTRACTED_PEOPLE = [
    {
        "krs_name": "Jan Kowalski",
        "rejestrio_id": ["123"],
        "employment": [
            {
                "employed_krs": "0000123456",
                "employed_role": "Prezes",
                "employed_start": "2020-01-01",
            }
        ],
        "elections": [
            {
                "election_type": "samorządu",
                "party": None,
                "election_year": 2024,
                "teryt_powiat": ["1465"],
            }
        ],
    },
    {
        "krs_name": "Anna Nowak",
        "rejestrio_id": ["456"],
        "employment": [],
        "elections": [],
    },
]


@pytest.fixture
def mock_ctx():
    ctx = MagicMock(spec=Context)
    ctx.refresh_policy = ProcessPolicy.with_default()
    ctx.io = MagicMock()
    return ctx


def _people_payloads(only_changed: bool) -> PeoplePayloads:
    pipeline = Pipeline.create(PeoplePayloads)
    pipeline.people = _FixedPipeline(EXTRACTED_PEOPLE)  # type: ignore[assignment]
    # The flags come off the process's own argv, which a test does not have.
    pipeline.__dict__["args"] = SimpleNamespace(
        only_changed=only_changed, koryta_date=None
    )
    return pipeline


def test_the_pipeline_emits_every_payload_by_default(mock_ctx, monkeypatch):
    monkeypatch.setattr(
        SiteSnapshot, "read", classmethod(lambda cls, ctx, date=None: 1 / 0)
    )

    assert len(_people_payloads(only_changed=False).process(mock_ctx)) == 2


def test_the_pipeline_drops_the_payloads_the_site_already_holds(mock_ctx, monkeypatch):
    """The whole path: an extracted row, the payload built from it, the match.

    Worth running end to end because the two halves agree on field names and
    nothing else - `changes` reads `election_type` after `get_election_type`
    has rewritten it, and a rename on either side would silently keep or drop
    every payload rather than fail.
    """
    snapshot = SiteSnapshot(nodes(), edges(STORED_EMPLOYMENT, STORED_CANDIDACY))
    monkeypatch.setattr(
        SiteSnapshot, "read", classmethod(lambda cls, ctx, date=None: snapshot)
    )

    result = _people_payloads(only_changed=True).process(mock_ctx)

    assert list(result["name"]) == ["Anna Nowak"]


def test_a_column_another_document_fills_is_not_a_value_here():
    """Every row of an export carries every column the collection has.

    A person node arrives with a `krsNumber` of NaN because some place node has
    one, and indexing that would put people in the company lookup.
    """
    snapshot = SiteSnapshot(nodes(), edges())

    assert snapshot.companies == {"0000123456": COMPANY_ID}
    assert snapshot.regions == {"1465": "teryt1465"}
    assert list(snapshot.people) == ["Jan Kowalski"]
