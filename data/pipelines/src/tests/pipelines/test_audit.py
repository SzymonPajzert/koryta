"""The ``audit`` collection actually records what administrators decided.

Approving a revision and publishing a page are the two decisions that settle
what the public sees, and until `server/utils/audit.ts` they left no usable
record: approval was written onto the revision as ``review_user``, which holds
only the latest verdict, and publication was written nowhere at all. Both now
file an entry here.

A log nobody checks rots in a particular way - it keeps being written while
quietly ceasing to mean anything, because nothing reads it back. These tests
read it back against the data it claims to describe: an entry that names a
document which does not exist, or a revision belonging to somebody else, is a
log that has come loose from what happened.

The collection did not exist before this shipped, and `read_collection` returns
an empty list for a collection the export has no directory for. So this file
passes vacuously against any export without it - which is deliberate, and is
why `test_audit_log_is_written_once_pages_are_being_published` states the
condition under which emptiness is itself the failure.

And every export so far has been without it. The scheduled export names the
collections it takes, and `audit` was not among them until 2026-10, so that
test failed every night accusing `recordAudit` of a write nobody had checked:
the log was there, the export was not looking. It now skips while the export
lacks the collection, and has teeth from the first export that has it.

Reading the export needs credentials and a download, so the whole file is
marked ``e2e`` and deselected by default. Run it with::

    .venv/bin/pytest -m e2e src/tests/pipelines/test_audit.py
"""

import datetime

import pytest

from scrapers.koryta.snapshot import reference_id

#: Reads the production export rather than a fixture, which is what `e2e`
#: marks: a test that needs state this repository does not carry.
pytestmark = pytest.mark.e2e

# From `shared/audit.ts`. Kept as a literal rather than parsed out of the
# TypeScript so that adding an action there has to be a deliberate change here
# too - a new kind of admin decision is exactly the thing worth noticing.
# `delete`, `merge` and `split` joined it there without joining this list, and
# would have read as malformed entries the first night the log was exported.
AUDIT_ACTIONS = {
    "approve",
    "reject",
    "publish",
    "unpublish",
    "delete",
    "merge",
    "split",
}

#: The actions that always name a revision: the two that settle one, and a
#: removal, which `/api/edges/delete` files as a revision of its own.
REVISION_ACTIONS = {"approve", "reject", "delete"}

#: The actions that name one only sometimes. A publication changes who may see
#: a page rather than what it says, and `/api/nodes/publish` files it bare -
#: but one filed in the same step as an approval ("zatwierdź i opublikuj", a
#: relation published from the queue) names the revision it went out with.
#: `merge` and `split` name none: they move relations, not revisions.
SOMETIMES_REVISION_ACTIONS = {"publish", "unpublish"}

AUDIT_COLLECTIONS = {"nodes", "edges"}


@pytest.fixture(scope="session")
def audit(snapshot):
    return snapshot.collection("audit")


def sample(items, limit=5):
    """The first few offenders, for a message that fits on a screen."""
    listed = list(items)[:limit]
    return ", ".join(str(item) for item in listed)


def test_every_entry_names_a_known_action(audit):
    """An entry whose action nobody recognises cannot be read back.

    The statistics page counts every document in this collection as one admin
    decision, so a malformed entry is not skipped - it is silently counted as
    something that happened.
    """
    unknown = [
        (entry["id"], entry.get("action"))
        for entry in audit
        if entry.get("action") not in AUDIT_ACTIONS
    ]

    assert not unknown, (
        f"{len(unknown)}/{len(audit)} audit entries carry an action outside "
        f"{sorted(AUDIT_ACTIONS)}, as (id, action): {sample(unknown)}"
    )


def test_every_entry_names_who_decided_and_when(audit):
    """The two fields the log exists for, plus the one the timeline reads.

    ``at`` is an ISO 8601 string rather than a Timestamp because the activity
    scan is a range query on it (`collectAdminDecisions`). Firestore compares
    strings lexicographically, so a differently-shaped timestamp does not raise
    - it sorts somewhere arbitrary and drops out of the window, and the decision
    it recorded stops appearing on the statistics page.
    """
    malformed = []
    for entry in audit:
        user = entry.get("user")
        at = entry.get("at")
        if not isinstance(user, str) or not user:
            malformed.append((entry["id"], "user", user))
            continue
        if not isinstance(at, str):
            malformed.append((entry["id"], "at", at))
            continue
        try:
            datetime.datetime.fromisoformat(at.replace("Z", "+00:00"))
        except ValueError:
            malformed.append((entry["id"], "at", at))

    assert not malformed, (
        f"{len(malformed)}/{len(audit)} audit entries cannot say who decided "
        f"or when, as (id, field, value): {sample(malformed)}"
    )


def test_only_revision_decisions_name_a_revision(audit):
    """`revision_id` is present for the actions that settle one, and only there.

    Both directions matter. An approval with no revision does not say what was
    approved; a merge carrying one implies a revision explains where the
    relations went, which none does. A publication is the one action that may
    go either way - see `SOMETIMES_REVISION_ACTIONS`.
    """
    wrong = [
        (entry["id"], entry.get("action"), entry.get("revision_id"))
        for entry in audit
        if entry.get("action") not in SOMETIMES_REVISION_ACTIONS
        and (entry.get("revision_id") is not None)
        != (entry.get("action") in REVISION_ACTIONS)
    ]

    assert not wrong, (
        f"{len(wrong)}/{len(audit)} audit entries disagree with their action "
        f"about naming a revision, as (id, action, revision_id): {sample(wrong)}"
    )


def test_every_entry_points_at_a_document_that_exists(audit, snapshot):
    """The target has to be real, in the collection the entry names.

    ``node_id`` on a revision holds the target's id whether the target is a node
    or an edge, which is why the entry carries the collection separately. If it
    named the wrong one, the log would describe decisions about documents that
    do not exist.
    """
    known = {
        name: {document["id"] for document in snapshot.collection(name)}
        for name in AUDIT_COLLECTIONS
    }

    dangling = []
    for entry in audit:
        collection = entry.get("collection")
        if collection not in AUDIT_COLLECTIONS:
            dangling.append((entry["id"], collection, entry.get("target_id")))
            continue
        target = reference_id(entry.get("target_id"))
        if target not in known[collection]:
            dangling.append((entry["id"], collection, target))

    assert not dangling, (
        f"{len(dangling)}/{len(audit)} audit entries point at a document that "
        f"is not in the collection they name, as (id, collection, target_id): "
        f"{sample(dangling)}"
    )


def test_every_settled_revision_belongs_to_the_document_it_settled(audit, snapshot):
    """An entry that names a revision must name one *of the target it claims*.

    This is what tells a log that records real decisions from one that records
    plausible-looking noise: the two ids in an entry have to agree with each
    other and with the revision itself. They are written from one place
    (`recordAudit`, in the same batch as the change), so disagreement means the
    write path has come apart.
    """
    revisions = {
        document["id"]: document for document in snapshot.collection("revisions")
    }

    mismatched = []
    for entry in audit:
        if entry.get("revision_id") is None:
            continue
        revision_id = reference_id(entry.get("revision_id"))
        revision = revisions.get(revision_id)
        if revision is None:
            mismatched.append((entry["id"], revision_id, "no such revision"))
            continue
        target = reference_id(entry.get("target_id"))
        belongs_to = reference_id(revision.get("node_id") or revision.get("nodeId"))
        if belongs_to != target:
            mismatched.append((entry["id"], revision_id, f"belongs to {belongs_to}"))

    assert not mismatched, (
        f"{len(mismatched)}/{len(audit)} revision decisions name a revision "
        f"that is not the target's, as (id, revision_id, problem): "
        f"{sample(mismatched)}"
    )


def test_audit_log_is_written_once_pages_are_being_published(audit, snapshot):
    """Somebody publishing a page has to leave an entry behind.

    The other tests here check that what *is* written is coherent; they all pass
    on an empty collection, which is the honest answer before the feature ships
    but would also be the answer if the write path quietly stopped working.

    A publication that predates the log leaves no trace, and neither does the
    `migratePublished` backfill, which writes `published` on every document at
    once and is not an admin decision. So the condition cannot be "some node is
    published". It is: once a *revision has been reviewed through the site* -
    which is the same deploy that introduced the log - the log is not empty.
    `review_user` is written by `applyRevision` and by the reject endpoint,
    both of which file an entry in the same batch.
    """
    if not snapshot.exports("audit"):
        pytest.skip(
            "the export did not take the audit collection - it is not in "
            "scheduledFirestoreExport's collectionIds yet - so its being empty "
            "says nothing about recordAudit"
        )

    reviewed = [
        document["id"]
        for document in snapshot.collection("revisions")
        if document.get("review_user")
    ]
    if not reviewed:
        pytest.skip("no revision has been reviewed through the site yet")

    assert audit, (
        f"{len(reviewed)} revisions carry a review_user, so admins have been "
        f"settling them through the site, but the audit collection is empty - "
        f"the write in recordAudit is not reaching Firestore."
    )
