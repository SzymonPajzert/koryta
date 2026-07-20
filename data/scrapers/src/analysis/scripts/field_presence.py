"""Analyse field presence per node ``type`` in the ``nodes`` and ``revisions``
Firestore collections.

Fields in koryta depend on the node ``type`` (e.g. only ``person`` nodes carry a
``wikipedia`` url). A field that is present on *every* node of a type is
effectively part of that type's schema; a field present on *none* is simply not
part of it. The interesting cases sit in between: fields that are set **often but
not always** for a given type. Those usually point at data that *should* be
filled in but is missing on some documents — the same class of problem that
``tests/pipelines/test_revisions.py`` checks for the ``type`` field.

For every (collection, type) pair this script reports, for each field, how many
documents of that type have it set and the resulting presence rate, and it
highlights the fields whose presence rate falls inside the "often but not always"
band (configurable, default 50%-100%).

Run from the ``src`` directory (same import root as the tests)::

    python -m analysis.scripts.field_presence
    python -m analysis.scripts.field_presence --min-rate 0.6 --max-count 5000

It reads the same koryta.pl Firestore dumps as the pipelines, picking the most
recent dump date that contains data (mirroring the retry loop in
``test_revisions.py``).
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd

# Allow running as a plain script (python analysis/scripts/field_presence.py)
# by making sure the ``src`` root is importable, like the test suite expects.
_SRC_ROOT = Path(__file__).resolve().parents[2]
if str(_SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(_SRC_ROOT))

from conductor import setup_context  # noqa: E402
from scrapers.koryta.download import FirestoreCollection  # noqa: E402

# Wrapper / bookkeeping keys that are not part of a node's own schema and should
# be ignored when analysing field presence.
#   - id/date are injected by FirestoreCollection.process
#   - revisions wrap the node fields inside ``data`` and add node_id / update_*
META_KEYS = {
    "id",
    "date",
    "node_id",
    "update_user",
    "update_time",
    "revision_id",
}


def load_snapshot(ctx: Any, collection: str, max_lookback: int = 30) -> pd.DataFrame:
    """Return a DataFrame for ``collection`` from the most recent dump date that
    has data, retrying earlier dates just like ``test_revisions.py`` does."""
    date_read = datetime.now().strftime("%Y-%m-%d")
    for _ in range(max_lookback):
        try:
            df = FirestoreCollection(collection, None, date_read).process(ctx)
            if len(df) > 0:
                print(f"Loaded {len(df)} '{collection}' documents for {date_read}.")
                return df
        except Exception as exc:  # noqa: BLE001 - dumps for a date may be absent
            print(f"  ({collection} @ {date_read} failed: {exc})")
        date_read = (
            datetime.strptime(date_read, "%Y-%m-%d") - pd.Timedelta(days=1)
        ).strftime("%Y-%m-%d")
    return pd.DataFrame()


def field_bag(row: pd.Series) -> tuple[str | None, dict[str, Any]]:
    """Extract ``(type, fields)`` from a document row.

    Revisions nest the node's fields under ``data``; node documents keep them at
    the top level. This handles both shapes transparently.
    """
    data = row.get("data")
    if isinstance(data, dict):
        fields = data
    else:
        # Top-level (node) documents: DataFrame.from_records unions all columns
        # and fills documents that lack a column with NaN. Those NaN cells are a
        # pandas artifact, not real keys, so drop them to keep "present" honest.
        fields = {
            k: v
            for k, v in row.items()
            if k != "data" and not (isinstance(v, float) and pd.isna(v))
        }

    node_type = fields.get("type")
    if not isinstance(node_type, str):
        node_type = None

    clean = {
        k: v
        for k, v in fields.items()
        if k not in META_KEYS and k != "type"
    }
    return node_type, clean


def _is_set(value: Any) -> bool:
    """Treat None / NaN / empty string / empty container as "not set"."""
    if value is None:
        return False
    if isinstance(value, float) and pd.isna(value):
        return False
    if isinstance(value, (str, list, dict, tuple, set)) and len(value) == 0:
        return False
    return True


def analyse(df: pd.DataFrame) -> tuple[
    Counter, dict[str, Counter], dict[str, Counter]
]:
    """Return per-type totals and, per type, the counts of documents where each
    field is *present as a key* and where it is *set to a non-empty value*."""
    type_totals: Counter = Counter()
    present_counts: dict[str, Counter] = defaultdict(Counter)
    set_counts: dict[str, Counter] = defaultdict(Counter)

    for _, row in df.iterrows():
        node_type, fields = field_bag(row)
        key = node_type if node_type is not None else "<missing type>"
        type_totals[key] += 1
        for field, value in fields.items():
            present_counts[key][field] += 1
            if _is_set(value):
                set_counts[key][field] += 1

    return type_totals, present_counts, set_counts


def report(
    collection: str,
    type_totals: Counter,
    present_counts: dict[str, Counter],
    set_counts: dict[str, Counter],
    min_rate: float,
    max_rate: float,
) -> None:
    print("\n" + "=" * 78)
    print(f"COLLECTION: {collection}")
    print("=" * 78)

    if not type_totals:
        print("No documents found.")
        return

    for node_type, total in type_totals.most_common():
        print(f"\n### type = {node_type!r}  ({total} documents)")

        # Union of all fields seen for this type, ordered by how often they are set.
        fields = sorted(
            set(present_counts[node_type]) | set(set_counts[node_type]),
            key=lambda f: set_counts[node_type][f],
            reverse=True,
        )
        if not fields:
            print("  (no non-meta fields)")
            continue

        often_but_not_always: list[tuple[str, float, int]] = []
        print(f"  {'field':<28} {'set':>6} {'rate':>7}   {'present':>7}")
        for field in fields:
            n_set = set_counts[node_type][field]
            n_present = present_counts[node_type][field]
            rate = n_set / total if total else 0.0
            flag = ""
            if min_rate <= rate < max_rate:
                often_but_not_always.append((field, rate, n_set))
                flag = "  <-- often but not always"
            print(
                f"  {field:<28} {n_set:>6} {rate:>6.1%}   {n_present:>7}{flag}"
            )

        if often_but_not_always:
            print(
                f"\n  Fields set for {min_rate:.0%}-<{max_rate:.0%} of {node_type!r} "
                f"nodes (candidate gaps):"
            )
            for field, rate, n_set in often_but_not_always:
                missing = total - n_set
                print(
                    f"    - {field}: set on {n_set}/{total} ({rate:.1%}), "
                    f"missing on {missing}"
                )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--collections",
        nargs="+",
        default=["nodes", "revisions"],
        help="Firestore collections to analyse (default: nodes revisions).",
    )
    parser.add_argument(
        "--min-rate",
        type=float,
        default=0.5,
        help="Lower bound (inclusive) of the 'often but not always' band.",
    )
    parser.add_argument(
        "--max-rate",
        type=float,
        default=1.0,
        help="Upper bound (exclusive) of the 'often but not always' band.",
    )
    args = parser.parse_args()

    ctx = setup_context(False)[0]

    for collection in args.collections:
        df = load_snapshot(ctx, collection)
        if df.empty:
            print(f"\nNo data found for collection {collection!r}; skipping.")
            continue
        type_totals, present_counts, set_counts = analyse(df)
        report(
            collection,
            type_totals,
            present_counts,
            set_counts,
            args.min_rate,
            args.max_rate,
        )


if __name__ == "__main__":
    main()
