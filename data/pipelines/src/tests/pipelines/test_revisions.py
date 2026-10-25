"""Field-presence checks on the ``revisions`` collection.

A field that is set on 100% of a node type's documents is part of that type's
schema, and its absence signals a data problem - see
``analysis/scripts/field_presence.py``, which is how this list was derived.
Referential and cross-collection invariants live in ``test_invariants.py``.

Much of what used to fail here came from one event: the December 2025 backfill
in ``src/scripts/create_revisions.py``, which minted a revision for every node
and edge that did not have one. It deleted ``source`` and ``target`` from the
data before writing (``for removable in ["user", "date", "source", "target"]``),
so its edge revisions described a link without saying what it links, until
``scripts/migrate/archive/repair-migrated-revisions.ts`` restored them from the
edges. The same batch also wrote ``node_id`` as a document reference rather than
an id, which is what ``test_revision_node_id_is_a_document_id`` covers.
"""

import datetime

import pytest

#: Reads the production export rather than a fixture, so it is deselected by
#: default. Run with ``.venv/bin/pytest -m e2e src/tests/pipelines``.
pytestmark = pytest.mark.e2e

# Fields that must always be present on a revision of a given node ``type``,
# with the number of revisions known to be missing them today. The budget only
# keeps a known problem from failing the build; it should shrink, never grow,
# and a count past it warns until the buffer in conftest.py runs out.
REQUIRED_FIELDS = [
    # Every election revision should say which office was contested, and the
    # elections list has nothing to show for one that does not. Counted only
    # since CHECKED_SINCE: 0 on the 2026-10-25T03:00:33.098Z export.
    ("election", "position", 0),
    # None on the export of 2026-10-25T03:00Z. There were 183 and 98, all from
    # the create_revisions.py backfill described above, until
    # repair-migrated-revisions.ts restored them, and the script is fixed.
    ("employed", "source", 0),
    ("employed", "target", 0),
    ("owns", "source", 0),
    ("owns", "target", 0),
    # 40 from that backfill; the other 129 are employment recorded without a
    # job title. 163 on the 2026-07-28 export and 169 on the 2026-08-02 one -
    # the revision side of KNOWN_ROLELESS in test_invariants.py, which grew by
    # the same six, and stops growing with the same fix.
    ("employed", "name", 169),
]

# Fields checked only on the revisions written since a day, because the ones
# written before it are history no repair can lower: a revision is a record of
# what was written, and repairing the document writes a new one beside it.
#
# The 1,891 election revisions without an office (on every export read from
# 2026-10-09 to 2026-10-25) were all written by the uploads of March (1,324)
# and April 2026 (567). 1,478 of them sat on candidacies still without one on
# 10-24, 388 on candidacies named since and 25 on removed ones, so naming
# every office would still have left this at 1,891. Since May none has been
# written without one; the 16 written by the fold of local runs on 2026-10-23
# were rewritten in place that evening. A revision that carries the field as
# null still has it, as everywhere in this list: 15 election revisions since
# May do, all typed in by hand. The candidacies themselves are
# `test_a_candidacy_names_its_office` in test_invariants.py, which does fall
# as offices are named.
CHECKED_SINCE = {("election", "position"): "2026-05-01"}


def written_on(revision: dict) -> str:
    """The day a revision was written, as `YYYY-MM-DD`, or "" if it says not."""
    value = revision.get("update_time")
    if isinstance(value, datetime.datetime):
        return value.date().isoformat()
    return str(value or "")[:10]


@pytest.fixture(scope="session")
def revisions(snapshot):
    return snapshot.collection("revisions")


def node_data(revision: dict) -> dict | None:
    """The nested node fields of a revision, or None if absent.

    Revisions wrap the node's fields inside a ``data`` sub-document.
    """
    data = revision.get("data")
    return data if isinstance(data, dict) else None


def test_revisions_have_type(revisions, within_budget):
    """No revision may exist without a ``data.type`` field."""
    # One "Test field" document with nothing else in it either - no node_id,
    # update_time or update_user.
    KNOWN_STUBS = 1

    missing = [
        revision["id"]
        for revision in revisions
        if (data := node_data(revision)) is None or "type" not in data
    ]

    assert within_budget(len(missing), KNOWN_STUBS), (
        f"Found {len(missing)} revisions without a 'data.type' field, up from "
        f"the {KNOWN_STUBS} known stub. Sample IDs: {missing[:10]}"
    )


@pytest.mark.parametrize(
    "node_type,field,budget",
    REQUIRED_FIELDS,
    ids=[f"{t}.{f}" for t, f, _ in REQUIRED_FIELDS],
)
def test_required_field_present(revisions, node_type, field, budget, within_budget):
    """Every revision of ``node_type`` must have ``field`` present, counting
    from ``CHECKED_SINCE`` where the field has a day there."""
    since = CHECKED_SINCE.get((node_type, field), "")
    total = 0
    missing = []
    for revision in revisions:
        data = node_data(revision)
        if data is None or data.get("type") != node_type:
            continue
        # An undated revision stays in, so a writer that stops stamping its
        # revisions does not drop out of the check unseen.
        if since and "" < written_on(revision) < since:
            continue
        # A removal restates the document it takes down, so it has exactly the
        # fields that document had: taking down an election edge that never
        # said which office it was is the repair of a known gap, not a new one.
        # Three of each on 2026-10-09 - duplicates removed as „duplikat” in
        # September and October, and two merged away by merge-duplicate-people.
        if data.get("deleted") is True:
            continue
        total += 1
        if field not in data:
            missing.append(revision["id"])

    if total == 0:
        pytest.skip(f"No revisions of type '{node_type}' found in the export")

    assert within_budget(len(missing), budget), (
        f"Found {len(missing)}/{total} '{node_type}' revisions missing the "
        f"'{field}' field{f' since {since}' if since else ''}, up from the "
        f"{budget} known ones. "
        f"Sample IDs: {missing[:10]}"
    )
