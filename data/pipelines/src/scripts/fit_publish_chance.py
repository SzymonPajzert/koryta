"""Fit the weights of `analysis.scores.publishable`: of the people nobody had
published or voted on at one export, who was published by a later one.

    uv run python src/scripts/fit_publish_chance.py \
        --anchor 2026-11-11 --until 2026-11-20

Reads both exports the way the night reads one (`FirestoreCollection`), builds
the facts with the model's own `site_facts`, and prints `WEIGHTS` and
`INTERCEPT` to paste into the model, with how well they rank (AUC, in-sample
and five-fold) and what share of each band was published. The chance it fits
is per the gap between the two exports and the pace the publishing routes ran
at: keep the gap near a week and refit when the pace changes.
"""

import argparse
import typing

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.stats import rankdata

from analysis.scores.publishable import (
    CHANCE_BANDS,
    WEIGHTS,
    chance_band,
    site_facts,
)
from conductor import setup_context
from scrapers.koryta.download import EDGE_FIELDS, NODE_FIELDS, FirestoreCollection
from scrapers.krs.columns import flag

#: Inverse L2 strength over standardized features, as a logistic regression's C.
C = 1.0
FEATURES = list(WEIGHTS)


def fit_logistic(
    x: np.ndarray, y: np.ndarray, c: float = C
) -> tuple[np.ndarray, float]:
    """L2 logistic regression; weights and intercept on the features' own scale."""
    mean = x.mean(axis=0)
    std = x.std(axis=0)
    std[std == 0] = 1.0
    z = (x - mean) / std

    def loss(params: np.ndarray) -> tuple[float, np.ndarray]:
        w, b = params[:-1], params[-1]
        logit = z @ w + b
        p = 1.0 / (1.0 + np.exp(-logit))
        value = np.sum(np.logaddexp(0.0, logit) - y * logit) + 0.5 * (w @ w) / c
        grad = np.append(z.T @ (p - y) + w / c, np.sum(p - y))
        return value, grad

    fitted = minimize(loss, np.zeros(x.shape[1] + 1), jac=True, method="L-BFGS-B")
    w_std, b_std = fitted.x[:-1], fitted.x[-1]
    return w_std / std, float(b_std - np.sum(w_std * mean / std))


def predict(x: np.ndarray, weights: np.ndarray, intercept: float) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-(x @ weights + intercept)))


def auc(y: np.ndarray, score: np.ndarray) -> float:
    """Area under the ROC curve, by ranks."""
    ranks = rankdata(score)
    positives = int(y.sum())
    negatives = len(y) - positives
    return float(
        (ranks[y == 1].sum() - positives * (positives + 1) / 2)
        / (positives * negatives)
    )


def cross_validated_auc(x: np.ndarray, y: np.ndarray, folds: int = 5) -> float:
    order = np.random.default_rng(0).permutation(len(y))
    held = np.empty(len(y))
    for fold in range(folds):
        test = order[fold::folds]
        train = np.setdiff1d(order, test)
        weights, intercept = fit_logistic(x[train], y[train])
        held[test] = predict(x[test], weights, intercept)
    return auc(y, held)


def human_voted(stats: typing.Any) -> bool:
    votes = stats.get("votes") if isinstance(stats, dict) else None
    return bool(votes.get("humanVoted")) if isinstance(votes, dict) else False


def cohort(ctx, anchor: str, until: str) -> tuple[pd.DataFrame, np.ndarray]:
    """Everybody unjudged at `anchor`: their facts, and whether `until` saw them
    published."""
    nodes = FirestoreCollection("nodes", None, anchor).process(ctx)
    edges = FirestoreCollection("edges", None, anchor).process(ctx)
    audit = FirestoreCollection("audit", None, until).process(ctx)
    stamp = pd.Timestamp(nodes["date"].iloc[0])

    people = nodes[nodes["type"] == "person"]
    unjudged = people[~flag(people["published"]) & ~people["stats"].map(human_voted)]
    facts = site_facts(
        nodes.reindex(columns=NODE_FIELDS),
        edges.reindex(columns=EDGE_FIELDS),
        as_of_year=stamp.year,
    )
    publications = audit[audit["action"] == "publish"].assign(
        at=lambda df: pd.to_datetime(df["at"].astype(str), utc=True, errors="coerce")
    )
    first = publications.groupby("target_id")["at"].min()
    published = {str(node) for node, at in first.items() if at > stamp}

    ids = [str(node) for node in unjudged["id"] if str(node) in facts]
    frame = pd.DataFrame([facts[node].features() for node in ids], index=ids)[FEATURES]
    labels = np.array([node in published for node in ids], dtype=float)
    print(
        f"{len(ids)} people unjudged at {stamp}, "
        f"{int(labels.sum())} published by {until}"
    )
    return frame, labels


def main(argv: typing.Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--anchor", required=True, help="Day of the export to read people at"
    )
    parser.add_argument(
        "--until", required=True, help="Day of the export to read publications from"
    )
    args = parser.parse_args(argv)

    ctx, _ = setup_context()
    frame, labels = cohort(ctx, args.anchor, args.until)
    x = frame.to_numpy(dtype=float)
    weights, intercept = fit_logistic(x, labels)
    chances = predict(x, weights, intercept)

    print(
        f"\nAUC {auc(labels, chances):.3f} in-sample, "
        f"{cross_validated_auc(x, labels):.3f} five-fold"
    )
    bands = np.array([chance_band(value) for value in chances])
    for floor, band in (*CHANCE_BANDS, (0.0, 1)):
        held = bands == band
        if held.any():
            print(
                f"   band {band} (from {floor:.0%}): {held.sum():6d} people, "
                f"{labels[held].mean():.1%} published, "
                f"{labels[held].sum() / max(labels.sum(), 1):.0%} of all published"
            )
    print("\nWEIGHTS: dict[str, float] = {")
    for name, weight in zip(FEATURES, weights):
        print(f'    "{name}": {weight:.3f},')
    print(f"}}\nINTERCEPT = {intercept:.3f}")


if __name__ == "__main__":
    main()
