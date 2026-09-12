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
from analysis.payloads.person import (
    canonical_name,
    collapsed_people,
    one_register_entry,
)
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
from entities.composite import Election, Person
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

    assert snapshot.changes(
        payload(name="Anna Nowak", rejestrIo="https://rejestr.io/osoby/999")
    ) == [NEW_PERSON]


def test_a_new_spelling_of_a_stored_person_is_not_a_new_person():
    """The name is not the identity, and this is the whole duplicate bug.

    The pipeline picks a name out of a `list_distinct` whose order is a hash, so
    one human is "Andrzej Golimont" one run and "Andrzej Marcin Golimont" the
    next. Reading the second as somebody new is what filed 170 people under two
    pages each; the register entry is what says they are one.
    """
    snapshot = SiteSnapshot(nodes(), edges())

    assert snapshot.changes(payload(name="Jan Marek Kowalski")) == []


def test_a_namesake_with_another_register_entry_is_a_new_person():
    """And the other direction, which matching loosely would have made worse.

    Two strangers share a name; only the register tells them apart. 36 stored
    nodes have had one overwrite the other's `rejestrIo` already.
    """
    snapshot = SiteSnapshot(nodes(), edges())

    assert snapshot.changes(payload(rejestrIo="https://rejestr.io/osoby/456")) == [
        NEW_PERSON
    ]


def test_a_party_the_node_does_not_carry_is_kept():
    snapshot = SiteSnapshot(nodes(), edges())

    assert snapshot.changes(payload(parties=["PiS", "PSL"])) == [PERSON_FIELDS]


def test_a_party_the_node_already_carries_is_dropped():
    snapshot = SiteSnapshot(nodes(), edges())

    assert snapshot.changes(payload(parties=["PiS"])) == []


def test_a_rejestr_io_link_the_node_lacks_is_kept():
    """Also the fallback match: 880 people predate the pipeline sending a
    register entry, and the name is the only thing left to find them by. The
    payload is kept because it has one to give them."""
    snapshot = SiteSnapshot(nodes(person={"rejestrIo": None}), edges())

    assert snapshot.changes(payload()) == [PERSON_FIELDS]


def test_an_empty_content_is_not_a_change():
    """`updatedPerson` learns nothing from a field the payload leaves blank."""
    snapshot = SiteSnapshot(nodes(), edges())

    assert snapshot.changes(payload(content="")) == []


def test_a_link_the_pipeline_does_not_have_is_not_a_change():
    """NaN is how a pandas row says "no Wikipedia page", not a link to write.

    `map_person_payload` reads these off a frame, so an absent link arrives as
    NaN rather than None - truthy, and unequal to itself. Counted literally it
    made every person without a Wikipedia page look outdated: 4186 of the 4341
    people on koryta.pl, against 189 that would really learn one.
    """
    snapshot = SiteSnapshot(nodes(), edges())

    assert snapshot.changes(payload(wikipedia=float("nan"))) == []


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
    `test_a_repeated_row_matches_the_second_stored_spell`.
    """
    snapshot = SiteSnapshot(nodes(), edges(STORED_EMPLOYMENT))

    assert snapshot.changes(payload(companies=[EMPLOYMENT, EMPLOYMENT])) == [
        NEW_EMPLOYMENT
    ]


def test_a_repeated_row_matches_the_second_stored_spell():
    """Two rows saying one thing, two stored edges saying it: nothing to write.

    This used to assert the opposite, mirroring an ingest that would have
    written a third edge here - `findEdgeOrCreate` counted a same-identity
    claim twice, once through `occurrence` and once by filtering it out, so the
    second row looked for index 1 of a one-element list and missed. Round-
    tripping the 31 August export found 826 groups on the site that a re-upload
    would have grown that way. The ingest now counts it once and so does this.
    """
    stored_twice = edges(
        STORED_EMPLOYMENT, dict(STORED_EMPLOYMENT, id="edge-employed-2")
    )

    assert (
        SiteSnapshot(nodes(), stored_twice).changes(
            payload(companies=[EMPLOYMENT, EMPLOYMENT])
        )
        == []
    )


def test_a_third_repeated_row_is_still_a_fact_the_site_lacks():
    """The collection settles at max(rows, stored), never below it."""
    stored_twice = edges(
        STORED_EMPLOYMENT, dict(STORED_EMPLOYMENT, id="edge-employed-2")
    )

    assert SiteSnapshot(nodes(), stored_twice).changes(
        payload(companies=[EMPLOYMENT, EMPLOYMENT, EMPLOYMENT])
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


def test_a_candidacy_with_no_region_on_the_site_is_reported():
    snapshot = SiteSnapshot(nodes(), edges())
    elsewhere = dict(CANDIDACY, teryt="0201")

    assert snapshot.changes(payload(elections=[elsewhere])) == [UNRESOLVED_REGION]


def test_reporting_an_unplaceable_candidacy_does_not_keep_the_payload(
    mock_ctx, monkeypatch
):
    """The ingest drops it and says so, so uploading achieves nothing.

    It used to *throw*, and a payload that would fail is one somebody has to
    see fail - which is why this was the one reason that kept a payload without
    being a write.
    """
    snapshot = SiteSnapshot(nodes(), edges(STORED_EMPLOYMENT, STORED_CANDIDACY))
    monkeypatch.setattr(
        SiteSnapshot, "read", classmethod(lambda cls, ctx, date=None: snapshot)
    )
    person = Person(
        name="Jan Kowalski",
        companies=[],
        elections=[Election(**dict(CANDIDACY, teryt="0201"))],
        sources=[],
        parties=["PiS"],
        rejestrIo="https://rejestr.io/osoby/123",
    )

    kept = _people_payloads(only_changed=True).only_changed(mock_ctx, [person])

    assert kept == []


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


def _people_payloads(
    only_changed: bool = False,
    on_koryta: bool = False,
    not_on_koryta: bool = False,
) -> PeoplePayloads:
    pipeline = Pipeline.create(PeoplePayloads)
    pipeline.people = _FixedPipeline(EXTRACTED_PEOPLE)  # type: ignore[assignment]
    # The flags come off the process's own argv, which a test does not have.
    pipeline.__dict__["args"] = SimpleNamespace(
        only_changed=only_changed,
        on_koryta=on_koryta,
        not_on_koryta=not_on_koryta,
        koryta_date=None,
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


def test_the_pipeline_keeps_only_the_people_the_site_has(mock_ctx, monkeypatch):
    snapshot = SiteSnapshot(nodes(), edges())
    monkeypatch.setattr(
        SiteSnapshot, "read", classmethod(lambda cls, ctx, date=None: snapshot)
    )

    result = _people_payloads(on_koryta=True).process(mock_ctx)

    assert list(result["name"]) == ["Jan Kowalski"]


def test_the_pipeline_keeps_only_the_people_the_site_lacks(mock_ctx, monkeypatch):
    """The same path as `--on-koryta`, read the other way round. End to end
    because the two flags are only each other's complement if they resolve a
    payload to a page by the same fields, and nothing but a run over a real
    payload checks that."""
    snapshot = SiteSnapshot(nodes(), edges())
    monkeypatch.setattr(
        SiteSnapshot, "read", classmethod(lambda cls, ctx, date=None: snapshot)
    )

    result = _people_payloads(not_on_koryta=True).process(mock_ctx)

    assert list(result["name"]) == ["Anna Nowak"]


def test_a_column_another_document_fills_is_not_a_value_here():
    """Every row of an export carries every column the collection has.

    A person node arrives with a `krsNumber` of NaN because some place node has
    one, and indexing that would put people in the company lookup.
    """
    snapshot = SiteSnapshot(nodes(), edges())

    assert snapshot.companies == {"0000123456": COMPANY_ID}
    assert snapshot.regions == {"1465": "teryt1465"}
    assert list(snapshot.people) == ["https://rejestr.io/osoby/123"]
    assert list(snapshot.people_by_name) == ["Jan Kowalski"]


class TestOneRegisterEntry:
    """Which rejestr.io entry a row that carries several is filed under.

    A row carrying two is two people: `create_people_table` groups namesakes of
    the same age on purpose and cannot tell them from strangers. Nothing here
    undoes that - the point is only that the choice does not *move*, because
    `/api/ingest/person` now identifies a person by their register entry, and an
    entry that changes between runs opens a second page for them.
    """

    def test_the_only_entry_is_the_answer(self):
        assert one_register_entry(["1956879"]) == "1956879"

    def test_the_choice_does_not_depend_on_the_order_it_arrives_in(self):
        """duckdb's `list_distinct` returns a hash order, not the input order,
        so the same set reaches this function differently on different runs."""
        assert one_register_entry(["1956879", "383093"]) == one_register_entry(
            ["383093", "1956879"]
        )

    def test_entries_sort_as_numbers_rather_than_as_text(self):
        assert one_register_entry(["1956879", "383093"]) == "383093"

    def test_a_non_numeric_entry_still_sorts_somewhere_stable(self):
        assert one_register_entry(["abc", "123"]) == "123"
        assert one_register_entry(["abc", "abd"]) == "abc"

    def test_a_row_with_no_entry_at_all_is_an_error(self):
        with pytest.raises(ValueError):
            one_register_entry([])

    def test_a_collapsed_row_is_reported_rather_than_dropped(self):
        collapsed_people.clear()
        one_register_entry(["1956879", "383093"])
        one_register_entry(["123"])

        assert dict(collapsed_people) == {"383093, 1956879": 1}
        collapsed_people.clear()


class TestCanonicalName:
    """Which spelling a person whose sources disagree gets called on the site."""

    def test_the_middle_name_is_left_out(self):
        assert (
            canonical_name(["Andrzej Marcin Golimont", "Andrzej Golimont"])
            == "Andrzej Golimont"
        )

    def test_the_choice_does_not_depend_on_the_order_it_arrives_in(self):
        """`full_name` is a `list_distinct`, so the order is a hash."""
        assert canonical_name(["Andrzej Golimont", "Andrzej Marcin Golimont"]) == (
            canonical_name(["Andrzej Marcin Golimont", "Andrzej Golimont"])
        )

    def test_the_register_shouting_does_not_win(self):
        """A bare sort would take the capitals, which sort first."""
        assert (
            canonical_name(["GRZEGORZ GWOZDZ", "Grzegorz Gwozdz"]) == "Grzegorz Gwozdz"
        )

    def test_a_single_spelling_is_left_alone(self):
        assert canonical_name(["Teresa Maria Bogiel"]) == "Teresa Maria Bogiel"

    def test_nothing_to_choose_from_is_no_name(self):
        assert canonical_name([]) is None
        assert canonical_name(["", "   "]) is None
