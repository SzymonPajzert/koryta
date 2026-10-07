"""What `--only-changed` keeps for a company, against a snapshot of the site.

The companion to `test_payloads_only_changed.py`, which does the same for
people. Every case here is a decision
`frontend/server/api/ingest/company.post.ts` makes for itself once the payload
reaches it, and the ones that *keep* a payload matter more: a payload dropped
by mistake is a fact that never reaches the site, with nothing to notice it by.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pandas as pd
import pytest

from analysis.payloads import CompaniesPayloads
from analysis.payloads.site import (
    COMPANY_FIELDS,
    COMPANY_UNAPPROVED,
    NEW_COMPANY,
    NEW_OWNER,
    NEW_SEAT,
    SKARB_PANSTWA_NODE_ID,
    SiteSnapshot,
)
from scrapers.stores import Context, Pipeline, ProcessPolicy

COMPANY_ID = "place-1"
OWNER_ID = "place-2"
KRS = "0000076705"
OWNER_KRS = "0000123456"


def company_node(**overrides):
    """The node a previous run of the same payload left behind."""
    node = {
        "id": COMPANY_ID,
        "type": "place",
        "name": "PKP Szybka Kolej Miejska w Trojmiescie (Gdynia)",
        "krsNumber": KRS,
        "activity": ["49.12.Z", "49.31.Z"],
        "categories": ["koleje"],
        "isPublic": True,
        "supervisoryBody": "rada_nadzorcza",
        "revision_id": "rev-1",
    }
    node.update(overrides)
    return node


def nodes(*extra, company=None):
    return pd.DataFrame.from_records(
        [
            company_node(**(company or {})),
            {
                "id": OWNER_ID,
                "type": "place",
                "name": "Wlasciciel S.A.",
                "krsNumber": OWNER_KRS,
                "revision_id": "rev-2",
            },
            {"id": "teryt2262", "type": "region", "name": "Gdynia", "teryt": "2262"},
            {"id": "teryt2263", "type": "region", "name": "Sopot", "teryt": "2263"},
            *extra,
        ]
    )


def edges(*rows):
    return pd.DataFrame.from_records(list(rows)) if rows else pd.DataFrame()


def payload(**overrides):
    """The payload `CompaniesPayloads` emits for that same company."""
    base = {
        "krs": KRS,
        "name": "PKP Szybka Kolej Miejska w Trojmiescie (Gdynia)",
        "activity": ["49.12.Z", "49.31.Z"],
        "categories": ["koleje"],
        "supervisory_body": "rada_nadzorcza",
        "is_public": True,
        "owners": [],
        "owner_teryts": [],
        "owner_skarb_panstwa": False,
    }
    base.update(overrides)
    return base


def changes(payload_dict, *, node_rows=None, edge_rows=()):
    snapshot = SiteSnapshot(
        node_rows if node_rows is not None else nodes(), edges(*edge_rows)
    )
    return snapshot.company_changes(payload_dict)


class TestTheNode:
    def test_a_payload_that_restates_the_node_writes_nothing(self):
        assert changes(payload()) == []

    def test_a_company_the_site_does_not_have_is_new(self):
        assert changes(payload(krs="0000999999")) == [NEW_COMPANY]

    def test_a_new_name_is_a_change(self):
        assert changes(payload(name="PKP SKM")) == [COMPANY_FIELDS]

    def test_a_new_category_is_a_change(self):
        assert changes(payload(categories=["koleje", "szpitale"])) == [COMPANY_FIELDS]

    def test_an_emptied_category_set_is_a_change(self):
        # An empty list is a real answer - "in no sector we track" - and has to
        # reach the node, or a company could never lose a category.
        assert changes(payload(categories=[])) == [COMPANY_FIELDS]

    def test_a_category_a_person_set_is_not_overwritten(self):
        # `categoriesSource: "manual"` makes the ingest skip the field, so
        # disagreeing with it is not a change.
        assert (
            changes(
                payload(categories=["szpitale"]),
                node_rows=nodes(company={"categoriesSource": "manual"}),
            )
            == []
        )

    def test_an_ownership_answer_a_person_gave_is_not_overwritten(self):
        assert (
            changes(
                payload(is_public=False),
                node_rows=nodes(company={"isPublicSource": "manual"}),
            )
            == []
        )

    def test_a_payload_with_no_codes_does_not_clear_the_stored_ones(self):
        # An empty `activity` is a payload that found none, not one asserting
        # there are none, and the ingest leaves the stored list alone.
        assert changes(payload(activity=[])) == []

    def test_clearing_the_supervisory_body_is_a_change(self):
        # "" is a deletion rather than a value - see the ingest.
        assert changes(payload(supervisory_body="")) == [COMPANY_FIELDS]

    def test_clearing_a_supervisory_body_that_is_not_there_is_not(self):
        assert (
            changes(
                payload(supervisory_body=""),
                node_rows=nodes(company={"supervisoryBody": None}),
            )
            == []
        )

    def test_a_register_field_the_payload_omits_leaves_the_node_alone(self):
        # A payload from a pipeline that predates `legal_form` must not clear it.
        assert (
            changes(payload(), node_rows=nodes(company={"legalForm": "SPOLKA AKCYJNA"}))
            == []
        )

    def test_a_wikipedia_link_the_node_lacks_is_a_change(self):
        link = "https://pl.wikipedia.org/wiki/PKP_Szybka_Kolej_Miejska_w_Trójmieście"
        assert changes(payload(wikipedia=link)) == [COMPANY_FIELDS]
        assert (
            changes(
                payload(wikipedia=link), node_rows=nodes(company={"wikipedia": link})
            )
            == []
        )

    def test_a_payload_with_no_article_leaves_a_stored_link_alone(self):
        # A reader can link an article the pipelines never matched.
        link = "https://pl.wikipedia.org/wiki/SKM_Trójmiasto"
        assert changes(payload(), node_rows=nodes(company={"wikipedia": link})) == []

    def test_a_node_with_no_approved_revision_is_always_written(self):
        # Approving is what points the node at a revision, so one with nothing
        # to point at is written whatever it says.
        assert changes(payload(), node_rows=nodes(company={"revision_id": None})) == [
            COMPANY_UNAPPROVED
        ]


class TestTheOwners:
    def test_an_owner_the_site_has_no_edge_for_is_a_change(self):
        assert changes(payload(owners=[OWNER_KRS])) == [NEW_OWNER]

    def test_an_owner_already_linked_is_not(self):
        stored = {
            "id": "edge-1",
            "type": "owns",
            "source": OWNER_ID,
            "target": COMPANY_ID,
        }
        assert changes(payload(owners=[OWNER_KRS]), edge_rows=[stored]) == []

    def test_an_owner_the_site_does_not_track_is_skipped(self):
        # The register names 238 shareholders koryta.pl has no node for. The
        # ingest warns and moves on rather than minting one.
        assert changes(payload(owners=["0000999999"])) == []

    def test_one_owner_named_twice_is_one_edge(self):
        assert changes(payload(owners=[OWNER_KRS, OWNER_KRS])) == [NEW_OWNER]

    def test_a_jst_owner_is_resolved_through_its_teryt(self):
        assert changes(payload(owner_teryts=["2262"])) == [NEW_OWNER]

    def test_a_jst_owner_with_no_region_node_is_skipped(self):
        assert changes(payload(owner_teryts=["9999"])) == []

    def test_the_treasury_is_linked_by_node_id(self):
        treasury = {"id": SKARB_PANSTWA_NODE_ID, "type": "place", "name": "Skarb"}
        assert changes(
            payload(owner_skarb_panstwa=True), node_rows=nodes(treasury)
        ) == [NEW_OWNER]

    def test_the_treasury_is_skipped_where_the_site_has_no_such_node(self):
        # A local stack seeded by `seed-emulator.ts` has none, and the ingest
        # checks before pointing an edge at it.
        assert changes(payload(owner_skarb_panstwa=True)) == []


class TestTheSeat:
    def test_an_unrecorded_seat_is_a_change(self):
        assert changes(payload(teryt_code="2262")) == [NEW_SEAT]

    def test_a_recorded_seat_is_not(self):
        stored = {
            "id": "edge-1",
            "type": "seat",
            "source": "teryt2262",
            "target": COMPANY_ID,
        }
        assert changes(payload(teryt_code="2262"), edge_rows=[stored]) == []

    def test_a_seat_still_stored_as_an_owns_edge_counts(self):
        # Until `split-seat-edges.ts` retypes them, a seat written before the
        # `owns`/`seat` split is an `owns` edge, and the ingest declines to
        # write a `seat` beside it.
        stored = {
            "id": "edge-1",
            "type": "owns",
            "source": "teryt2262",
            "target": COMPANY_ID,
        }
        assert changes(payload(teryt_code="2262"), edge_rows=[stored]) == []

    def test_a_seat_stored_in_another_region_is_left_alone(self):
        # 13 companies disagree with the register about where they sit. The
        # ingest reports it and writes nothing, so neither is this a change.
        stored = {
            "id": "edge-1",
            "type": "seat",
            "source": "teryt2263",
            "target": COMPANY_ID,
        }
        assert changes(payload(teryt_code="2262"), edge_rows=[stored]) == []

    def test_a_seat_an_admin_removed_is_not_a_competing_claim(self):
        stored = {
            "id": "edge-1",
            "type": "seat",
            "source": "teryt2263",
            "target": COMPANY_ID,
            "deleted": True,
        }
        assert changes(payload(teryt_code="2262"), edge_rows=[stored]) == [NEW_SEAT]

    def test_a_seat_code_finer_than_a_powiat_falls_back_to_one(self):
        # `get_teryt` reads geonames and returns six digits, which matches no
        # region node - the site records a seat at powiat level.
        assert changes(payload(teryt_code="226201")) == [NEW_SEAT]

    def test_a_seat_the_ingest_cannot_place_writes_nothing(self):
        assert changes(payload(teryt_code="9999")) == []


class _FixedPipeline(Pipeline):
    filename = "mock"

    def __init__(self, data):
        super().__init__()
        self.data = pd.DataFrame(data)

    def should_refresh_with_logic(self, ctx: Context) -> bool:
        return False

    def process(self, ctx: Context) -> pd.DataFrame:
        return self.data

    def read_or_process(self, ctx: Context) -> pd.DataFrame:
        self._cached_result = self.data
        return self.data


ENRICHED_COMPANIES = [
    {
        "krs": KRS,
        "name": "PKP Szybka Kolej Miejska w Trojmiescie",
        "city": "Gdynia",
        "activity": ["49.12.Z", "49.31.Z"],
        "is_public": True,
    },
    {
        "krs": OWNER_KRS,
        "name": "Wlasciciel",
        "city": "Gdynia",
        "activity": ["49.12.Z"],
        "is_public": True,
    },
]


@pytest.fixture
def mock_ctx():
    ctx = MagicMock(spec=Context)
    ctx.refresh_policy = ProcessPolicy.with_default()
    ctx.io = MagicMock()
    return ctx


def _companies_payloads(only_changed: bool, monkeypatch) -> CompaniesPayloads:
    pipeline = Pipeline.create(CompaniesPayloads)
    pipeline.companies = _FixedPipeline(ENRICHED_COMPANIES)  # type: ignore[assignment]
    monkeypatch.setattr(
        "analysis.payloads.company.KorytaCompanies",
        lambda *args, **kwargs: _FixedPipeline([{"krs": KRS}, {"krs": OWNER_KRS}]),
    )
    # The flags come off the process's own argv, which a test does not have.
    pipeline.__dict__["args"] = SimpleNamespace(
        only_changed=only_changed, koryta_date=None
    )
    return pipeline


def test_the_pipeline_emits_every_payload_by_default(mock_ctx, monkeypatch):
    monkeypatch.setattr(
        SiteSnapshot, "read", classmethod(lambda cls, ctx, date=None: 1 / 0)
    )

    result = _companies_payloads(False, monkeypatch).process(mock_ctx)

    assert set(result["krs"]) == {KRS, OWNER_KRS}


def test_the_pipeline_drops_the_companies_the_site_already_matches(
    mock_ctx, monkeypatch
):
    """The whole path, because the two halves agree on field names and nothing
    else: `company_changes` reads `is_public` and `teryt_code` as the payload
    spells them, and a rename on either side would silently keep or drop every
    company rather than fail."""
    site = nodes(
        company={
            "name": "PKP Szybka Kolej Miejska w Trojmiescie (Gdynia)",
            "categories": ["koleje"],
            "supervisoryBody": None,
        }
    )
    snapshot = SiteSnapshot(site, edges())
    monkeypatch.setattr(
        SiteSnapshot, "read", classmethod(lambda cls, ctx, date=None: snapshot)
    )

    result = _companies_payloads(True, monkeypatch).process(mock_ctx)

    # The owner's node says nothing the payload says, so it is kept; the
    # company the site already matches is dropped.
    assert list(result["krs"]) == [OWNER_KRS]
