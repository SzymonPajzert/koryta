"""Whether the people the site judged good had a model score before the judging.

The score that matters is the one standing around the time a person was
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
    MOVED_VOTE,
    NO_MODEL_SCORE,
    NO_PAGE,
    PUBLISHED,
    PeopleScoreCoverage,
    Snapshot,
    coverage,
    export_stamps,
    report,
    snapshot,
)
from scrapers.koryta.download import FirestoreCollection
from scrapers.stores.file import DownloadableFile

#: A uid that writes pipeline votes the site counts, from a run outside the
#: repo's models.
OUTSIDE_RUN = "pipeline-deepseek-v4-flash-investigator-v0"


def snap(
    stamp: str,
    pages: dict[str, str],
    public: set[str] = frozenset(),  # type: ignore[assignment]
    bands: dict[str, dict[str, int]] | None = None,
    human_voted: set[str] = frozenset(),  # type: ignore[assignment]
    marked_interesting: dict[str, str | None] | None = None,
) -> Snapshot:
    marked = {
        node: None if cast is None else pd.Timestamp(cast)
        for node, cast in (marked_interesting or {}).items()
    }
    return Snapshot(
        stamp=stamp,
        names=dict(pages),
        public=set(public),
        site_score={node: float(max(b.values())) for node, b in (bands or {}).items()},
        bands=dict(bands or {}),
        human_voted=set(human_voted) | set(marked),
        marked_interesting=marked,
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
        (1, BELOW_GATE),
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


def test_a_vote_from_outside_the_models_is_listed_but_scores_nobody():
    rows = coverage(
        [
            snap("d1", {"a": "A"}, bands={"a": {OUTSIDE_RUN: 5}}),
            snap("d2", {"a": "A"}, public={"a"}),
        ]
    )
    row = by_node(rows)["a"]
    assert (row.bucket, row.max_band_before, row.n_models_before) == (
        NO_MODEL_SCORE,
        None,
        0,
    )
    assert row.models_before == f"{OUTSIDE_RUN}=5"


def test_a_page_created_and_published_between_two_exports_had_no_page():
    rows = coverage([snap("d1", {}), snap("d2", {"a": "A"}, public={"a"})])
    row = by_node(rows)["a"]
    assert (row.bucket, row.bucket_at_event) == (NO_PAGE, NO_MODEL_SCORE)
    assert row.name == "A"
    assert row.n_models_before == 0


def test_a_score_written_between_the_exports_shows_at_the_event():
    # The night creates the page and rates it hours before anybody publishes
    # it, and the export before never saw either.
    rows = coverage(
        [
            snap("d1", {}),
            snap("d2", {"a": "A"}, public={"a"}, bands={"a": {"pipeline-facts": 4}}),
        ]
    )
    row = by_node(rows)["a"]
    assert (row.bucket, row.bucket_at_event) == (NO_PAGE, IN_QUEUE)
    assert (row.max_band_before, row.max_band_at_event) == (None, 4)


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
    assert row.bucket == row.bucket_at_event == BEFORE_WINDOW
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
            snap("d2", {"a": "A"}, marked_interesting={"a": None}),
        ]
    )
    assert PUBLISHED not in {r.event for r in rows}
    row = by_node(rows, INTERESTING)["a"]
    assert (row.bucket, row.max_band_before, row.voted_at) == (BELOW_GATE, 2, None)


def test_a_vote_older_than_the_export_before_it_was_moved_by_a_merge():
    rows = coverage(
        [
            snap("2026-08-30T02:00:00Z", {"a": "A", "b": "B"}),
            snap("2026-08-31T02:00:00Z", {"a": "A", "b": "B"}),
            snap(
                "2026-09-01T02:00:00Z",
                {"a": "A", "b": "B"},
                marked_interesting={
                    # Cast in July on the duplicate a merge folded into `a`.
                    "a": "2026-07-15T10:00:00Z",
                    "b": "2026-08-31T15:00:00Z",
                },
            ),
        ]
    )
    a, b = by_node(rows, INTERESTING)["a"], by_node(rows, INTERESTING)["b"]
    assert a.bucket == a.bucket_at_event == MOVED_VOTE
    assert a.voted_at == "2026-07-15T10:00:00+00:00"
    assert b.bucket == NO_MODEL_SCORE


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
            {
                "nodeId": "a",
                "userUid": "reader",
                "categoryVotes": {"interesting": 1},
                "updatedAt": "2026-09-30T12:00:00.000Z",
            },
            {
                "nodeId": "a",
                "userUid": "other",
                "categoryVotes": {"interesting": 3},
                "updatedAt": "2026-09-20T12:00:00.000Z",
            },
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
    # The earliest positive vote is when the page was first marked.
    assert got.marked_interesting == {"a": pd.Timestamp("2026-09-20T12:00:00Z")}


def blob(stamp: str, kind: str, part: str = "output-0") -> DownloadableFile:
    """A blob ref shaped like the ones `Client.list_blobs` hands back."""
    name = f"hostname=koryta.pl/date={stamp}/all_namespaces/kind_{kind}/{part}"
    return DownloadableFile(f"gs://koryta-pl-crawled/{name}", name.replace("/", "."))


def test_every_export_of_a_day_with_people_and_votes_is_read_oldest_first():
    ctx = Mock()
    ctx.io.list_files.return_value = [
        blob("2026-09-12T15:42:24.612Z", "nodes"),
        blob("2026-09-12T15:42:24.612Z", "votes"),
        blob("2026-09-12T02:00:10.000Z", "votes"),
        blob("2026-09-12T02:00:10.000Z", "nodes"),
        blob("2026-09-12T02:00:10.000Z", "nodes", "output-1"),
        # An export cut short before its votes is no use here.
        blob("2026-09-12T09:00:00.000Z", "nodes"),
        blob("2026-09-12T09:00:00.000Z", "edges"),
    ]
    assert export_stamps(ctx, "2026-09-12") == [
        "2026-09-12T02:00:10.000Z",
        "2026-09-12T15:42:24.612Z",
    ]
    (prefix,) = ctx.io.list_files.call_args.args
    assert prefix.prefix == "hostname=koryta.pl/date=2026-09-12"


def test_the_pipeline_reads_each_export_and_skips_one_without_votes(capsys):
    person = {"id": "a", "name": "A"}
    scored = pd.DataFrame(
        [{"nodeId": "a", "userUid": "pipeline", "categoryVotes": {"interesting": 4}}]
    )
    exports = {
        ("nodes", "2026-08-08T02:00:00Z"): nodes_frame("x", [person]),
        ("votes", "2026-08-08T02:00:00Z"): scored,
        # The 9th's export has its people and lost its votes: read as "nobody
        # scored" it would file the 10th's publication as unscored.
        ("nodes", "2026-08-09T02:00:00Z"): nodes_frame("x", [person]),
        ("nodes", "2026-08-10T02:00:00Z"): nodes_frame(
            "x", [{**person, "published": True}]
        ),
        ("votes", "2026-08-10T02:00:00Z"): scored,
    }

    def process(self, ctx):
        return exports.get((self.collection_name, self.date), pd.DataFrame())

    def stamps(ctx, day):
        return [f"{day}T02:00:00Z"]

    with (
        patch.object(FirestoreCollection, "process", process),
        patch("analysis.scores.coverage.export_stamps", stamps),
    ):
        frame = PeopleScoreCoverage(date="2026-08-10").process(Mock())

    row = frame[frame.event == PUBLISHED].iloc[0]
    assert (row.bucket, row.bucket_at_event) == (IN_QUEUE, IN_QUEUE)
    assert row.before_snapshot == "2026-08-08T02:00:00Z"
    out = capsys.readouterr().out
    assert "Read 2 exports" in out
    assert "The 2026-08-09T02:00:00Z export lacks people or votes" in out


def test_report_prints_both_bounds_and_eras_and_survives_an_empty_frame(capsys):
    rows = coverage(
        [
            snap(
                "2026-10-05T02:00:00Z",
                {"a": "A", "b": "B"},
                bands={"a": {"pipeline": 4}},
            ),
            snap(
                "2026-10-08T02:00:00Z",
                {"a": "A", "b": "B"},
                public={"a", "b"},
                bands={"a": {"pipeline": 4}, "b": {"pipeline-facts": 3}},
            ),
        ]
    )
    frame = pd.DataFrame([r.__dict__ for r in rows])
    report(frame)
    out = capsys.readouterr().out
    assert "scores kept up nightly" in out
    assert "at event:" in out
    assert "published: 1 of 2 had no model score before (50%), 0 at the event" in out

    report(frame.iloc[0:0])
    assert "Nobody was published" in capsys.readouterr().out
