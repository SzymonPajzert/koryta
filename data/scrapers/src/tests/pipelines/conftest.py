import os

import pytest

from conductor import setup_context
from scrapers.koryta.snapshot import Snapshot, load_snapshot


@pytest.fixture(scope="session")
def snapshot() -> Snapshot:
    """The most recent complete Firestore export, shared by the whole session.

    Session-scoped for two reasons: the export is tens of megabytes and parsing
    it is the slow part of these tests, and every test has to see the *same*
    export. Checking that an edge's target exists is meaningless if the edges
    come from one snapshot and the nodes from another taken twelve hours later.

    Set ``KORYTA_EXPORT`` to a timestamp from the bucket
    (``2026-07-28T14:25:08.897Z``) to pin the tests to one export - to reproduce
    a failure against the data that produced it, or to tell a regression apart
    from a difference between two days.
    """
    return load_snapshot(setup_context(False)[0], os.environ.get("KORYTA_EXPORT"))
