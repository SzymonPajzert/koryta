"""Which of the people the site judged good had a score before anybody judged them.

A model's job is to put a person in front of a reader before the reader knows
to look. So the question here is not "how did the models rate the published
pages" - it is whether the people who were published, or whom a reader marked
interesting, had been scored at all by the time that happened, and how high.

Today's export cannot answer it. `Population.population` makes a seed of anybody
published or voted on, only the shortlist is banded, and `replace_scores`
retracts the score of whoever leaves it - so almost every published page in
today's export carries no model score, by design rather than by omission. What
the models had said is only in the exports from before the event, one a day,
which is what this reads: every export from `MULTI_MODEL_ERA` to `date`.

For each person and each of the two events it takes the export just before the
event and files them in one of `BUCKETS`:

*   `before_window` - already published, or already marked interesting, in the
    first export read, so nothing can be said about what came first.
*   `no_page` - the page did not exist in the export before: created and
    published (or voted on) the same day, before any model run could see it.
*   `no_model_score` - the page existed and no model had a score standing on it.
    `human_voted_before` says whether that is a retraction: a reader's earlier
    vote takes a person off the shortlist too.
*   `model_score_0` - a model had a score standing and the best of them was 0.
*   `below_gate` - the best model score was under `QUEUE_THRESHOLD`, so the
    person never showed in /eksploruj/nowe?order=recent, which the site gates
    on it (`DEFAULT_MIN_VOTES` in nowe.vue).
*   `in_queue` - scored at or over the gate.

The best model score is the site's own rule: `computeVoteStats`
(frontend/shared/stats.ts) adds a node's human votes to the highest pipeline
vote on it, so for somebody nobody has judged `stats.votes.interesting` is the
best model's band. `site_score_before` keeps what the site stored alongside it.

Not part of the night: it reads every export since `MULTI_MODEL_ERA`, one more
each day, and nothing reads what it writes. Run it when the question is asked:

    .venv/bin/koryta PeopleScoreCoverage --no-backup
"""

import collections
import dataclasses
import typing

import pandas as pd
from memoized_property import memoized_property  # type:ignore

from analysis.scores.base import QUEUE_THRESHOLD
from entities.person import is_pipeline_uid
from scrapers.koryta.download import CURRENT_DATE, FirestoreCollection, was_public
from scrapers.stores import Context, Pipeline

#: The day the models beyond the original `pipeline` uid first appear in an
#: export. Anything earlier can only measure one of them, so both this and
#: `scripts/score_model_accuracy.py` start here rather than pretend the older
#: snapshots say something about `pipeline-capture`.
MULTI_MODEL_ERA = "2026-08-08"

#: The first night the scores were uploaded by the night itself rather than by
#: hand (jobs/score_import, the night's `scores` step). Before it a score could
#: be weeks stale, so `report` gives the nightly era a table of its own.
NIGHTLY_SCORES_SINCE = "2026-10-07"

PUBLISHED = "published"
INTERESTING = "interesting"
EVENTS = (PUBLISHED, INTERESTING)

BEFORE_WINDOW = "before_window"
NO_PAGE = "no_page"
NO_MODEL_SCORE = "no_model_score"
MODEL_SCORE_0 = "model_score_0"
BELOW_GATE = "below_gate"
IN_QUEUE = "in_queue"
BUCKETS = (
    BEFORE_WINDOW,
    NO_PAGE,
    NO_MODEL_SCORE,
    MODEL_SCORE_0,
    BELOW_GATE,
    IN_QUEUE,
)


@dataclasses.dataclass
class Snapshot:
    """What one export says about each person page, narrowed to this question.

    `bands` holds only the models with a score standing; a model absent from it
    said nothing about the person, which is not the same as having said 0.
    """

    stamp: str
    names: dict[str, str] = dataclasses.field(default_factory=dict)
    public: set[str] = dataclasses.field(default_factory=set)
    site_score: dict[str, float] = dataclasses.field(default_factory=dict)
    bands: dict[str, dict[str, int]] = dataclasses.field(default_factory=dict)
    human_voted: set[str] = dataclasses.field(default_factory=set)
    marked_interesting: set[str] = dataclasses.field(default_factory=set)

    @property
    def pages(self) -> set[str]:
        return set(self.names)


@dataclasses.dataclass
class ScoreCoverage:
    """One person, one event, and what the models had said just before it."""

    node_id: str
    name: str
    #: `PUBLISHED` or `INTERESTING`.
    event: str
    #: The first export that shows the event; None when it predates them all.
    event_snapshot: str | None
    #: The export read for the scores: the one before `event_snapshot`.
    before_snapshot: str | None
    #: One of `BUCKETS`.
    bucket: str
    #: `stats.votes.interesting` as the site stored it in `before_snapshot`.
    site_score_before: float | None
    max_band_before: int | None
    n_models_before: int
    #: "uid=band" for every model with a score standing, by uid.
    models_before: str
    human_voted_before: bool
    #: Whether any export up to `before_snapshot` carried a model score for
    #: the person - a person scored once and retracted later reads as scored.
    ever_scored_before: bool
    max_band_ever_before: int | None


def snapshot(stamp: str, nodes: pd.DataFrame, votes: pd.DataFrame) -> Snapshot:
    """One export's person pages and the votes on them.

    A page is a person node that is not a merge tombstone; a merged-away node
    keeps neither its votes nor its place in the queue. A vote carrying
    `extractionId` instead of `nodeId` is somebody rating an extracted fact,
    which no model has an opinion about.
    """
    snap = Snapshot(stamp=stamp)
    for page in nodes.to_dict(orient="records"):
        node_id = str(page.get("id") or "")
        if not node_id or _present(page.get("merged_into")):
            continue
        snap.names[node_id] = str(page.get("name") or "")
        if was_public(page):
            snap.public.add(node_id)
        score = _site_score(page.get("stats"))
        if score is not None:
            snap.site_score[node_id] = score

    for vote in votes.to_dict(orient="records"):
        target = vote.get("nodeId")
        categories = vote.get("categoryVotes")
        if not _present(target) or not isinstance(categories, dict):
            continue
        node_id = str(target)
        if node_id not in snap.names:
            continue
        value = categories.get("interesting")
        uid = str(vote.get("userUid") or "")
        if is_pipeline_uid(uid):
            if isinstance(value, (int, float)) and not pd.isna(value):
                snap.bands.setdefault(node_id, {})[uid] = int(value)
            continue
        snap.human_voted.add(node_id)
        if isinstance(value, (int, float)) and value > 0:
            snap.marked_interesting.add(node_id)
    return snap


def coverage(snapshots: typing.Sequence[Snapshot]) -> list[ScoreCoverage]:
    """Every published and every marked-interesting person, filed by bucket.

    `snapshots` must be in time order. An event is the first export in which a
    person is public (or has a positive human vote) after one in which they
    were not, or were not there at all; a person who was public, lost it and got
    it back counts once, at the first time.
    """
    if not snapshots:
        return []
    first = snapshots[0]
    rows: list[ScoreCoverage] = []
    for event, holds in (
        (PUBLISHED, lambda s: s.public),
        (INTERESTING, lambda s: s.marked_interesting),
    ):
        seen: set[str] = set()
        for node_id in sorted(holds(first)):
            seen.add(node_id)
            rows.append(_row(node_id, first.names[node_id], event, None, None))

        best_ever: dict[str, int] = {}
        for before, after in zip(snapshots, snapshots[1:]):
            for node_id, bands in before.bands.items():
                top = max(bands.values())
                best_ever[node_id] = max(best_ever.get(node_id, top), top)
            for node_id in sorted(holds(after) - seen):
                seen.add(node_id)
                rows.append(
                    _row(
                        node_id,
                        after.names.get(node_id, ""),
                        event,
                        after,
                        before,
                        best_ever.get(node_id),
                    )
                )
    return rows


def _row(
    node_id: str,
    name: str,
    event: str,
    after: Snapshot | None,
    before: Snapshot | None,
    best_ever: int | None = None,
) -> ScoreCoverage:
    if after is None or before is None:
        return ScoreCoverage(
            node_id=node_id,
            name=name,
            event=event,
            event_snapshot=None,
            before_snapshot=None,
            bucket=BEFORE_WINDOW,
            site_score_before=None,
            max_band_before=None,
            n_models_before=0,
            models_before="",
            human_voted_before=False,
            ever_scored_before=False,
            max_band_ever_before=None,
        )

    bands = before.bands.get(node_id, {})
    top = max(bands.values()) if bands else None
    if node_id not in before.pages:
        bucket = NO_PAGE
    elif top is None:
        bucket = NO_MODEL_SCORE
    elif top <= 0:
        bucket = MODEL_SCORE_0
    elif top < QUEUE_THRESHOLD:
        bucket = BELOW_GATE
    else:
        bucket = IN_QUEUE
    return ScoreCoverage(
        node_id=node_id,
        name=name,
        event=event,
        event_snapshot=after.stamp,
        before_snapshot=before.stamp,
        bucket=bucket,
        site_score_before=before.site_score.get(node_id),
        max_band_before=top,
        n_models_before=len(bands),
        models_before=",".join(f"{uid}={band}" for uid, band in sorted(bands.items())),
        human_voted_before=node_id in before.human_voted,
        ever_scored_before=best_ever is not None,
        max_band_ever_before=best_ever,
    )


def report(frame: pd.DataFrame) -> None:
    """The buckets per event, over the whole window and over the nightly era."""
    if frame.empty:
        print("Nobody was published or marked interesting in the window")
        return
    print(
        f"\nWhat the models had said just before a person was published or "
        f"marked interesting (gate: best model score >= {QUEUE_THRESHOLD})"
    )
    in_window = frame[frame.bucket != BEFORE_WINDOW]
    nightly = in_window[in_window.event_snapshot >= NIGHTLY_SCORES_SINCE]
    for title, part in (
        (f"since {MULTI_MODEL_ERA}", in_window),
        (f"since {NIGHTLY_SCORES_SINCE}, scores uploaded nightly", nightly),
    ):
        print(f"\n-- {title} --")
        if part.empty:
            print("   nobody")
            continue
        table = pd.crosstab(part.event, part.bucket).reindex(
            columns=[b for b in BUCKETS if b != BEFORE_WINDOW], fill_value=0
        )
        table["total"] = table.sum(axis=1)
        print(table.to_string())
        unscored = part[part.bucket.isin([NO_PAGE, NO_MODEL_SCORE, MODEL_SCORE_0])]
        for event, rows in unscored.groupby("event"):
            total = int((part.event == event).sum())
            retracted = int(rows.human_voted_before.sum())
            print(
                f"   {event}: {len(rows)} of {total} had no score above 0 "
                f"({len(rows) / total:.0%}); {retracted} of them had a human "
                f"vote already, {int(rows.ever_scored_before.sum())} had been "
                "scored at some earlier export"
            )
    before = frame[frame.bucket == BEFORE_WINDOW]
    counts = collections.Counter(before.event)
    print(
        "\nAlready so in the first export read, and not counted above: "
        + ", ".join(f"{counts.get(e, 0)} {e}" for e in EVENTS)
    )


class PeopleScoreCoverage(Pipeline[ScoreCoverage]):
    """Whether the people published or marked interesting had a model score first.

    One row per person and event; see the module docstring for the buckets.
    `date` is the last day read, today's by default. A past day's exports never
    change, so neither does a stored output for it.
    """

    date: str
    dtype = {
        "node_id": str,
        "name": str,
        "event": str,
        "event_snapshot": str,
        "before_snapshot": str,
        "bucket": str,
        "models_before": str,
    }

    def __init__(self, date: str | None = None) -> None:
        super().__init__()
        self.date = date or CURRENT_DATE

    @memoized_property
    def filename(self) -> str:
        return f"people_score_coverage_{self.date}"

    @property
    def output_class(self):
        return ScoreCoverage

    def process(self, ctx: Context) -> pd.DataFrame:
        snapshots = []
        for day in pd.date_range(MULTI_MODEL_ERA, self.date, freq="D"):
            snap = read_day(ctx, day.date().isoformat())
            if snap is not None:
                snapshots.append(snap)
        print(f"Read {len(snapshots)} exports from {MULTI_MODEL_ERA} to {self.date}")
        rows = coverage(snapshots)
        frame = pd.DataFrame(
            [dataclasses.asdict(row) for row in rows],
            columns=[f.name for f in dataclasses.fields(ScoreCoverage)],
        )
        report(frame)
        return frame


def read_day(ctx: Context, day: str) -> Snapshot | None:
    """The newest export of `day`, or None when it lacks the people or the votes.

    A day without a votes export would read as nobody scored and nobody voted
    on, and file every event after it as unscored; skipping it reads the one
    before instead.
    """
    nodes = FirestoreCollection("nodes", "person", day).process(ctx)
    if nodes.empty:
        return None
    votes = FirestoreCollection("votes", None, day).process(ctx)
    if votes.empty:
        print(f"The {day} export has no votes; reading the day before it instead")
        return None
    return snapshot(str(nodes["date"].iloc[0]), nodes, votes)


def _site_score(stats: object) -> float | None:
    if not isinstance(stats, dict):
        return None
    votes = stats.get("votes")
    if not isinstance(votes, dict):
        return None
    value = votes.get("interesting")
    if isinstance(value, (int, float)) and not pd.isna(value):
        return float(value)
    return None


def _present(value: object) -> bool:
    """Whether a field holds something - not None, NaN or blank."""
    if value is None:
        return False
    if isinstance(value, float) and pd.isna(value):
        return False
    return bool(str(value).strip())
