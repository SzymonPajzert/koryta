"""Which scoring model is worth a reader's time, measured against their votes.

Every model in `analysis.scores` writes its verdict to the site as a vote under
its own `pipeline-*` uid, and the site shows a person whose best model score
reaches `QUEUE_THRESHOLD`. Nothing in that loop ever asked whether a model is
right. This does, by reading the one label the site produces: a reader opens
somebody, looks them up, and votes -5..+5 on whether they were worth it.

The join is the awkward part, because a model's vote does not survive being
answered. `Firestore.replace_scores` retracts the score of anybody who has left
the shortlist, and a human vote is exactly what takes somebody off it - so by
the time a verdict exists, the score that caused it has been deleted. The
nightly Firestore export to GCS is what makes the pairing possible at all:
every snapshot holds the scores standing that morning, and a human vote carries
`updatedAt`, so the score a reader actually saw is the one in the newest
snapshot before their vote.

That gives two populations, and they answer different questions:

*   **queue** - a score was standing when the reader voted. This is production
    behaviour, and it is selection-biased on purpose: these are the people the
    queue put in front of somebody, which is the thing being judged.
*   **blind** - no score was standing, and the models scored the person in the
    very next run. The reader cannot have been influenced by a score that did
    not exist, and the model cannot have been seeded on a vote its input export
    predated, so this is the closest thing to a controlled test the site
    produces. It exists because ingest and review run at different speeds
    rather than because anybody arranged it, and it is small.

A model is reported on both, and a claim that holds on only one of them is a
claim about the queue rather than about the model.

    uv run python src/scripts/score_model_accuracy.py
    uv run python src/scripts/score_model_accuracy.py --since 2026-08-08
    uv run python src/scripts/score_model_accuracy.py --csv rows.csv
"""

import argparse
import collections
import dataclasses
import typing

import pandas as pd
from leveldb_export import parse_leveldb_documents  # type: ignore

from analysis.scores import PEOPLE_SCORE_MODELS, QUEUE_THRESHOLD
from analysis.scores.coverage import MULTI_MODEL_ERA
from conductor import setup_context
from entities.person import is_pipeline_uid
from scrapers.koryta.download import export_timestamp
from scrapers.stores import CloudStorage, Context
from scrapers.stores.file import DownloadableFile

#: What counts as the reader having been glad they looked. +1 is "ciekawe" and
#: +3 is "koryciarz" - see `scaleLabels` in frontend/app/composables/votes.ts,
#: which is the ladder the numbers on the site mean.
INTERESTING = 1
STRONG = 3

#: And what counts as the click having been wasted. -1 is "nie moge znalezc
#: informacji", the commonest negative by a distance: the reader went looking
#: and there was nothing there.
WASTED = -1


@dataclasses.dataclass
class Verdict:
    """One person, what a reader said about them, and what the models had said.

    `scores` holds only the models that had an opinion; a model absent from it
    said nothing about this person, which is different from having said 1.
    """

    node_id: str
    name: str
    verdict: int
    population: str
    scores: dict[str, int]


def vote_blobs(ctx: Context, since: str) -> dict[str, list[DownloadableFile]]:
    """The votes half of every export from `since` on, grouped by export.

    Listed a day at a time. `FirestoreCollection` lists the whole
    `hostname=koryta.pl` prefix per call, which is fine when a run reads one
    export and hopeless when it reads forty: the bucket holds two exports a day
    of eight collections going back to December, and listing all of that takes
    longer than everything else here put together. A day's prefix is a few
    thousand objects, and the `date=` namespace is an ISO timestamp, so the day
    is a prefix of it.
    """
    grouped: dict[str, list[DownloadableFile]] = collections.defaultdict(list)
    today = pd.Timestamp.now(tz="UTC").date()
    for day in pd.date_range(since, today, freq="D"):
        prefix = f"hostname=koryta.pl/date={day.date().isoformat()}"
        for blob in ctx.io.list_files(CloudStorage(prefix=prefix, binary=True)):
            assert isinstance(blob, DownloadableFile)
            if "output" not in blob.filename or "votes" not in blob.filename:
                continue
            stamp = export_timestamp(blob)
            if stamp:
                grouped[stamp].append(blob)
    return dict(sorted(grouped.items()))


def read_export(ctx: Context, blobs: list[DownloadableFile]) -> list[dict]:
    """The vote documents in one export, as plain dicts.

    Only votes on a node: a vote carrying `extractionId` instead is somebody
    rating an extracted fact, which no scoring model has an opinion about.
    """
    rows = []
    for blob in blobs:
        for doc in parse_leveldb_documents(ctx.io.read_data(blob).read_file()):
            categories = doc.get("categoryVotes")
            node_id = doc.get("nodeId")
            if not isinstance(categories, dict) or not node_id:
                continue
            rows.append(
                {
                    "node_id": str(node_id),
                    "uid": str(doc.get("userUid")),
                    "interesting": categories.get("interesting"),
                    "updated_at": doc.get("updatedAt"),
                }
            )
    return rows


def panel(ctx: Context, since: str) -> pd.DataFrame:
    """One row per (export, vote) for every export on or after `since`.

    A pipeline vote carries no timestamp of its own - the model rewrites the
    document rather than dating it - so which snapshot it appears in is the
    only clock it has, and reading the exports is the only way to get one.
    """
    frames = []
    exports = vote_blobs(ctx, since)
    print(f"Reading {len(exports)} votes exports since {since}")
    for stamp, blobs in exports.items():
        frame = pd.DataFrame.from_records(read_export(ctx, blobs))
        frame["snapshot"] = pd.Timestamp(stamp)
        frames.append(frame)
    if not frames:
        raise SystemExit(f"No votes exports on or after {since}")
    return pd.concat(frames, ignore_index=True)


def people(ctx: Context) -> dict[str, str]:
    """Node id -> name, for people only.

    A vote can name a place or an article, and no scoring model has ever had an
    opinion about either, so counting those would dilute every rate here with
    rows no model could have got right or wrong.
    """
    from scrapers.koryta.download import FirestoreCollection  # noqa: PLC0415

    nodes, date = FirestoreCollection.latest_on_or_before(ctx, "nodes", "person")
    print(f"Read {len(nodes)} people from the {date} export")
    return dict(zip(nodes["id"].astype(str), nodes.get("name", nodes["id"])))


def verdicts(frame: pd.DataFrame, names: dict[str, str]) -> list[Verdict]:
    """Pair every human vote with the model scores it was cast against.

    The pairing is per snapshot rather than per person, because a person can be
    scored, retracted and scored again, and only the score standing at the
    moment of the vote is the one the reader was answering.
    """
    frame = frame.copy()
    frame["is_pipeline"] = frame["uid"].map(is_pipeline_uid)
    frame["voted_at"] = pd.to_datetime(
        frame["updated_at"], format="ISO8601", utc=True, errors="coerce"
    )
    snapshots = pd.DatetimeIndex(sorted(frame["snapshot"].unique()))

    scores = (
        frame[frame["is_pipeline"]]
        .pivot_table(
            index=["node_id", "snapshot"],
            columns="uid",
            values="interesting",
            aggfunc="max",
        )
        .to_dict(orient="index")
    )

    human = frame[~frame["is_pipeline"] & frame["voted_at"].notna()]
    # The export repeats every vote every night, and a reader may revise one.
    # The last snapshot's version of it is the verdict that stands.
    human = (
        human.sort_values("snapshot").groupby(["node_id", "uid"], as_index=False).last()
    )

    out: list[Verdict] = []
    for row in human.itertuples():
        node_id = str(row.node_id)
        if node_id not in names or pd.isna(row.interesting):
            continue
        before = int(snapshots.searchsorted(row.voted_at, side="left")) - 1
        if before < 0:
            # Voted on before the first export read, so nothing can be said
            # about what the models had on them at the time.
            continue

        standing = _clean(scores.get((node_id, snapshots[before])))
        if standing:
            population = "queue"
        elif before + 1 < len(snapshots):
            standing = _clean(scores.get((node_id, snapshots[before + 1])))
            population = "blind"
        else:
            continue
        if not standing:
            continue
        out.append(
            Verdict(
                node_id=node_id,
                name=names[node_id],
                verdict=int(typing.cast(int, row.interesting)),
                population=population,
                scores=standing,
            )
        )
    return out


def _clean(scores: dict | None) -> dict[str, int]:
    """A snapshot's score row with the models that said nothing dropped."""
    if not scores:
        return {}
    return {uid: int(v) for uid, v in scores.items() if pd.notna(v)}


def as_frame(found: list[Verdict]) -> pd.DataFrame:
    """The verdicts as a table, one column per model, NaN where it was silent."""
    rows = []
    for verdict in found:
        row = {
            "node_id": verdict.node_id,
            "name": verdict.name,
            "verdict": verdict.verdict,
            "population": verdict.population,
        }
        row.update(verdict.scores)
        rows.append(row)
    return pd.DataFrame.from_records(rows)


def model_columns(frame: pd.DataFrame) -> list[str]:
    """The model columns present, known models first and in run order.

    A uid nobody in this repo writes still gets reported - the site has carried
    at least one model run from outside it - because leaving it out would make
    the base rate include the people it nominated while crediting them to
    nobody.
    """
    known = [m.model_tag for m in PEOPLE_SCORE_MODELS if m.model_tag in frame]
    return known + sorted(
        c for c in frame.columns if is_pipeline_uid(c) and c not in known
    )


def report(frame: pd.DataFrame) -> None:
    verdict = frame["verdict"]
    models = model_columns(frame)
    print(
        f"\n{len(frame)} people judged by a reader "
        f"({(frame.population == 'queue').sum()} with a score standing, "
        f"{(frame.population == 'blind').sum()} blind)"
    )
    print(
        f"Base rate: {(verdict >= INTERESTING).mean():.0%} called interesting, "
        f"{(verdict <= WASTED).mean():.0%} a wasted click\n"
    )

    rows = []
    for uid in models:
        named = frame[frame[uid].notna()]
        if named.empty:
            continue
        low = named[named[uid] < QUEUE_THRESHOLD]
        high = named[named[uid] >= QUEUE_THRESHOLD]
        rows.append(
            {
                "model": uid,
                "n": len(named),
                "interesting": (named.verdict >= INTERESTING).mean(),
                "strong": (named.verdict >= STRONG).mean(),
                "wasted": (named.verdict <= WASTED).mean(),
                "mean": named.verdict.mean(),
                f"band<{QUEUE_THRESHOLD}": (low.verdict >= INTERESTING).mean()
                if len(low)
                else float("nan"),
                f"band>={QUEUE_THRESHOLD}": (high.verdict >= INTERESTING).mean()
                if len(high)
                else float("nan"),
            }
        )
    table = pd.DataFrame(rows).sort_values("mean", ascending=False)
    print(table.to_string(index=False, float_format=lambda v: f"{v:.2f}"))
    print(
        "\n`interesting` is the share of the people a model named whom the reader "
        "rated +1 or better; compare it against the base rate above, not against "
        f"50%. The two band columns are that same share for the model saying less "
        f"than {QUEUE_THRESHOLD} against it saying {QUEUE_THRESHOLD} or more, "
        "which is whether its own ordering means anything."
    )

    for population in ("queue", "blind"):
        part = frame[frame.population == population]
        if part.empty:
            continue
        print(
            f"\n-- {population} only (n={len(part)}, "
            f"base {(part.verdict >= INTERESTING).mean():.0%}) --"
        )
        for uid in models:
            named = part[part[uid].notna()]
            if len(named) < 5:
                continue
            print(
                f"   {uid:24s} n={len(named):4d}  "
                f"interesting {(named.verdict >= INTERESTING).mean():.0%}  "
                f"mean {named.verdict.mean():+.2f}"
            )

    print("\n-- per band --")
    for uid in models:
        named = frame[frame[uid].notna()]
        if len(named) < 10:
            continue
        grouped = named.groupby(uid).agg(
            n=("verdict", "size"),
            interesting=("verdict", lambda s: (s >= INTERESTING).mean()),
            wasted=("verdict", lambda s: (s <= WASTED).mean()),
            mean=("verdict", "mean"),
        )
        print(f"\n   {uid}")
        print(grouped.to_string(float_format=lambda v: f"{v:.2f}"))


def main(argv: typing.Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--since",
        default=MULTI_MODEL_ERA,
        help="Read exports from this date on (default: when the models went live)",
    )
    parser.add_argument("--csv", help="Write the paired rows here as well")
    args = parser.parse_args(argv)

    ctx, _ = setup_context()
    frame = as_frame(verdicts(panel(ctx, args.since), people(ctx)))
    if frame.empty:
        raise SystemExit("No reader has judged anybody a model had scored yet")
    report(frame)
    if args.csv:
        frame.to_csv(args.csv, index=False)
        print(f"\nWrote {len(frame)} rows to {args.csv}")


if __name__ == "__main__":
    main()
