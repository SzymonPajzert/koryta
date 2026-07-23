from datetime import datetime

import pandas as pd
import pytest

from conductor import setup_context
from scrapers.koryta.download import FirestoreCollection

# Fields that must always be present on a revision of a given node ``type``.
# Derived from the field-presence analysis (analysis/scripts/field_presence.py):
# a field that is set on 100% of a type's documents is part of that type's
# schema and its absence signals a data problem.
REQUIRED_FIELDS = [
    ("election", "position"),
    ("employed", "source"),
    ("employed", "target"),
    ("employed", "name"),
    ("owns", "source"),
    ("owns", "target"),
]


@pytest.fixture(scope="module")
def ctx():
    return setup_context(False)[0]


@pytest.fixture(scope="module")
def revisions(ctx):
    """Load the most recent revisions dump that contains data.

    Retries earlier dates because a given day's dump may be missing.
    """
    date_read = datetime.now().strftime("%Y-%m-%d")
    df = None

    for _ in range(30):
        try:
            input_documents = FirestoreCollection("revisions", None, date_read)
            df = input_documents.process(ctx)
            if len(df) > 0:
                break
        except Exception:
            pass
        date_read = (
            datetime.strptime(date_read, "%Y-%m-%d") - pd.Timedelta(days=1)
        ).strftime("%Y-%m-%d")

    assert df is not None and len(df) > 0, (
        "Could not find any revisions in the database dumps"
    )
    return df


def node_data(row) -> dict | None:
    """Return the nested node fields of a revision row, or None if absent.

    Revisions wrap the node's fields inside a ``data`` sub-document.
    """
    data = row.get("data")
    return data if isinstance(data, dict) else None


@pytest.mark.integration
def test_revisions_have_type(revisions):
    """No revision may exist without a ``data.type`` field."""
    missing = []
    for _, row in revisions.iterrows():
        data = node_data(row)
        if data is None or "type" not in data:
            missing.append(row.get("id"))

    assert not missing, (
        f"Found {len(missing)} revisions without a 'data.type' field. "
        f"Sample IDs: {missing[:10]}"
    )


@pytest.mark.integration
@pytest.mark.parametrize(
    "node_type,field",
    REQUIRED_FIELDS,
    ids=[f"{t}.{f}" for t, f in REQUIRED_FIELDS],
)
def test_required_field_present(revisions, node_type, field):
    """Every revision of ``node_type`` must have ``field`` present."""
    total = 0
    missing = []
    for _, row in revisions.iterrows():
        data = node_data(row)
        if data is None or data.get("type") != node_type:
            continue
        total += 1
        if field not in data:
            missing.append(row.get("id"))

    if total == 0:
        pytest.skip(f"No revisions of type '{node_type}' found in the dump")

    assert not missing, (
        f"Found {len(missing)}/{total} '{node_type}' revisions missing the "
        f"'{field}' field. Sample IDs: {missing[:10]}"
    )
