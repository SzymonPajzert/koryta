"""Fit the weights of `analysis.scores.publishable`: of the people whose
examination ended, which ones we published.

    uv run python src/scripts/fit_publish_chance.py \\
        --anchor 2026-11-04 --until 2026-11-20

The chance has no clock in it (decision on 2026-11-20). An examination counts
once it has ended, however long it took, and a person nobody has finished with
is no label at all. It ends in a publication by any route, or in a finding that
there is nothing to publish:
- the BIP route read their declaration and held them for having no paid
  public post;
- a settled reading of their declaration gives a birth date the site calls a
  namesake's (`different_kind`), and no crop or found candidacy of theirs is
  still waiting;
- the owner voted them down (-1 found nothing, -2 and below found nothing worth
  publishing).
A crawl that did not find somebody's declaration ends nothing: a third of those
were found by the next crawl. A vote up that never became a publication is not
a publication either.

Facts are read at `--anchor`. A publication counts only for a page still
unpublished and unvoted there, because publishing adds to a page; the other
verdicts count whenever they came, because none of them writes a fact. Outcomes
are read at `--until`. Prints `WEIGHTS` and `INTERCEPT` to paste into the
model, with the AUC and what share of each band was published.
"""

import argparse
import collections
import re
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

#: The site owner (`set_auth_claims.OWNERS`), whose votes are verdicts.
OWNER = "of0BKlwqWLX21Cuml4NMHZ18xoC3"

#: How old somebody must be to have filed a declaration (`ADULT` on the site).
ADULT = 18

#: A publication record in one of these states is the BIP route's own verdict.
DECIDING = frozenset({"published", "queued", "publishing", "held", "confirmed"})


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


def different_kind(read: str, page: str, this_year: int) -> str:
    """Whether a settled date other than the page's is a namesake's or a
    misreading: the site's `differentKind` (frontend/shared/declarationPeople.ts)."""
    if len(read) < 4 or not re.fullmatch(r"\d{4}", read[:4]):
        return "mismatched"
    year = int(read[:4])
    if year > this_year - ADULT:
        return "mismatched"
    if len(read) == 4:
        return "namesake"
    if len(page) < 10 or not re.fullmatch(r"\d{4}", page[:4]):
        return "mismatched"
    page_year = int(page[:4])
    if year == page_year:
        slips = sum(1 for a, b in zip(read, page) if a != b)
        return "mismatched" if slips <= 2 else "namesake"
    if read[4:] == page[4:]:
        return "mismatched"
    return "namesake" if abs(year - page_year) < 10 else "mismatched"


def human_voted(stats: typing.Any) -> bool:
    votes = stats.get("votes") if isinstance(stats, dict) else None
    return bool(votes.get("humanVoted")) if isinstance(votes, dict) else False


def listed(value: typing.Any) -> list:
    return list(value) if isinstance(value, (list, tuple, np.ndarray)) else []


def held_for_no_post(publications: pd.DataFrame) -> tuple[dict[str, str], set[str]]:
    """The BIP route's own records: who it held only for having no paid public
    post, and everybody whose record decides their case one way or another."""
    records: dict[str, list[tuple[str, str]]] = collections.defaultdict(list)
    for person, status, reason in publications[
        ["personId", "status", "reason"]
    ].itertuples(index=False):
        records[str(person)].append((str(status), str(reason)))
    verdicts: dict[str, str] = {}
    for person, recs in records.items():
        if {status for status, _ in recs} & (DECIDING - {"held"}):
            continue
        holds = {reason for status, reason in recs if status == "held"}
        if holds and holds <= {"no_public_post"}:
            verdicts[person] = "no_public_post"
    decided = {p for p, recs in records.items() if any(s in DECIDING for s, _ in recs)}
    return verdicts, decided


def crop_kinds(
    extracts: pd.DataFrame, birth_dates: typing.Mapping[str, str], this_year: int
) -> tuple[dict[str, list[str]], dict[str, set[str]]]:
    """What every crop naming a page says of it, and the candidacies its crops
    cover: matched, namesake, mismatched, still reading, or the crop's state."""
    kinds: dict[str, list[str]] = collections.defaultdict(list)
    covered: dict[str, set[str]] = collections.defaultdict(set)
    for status, agreed, outcomes, people, keys in extracts[
        ["status", "agreed", "pageOutcomes", "personIds", "candidacyKeys"]
    ].itertuples(index=False):
        outcomes = outcomes if isinstance(outcomes, dict) else {}
        value = agreed.get("value") if isinstance(agreed, dict) else None
        settled = status == "agreed" and isinstance(value, str) and len(value) == 10
        for person in set(map(str, listed(people))) | set(outcomes):
            covered[person] |= set(map(str, listed(keys)))
            outcome = outcomes.get(person) if settled else None
            if outcome in ("queued", "held", "confirmed"):
                kinds[person].append("matched")
            elif outcome == "different" and isinstance(value, str):
                page = birth_dates.get(person, "")
                kinds[person].append(different_kind(value, page, this_year))
            elif status in ("open", "disputed") or (status == "agreed" and not outcome):
                kinds[person].append("reading")
            else:
                kinds[person].append(str(status))
    return kinds, covered


def bip_negatives(
    publications: pd.DataFrame,
    extracts: pd.DataFrame,
    candidacies: pd.DataFrame,
    birth_dates: typing.Mapping[str, str],
    this_year: int,
) -> dict[str, str]:
    """Pages the BIP route finished with nothing to publish, and why.

    The route's own record decides first: a page published, queued, held for a
    doubt or confirmed is no negative, and one held only for having no paid
    public post is. Without such a record the crops reading their declarations
    decide: a settled date the site calls a namesake's is a negative once none
    of their crops is still being read and every candidacy of theirs the
    crawler found has a crop.
    """
    verdicts, decided = held_for_no_post(publications)
    found: dict[str, set[str]] = collections.defaultdict(set)
    for key, status, people in candidacies[["key", "status", "personIds"]].itertuples(
        index=False
    ):
        if status == "found":
            for person in listed(people):
                found[str(person)].add(str(key))
    kinds, covered = crop_kinds(extracts, birth_dates, this_year)
    for person, read in kinds.items():
        if person in verdicts or person in decided:
            continue
        waiting = {"matched", "reading"} & set(read) or found[person] - covered[person]
        if "namesake" in read and not waiting:
            verdicts[person] = "namesake"
    return verdicts


def cohort(ctx, anchor: str, until: str) -> tuple[pd.DataFrame, np.ndarray, list[str]]:
    """Everybody whose examination ended: facts at `anchor`, outcomes at `until`."""
    nodes = FirestoreCollection("nodes", None, anchor).process(ctx)
    edges = FirestoreCollection("edges", None, anchor).process(ctx)
    stamp = pd.Timestamp(nodes["date"].iloc[0])
    read = {
        name: FirestoreCollection(name, None, until).process(ctx)
        for name in (
            "audit",
            "votes",
            "declarationPublications",
            "declarationExtracts",
            "declarationCandidacies",
        )
    }

    people = nodes[nodes["type"] == "person"]
    if "merged_into" in people:
        people = people[people["merged_into"].isna()]
    facts = site_facts(
        nodes.reindex(columns=NODE_FIELDS),
        edges.reindex(columns=EDGE_FIELDS),
        as_of_year=stamp.year,
    )
    public_then = set(people.loc[flag(people["published"]), "id"].astype(str))
    voted_then = set(people.loc[people["stats"].map(human_voted), "id"].astype(str))

    audit = read["audit"].assign(
        at=lambda df: pd.to_datetime(df["at"].astype(str), utc=True, errors="coerce")
    )
    last = {
        action: audit[audit["action"] == action].groupby("target_id")["at"].max()
        for action in ("publish", "unpublish")
    }
    # Published after the anchor and not taken down again since.
    published = {
        str(node)
        for node, at in last["publish"].items()
        if at > stamp and not last["unpublish"].get(node, pd.NaT) > at
    }

    labels: dict[str, tuple[int, str]] = {
        person: (1, "published") for person in published - public_then - voted_then
    }
    births = {
        str(person): str(birth)
        for person, birth in people.reindex(columns=["id", "birthDate"]).itertuples(
            index=False
        )
        if isinstance(birth, str)
    }
    negatives = bip_negatives(
        read["declarationPublications"],
        read["declarationExtracts"],
        read["declarationCandidacies"],
        births,
        stamp.year,
    )
    votes = read["votes"]
    owner = votes[(votes["userUid"] == OWNER) & votes["nodeId"].notna()]
    for person, categories in owner[["nodeId", "categoryVotes"]].itertuples(
        index=False
    ):
        value = categories.get("interesting") if isinstance(categories, dict) else None
        if isinstance(value, (int, float)) and value < 0:
            negatives.setdefault(str(person), "voted_down")
    for person, why in negatives.items():
        if person not in published:
            labels.setdefault(person, (0, why))

    ids = [person for person in labels if person in facts and person not in public_then]
    frame = pd.DataFrame([facts[node].features() for node in ids], index=ids)[FEATURES]
    y = np.array([labels[node][0] for node in ids], dtype=float)
    reasons = [labels[node][1] for node in ids]
    print(
        f"facts at {stamp}, outcomes at {until}: {len(ids)} examinations ended, "
        f"{int(y.sum())} published; {dict(collections.Counter(reasons))}"
    )
    return frame, y, reasons


def main(argv: typing.Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--anchor", required=True, help="Day of the export to read the facts at"
    )
    parser.add_argument(
        "--until", required=True, help="Day of the export to read the outcomes from"
    )
    args = parser.parse_args(argv)

    ctx, _ = setup_context()
    frame, labels, _ = cohort(ctx, args.anchor, args.until)
    x = frame.to_numpy(dtype=float)
    weights, intercept = fit_logistic(x, labels)
    chances = predict(x, weights, intercept)

    print(
        f"\nAUC {auc(labels, chances):.3f} in-sample, "
        f"{cross_validated_auc(x, labels):.3f} five-fold"
    )
    never_stood = frame["log_candidacies"].to_numpy() == 0
    if never_stood.any():
        print(
            f"   never stood: {never_stood.sum()} examined, "
            f"{labels[never_stood].mean():.1%} published, "
            f"{chances[never_stood].mean():.1%} predicted"
        )
    bands = np.array([chance_band(value) for value in chances])
    for floor, band in (*CHANCE_BANDS, (0.0, 1)):
        held = bands == band
        if held.any():
            print(
                f"   band {band} (from {floor:.0%}): {held.sum():6d} people, "
                f"{labels[held].mean():.1%} published"
            )
    print("\nWEIGHTS: dict[str, float] = {")
    for name, weight in zip(FEATURES, weights):
        print(f'    "{name}": {weight:.3f},')
    print(f"}}\nINTERCEPT = {intercept:.3f}")


if __name__ == "__main__":
    main()
