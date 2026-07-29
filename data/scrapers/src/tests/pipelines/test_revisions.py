"""Field-presence checks on the ``revisions`` collection.

A field that is set on 100% of a node type's documents is part of that type's
schema, and its absence signals a data problem - see
``analysis/scripts/field_presence.py``, which is how this list was derived.
Referential and cross-collection invariants live in ``test_invariants.py``.

Most of what still fails here comes from one event: the December 2025 backfill
in ``src/scripts/create_revisions.py``, which minted a revision for every node
and edge that did not have one. It deletes ``source`` and ``target`` from the
data before writing (``for removable in ["user", "date", "source", "target"]``),
so its 1114 edge revisions describe a link without saying what it links. The
same batch also writes ``node_id`` as a document reference rather than an id,
which is what ``test_revision_node_id_is_a_document_id`` covers.
"""

import pytest

# Fields that must always be present on a revision of a given node ``type``,
# with the number of revisions known to be missing them today. The budget only
# keeps a known problem from failing the build; it should shrink, never grow.
REQUIRED_FIELDS = [
    # Every election revision should say which office was contested; 1891 do
    # not, and the elections list has nothing to show for them.
    ("election", "position", 1891),
    # Entirely the create_revisions.py backfill described above.
    ("employed", "source", 183),
    ("employed", "target", 183),
    ("owns", "source", 98),
    ("owns", "target", 98),
    # 40 from that backfill; the other 123 are employment recorded without a
    # job title.
    ("employed", "name", 163),
]


@pytest.fixture(scope="session")
def revisions(snapshot):
    return snapshot.collection("revisions")


def node_data(revision: dict) -> dict | None:
    """The nested node fields of a revision, or None if absent.

    Revisions wrap the node's fields inside a ``data`` sub-document.
    """
    data = revision.get("data")
    return data if isinstance(data, dict) else None


@pytest.mark.integration
def test_revisions_have_type(revisions):
    """No revision may exist without a ``data.type`` field."""
    # One "Test field" document with nothing else in it either - no node_id,
    # update_time or update_user.
    KNOWN_STUBS = 1

    missing = [
        revision["id"]
        for revision in revisions
        if (data := node_data(revision)) is None or "type" not in data
    ]

    assert len(missing) <= KNOWN_STUBS, (
        f"Found {len(missing)} revisions without a 'data.type' field, up from "
        f"the {KNOWN_STUBS} known stub. Sample IDs: {missing[:10]}"
    )


@pytest.mark.integration
@pytest.mark.parametrize(
    "node_type,field,budget",
    REQUIRED_FIELDS,
    ids=[f"{t}.{f}" for t, f, _ in REQUIRED_FIELDS],
)
def test_required_field_present(revisions, node_type, field, budget):
    """Every revision of ``node_type`` must have ``field`` present."""
    total = 0
    missing = []
    for revision in revisions:
        data = node_data(revision)
        if data is None or data.get("type") != node_type:
            continue
        total += 1
        if field not in data:
            missing.append(revision["id"])

    if total == 0:
        pytest.skip(f"No revisions of type '{node_type}' found in the export")

    assert len(missing) <= budget, (
        f"Found {len(missing)}/{total} '{node_type}' revisions missing the "
        f"'{field}' field, up from the {budget} known ones. "
        f"Sample IDs: {missing[:10]}"
    )
