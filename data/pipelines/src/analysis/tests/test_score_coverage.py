"""Whether the people the site judged good had a model score before the judging.

The score that matters is the one standing in the export *before* a person was
published or marked interesting: the models retract a score as soon as a person
is judged, so today's export says nothing about what came first.
"""

from unittest.mock import Mock, patch

import pandas as pd
import pytest

from analysis.scores import QUEUE_THRESHOLD
from analysis.scores.coverage import (
    BEFORE_WINDOW,
    BELOW_GATE,
    IN_QUEUE,
    INTERESTING,
    MODEL_SCORE_0,
    NO_MODEL_SCORE,
    NO_PAGE,
    PUBLISHED,
    PeopleScoreCoverage,
    Snapshot,
    coverage,
    report,
    snapshot,
)
from scrapers.koryta.download import FirestoreCollection


def snap(
    stamp: str,
    pages: dict[str, str],
    public: set[str] = frozenset(),  # type: ignore[assignment]
    bands: dict[str, dict[str, int]] | None = None,
    human_voted: set[str] = frozenset(),  # type: ignore[assignment]
    marked_interesting: set[str] = frozenset(),  # type: ignore[assignment]
) -> Snapshot:
    return Snapshot(
        stamp=stamp,
        names=dict(pages),
        public=set(public),
        site_score={node: float(max(b.values())) for node, b in (bands or {}).items()},
        bands=dict(bands or {}),
        human_voted=set(human_voted) | set(marked_interesting),
        marked_interesting=set(marked_interesting),
    )


def by_node(rows, event=PUBLISHED):
    return {row.node_id: row for row in rows if row.event == event}


def test_a_person_published_while_scored_over_the_gate_was_in_the_queue():
    rows = coverage(
        [
            snap(
                "d1", {"a": "A"}, bands={"a": {"pipeline": 2, "pipeline-turnover": 4}}
            ),
            snap("d2", {"a": "A"}, public={"a"}),
        ]
    )
    row = by_node(rows)["a"]
    assert row.bucket == IN_QUEUE
    assert (row.event_snapshot, row.before_snapshot) == ("d2", "d1")
    assert row.max_band_before == 4
    assert row.n_models_before == 2
    assert row.models_before == "pipeline=2,pipeline-turnover=4"
    assert row.site_score_before == 4.0


@pytest.mark.parametrize(
    ("band", "bucket"),
    [
        (0, MODEL_SCORE_0),
        (QUEUE_THRESHOLD - 1, BELOW_GATE),
        (QUEUE_THRESHOLD, IN_QUEUE),
    ],
)
def test_the_best_model_band_decides_the_bucket(band, bucket):
    rows = coverage(
        [
            snap("d1", {"a": "A"}, bands={"a": {"pipeline": band}}),
            snap("d2", {"a": "A"}, public={"a"}),
        ]
    )
    assert by_node(rows)["a"].bucket == bucket


def test_a_page_created_and_published_between_two_exports_had_no_page():
    rows = coverage([snap("d1", {}), snap("d2", {"a": "A"}, public={"a"})])
    row = by_node(rows)["a"]
    assert row.bucket == NO_PAGE
    assert row.name == "A"
    assert row.n_models_before == 0


def test_a_page_nobody_scored_is_told_from_one_whose_score_a_vote_took_away():
    rows = coverage(
        [
            snap("d1", {"a": "A", "b": "B"}, bands={"a": {"pipeline": 4}}),
            # A reader's vote on `a` takes it off the shortlist; the next model
            # run retracts its score, which this export no longer has.
            snap("d2", {"a": "A", "b": "B"}, human_voted={"a"}),
            snap("d3", {"a": "A", "b": "B"}, public={"a", "b"}, human_voted={"a"}),
        ]
    )
    a, b = by_node(rows)["a"], by_node(rows)["b"]
    assert (a.bucket, b.bucket) == (NO_MODEL_SCORE, NO_MODEL_SCORE)
    assert (a.human_voted_before, b.human_voted_before) == (True, False)
    assert (a.ever_scored_before, a.max_band_ever_before) == (True, 4)
    assert (b.ever_scored_before, b.max_band_ever_before) == (False, None)


def test_a_score_from_after_the_event_does_not_count_as_ever_scored():
    rows = coverage(
        [
            snap("d1", {"a": "A"}),
            snap("d2", {"a": "A"}, public={"a"}),
            snap("d3", {"a": "A"}, public={"a"}, bands={"a": {"pipeline": 5}}),
        ]
    )
    row = by_node(rows)["a"]
    assert (row.bucket, row.ever_scored_before) == (NO_MODEL_SCORE, False)


def test_somebody_public_in_the_first_export_read_is_before_the_window():
    rows = coverage(
        [
            snap("d1", {"a": "A"}, public={"a"}),
            snap("d2", {"a": "A"}, public={"a"}),
        ]
    )
    row = by_node(rows)["a"]
    assert row.bucket == BEFORE_WINDOW
    assert (row.event_snapshot, row.before_snapshot) == (None, None)


def test_a_page_published_twice_counts_at_the_first_time():
    rows = coverage(
        [
            snap("d1", {"a": "A"}, bands={"a": {"pipeline": 3}}),
            snap("d2", {"a": "A"}, public={"a"}),
            snap("d3", {"a": "A"}),
            snap("d4", {"a": "A"}, public={"a"}),
        ]
    )
    assert [r.event_snapshot for r in rows if r.event == PUBLISHED] == ["d2"]


def test_a_reader_marking_somebody_interesting_is_its_own_event():
    rows = coverage(
        [
            snap("d1", {"a": "A"}, bands={"a": {"pipeline-capture": 2}}),
            snap("d2", {"a": "A"}, marked_interesting={"a"}),
        ]
    )
    assert PUBLISHED not in {r.event for r in rows}
    row = by_node(rows, INTERESTING)["a"]
    assert (row.bucket, row.max_band_before) == (BELOW_GATE, 2)


def nodes_frame(stamp: str, rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame([{**row, "date": stamp} for row in rows])


def test_snapshot_reads_pages_scores_and_human_votes_off_an_export():
    nodes = nodes_frame(
        "2026-10-01T02:00:00Z",
        [
            {
                "id": "a",
                "name": "A",
                "published": True,
                "stats": {"votes": {"interesting": 3}},
            },
            {"id": "b", "name": "B", "published": False},
            {"id": "c", "name": "C", "deleted": True, "merged_into": "a"},
        ],
    )
    votes = pd.DataFrame(
        [
            {
                "nodeId": "b",
                "userUid": "pipeline-turnover",
                "categoryVotes": {"interesting": 2},
            },
            {"nodeId": "b", "userUid": "reader", "categoryVotes": {"interesting": -1}},
            {"nodeId": "a", "userUid": "reader", "categoryVotes": {"interesting": 1}},
            # A vote on an extracted fact names no node.
            {
                "nodeId": float("nan"),
                "userUid": "reader",
                "categoryVotes": {"interesting": 1},
            },
            # The merged-away page keeps no votes.
            {"nodeId": "c", "userUid": "pipeline", "categoryVotes": {"interesting": 5}},
        ]
    )
    got = snapshot("2026-10-01T02:00:00Z", nodes, votes)
    assert got.pages == {"a", "b"}
    assert got.public == {"a"}
    assert got.site_score == {"a": 3.0}
    assert got.bands == {"b": {"pipeline-turnover": 2}}
    assert got.human_voted == {"a", "b"}
    assert got.marked_interesting == {"a"}


def test_the_pipeline_skips_a_day_whose_export_has_no_votes(capsys):
    person = {"id": "a", "name": "A"}
    exports = {
        ("nodes", "2026-08-08"): nodes_frame("2026-08-08T02:00:00Z", [person]),
        ("votes", "2026-08-08"): pd.DataFrame(
            [
                {
                    "nodeId": "a",
                    "userUid": "pipeline",
                    "categoryVotes": {"interesting": 4},
                }
            ]
        ),
        # The 9th has its people and lost its votes: read as "nobody scored"
        # it would file the 10th's publication as unscored.
        ("nodes", "2026-08-09"): nodes_frame("2026-08-09T02:00:00Z", [person]),
        ("nodes", "2026-08-10"): nodes_frame(
            "2026-08-10T02:00:00Z", [{**person, "published": True}]
        ),
        ("votes", "2026-08-10"): pd.DataFrame(
            [
                {
                    "nodeId": "a",
                    "userUid": "pipeline",
                    "categoryVotes": {"interesting": 4},
                }
            ]
        ),
    }

    def process(self, ctx):
        return exports.get((self.collection_name, self.date), pd.DataFrame())

    with patch.object(FirestoreCollection, "process", process):
        frame = PeopleScoreCoverage(date="2026-08-10").process(Mock())

    row = frame[frame.event == PUBLISHED].iloc[0]
    assert row.bucket == IN_QUEUE
    assert row.before_snapshot == "2026-08-08T02:00:00Z"
    assert "Read 2 exports" in capsys.readouterr().out


def test_report_prints_both_eras_and_survives_an_empty_frame(capsys):
    rows = coverage(
        [
            snap(
                "2026-10-05T02:00:00Z",
                {"a": "A", "b": "B"},
                bands={"a": {"pipeline": 4}},
            ),
            snap("2026-10-08T02:00:00Z", {"a": "A", "b": "B"}, public={"a", "b"}),
        ]
    )
    frame = pd.DataFrame([r.__dict__ for r in rows])
    report(frame)
    out = capsys.readouterr().out
    assert "scores uploaded nightly" in out
    assert "published: 1 of 2 had no score above 0 (50%)" in out

    report(frame.iloc[0:0])
    assert "Nobody was published" in capsys.readouterr().out
