"""Which of the people the site judged good had a score before anybody judged them.

A model's job is to put a person in front of a reader before the reader knows
to look. So the question here is not "how did the models rate the published
pages" - it is whether the people who were published, or whom a reader marked
interesting, had been scored at all by the time that happened, and how high.

Today's export cannot answer it. `Population.population` makes a seed of anybody
published or voted on, only the shortlist is banded, and `replace_scores`
retracts the score of whoever leaves it - so almost every published page in
today's export carries no model score, by design rather than by omission. What
the models had said is only in the exports from before the event, which is what
this reads: every export from `MULTI_MODEL_ERA` to `date`, all of a day's.

For each person and each of the two events it files them twice, in one of
`BUCKETS` each time: `bucket` by the last export before the event, and
`bucket_at_event` by the first export that shows it. The event happened
between the two, and so did whatever the models said that neither export
caught. `bucket` misses a score a run wrote in between - the hand-run ingests
of August rated new pages that way, and since 2026-10-08 the night rates the
pages it creates hours before anybody publishes them. `bucket_at_event` counts
that score, but also one a run wrote after the event from an export taken
before it, and misses one a run dropped in between. Neither is exact; read
them as a range.

*   `before_window` - already published, or already marked interesting, in the
    first export read, so nothing can be said about what came first.
*   `moved_vote` - marked interesting by a vote older than the export before it,
    which did not have it on this page: a merge moved it here from a duplicate,
    and what the models had said when it was cast is not known.
*   `no_page` - the page was not in the export before: created and published
    (or voted on) between two exports.
*   `no_model_score` - no model had a score standing on the page.
    `human_voted_before` says whether that is a retraction: a reader's earlier
    vote takes a person off the shortlist too.
*   `below_gate` - the best model score was under `QUEUE_THRESHOLD`, so the
    person never showed in /eksploruj/nowe?order=recent, which the site gates
    on it (`DEFAULT_MIN_VOTES` in nowe.vue).
*   `in_queue` - scored at or over the gate.

There is no bucket for a score of 0, because no model can store one:
`banded_scores` drops a raw score of 0 or less rather than band it. A 0 on the
site means that nothing scored the person.

Only the models in `PEOPLE_SCORE_MODELS` count. The site takes the best
pipeline vote of any uid (`computeVoteStats`, frontend/shared/stats.ts), and
one run from outside this repo still has votes standing under its own uid;
`models_before` lists it, and `site_score_before` keeps what the site stored.

Not part of the night: it reads every export since `MULTI_MODEL_ERA`, more each
day, and nothing reads what it writes. Run it when the question is asked:

    .venv/bin/koryta PeopleScoreCoverage --no-backup
"""

import collections
import dataclasses
import itertools
import typing

import pandas as pd
from memoized_property import memoized_property  # type:ignore

from analysis.scores import PEOPLE_SCORE_MODELS, QUEUE_THRESHOLD
from entities.person import is_pipeline_uid
from scrapers.koryta.download import (
    CURRENT_DATE,
    KORYTA_DUMP,
    FirestoreCollection,
    export_timestamp,
    was_public,
)
from scrapers.stores import CloudStorage, Context, Pipeline
from scrapers.stores.file import DownloadableFile

#: The day the models beyond the original `pipeline` uid first appear in an
#: export. Anything earlier can only measure one of them, so both this and
#: `scripts/score_model_accuracy.py` start here rather than pretend the older
#: snapshots say something about `pipeline-capture`.
MULTI_MODEL_ERA = "2026-08-08"

#: The first export whose events all happened with every model's scores on the
#: site. An event it is the first to show came after the 7th's export, and by
#: then a hand run of the night's `scores` step (jobs/score_import) had
#: uploaded them all, on 2026-10-06 at 12:15; the first scheduled night ran on
#: the 8th. Before it a score could be weeks stale, so `report` gives the era a
#: table of its own. Compared against `event_snapshot` as a string.
NIGHTLY_SCORES_SINCE = "2026-10-08"

#: The uids whose votes count as a model's score.
MODEL_TAGS = frozenset(model.model_tag for model in PEOPLE_SCORE_MODELS)

PUBLISHED = "published"
INTERESTING = "interesting"
EVENTS = (PUBLISHED, INTERESTING)

BEFORE_WINDOW = "before_window"
MOVED_VOTE = "moved_vote"
NO_PAGE = "no_page"
NO_MODEL_SCORE = "no_model_score"
BELOW_GATE = "below_gate"
IN_QUEUE = "in_queue"
BUCKETS = (BEFORE_WINDOW, MOVED_VOTE, NO_PAGE, NO_MODEL_SCORE, BELOW_GATE, IN_QUEUE)
#: The buckets that say something about the models, in the order `report`
#: prints them.
SCORED_BUCKETS = (NO_PAGE, NO_MODEL_SCORE, BELOW_GATE, IN_QUEUE)


@dataclasses.dataclass
class Snapshot:
    """What one export says about each person page, narrowed to this question.

    `bands` holds every pipeline uid with a score standing, models from outside
    `MODEL_TAGS` included; a uid absent from it said nothing about the person,
    which is not the same as having said 0.
    """

    stamp: str
    names: dict[str, str] = dataclasses.field(default_factory=dict)
    public: set[str] = dataclasses.field(default_factory=set)
    site_score: dict[str, float] = dataclasses.field(default_factory=dict)
    bands: dict[str, dict[str, int]] = dataclasses.field(default_factory=dict)
    human_voted: set[str] = dataclasses.field(default_factory=set)
    #: Page -> when the earliest positive human vote standing on it was cast.
    #: A page is in it when it is marked interesting, with or without a time.
    marked_interesting: dict[str, pd.Timestamp | None] = dataclasses.field(
        default_factory=dict
    )

    @property
    def pages(self) -> set[str]:
        return set(self.names)


@dataclasses.dataclass
class ScoreCoverage:
    """One person, one event, and what the models had said around it."""

    node_id: str
    name: str
    #: `PUBLISHED` or `INTERESTING`.
    event: str
    #: The first export that shows the event; None when it predates them all.
    event_snapshot: str | None
    #: The last export before it.
    before_snapshot: str | None
    #: One of `BUCKETS`, by `before_snapshot`.
    bucket: str
    #: One of `BUCKETS`, by `event_snapshot`.
    bucket_at_event: str
    #: `stats.votes.interesting` as the site stored it in `before_snapshot`.
    site_score_before: float | None
    max_band_before: int | None
    max_band_at_event: int | None
    #: How many of `MODEL_TAGS` had a score standing in `before_snapshot`.
    n_models_before: int
    #: "uid=band" for every pipeline uid with a score standing, by uid.
    models_before: str
    human_voted_before: bool
    #: Whether any export up to `before_snapshot` carried a model score for
    #: the person - a person scored once and retracted later reads as scored.
    ever_scored_before: bool
    max_band_ever_before: int | None
    #: For `INTERESTING`, when the vote that made it was cast.
    voted_at: str | None


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
            cast = _timestamp(vote.get("updatedAt"))
            known = snap.marked_interesting.get(node_id)
            if node_id not in snap.marked_interesting or (
                cast is not None and (known is None or cast < known)
            ):
                snap.marked_interesting[node_id] = cast
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
    holds: dict[str, typing.Callable[[Snapshot], typing.Collection[str]]] = {
        PUBLISHED: lambda s: s.public,
        INTERESTING: lambda s: s.marked_interesting,
    }
    for event in EVENTS:
        seen = set(holds[event](first))
        rows += [_before_window(n, first.names[n], event) for n in sorted(seen)]
        best_ever: dict[str, int] = {}
        for before, after in itertools.pairwise(snapshots):
            for node_id, bands in before.bands.items():
                top = _best(bands)
                if top is not None:
                    best_ever[node_id] = max(best_ever.get(node_id, top), top)
            for node_id in sorted(set(holds[event](after)) - seen):
                seen.add(node_id)
                rows.append(_row(node_id, event, before, after, best_ever))
    return rows


def _before_window(node_id: str, name: str, event: str) -> ScoreCoverage:
    return ScoreCoverage(
        node_id=node_id,
        name=name,
        event=event,
        event_snapshot=None,
        before_snapshot=None,
        bucket=BEFORE_WINDOW,
        bucket_at_event=BEFORE_WINDOW,
        site_score_before=None,
        max_band_before=None,
        max_band_at_event=None,
        n_models_before=0,
        models_before="",
        human_voted_before=False,
        ever_scored_before=False,
        max_band_ever_before=None,
        voted_at=None,
    )


def _row(
    node_id: str,
    event: str,
    before: Snapshot,
    after: Snapshot,
    best_ever: dict[str, int],
) -> ScoreCoverage:
    bands = before.bands.get(node_id, {})
    top = _best(bands)
    at_event = _best(after.bands.get(node_id, {}))
    bucket = _bucket(node_id in before.pages, top)
    bucket_at_event = _bucket(True, at_event)

    voted_at = after.marked_interesting.get(node_id) if event == INTERESTING else None
    if voted_at is not None and voted_at < pd.Timestamp(before.stamp):
        bucket = bucket_at_event = MOVED_VOTE

    return ScoreCoverage(
        node_id=node_id,
        name=after.names.get(node_id, ""),
        event=event,
        event_snapshot=after.stamp,
        before_snapshot=before.stamp,
        bucket=bucket,
        bucket_at_event=bucket_at_event,
        site_score_before=before.site_score.get(node_id),
        max_band_before=top,
        max_band_at_event=at_event,
        n_models_before=sum(uid in MODEL_TAGS for uid in bands),
        models_before=",".join(f"{uid}={band}" for uid, band in sorted(bands.items())),
        human_voted_before=node_id in before.human_voted,
        ever_scored_before=node_id in best_ever,
        max_band_ever_before=best_ever.get(node_id),
        voted_at=voted_at.isoformat() if voted_at is not None else None,
    )


def _best(bands: dict[str, int]) -> int | None:
    """The best score any of `MODEL_TAGS` gave, or None when none of them did."""
    scores = [band for uid, band in bands.items() if uid in MODEL_TAGS]
    return max(scores) if scores else None


def _bucket(has_page: bool, top: int | None) -> str:
    if not has_page:
        return NO_PAGE
    if top is None:
        return NO_MODEL_SCORE
    if top < QUEUE_THRESHOLD:
        return BELOW_GATE
    return IN_QUEUE


def report(frame: pd.DataFrame) -> None:
    """The buckets per event, over the whole window and over the nightly era."""
    if frame.empty:
        print("Nobody was published or marked interesting in the window")
        return
    print(
        "\nWhat the models had said around the time a person was published or "
        f"marked interesting (gate: best model score >= {QUEUE_THRESHOLD}). "
        "'before' reads the last export before it and 'at event' the first "
        "export that shows it; the truth is between the two."
    )
    in_window = frame[frame.bucket.isin(SCORED_BUCKETS)]
    nightly = in_window[in_window.event_snapshot >= NIGHTLY_SCORES_SINCE]
    for title, part in (
        (f"since {MULTI_MODEL_ERA}", in_window),
        (
            f"shown from the {NIGHTLY_SCORES_SINCE} export, scores kept up nightly",
            nightly,
        ),
    ):
        print(f"\n-- {title} --")
        if part.empty:
            print("   nobody")
            continue
        for column, label in (("bucket", "before"), ("bucket_at_event", "at event")):
            table = pd.crosstab(part.event, part[column]).reindex(
                columns=list(SCORED_BUCKETS), fill_value=0
            )
            table["total"] = table.sum(axis=1)
            print(f"\n   {label}:\n{table.to_string()}")
        for event, rows in part.groupby("event"):
            unscored = rows[rows.bucket.isin([NO_PAGE, NO_MODEL_SCORE])]
            later = rows.bucket_at_event == NO_MODEL_SCORE
            print(
                f"   {event}: {len(unscored)} of {len(rows)} had no model score "
                f"before ({len(unscored) / len(rows):.0%}), {int(later.sum())} "
                f"at the event ({later.mean():.0%}); "
                f"{int(unscored.human_voted_before.sum())} of the first had a "
                f"human vote already, {int(unscored.ever_scored_before.sum())} "
                "had been scored at some earlier export"
            )
    counts = collections.Counter(zip(frame.bucket, frame.event))
    for bucket, meaning in (
        (BEFORE_WINDOW, "already so in the first export read"),
        (MOVED_VOTE, "marked interesting by a vote a merge moved"),
    ):
        print(
            f"\nNot counted above, {meaning}: "
            + ", ".join(f"{counts.get((bucket, e), 0)} {e}" for e in EVENTS)
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
        "bucket_at_event": str,
        "models_before": str,
        "voted_at": str,
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
            for stamp in export_stamps(ctx, day.date().isoformat()):
                snap = read_export(ctx, stamp)
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


def export_stamps(ctx: Context, day: str) -> list[str]:
    """Every export taken on `day` that holds both people and votes, oldest first.

    All of them rather than the newest, which is what `FirestoreCollection`
    reads for a day: with two exports a day, the newest alone can put the
    export before an event a day earlier than it was.
    """
    kinds: dict[str, set[str]] = collections.defaultdict(set)
    prefix = CloudStorage(prefix=f"{KORYTA_DUMP.prefix}/date={day}", binary=True)
    for blob in ctx.io.list_files(prefix):
        assert isinstance(blob, DownloadableFile)
        stamp = export_timestamp(blob)
        if not stamp or "output" not in blob.filename:
            continue
        for kind in ("nodes", "votes"):
            if f"kind_{kind}" in blob.filename:
                kinds[stamp].add(kind)
    return sorted(stamp for stamp, have in kinds.items() if have >= {"nodes", "votes"})


def read_export(ctx: Context, stamp: str) -> Snapshot | None:
    """One export, or None when it lacks the people or the votes.

    An export without votes would read as nobody scored and nobody voted on,
    and file every event after it as unscored; skipping it reads the one
    before instead. `FirestoreCollection` matches its `date` against the
    `date=` namespace as a substring, so the full timestamp names one export.
    """
    nodes = FirestoreCollection("nodes", "person", stamp).process(ctx)
    votes = FirestoreCollection("votes", None, stamp).process(ctx)
    if nodes.empty or votes.empty:
        print(f"The {stamp} export lacks people or votes; skipping it")
        return None
    return snapshot(stamp, nodes, votes)


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


def _timestamp(value: object) -> pd.Timestamp | None:
    """A vote's `updatedAt` as a UTC time, or None when it has none."""
    if not _present(value):
        return None
    stamp = pd.to_datetime(str(value), utc=True, errors="coerce")
    return stamp if isinstance(stamp, pd.Timestamp) else None


def _present(value: object) -> bool:
    """Whether a field holds something - not None, NaN or blank."""
    if value is None:
        return False
    if isinstance(value, float) and pd.isna(value):
        return False
    return bool(str(value).strip())
