"""Measure the scoring models against the only ground truth the site has.

The five models in ``analysis.scores`` nominate people to look at next, and
nothing has ever checked whether they nominate the right ones. The site does
hold an answer key: the people a human published, and the people a human voted
on. ``Population`` already treats both as truth - a published page is worth
``IS_PUBLIC_SCORE`` and a human vote is worth its own value - but it uses them
only as seeds, and a seed is never scored, so the models are never graded.

This grades them, by hiding part of the answer key. The labelled people are cut
into ``--folds`` slices; for each slice the held-out people lose their seed
weight and join the shortlist, so every model sees them exactly as it sees a
stranger, while the rest of the answer key stays behind to seed on. The band a
held-out person comes back with is what the model would have said about them
before anybody looked.

Two things are deliberately not folded in. ``CompanyScores`` is recomputed per
fold rather than read from its pipeline - that is what
``analysis.scores.ensemble`` does for every caller - because the stored one is
built from ``is_public`` and would hand ``PeopleScores`` the answer. And a
labelled person
the payloads have no row for is reported separately rather than counted as a
miss: the models never had anything to go on, which is a data problem and not a
modelling one, and mixing the two hides both.

Run it from ``data/scrapers`` after the score pipelines' sources are built::

    .venv/bin/python -m analysis.scripts.score_recall --all --no-backup
    .venv/bin/python -m analysis.scripts.score_recall --all --no-backup --folds 4

``--all`` and the other ``Extract`` flags are passed through, so the population
graded is the population that would be scored, and ``--refresh`` works as it
does for ``koryta`` - ``--refresh :PeopleMerged`` grades against the merge
already on disk rather than spending an hour rebuilding the wiki dump.
"""

from __future__ import annotations

import argparse
import collections
import dataclasses
import json
import os
import sys
from pathlib import Path

_SRC_ROOT = Path(__file__).resolve().parents[2]
if str(_SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(_SRC_ROOT))

from analysis.scores import PEOPLE_SCORE_MODELS  # noqa: E402
from analysis.scores.base import Population  # noqa: E402
from analysis.scores.ensemble import model_bands  # noqa: E402
from conductor import setup_context  # noqa: E402
from koryta import selected_resources  # noqa: E402
from scrapers.stores import Pipeline, ProcessPolicy  # noqa: E402

#: Bands at or above this count as "the model would have surfaced them". Band 3
#: is the top 15% of a model's positives (see `SCORE_BANDS`), which is about as
#: deep as anybody reads a queue.
SURFACED_BAND = 3


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--folds",
        type=int,
        default=2,
        help="How many slices to cut the answer key into. Two is the default "
        "because it holds out the most at once; more folds leave more seed "
        "behind and flatter the models.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("versioned") / "score_recall.json",
        help="Where to write the full per-person result.",
    )
    # Spelled as `koryta` spells it, because grading has to run against the
    # same sources a real run would use, and a source that is expensive to
    # rebuild - the wiki dump takes the best part of an hour - has to be
    # holdable at its cached version here too.
    parser.add_argument(
        "--refresh",
        action="append",
        default=[],
        help="Pipeline name to refresh, ':' to exclude, or 'all'.",
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Disable reading/writing versioned backups in shared GCS.",
    )
    args, _ = parser.parse_known_args()
    return args


def process_policy(refresh: list[str]) -> ProcessPolicy:
    """`koryta`'s `--refresh` handling: a leading ':' excludes instead."""
    return ProcessPolicy.with_default(
        [r for r in refresh if not r.startswith(":")],
        exclude_refresh=[r[1:] for r in refresh if r.startswith(":")],
    )


def fold_population(base: Population, held_out: set[str]) -> Population:
    """`base` with `held_out` demoted from answer key to candidate."""
    return dataclasses.replace(
        base,
        seed_weights={
            name: weight
            for name, weight in base.seed_weights.items()
            if name not in held_out
        },
        shortlist=list(base.shortlist)
        + [name for name in sorted(held_out) if name in base.employments],
    )


def report(
    title: str,
    labelled: list[str],
    bands: dict[str, dict[str, int]],
    control: dict[str, dict[str, int]],
    control_size: int,
) -> dict:
    """Print, and return, how the held-out group scored against the strangers."""

    def best(source, name):
        return max(source.get(name, {}).values(), default=0)

    held = collections.Counter(best(bands, n) for n in labelled)
    ctrl = collections.Counter(best(control, n) for n in control)
    ctrl[0] += control_size - sum(ctrl.values())

    print(f"\n{title}")
    print(f"{'band':<6}{'held out':>20}{'unlabelled shortlist':>24}")
    for band in (5, 4, 3, 2, 1, 0):
        h, c = held[band], ctrl[band]
        print(
            f"{band:<6}{h:>8} ({100.0 * h / max(len(labelled), 1):>5.1f}%)"
            f"{c:>13} ({100.0 * c / max(control_size, 1):>5.1f}%)"
        )

    surfaced = sum(h for b, h in held.items() if b >= SURFACED_BAND)
    ctrl_surfaced = sum(c for b, c in ctrl.items() if b >= SURFACED_BAND)
    held_rate = 100.0 * surfaced / max(len(labelled), 1)
    ctrl_rate = 100.0 * ctrl_surfaced / max(control_size, 1)
    print(
        f"\nband >= {SURFACED_BAND}: {surfaced}/{len(labelled)} "
        f"({held_rate:.1f}%) of the "
        f"held-out group, against {ctrl_rate:.1f}% of the unlabelled shortlist "
        f"- a lift of {held_rate / ctrl_rate:.2f}x"
        if ctrl_rate
        else f"\nband >= {SURFACED_BAND}: {surfaced}/{len(labelled)} ({held_rate:.1f}%)"
    )
    return {
        "n": len(labelled),
        "bands": dict(held),
        "control_bands": dict(ctrl),
        "surfaced_rate": held_rate,
        "control_surfaced_rate": ctrl_rate,
    }


def distinct_shortlist_size(base: Population) -> int:
    """How many people the shortlist actually names.

    `FirestoreCollection` selects its export by a `date=<day>` substring, so a
    day with two exports yields every node twice and `shortlist` carries every
    name twice with it. Scoring is unaffected - the models key on name through
    dicts - but a doubled denominator would halve every control rate reported
    here, which is the number the recall is judged against.
    """
    size = len(set(base.shortlist))
    if size != len(base.shortlist):
        print(
            f"note: shortlist had {len(base.shortlist)} entries for {size} "
            "distinct names - the export was read twice."
        )
    return size


def answer_key(base: Population, model, ctx) -> tuple[list[str], list[str], list[str]]:
    """The published, the upvoted-or-published, and the downvoted.

    Which positives were published has to be read back off the koryta frame
    rather than inferred from the seed weight. `Population` stores a published
    person at `IS_PUBLIC_SCORE` and a voted-on person at their own vote, so a
    `weight >= IS_PUBLIC_SCORE` test also catches everybody a human scored 3 or
    more - 150 people on today's data - reporting them as published and
    draining the upvoted group that is meant to be the comparison.
    """
    positives = sorted(n for n, w in base.seed_weights.items() if w > 0)
    negatives = sorted(n for n, w in base.seed_weights.items() if w < 0)

    koryta = model.people_koryta.read_or_process(ctx)
    is_public = dict(zip(koryta["full_name"], koryta["is_public"].fillna(False)))
    published = sorted(n for n in positives if bool(is_public.get(n, False)))
    return published, positives, negatives


def print_answer_key(published, positives, negatives, known, shortlist_size) -> None:
    """What the models are being graded against, and what it cannot cover."""
    print("=" * 72)
    print("ANSWER KEY")
    print("=" * 72)
    for label, names in (
        ("published", published),
        ("positive (published or upvoted)", positives),
        ("negative (downvoted)", negatives),
    ):
        have = known(names)
        print(
            f"  {label:<34} {len(names):>5}, of which {len(have):>5} "
            "have a payload row "
            f"({100.0 * len(have) / max(len(names), 1):>5.1f}%)"
        )
    print(f"  {'unlabelled shortlist':<34} {shortlist_size:>5}")

    if not negatives and not [n for n in positives if n not in set(published)]:
        print(
            "\nWARNING: the answer key holds no human votes at all, so only the\n"
            "published half of it is being graded. `KorytaVotes` picks its export\n"
            "by an exact `date=<today>` match and, unlike `KorytaPeople`, does not\n"
            "walk back a day when there is none - so a run started before the day's\n"
            "export lands sees zero votes and says nothing about it. Check\n"
            "`versioned/person_votes_<date>/` is not empty."
        )
    print(
        f"\n{len(positives) - len(known(positives))} labelled people have no "
        "payload row at all. No model can see them, so they are excluded from "
        "the grades below rather than counted as misses."
    )


def main() -> int:
    args = parse_args()
    if args.no_backup:
        os.environ["DISABLE_BACKUP"] = "1"
    models = [Pipeline.create(m) for m in PEOPLE_SCORE_MODELS]

    required: set = set()
    for model_type in PEOPLE_SCORE_MODELS:
        required |= selected_resources({model_type.__name__})
    ctx, _dumper = setup_context(required, policy=process_policy(args.refresh))

    base = models[0].population(ctx)
    payloads = models[0].people_payloads.read_or_process(ctx)

    shortlist_size = distinct_shortlist_size(base)
    published, positives, negatives = answer_key(base, models[0], ctx)

    def known(names):
        return [n for n in names if n in base.employments]

    print_answer_key(published, positives, negatives, known, shortlist_size)

    labelled = sorted(set(positives) | set(negatives))
    folds = [set(labelled[i :: args.folds]) for i in range(args.folds)]

    held_bands: dict[str, dict[str, int]] = collections.defaultdict(dict)
    control_bands: dict[str, dict[str, int]] = collections.defaultdict(dict)

    for i, held_out in enumerate(folds):
        pop = fold_population(base, held_out)
        print(
            f"\n--- fold {i + 1}/{args.folds}: {len(held_out)} held out, "
            f"{len(pop.seeds())} positive seeds left, "
            f"{len(pop.shortlist)} on the shortlist"
        )
        for model in models:
            bands = model_bands(model, ctx, pop, payloads)
            print(f"    {model.model_tag:<22} rated {len(bands)}")
            for name, band in bands.items():
                if name in held_out:
                    held_bands[name][model.model_tag] = band
                elif i == 0:
                    control_bands[name][model.model_tag] = band

    print("\n" + "=" * 72)
    print("RECALL - would the models have nominated the people we already know?")
    print("(band is the best across the five models; 0 = no model rated them)")
    print("=" * 72)

    results = {
        "published": report(
            "PUBLISHED people, held out:",
            known(published),
            held_bands,
            control_bands,
            shortlist_size,
        ),
        "upvoted": report(
            "UPVOTED people (human vote > 0), held out:",
            known([n for n in positives if n not in set(published)]),
            held_bands,
            control_bands,
            shortlist_size,
        ),
        "downvoted": report(
            "DOWNVOTED people (human vote < 0), held out - a good model scores "
            "these LOW:",
            known(negatives),
            held_bands,
            control_bands,
            shortlist_size,
        ),
    }

    print("\nper-model recall on held-out published people:")
    for model in models:
        tag = model.model_tag
        pool = known(published)
        rated = sum(1 for n in pool if tag in held_bands.get(n, {}))
        high = sum(
            1 for n in pool if held_bands.get(n, {}).get(tag, 0) >= SURFACED_BAND
        )
        print(
            f"  {tag:<22} rated {rated:>4}/{len(pool)} "
            f"({100.0 * rated / max(len(pool), 1):>5.1f}%), "
            f"band >= {SURFACED_BAND} for {high:>4}"
        )

    missed = [
        n
        for n in known(published)
        if max(held_bands.get(n, {}).values(), default=0) == 0
    ]
    print(f"\n{len(missed)} published people with a payload row that no model rated.")
    print("  first 20:", ", ".join(missed[:20]))

    invisible = [n for n in published if n not in base.employments]
    print(f"\n{len(invisible)} published people have no payload row at all.")
    print("  first 20:", ", ".join(invisible[:20]))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w") as fh:
        json.dump(
            {
                "folds": args.folds,
                "answer_key": {
                    "published": len(published),
                    "published_with_payload": len(known(published)),
                    "positive": len(positives),
                    "negative": len(negatives),
                    "shortlist": len(base.shortlist),
                },
                "results": results,
                "per_person": {n: b for n, b in held_bands.items()},
                "missed": missed,
                "no_payload_row": invisible,
            },
            fh,
            indent=2,
            ensure_ascii=False,
        )
    print(f"\nwrote {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
